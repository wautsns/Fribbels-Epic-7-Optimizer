/*
 * tesseract.js 的 OCR 服务，只跑在主进程。
 *
 * 为什么不在渲染进程里跑：Electron 16 的渲染进程建不了 worker 线程，
 * `new Worker(...)` 直接报 "The V8 platform used by this instance of Node does not
 * support creating Workers"；而且渲染进程有 document，tesseract.js 会把自己当浏览器，
 * 把 workerPath / langPath 改写成 file:// URL。主进程是普通 Node 环境，两个问题都没有。
 *
 * 渲染进程通过 ipcRenderer.invoke(CHANNEL, pngBuffer) 调用，主进程返回纯文本。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const CHANNEL = 'e7-tesseract-ocr';

// 只用来读数字（属性数值、套装等级），worker 参数固定，省掉每次调用再设置
const WHITELIST = '0123456789%.,';

// 多 PSM  fallback：layout analysis 对"只有单字符的 textline"有时会跳过，
// 不同 PSM 的检测策略不同，依次试取数字最多的
//   11=稀疏文本（优先）、6=统一块、4=单列、3=默认、12=自动+OSD
const PSM_CANDIDATES = ['11', '6', '4', '3', '12'];

// 是否启用 whitelist：true → 限制只识别数字和标点，false → 让 tesseract 自由检测
// strip + PSM=7 绕开了 layout analysis 的 textline 检测，whitelist 不会再干扰单行识别
const USE_WHITELIST = true;

let workerPromise = null;

function unpackedPath(target) {
    const asarSegment = 'app.asar' + path.sep;

    if (target && target.includes(asarSegment)) {
        return target.replace(asarSegment, 'app.asar.unpacked' + path.sep);
    }

    return target;
}

function requireRuntime() {
    // eval 让 webpack 不要把 tesseract.js 打进主进程 bundle，运行时按 app 目录解析
    return eval('require'); // eslint-disable-line no-eval
}

function moduleRoot() {
    try {
        return path.dirname(requireRuntime().resolve('tesseract.js/package.json'));
    } catch (error) {
        return unpackedPath(path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'tesseract.js'));
    }
}

// 语言包和 wasm 在打包时被解包到 app.asar.unpacked，worker 线程读不到 asar 内部
function assetsDir() {
    // moduleRoot 是 <app>/node_modules/tesseract.js，往上两级就是 app 根目录
    const bundled = path.join(moduleRoot(), '..', '..', 'assets', 'tesseract');
    const unpacked = unpackedPath(bundled);

    if (fs.existsSync(unpacked)) {
        return unpacked;
    }

    if (fs.existsSync(bundled)) {
        return bundled;
    }

    throw new Error(`tesseract assets not found: ${unpacked}`);
}

function workerScript() {
    const script = path.join(moduleRoot(), 'src', 'worker-script', 'node', 'index.js');
    const unpacked = unpackedPath(script);

    if (fs.existsSync(unpacked)) {
        return unpacked;
    }

    return script;
}

async function createWorker() {
    const { createWorker: tessCreateWorker } = requireRuntime()('tesseract.js');
    const cachePath = path.join(os.tmpdir(), 'e7-tesseract-cache');

    if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, { recursive: true });
    }

    const worker = await tessCreateWorker('eng', 1, {
        workerPath: workerScript(),
        langPath: assetsDir(),
        cachePath,
        gzip: true,
        logger: () => {},
    });

    const params = {};
    if (USE_WHITELIST) {
        params.tessedit_char_whitelist = WHITELIST;
    }
    // PSM 在 recognise 里按候选列表动态切换
    await worker.setParameters(params);

    return worker;
}

function getWorker() {
    if (!workerPromise) {
        workerPromise = createWorker().catch((error) => {
            // 允许下次调用重试（语言包缺失等问题可能被修好）
            workerPromise = null;
            throw error;
        });
    }

    return workerPromise;
}

// 从 text 里抽数字计数，和 screen.js 的 parsePlainNumbers 保持一致
function countNumbers(text) {
    const matches = String(text || '').match(/\d+(?:,\d{3})*(?:\.\d+)?/g);
    return matches ? matches.length : 0;
}

// png: Buffer / Uint8Array（IPC 传过来是 Uint8Array），返回 { text, confidence }
// opts.psm: 指定 PSM 直接用（比如单行图传 '7'），否则多 PSM fallback
async function recognise(png, opts = {}) {
    if (!png || !png.length) {
        return { text: '', confidence: null };
    }

    const worker = await getWorker();
    const buf = Buffer.from(png);

    // 指定了 PSM 就直接用（逐行识别时传 '7' 单行模式）
    if (opts.psm) {
        await worker.setParameters({ tessedit_pageseg_mode: opts.psm });
        const { data } = await worker.recognize(buf);
        return {
            text: String((data && data.text) || ''),
            confidence: data && typeof data.confidence === 'number' ? data.confidence : null,
        };
    }

    // 没指定 PSM → 多候选依次尝试，取数字最多的
    let best = { text: '', confidence: null, numCount: -1 };
    for (const psm of PSM_CANDIDATES) {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const { data } = await worker.recognize(buf);
        const text = String((data && data.text) || '');
        const conf = data && typeof data.confidence === 'number' ? data.confidence : null;
        const numCount = countNumbers(text);
        if (numCount > best.numCount) {
            best = { text, confidence: conf, numCount };
        }
        if (numCount >= 4) break; // 够 4 个就停
    }
    return { text: best.text, confidence: best.confidence };
}

async function terminate() {
    if (!workerPromise) {
        return;
    }

    const pending = workerPromise;
    workerPromise = null;

    try {
        const worker = await pending;
        await worker.terminate();
    } catch (error) {
        // 创建时就失败了，没有可关的 worker
    }
}

module.exports = {
    CHANNEL,
    recognise,
    terminate,
};
