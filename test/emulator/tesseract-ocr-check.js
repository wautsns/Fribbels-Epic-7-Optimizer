// 端到端验证「渲染进程发图 → 主进程 tesseract.js 识别 → 回传文本」这条真实链路：
// 主进程注册的 handler 和 app/main.dev.js 用的是同一个模块与同一个 channel，
// 渲染进程调用的也是 screen.js 里真实的 tesseractJsNumbers。
//
// 只用仓库内的语言包与应用内的 Jimp，不联网、不需要模拟器。
// 用法：.\node_modules\electron\dist\electron.exe test\emulator\tesseract-ocr-check.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const appDir = path.join(root, 'app');
const tesseractOcr = require(path.join(appDir, 'js', 'lib', 'emulator', 'tesseractOcr.js'));

const toUrlPath = value => value.replace(/\\/g, '/');

function checkScript() {
    return `
        (async () => {
            const Jimp = eval('require')(${JSON.stringify(toUrlPath(path.join(appDir, 'node_modules', 'jimp')))});
            const screen = eval('require')(${JSON.stringify(toUrlPath(path.join(appDir, 'js', 'lib', 'emulator', 'screen.js')))});

            const image = new Jimp(260, 96, 0xffffffff);
            const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
            image.print(font, 10, 28, '1234');

            const numbers = await screen.tesseractJsNumbers(image, { x: 0, y: 0, w: 260, h: 96 }, 2);

            return { numbers, tessJsEnabled: screen.isTesseractEnabled() };
        })()
    `;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
    // 与 app/main.dev.js 完全相同的接线方式
    ipcMain.handle(tesseractOcr.CHANNEL, (_event, png) => tesseractOcr.recognise(png));

    const win = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    });

    win.webContents.on('console-message', (event, level, message) => {
        console.log('[renderer]', message);
    });

    await win.loadFile(path.join(appDir, 'app.html')).catch(() => null);

    let failures = 0;
    const check = (name, ok, detail) => {
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` -> ${detail}`}`);
        if (!ok) failures += 1;
    };

    try {
        const out = await win.webContents.executeJavaScript(checkScript(), true);

        check(
            'renderer → main 的 OCR 返回了数字',
            Array.isArray(out.numbers) && out.numbers.length > 0,
            JSON.stringify(out.numbers)
        );
        check(
            '识别结果包含 1234',
            Array.isArray(out.numbers) && out.numbers.some(value => String(value).includes('1234')),
            JSON.stringify(out.numbers)
        );
        check('tesseract 仍启用（没有回退到 Windows OCR）', out.tessJsEnabled === true, String(out.tessJsEnabled));
    } catch (error) {
        console.error(error && error.stack ? error.stack : error);
        failures += 1;
    }

    await tesseractOcr.terminate().catch(() => null);
    app.exit(failures === 0 ? 0 : 1);
});

app.on('window-all-closed', () => {});
