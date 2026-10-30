// 在打包产物上验证 OCR 链路：直接 require app.asar 里的 tesseractOcr / screen，
// 覆盖「worker 脚本与语言包在 app.asar.unpacked、模块本身在 app.asar 里」这条真实路径。
//
// 先 yarn package-win，再运行：
//   .\node_modules\electron\dist\electron.exe test\emulator\packaged-ocr-check.js

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const asarPath = process.env.E7_ASAR || path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const asar = asarPath.replace(/\\/g, '/');

function checkScript() {
    return `
        (async () => {
            const Jimp = eval('require')(${JSON.stringify(asar + '/node_modules/jimp')});
            const screen = eval('require')(${JSON.stringify(asar + '/js/lib/emulator/screen.js')});

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
    let failures = 0;
    const check = (name, ok, detail) => {
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` -> ${detail}`}`);
        if (!ok) failures += 1;
    };

    if (!fs.existsSync(asarPath)) {
        console.log(`FAIL 找不到打包产物：${asarPath}`);
        app.exit(1);
        return;
    }

    // 与 app/main.dev.js 完全相同的接线方式
    const tesseractOcr = require(`${asar}/js/lib/emulator/tesseractOcr.js`);
    ipcMain.handle(tesseractOcr.CHANNEL, (_event, png) => tesseractOcr.recognise(png));

    const win = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    });

    win.webContents.on('console-message', (event, level, message) => {
        console.log('[renderer]', message);
    });

    await win.loadURL('about:blank').catch(() => null);

    try {
        const out = await win.webContents.executeJavaScript(checkScript(), true);

        check('ASAR 内语言包可读', fs.existsSync(path.join(asarPath + '.unpacked', 'assets', 'tesseract', 'eng.traineddata.gz')));
        check(
            'ASAR 内 tesseract.js 已解包',
            fs.existsSync(path.join(asarPath + '.unpacked', 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'))
        );
        check(
            'renderer → main 的 OCR 返回了数字',
            Array.isArray(out.numbers) && out.numbers.length > 0,
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
