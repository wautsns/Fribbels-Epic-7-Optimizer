// Minimal adb driver for emulator automation (screencap + input).
// Only used by the GvG/equip automation features; every command is serialized.

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB_CANDIDATES = [
    'C:/Apps/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'C:/Program Files/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'C:/Program Files (x86)/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'D:/Program Files/Netease/MuMuPlayer-12.0/shell/adb.exe',
    'C:/Program Files/Netease/MuMuPlayer-12.0/nx_main/adb.exe',
    'C:/Program Files (x86)/Nox/bin/adb.exe',
    'C:/LDPlayer/LDPlayer9/adb.exe',
    'C:/Program Files/BlueStacks_nxt/HD-Adb.exe',
];

const DEFAULT_PORTS = ['127.0.0.1:16384', '127.0.0.1:7555', 'emulator-5554'];

let adbPath = null;
let serial = null;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function detectAdbPath() {
    if (adbPath) {
        return adbPath;
    }

    const found = ADB_CANDIDATES.find(candidate => fs.existsSync(candidate));
    if (found) {
        adbPath = found;
    }

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
        throw new Error('adb not found, set the adb path first');
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
        throw new Error('No emulator device selected');
    }
    return ['-s', serial, ...args];
}

// screencap returns a PNG buffer (exec-out keeps the bytes intact)
function capture() {
    return new Promise((resolve, reject) => {
        const child = spawn(requireAdb(), withSerial(['exec-out', 'screencap', '-p']), {
            windowsHide: true,
        });

        const chunks = [];
        let stderr = '';

        child.stdout.on('data', chunk => chunks.push(chunk));
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });

        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('screencap timed out'));
        }, 15000);

        child.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(stderr || `screencap exited with ${code}`));
                return;
            }
            resolve(Buffer.concat(chunks));
        });
    });
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
        await execAdb(['connect', port]).catch(() => null);
    }

    const after = await listDevices();
    const connected = after.filter(device => device.state === 'device');
    if (connected.length === 0) {
        throw new Error('No adb device available. Start the emulator first.');
    }

    const preferredDevice = connected.find(device => preferred.includes(device.id));
    serial = (preferredDevice || connected[0]).id;
    return serial;
}

async function deviceSize() {
    const output = await execAdb(withSerial(['shell', 'wm', 'size']));
    const match = output.match(/(\d+)x(\d+)/);
    if (!match) {
        throw new Error('Unable to read device resolution');
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

    detectAdbPath,
    setAdbPath,
    setSerial,
    getSerial,

    connect,
    listDevices,
    deviceSize,
    capture,
    tap,
    longPress,
    swipe,
    back,
    currentFocus,
    wait,
};
