// Screen reading helpers for emulator automation:
// capture -> crop -> template match / Windows OCR.

const Jimp = require('jimp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const adb = require('./adb');

const templateCache = {};
let ocrQueue = Promise.resolve();
let tempIndex = 0;

function appDir() {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
        const pathname = decodeURIComponent(window.location.pathname);
        return pathname.slice(0, pathname.lastIndexOf('/')).replace(/^\//, '');
    }
    return path.join(__dirname, '../../..');
}

function toWinPath(value) {
    return value.replace(/\//g, '\\');
}

async function loadTemplate(name) {
    if (!templateCache[name]) {
        templateCache[name] = await Jimp.read(path.join(appDir(), 'assets', 'emulator', name));
    }
    return templateCache[name];
}

async function capture() {
    const buffer = await adb.capture();
    return Jimp.read(buffer);
}

function crop(image, region) {
    return image.clone().crop(region.x, region.y, region.w, region.h);
}

function luminance(image, region) {
    let sum = 0;
    let count = 0;
    const { data, width } = image.bitmap;
    const maxX = Math.min(image.bitmap.width, region.x + region.w);
    const maxY = Math.min(image.bitmap.height, region.y + region.h);

    for (let y = Math.max(0, region.y); y < maxY; y += 2) {
        for (let x = Math.max(0, region.x); x < maxX; x += 2) {
            const idx = (y * width + x) * 4;
            sum += (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
            count++;
        }
    }

    return count ? sum / count : 0;
}

function regionDiff(image, template, x, y) {
    const a = image.bitmap;
    const b = template.bitmap;
    let sum = 0;
    let count = 0;

    for (let ty = 0; ty < b.height; ty++) {
        for (let tx = 0; tx < b.width; tx++) {
            const px = x + tx;
            const py = y + ty;
            if (px < 0 || py < 0 || px >= a.width || py >= a.height) {
                continue;
            }
            const ia = (py * a.width + px) * 4;
            const ib = (ty * b.width + tx) * 4;
            const ga = a.data[ia] * 0.299 + a.data[ia + 1] * 0.587 + a.data[ia + 2] * 0.114;
            const gb = b.data[ib] * 0.299 + b.data[ib + 1] * 0.587 + b.data[ib + 2] * 0.114;
            sum += Math.abs(ga - gb);
            count++;
        }
    }

    return count ? sum / count : 255;
}

// Mean absolute difference between two frames inside a region (used to detect
// whether a panel opened/closed)
function regionDelta(a, b, region) {
    const widthA = a.bitmap.width;
    const widthB = b.bitmap.width;
    const maxX = Math.min(region.x + region.w, a.bitmap.width, b.bitmap.width);
    const maxY = Math.min(region.y + region.h, a.bitmap.height, b.bitmap.height);
    let sum = 0;
    let count = 0;

    for (let y = Math.max(0, region.y); y < maxY; y += 3) {
        for (let x = Math.max(0, region.x); x < maxX; x += 3) {
            const ia = (y * widthA + x) * 4;
            const ib = (y * widthB + x) * 4;
            sum += Math.abs(a.bitmap.data[ia] - b.bitmap.data[ib]);
            count++;
        }
    }

    return count ? sum / count : 0;
}

// Best match for a template around (x, y) with a small search radius
async function matchTemplate(image, name, x, y, radius = 4) {
    const template = await loadTemplate(name);
    let best = { x, y, score: Infinity };

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const score = regionDiff(image, template, x + dx, y + dy);
            if (score < best.score) {
                best = { x: x + dx, y: y + dy, score };
            }
        }
    }

    return best;
}

// ---- Tesseract.js (bundled wasm engine, no local installation required) ----
let tessJsWorker = null;
let tessJsAssets = null;

// The worker thread cannot open files inside app.asar, so electron-builder unpacks
// assets/tesseract next to the archive (app.asar.unpacked). If that folder is missing
// (e.g. an unpacked asar), the files are copied to a temp folder once.
function tesseractJsAssets() {
    if (tessJsAssets) {
        return tessJsAssets;
    }

    const source = path.join(appDir(), 'assets', 'tesseract');

    // running from source: the folder is a normal directory
    if (!source.includes('app.asar')) {
        tessJsAssets = source;
        return source;
    }

    const unpacked = source.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    if (fs.existsSync(unpacked)) {
        tessJsAssets = unpacked;
        return unpacked;
    }

    const base = path.join(os.tmpdir(), 'e7-tesseract-' + process.pid);

    if (!fs.existsSync(base)) {
        fs.mkdirSync(base, { recursive: true });
    }

    for (const name of fs.readdirSync(source)) {
        const target = path.join(base, name);
        if (!fs.existsSync(target)) {
            fs.writeFileSync(target, fs.readFileSync(path.join(source, name)));
        }
    }

    tessJsAssets = base;
    return base;
}

async function tesseractJsWorkerInstance() {
    if (tessJsWorker) {
        return tessJsWorker;
    }

    const base = tesseractJsAssets();
    // eval('require') keeps webpack from bundling tesseract.js into the renderer bundle
    const requireRuntime = eval('require');
    const { createWorker } = requireRuntime('tesseract.js');

    // the cache must be writable (the packaged assets folder may be read only)
    const cachePath = path.join(os.tmpdir(), 'e7-tesseract-cache');
    if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, { recursive: true });
    }

    tessJsWorker = await createWorker('eng', 1, {
        corePath: path.join(base, 'tesseract-core-lstm.wasm.js'),
        langPath: base,
        cachePath,
        gzip: true,
        logger: () => {},
    });

    await tessJsWorker.setParameters({
        tessedit_char_whitelist: '0123456789%.,',
        tessedit_pageseg_mode: '6',
    });

    return tessJsWorker;
}

function parsePlainNumbers(text) {
    const matches = String(text || '').match(/\d+(?:,\d{3})*(?:\.\d+)?/g);
    return matches ? matches.map(value => Number(value.replace(/,/g, ''))) : [];
}

async function tesseractJsNumbers(frame, region, scale = 4) {
    try {
        const worker = await tesseractJsWorkerInstance();
        const scaled = crop(frame, region).scale(scale, Jimp.RESIZE_BICUBIC);
        const buffer = await scaled.getBufferAsync(Jimp.MIME_PNG);
        const { data } = await worker.recognize(buffer);
        const numbers = parsePlainNumbers(data.text);
        return numbers.length ? numbers : null;
    } catch (error) {
        return null;
    }
}

// OCR through Windows.Media.Ocr (powershell); language '' -> system profile (zh-Hans)
function ocr(image, lang = '', scale = 3) {
    const job = ocrQueue.then(() => runOcr(image, lang, scale));
    ocrQueue = job.catch(() => null);
    return job;
}

// PowerShell is a separate process and cannot execute files inside app.asar,
// so the script is copied to a real temp path when the app is packaged.
function resolveScriptPath(baseDir = appDir()) {
    const bundled = path.join(baseDir, 'js', 'lib', 'emulator', 'winocr.ps1');

    if (!bundled.includes('app.asar')) {
        return bundled;
    }

    const extracted = path.join(os.tmpdir(), `e7-winocr-${process.pid}.ps1`);
    if (!fs.existsSync(extracted)) {
        fs.writeFileSync(extracted, fs.readFileSync(bundled));
    }

    return extracted;
}

function runOcr(image, lang, scale) {
    return runOcrOnce(image, lang, scale).catch(() => runOcrOnce(image, lang, scale));
}

function runOcrOnce(image, lang, scale) {
    return new Promise((resolve, reject) => {
        const scaled = scale && scale !== 1 ? image.clone().scale(scale) : image;
        const tempPath = path.join(os.tmpdir(), `e7ocr-${process.pid}-${tempIndex++}.png`);

        scaled.write(tempPath, () => {
            const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', toWinPath(resolveScriptPath()), '-Path', toWinPath(tempPath)];
            if (lang) {
                args.push('-Lang', lang);
            }

            execFile('powershell.exe', args, { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
                fs.unlink(tempPath, () => null);
                if (error) {
                    console.warn('GvG/emulator OCR failed', error.message, stderr);
                    reject(new Error(typeof i18next !== 'undefined'
                        ? i18next.t('Screen recognition failed, please retry')
                        : 'Screen recognition failed, please retry'));
                    return;
                }
                resolve(parseOcr(stdout, scale || 1));
            });
        });
    });
}

function parseOcr(stdout, scale) {
    return String(stdout || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^\d+\|/.test(line))
        .map(line => {
            const [x, y, w, h, ...rest] = line.split('|');
            return {
                x: Math.round(Number(x) / scale),
                y: Math.round(Number(y) / scale),
                w: Math.round(Number(w) / scale),
                h: Math.round(Number(h) / scale),
                text: rest.join('|'),
            };
        });
}

// numbers found in OCR lines, e.g. "11％" -> { value: 11, percent: true }
function extractNumbers(lines) {
    const numbers = [];

    lines.forEach(line => {
        // thousands separators ("2,835" / "2，835") must stay one number
        const matches = String(line.text || '').match(/(?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d+)?\s*[%％]?/g) || [];
        matches.forEach(match => {
            const value = parseFloat(match.replace(/[^\d.]/g, ''));
            if (!isNaN(value)) {
                numbers.push({
                    value,
                    percent: /[%％]/.test(match),
                    x: line.x,
                    y: line.y,
                });
            }
        });
    });

    return numbers;
}

module.exports = {
    appDir,
    resolveScriptPath,
    capture,
    crop,
    luminance,
    regionDelta,
    matchTemplate,
    ocr,
    tesseractJsNumbers,
    extractNumbers,
};
