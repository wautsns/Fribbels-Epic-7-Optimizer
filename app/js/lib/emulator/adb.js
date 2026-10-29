// Minimal adb driver for emulator automation (screencap + input).
// Only used by the GvG/equip automation features; every command is serialized.

const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB_CANDIDATES = [
    // MuMu
    'C:/Apps/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'C:/Program Files/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'C:/Program Files (x86)/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'D:/Program Files/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'C:/Program Files/Netease/MuMuPlayer-12.0/nx_main/adb.exe',
    // LDPlayer
    'C:/LDPlayer/LDPlayer9/adb.exe',
    'D:/LDPlayer/LDPlayer9/adb.exe',
    'C:/LDPlayer/LDPlayer14/adb.exe',
    'D:/LDPlayer/LDPlayer14/adb.exe',
    'C:/Program Files/LDPlayer/LDPlayer9/adb.exe',
    'D:/Program Files/LDPlayer/LDPlayer9/adb.exe',
    // Nox / BlueStacks / MEmu
    'C:/Program Files (x86)/Nox/bin/adb.exe',
    'D:/Program Files (x86)/Nox/bin/adb.exe',
    'C:/Program Files/BlueStacks_nxt/HD-Adb.exe',
    'C:/Program Files (x86)/Microvirt/MEmu/adb.exe',
];

// The emulators can be installed anywhere (e.g. D:/apps/leidian/LDPlayer9), so the
// install folder is read from the registry as well; every installer writes its
// InstallDir there.
const EMULATOR_REGISTRY_ROOTS = [
    'HKLM\\SOFTWARE\\leidian',
    'HKLM\\SOFTWARE\\Netease',
    'HKLM\\SOFTWARE\\WOW6432Node\\Netease',
    'HKCU\\SOFTWARE\\Netease',
    'HKLM\\SOFTWARE\\Nox',
    'HKLM\\SOFTWARE\\WOW6432Node\\Nox',
    'HKLM\\SOFTWARE\\BlueStacks_nxt',
    'HKLM\\SOFTWARE\\WOW6432Node\\BlueStacks_nxt',
    'HKLM\\SOFTWARE\\Microvirt',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microvirt',
];

// adb sits either in the install root (LDPlayer) or in a sub folder (MuMu, Nox, ...)
const ADB_RELATIVE_PATHS = [
    'adb.exe',
    'shell/adb.exe',
    'nx_main/adb.exe',
    'bin/adb.exe',
    'HD-Adb.exe',
    'platform-tools/adb.exe',
];

// LDPlayer 9/14 register their adb on 5555 (second instance 5557); MuMu on 16384,
// Nox on 7555
const DEFAULT_PORTS = ['127.0.0.1:16384', '127.0.0.1:7555', '127.0.0.1:5555', '127.0.0.1:5557', 'emulator-5554'];

let adbPath = null;
let serial = null;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Errors of this driver end up in the UI, so they go through i18next (the keys live in
// data/locales/*/translation.json); plain Node runs keep the English key.
function t(key, options) {
    return typeof i18next !== 'undefined' ? i18next.t(key, options) : key;
}

function regInstallDirs() {
    const dirs = [];

    if (process.platform !== 'win32') {
        return dirs;
    }

    for (const root of EMULATOR_REGISTRY_ROOTS) {
        let output = '';

        try {
            output = execFileSync('reg', ['query', root, '/s'], {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 5000,
                maxBuffer: 4 * 1024 * 1024,
                // a missing key prints a (localized) error on stderr; it is expected here
                stdio: ['ignore', 'pipe', 'ignore'],
            });
        } catch (error) {
            continue;
        }

        for (const line of String(output).split(/\r?\n/)) {
            const match = line.match(/Install(?:Dir|Path|Location)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i);
            if (!match) {
                continue;
            }

            // the value may still contain %ProgramFiles% style variables
            const value = match[1].trim().replace(/%([^%]+)%/g, (raw, name) => process.env[name] || raw);
            if (value) {
                dirs.push(value);
            }
        }
    }

    return dirs;
}

function adbInDir(dir) {
    for (const relative of ADB_RELATIVE_PATHS) {
        const candidate = path.join(dir, relative);
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (error) {
            // unreadable folder, keep looking
        }
    }

    return null;
}

function pathAdb() {
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);

    for (const dir of dirs) {
        try {
            const candidate = path.join(dir, 'adb.exe');
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (error) {
            // ignore malformed PATH entries
        }
    }

    return null;
}

// The registry wins over the hard coded guesses (it reflects this machine's install
// folders), then the common paths, then whatever adb is on the PATH.
function adbCandidates() {
    const registry = [];

    for (const dir of regInstallDirs()) {
        const found = adbInDir(dir);
        if (found && !registry.includes(found)) {
            registry.push(found);
        }
    }

    return registry.concat(ADB_CANDIDATES);
}

function detectAdbPath() {
    if (adbPath) {
        return adbPath;
    }

    const found = adbCandidates().find(candidate => fs.existsSync(candidate));
    adbPath = found || pathAdb();

    return adbPath;
}

function setAdbPath(value) {
    adbPath = value || null;
}

function setSerial(value) {
    serial = value || null;
}

function getSerial() {
    return serial;
}

function requireAdb() {
    if (!detectAdbPath()) {
        throw new Error(t('adb is not available. Set the emulator adb path in the Settings tab'));
    }
    return adbPath;
}

function execAdb(args, timeout = 15000) {
    return new Promise((resolve, reject) => {
        execFile(requireAdb(), args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(String(stderr || error.message).trim()));
                    return;
                }
                resolve(String(stdout));
            });
    });
}

function withSerial(args) {
    if (!serial) {
        throw new Error(t('No emulator device selected'));
    }
    return ['-s', serial, ...args];
}

// ---- screencap -------------------------------------------------------------
// Two modes: PNG (`screencap -p`, compressed on the device, slow) and raw
// (`screencap`, no encode). Measured on MuMu 12 @1280x720: PNG 400ms / 862KB,
// raw 287ms / 3.5MB — the PNG encoder on the device is the expensive part.
const SCREENSHOT_TIMEOUT = 15000;

function runScreencap(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(requireAdb(), withSerial(['exec-out', 'screencap', ...args]), {
            windowsHide: true,
        });

        const chunks = [];
        let stderr = '';

        child.stdout.on('data', chunk => chunks.push(chunk));
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });

        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(t('Screen capture timed out')));
        }, SCREENSHOT_TIMEOUT);

        child.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(stderr || t('Screen capture failed (exit code {{code}})', { code })));
                return;
            }
            resolve(Buffer.concat(chunks));
        });
    });
}

// screencap returns a PNG buffer (exec-out keeps the bytes intact)
function capture() {
    return runScreencap(['-p']);
}

// Raw framebuffer: a small header followed by width*height RGBA pixels.
// The header is 12 bytes on older Androids and 16 on newer ones (extra colorspace int),
// so it is derived from the payload size instead of being hard coded.
function parseRawScreencap(buffer) {
    if (!buffer || buffer.length < 16) {
        return null;
    }

    const width = buffer.readUInt32LE(0);
    const height = buffer.readUInt32LE(4);
    const format = buffer.readUInt32LE(8);

    // 1 = RGBA_8888, 2 = RGBX_8888 -> 4 bytes per pixel; anything else (e.g. RGB_565)
    // is left to the PNG path
    if ((format !== 1 && format !== 2) || !width || !height) {
        return null;
    }

    const pixels = width * height * 4;
    const headerSize = buffer.length - pixels;
    if (headerSize !== 12 && headerSize !== 16) {
        return null;
    }

    return { width, height, format, data: buffer.slice(headerSize) };
}

// Raw capture; returns null when the device does not return a supported format.
async function captureRaw() {
    return parseRawScreencap(await runScreencap([]));
}

async function listDevices() {
    const output = await execAdb(['devices']);
    return output
        .split(/\r?\n/)
        .slice(1)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [id, state] = line.split(/\s+/);
            return { id, state };
        });
}

// MuMu/LDPlayer expose the emulator over tcp; connect if it is not listed yet
async function connect(preferred = DEFAULT_PORTS) {
    const devices = await listDevices();
    const online = devices.filter(device => device.state === 'device');

    if (online.length > 0) {
        const preferredDevice = online.find(device => preferred.includes(device.id));
        serial = (preferredDevice || online[0]).id;
        return serial;
    }

    for (const port of preferred) {
        if (port.startsWith('emulator-')) {
            continue;
        }
        // a port that is not served at all fails fast; a served-but-silent adbd takes
        // the whole timeout, so keep it short and let the caller report the real reason
        await execAdb(['connect', port], 4000).catch(() => null);
    }

    const after = await listDevices();
    const connected = after.filter(device => device.state === 'device');
    if (connected.length === 0) {
        // listed but never handshakes: the emulator runs but its adbd does not answer
        const stuck = after.filter(device => device.state === 'offline');
        if (stuck.length > 0) {
            throw new Error(t('Emulator adb connection is offline ({{device}}): adbd is not responding. '
                + 'Restart the emulator, or check that ADB debugging is enabled in the emulator settings.',
                { device: stuck[0].id }));
        }

        throw new Error(t('No emulator device detected. Start the emulator first.'));
    }

    const preferredDevice = connected.find(device => preferred.includes(device.id));
    serial = (preferredDevice || connected[0]).id;
    return serial;
}

async function deviceSize() {
    const output = await execAdb(withSerial(['shell', 'wm', 'size']));
    const match = output.match(/(\d+)x(\d+)/);
    if (!match) {
        throw new Error(t('Unable to read the device resolution'));
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

// coordinates are in the emulator's own pixel space (landscape)
async function tap(x, y) {
    await execAdb(withSerial(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]));
}

async function longPress(x, y, duration = 700) {
    await execAdb(withSerial(['shell', 'input', 'swipe',
        String(Math.round(x)), String(Math.round(y)),
        String(Math.round(x)), String(Math.round(y)),
        String(Math.round(duration))]));
}

async function swipe(x1, y1, x2, y2, duration = 300) {
    await execAdb(withSerial(['shell', 'input', 'swipe',
        String(Math.round(x1)), String(Math.round(y1)),
        String(Math.round(x2)), String(Math.round(y2)),
        String(Math.round(duration))]));
}

async function back() {
    await execAdb(withSerial(['shell', 'input', 'keyevent', '4']));
}

async function currentFocus() {
    const output = await execAdb(withSerial(['shell', 'dumpsys', 'window']));
    const match = output.match(/mCurrentFocus=Window\{[^}]*\}\s*([^\s/]+)/);
    return match ? match[1] : '';
}

module.exports = {
    ADB_CANDIDATES,
    DEFAULT_PORTS,
    adbCandidates,
    regInstallDirs,

    detectAdbPath,
    setAdbPath,
    setSerial,
    getSerial,

    connect,
    listDevices,
    deviceSize,
    capture,
    captureRaw,
    tap,
    longPress,
    swipe,
    back,
    currentFocus,
    wait,
};
