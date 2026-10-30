/* eslint global-require: off, no-console: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./app/main.prod.js` using webpack. This gives us some performance wins.
 */
import 'core-js/stable';
import 'regenerator-runtime/runtime';
import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, ipcMain, Menu, MenuItem, screen } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
const remoteMain = require("@electron/remote/main");
const tesseractOcr = require('./js/lib/emulator/tesseractOcr');
// import MenuBuilder from './menu';

const isMac = process.platform === 'darwin'
var closed = false;

// Match build.appId
app.setAppUserModelId("fribbelse7optimizer");
app.setAsDefaultProtocolClient('fribbelse7optimizer');

const template = [
   {
      label: 'File',
      submenu: [
         isMac ? { role: 'close' } : { role: 'quit' }
      ]
   },

   {
      label: 'View',
      submenu: [
         {
            role: 'toggledevtools'
         },
         {
            type: 'separator'
         },
         {
            role: 'reload'
         },
         {
            role: 'forcereload'
         },
         {
            type: 'separator'
         },
         {
            role: 'resetzoom'
         },
         {
            role: 'zoomin'
         },
         {
            role: 'zoomout'
         },
         {
            type: 'separator'
         },
         {
            role: 'togglefullscreen'
         }
      ]
   },
   {
      role: 'window',
      submenu: [
         {
            role: 'minimize'
         },
         {
            role: 'close'
         }
      ]
   },

   {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = require('electron')
            await shell.openExternal('https://github.com/fribbels/Fribbels-Epic-7-Optimizer')
          }
        }
      ]
   }
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)

export default class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.allowDowngrade = false;
    autoUpdater.autoDownload = true;
  }
}

console.log("main.dev.ts");

let mainWindow = null;

// 记住窗口大小、位置和最大化状态，下次启动时恢复
const DEFAULT_WINDOW_WIDTH = 1394;
const DEFAULT_WINDOW_HEIGHT = 996;
const getWindowStateFile = () =>
  path.join(app.getPath('userData'), 'window-state.json');

const loadWindowState = () => {
  try {
    const state = JSON.parse(fs.readFileSync(getWindowStateFile(), 'utf8'));
    if (
      !state ||
      !Number.isFinite(state.width) ||
      !Number.isFinite(state.height) ||
      !Number.isFinite(state.x) ||
      !Number.isFinite(state.y) ||
      state.width < 400 ||
      state.height < 300
    ) {
      return null;
    }

    // 换显示器/分辨率后，避免窗口恢复到屏幕外
    const visible = screen.getAllDisplays().some(({ workArea }) =>
      state.x < workArea.x + workArea.width &&
      state.x + state.width > workArea.x &&
      state.y < workArea.y + workArea.height &&
      state.y + state.height > workArea.y
    );

    return visible ? state : null;
  } catch (err) {
    return null;
  }
};

let saveWindowStateTimer = null;

const saveWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    fs.writeFileSync(
      getWindowStateFile(),
      JSON.stringify({ ...bounds, isMaximized: mainWindow.isMaximized() }),
      'utf8'
    );
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
};

const scheduleSaveWindowState = () => {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(saveWindowState, 500);
};

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];

  return Promise.all(
    extensions.map((name) => installer.default(installer[name], forceDownload))
  ).catch(console.log);
};

const createWindow = async () => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '../resources');

  const getAssetPath = (paths) => {
    return path.join(RESOURCES_PATH, paths);
  };

  const savedState = loadWindowState();
  const windowOptions = {
    show: false,
    width: savedState ? savedState.width : DEFAULT_WINDOW_WIDTH,
    height: savedState ? savedState.height : DEFAULT_WINDOW_HEIGHT,
    icon: getAssetPath('icon.png'),
    webPreferences:
      (process.env.NODE_ENV === 'development' || process.env.E2E_BUILD === 'true') && process.env.ERB_SECURE !== 'true' ?
      {
        nodeIntegration: true,
        enableRemoteModule: true,
        contextIsolation: false
      } :
      {
        preload: path.join(__dirname, 'dist/renderer.prod.js'),
        nodeIntegration: true,
        enableRemoteModule: true,
        contextIsolation: false
      },
  };
  if (savedState) {
    windowOptions.x = savedState.x;
    windowOptions.y = savedState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (savedState && savedState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadURL(`file://${__dirname}/app.html`);
  // mainWindow.webContents.openDevTools();


  remoteMain.initialize();
  require('@electron/remote/main').enable(mainWindow.webContents)

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('resize', () => {
    mainWindow.webContents.send('resize');
    scheduleSaveWindowState();
  });

  mainWindow.on('move', () => {
    scheduleSaveWindowState();
  });

  mainWindow.on('resized', () => {
    mainWindow.webContents.send('resized');
  });

  mainWindow.on('close', (e) => {
    saveWindowState();
    if (!closed) {
      e.preventDefault();
      mainWindow.webContents.send('app-close');
    }
  });

  ipcMain.on('closed', _ => {
    closed = true;
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Auto-update checks are triggered only by the renderer's manual check action.

  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  saveWindowState();
});

if (process.env.E2E_BUILD === 'true') {
  // eslint-disable-next-line promise/catch-or-return
  app.whenReady().then(createWindow);
} else {
  app.on('ready', createWindow);
}

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindow();
});

ipcMain.on('app_version', (event) => {
  event.sender.send('app_version', { version: app.getVersion() });
});


ipcMain.on('test', async (event) => {
  const updates = await autoUpdater.checkForUpdates()
  console.log("TEST UPDATES")
  console.log(updates)
  event.sender.send('test', JSON.stringify(updates));
});

ipcMain.on('check', async (event) => {
  const updates = await autoUpdater.checkForUpdatesAndNotify()
  console.log(updates)
  event.sender.send('check', updates);
});

ipcMain.on('restart_app', () => {
  autoUpdater.quitAndInstall();
});

// 模拟器自动化的数字识别：tesseract.js 需要 worker 线程，只有主进程能满足，
// 渲染进程把裁剪好的 PNG 发过来，这里返回识别出的纯文本。
ipcMain.handle(tesseractOcr.CHANNEL, (_event, png) => tesseractOcr.recognise(png));

autoUpdater.on('update-available', (data) => {
  mainWindow.webContents.send('update_available');
});
autoUpdater.on('update-downloaded', (data) => {
  console.log("DOWNLOADED");
  console.log(data);
  mainWindow.webContents.send('update_downloaded', data);
});
autoUpdater.on('update-not-available', () => {
  mainWindow.webContents.send('update_not_available');
});
