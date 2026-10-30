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
const PSM = '6';

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

    await worker.setParameters({
        tessedit_char_whitelist: WHITELIST,
        tessedit_pageseg_mode: PSM,
    });

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

// png: Buffer / Uint8Array（IPC 传过来是 Uint8Array），返回识别到的纯文本
async function recognise(png) {
    if (!png || !png.length) {
        return '';
    }

    const worker = await getWorker();
    const { data } = await worker.recognize(Buffer.from(png));
    return String((data && data.text) || '');
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
