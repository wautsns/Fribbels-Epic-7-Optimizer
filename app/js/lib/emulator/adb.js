// Minimal adb driver for emulator automation (screencap + input).
// Only used by the GvG/equip automation features; every command is serialized.

const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
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
const DEFAULT_PORTS = [
    '127.0.0.1:16384',
    '127.0.0.1:7555',
    '127.0.0.1:5555',
    '127.0.0.1:5557',
    'emulator-5554',
];

let adbPath = null;
let serial = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
            const match = line.match(
                /Install(?:Dir|Path|Location)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i
            );
            if (!match) {
                continue;
            }

            // the value may still contain %ProgramFiles% style variables
            const value = match[1]
                .trim()
                .replace(/%([^%]+)%/g, (raw, name) => process.env[name] || raw);
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
    const dirs = String(process.env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean);

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

// 设置页里填的 adb（空 = 自动探测）；实际使用的路径由 detectAdbPath() 决定
let configuredAdbPath = null;

function detectAdbPath() {
    if (adbPath) {
        return adbPath;
    }

    if (configuredAdbPath) {
        adbPath = configuredAdbPath;
        return adbPath;
    }

    const found = adbCandidates().find((candidate) => fs.existsSync(candidate));
    adbPath = found || pathAdb();

    return adbPath;
}

function setAdbPath(value) {
    const next = value || null;

    // The emulator flow re-reads the settings field before every item; an unchanged
    // setting must not tear down the running stream (that is what silently dropped every
    // run back to one-shot screencap).
    if (next === configuredAdbPath) {
        return;
    }

    configuredAdbPath = next;

    const previous = adbPath;
    adbPath = null;

    let resolved = null;
    try {
        resolved = detectAdbPath();
    } catch (error) {
        resolved = null;
    }

    if (previous && resolved && previous !== resolved) {
        // 真的换了 adb，原来的流必须作废（会话/转发都挂在旧 adb server 上）
        stopStream().catch(() => {});
    }
}

function setSerial(value) {
    const next = value || null;
    if (next !== serial) {
        stopStream().catch(() => {});
    }
    serial = next;
}

function getSerial() {
    return serial;
}

function requireAdb() {
    if (!detectAdbPath()) {
        throw new Error(
            t(
                'adb is not available. Set the emulator adb path in the Settings tab'
            )
        );
    }
    return adbPath;
}

function execAdb(args, timeout = 15000) {
    return new Promise((resolve, reject) => {
        execFile(
            requireAdb(),
            args,
            { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(String(stderr || error.message).trim()));
                    return;
                }
                resolve(String(stdout));
            }
        );
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
        const child = spawn(
            requireAdb(),
            withSerial(['exec-out', 'screencap', ...args]),
            {
                windowsHide: true,
            }
        );

        const chunks = [];
        let stderr = '';

        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(t('Screen capture timed out')));
        }, SCREENSHOT_TIMEOUT);

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(
                    new Error(
                        stderr ||
                            t('Screen capture failed (exit code {{code}})', {
                                code,
                            })
                    )
                );
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
// Prefers the streaming backend when it is running (measured 108-167ms vs 263ms one-shot),
// and silently falls back to a one-shot `exec-out screencap` when the stream is unavailable.
async function captureRaw() {
    if (streamActive()) {
        try {
            return await streamCapture();
        } catch (error) {
            markStreamBroken(error);
        }
    }
    return parseRawScreencap(await runScreencap([]));
}

async function listDevices() {
    const output = await execAdb(['devices']);
    return output
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [id, state] = line.split(/\s+/);
            return { id, state };
        });
}

// MuMu/LDPlayer expose the emulator over tcp; connect if it is not listed yet
async function connect(preferred = DEFAULT_PORTS) {
    const devices = await listDevices();
    const online = devices.filter((device) => device.state === 'device');

    if (online.length > 0) {
        const preferredDevice = online.find((device) =>
            preferred.includes(device.id)
        );
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
    const connected = after.filter((device) => device.state === 'device');
    if (connected.length === 0) {
        // listed but never handshakes: the emulator runs but its adbd does not answer
        const stuck = after.filter((device) => device.state === 'offline');
        if (stuck.length > 0) {
            throw new Error(
                t(
                    'Emulator adb connection is offline ({{device}}): adbd is not responding. ' +
                        'Restart the emulator, or check that ADB debugging is enabled in the emulator settings.',
                    { device: stuck[0].id }
                )
            );
        }

        throw new Error(
            t('No emulator device detected. Start the emulator first.')
        );
    }

    const preferredDevice = connected.find((device) =>
        preferred.includes(device.id)
    );
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
function tapCommand(x, y) {
    return `input tap ${Math.round(x)} ${Math.round(y)}`;
}

function longPressCommand(x, y, duration = 700) {
    const px = Math.round(x);
    const py = Math.round(y);
    return `input swipe ${px} ${py} ${px} ${py} ${Math.round(duration)}`;
}

function swipeCommand(x1, y1, x2, y2, duration = 300) {
    return `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(
        x2
    )} ${Math.round(y2)} ${Math.round(duration)}`;
}

const BACK_COMMAND = 'input keyevent 4';

// 走流式通道时一次往返就够（实测 143ms vs 一次性的 259ms）
async function runInputCommand(command) {
    if (streamActive()) {
        try {
            await streamCommand(command);
            return;
        } catch (error) {
            markStreamBroken(error);
        }
    }
    await execAdb(withSerial(['shell', ...command.split(' ')]));
}

async function tap(x, y) {
    await runInputCommand(tapCommand(x, y));
}

async function longPress(x, y, duration = 700) {
    await runInputCommand(longPressCommand(x, y, duration));
}

async function swipe(x1, y1, x2, y2, duration = 300) {
    await runInputCommand(swipeCommand(x1, y1, x2, y2, duration));
}

async function back() {
    await runInputCommand(BACK_COMMAND);
}

/*
 * 把一串动作合并成一次下发（收益最大的一档：3 条 input 摊薄到每条约 40ms）。
 * steps 支持：
 *   {tap: [x, y]} / {longPress: [x, y, ms]} / {swipe: [x1, y1, x2, y2, ms]} /
 *   {back: true} / {wait: ms} / 'raw shell command'
 * 没有流通道时逐条执行，行为与现在完全一致。
 */
async function batch(steps) {
    const commands = [];

    for (const step of steps || []) {
        if (!step) continue;
        if (typeof step === 'string') {
            commands.push(step);
            continue;
        }
        if (step.wait != null) {
            commands.push(
                `sleep ${(Math.max(0, Number(step.wait)) / 1000).toFixed(3)}`
            );
            continue;
        }
        if (step.tap) {
            commands.push(tapCommand(step.tap[0], step.tap[1]));
            continue;
        }
        if (step.longPress) {
            commands.push(longPressCommand(...step.longPress));
            continue;
        }
        if (step.swipe) {
            commands.push(swipeCommand(...step.swipe));
            continue;
        }
        if (step.back) {
            commands.push(BACK_COMMAND);
            continue;
        }
        if (step.command) {
            commands.push(step.command);
            continue;
        }
    }

    if (!commands.length) return;

    if (streamActive()) {
        try {
            await streamCommand(commands.join('; '));
            return;
        } catch (error) {
            markStreamBroken(error);
        }
    }

    for (const command of commands) {
        await execAdb(withSerial(['shell', ...command.split(' ')]));
    }
}

async function currentFocus() {
    const output = await execAdb(withSerial(['shell', 'dumpsys', 'window']));
    const match = output.match(/mCurrentFocus=Window\{[^}]*\}\s*([^\s/]+)/);
    return match ? match[1] : '';
}

/* ---------------------------------------------------------------------------
 * 流式后端：adb forward + 设备侧 toybox netcat
 *
 * 为什么不用 `adb shell` 常驻：
 *   - `screencap` 的二进制输出经过 shell 的 pty 会被 `\n` -> `\r\n` 改写
 *     （实测每帧多出 6.5 万字节，像素被破坏）；设备内部关不掉这层翻译
 *     （`/dev/tty` 不存在，`stty` 报 "Not a typewriter"）。
 *   - 只有 `exec-out` 是二进制安全的，但它每次都要起一个 adb 进程。
 * 所以数据走 TCP（`adb forward`），由设备侧 `toybox netcat -L` 把连接交给脚本：
 *   - "frames" 连接：发一行 -> 抓一帧（按需，空闲时设备侧阻塞，零消耗）
 *   - "cmd" 连接：发一行命令 -> 回 OK（点击/滑动复用同一条通道）
 * 实测：单帧 263ms -> 108~167ms；单次点击 259ms -> 143ms；批量 3 条 -> 40ms/条。
 * ------------------------------------------------------------------------- */
const STREAM_PORT = 27910;
const STREAM_SCRIPT = '/data/local/tmp/e7_stream.sh';
const STREAM_TIMEOUT = 15000;
const STREAM_DISPATCH = [
    'read -r _mode',
    'if [ "$_mode" = "frames" ]; then',
    '  while read -r _req; do screencap; done',
    'else',
    '  while read -r _cmd; do',
    '    [ -n "$_cmd" ] || continue',
    // 必须走 sh -c：直接用 $_cmd 的话，变量展开不会再把 ";" 当命令分隔符，
    // "input tap 1160 103; sleep 0.25" 会整体当成 input 的参数（tap 拿到 "103;"
    // 解析失败被静默丢弃），批量点击就全哑了。
    '    sh -c "$_cmd" >/dev/null 2>&1',
    "    printf 'OK\\n'",
    '  done',
    'fi',
].join('\n');

let stream = null;

function streamActive() {
    return !!(stream && !stream.broken);
}

function markStreamBroken(error) {
    if (!stream || stream.broken) return;
    stream.broken = true;
    console.warn(
        '[emulator] streaming backend disabled, falling back to one-shot adb:',
        error && error.message
    );
}

function streamStats() {
    if (!stream) return null;
    return {
        active: !stream.broken,
        port: stream.port,
        captures: stream.captures,
        commands: stream.commands,
        lastCaptureMs: stream.lastCaptureMs,
    };
}

function connectSocket(port, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => {
            socket.destroy();
            reject(
                new Error(
                    t('Connecting to the emulator capture stream timed out')
                )
            );
        }, timeout);
        socket.once('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function attachFrameSocket(ctx) {
    ctx.frameSock.on('data', (chunk) => {
        ctx.frameBuf = Buffer.concat([ctx.frameBuf, chunk]);
        drainFrames(ctx);
    });
    ctx.frameSock.on('error', (error) => markStreamBroken(error));
    ctx.frameSock.on('close', () =>
        markStreamBroken(new Error('frame socket closed'))
    );
}

function drainFrames(ctx) {
    while (ctx.frameWaiter) {
        const buffer = ctx.frameBuf;
        if (buffer.length < 16) return;

        const width = buffer.readUInt32LE(0);
        const height = buffer.readUInt32LE(4);
        const format = buffer.readUInt32LE(8);
        const plausible =
            (format === 1 || format === 2) &&
            width > 0 &&
            height > 0 &&
            width <= 8192 &&
            height <= 8192;
        if (!plausible) {
            // 丢一个字节重新对齐（连接中断/残包后还能自己恢复）
            ctx.frameBuf = buffer.subarray(1);
            continue;
        }

        const need = width * height * 4 + ctx.headerSize;
        if (buffer.length < need) return;

        const data = buffer.subarray(ctx.headerSize, need);
        ctx.frameBuf = buffer.subarray(need);

        const waiter = ctx.frameWaiter;
        ctx.frameWaiter = null;
        clearTimeout(waiter.timer);
        ctx.captures++;
        ctx.lastCaptureMs = Date.now() - waiter.startedAt;
        waiter.resolve({ width, height, format, data });
    }
}

function attachCommandSocket(ctx) {
    ctx.cmdSock.on('data', (chunk) => {
        ctx.cmdBuf += chunk.toString('latin1');
        const index = ctx.cmdBuf.indexOf('OK\n');
        if (index < 0) return;
        ctx.cmdBuf = ctx.cmdBuf.slice(index + 3);
        const waiter = ctx.cmdWaiter;
        ctx.cmdWaiter = null;
        if (waiter) {
            clearTimeout(waiter.timer);
            ctx.commands++;
            waiter.resolve();
        }
    });
    ctx.cmdSock.on('error', (error) => markStreamBroken(error));
    ctx.cmdSock.on('close', () =>
        markStreamBroken(new Error('command socket closed'))
    );
}

function streamCapture() {
    const ctx = stream;
    return new Promise((resolve, reject) => {
        if (!ctx || ctx.broken) {
            reject(new Error(t('The emulator capture stream is not running')));
            return;
        }
        if (ctx.frameWaiter) {
            reject(new Error(t('A screen capture is already in progress')));
            return;
        }

        const waiter = { resolve, reject, startedAt: Date.now() };
        waiter.timer = setTimeout(() => {
            if (ctx.frameWaiter === waiter) ctx.frameWaiter = null;
            reject(new Error(t('Screen capture timed out')));
        }, STREAM_TIMEOUT);
        ctx.frameWaiter = waiter;

        try {
            ctx.frameSock.write('1\n');
        } catch (error) {
            ctx.frameWaiter = null;
            clearTimeout(waiter.timer);
            reject(error);
        }
    });
}

function streamCommand(command) {
    const ctx = stream;
    return new Promise((resolve, reject) => {
        if (!ctx || ctx.broken) {
            reject(new Error(t('The emulator capture stream is not running')));
            return;
        }
        if (ctx.cmdWaiter) {
            reject(new Error(t('An emulator command is already in progress')));
            return;
        }

        const waiter = { resolve, reject };
        waiter.timer = setTimeout(() => {
            if (ctx.cmdWaiter === waiter) ctx.cmdWaiter = null;
            reject(new Error(t('The emulator command timed out')));
        }, STREAM_TIMEOUT);
        ctx.cmdWaiter = waiter;

        try {
            ctx.cmdSock.write(`${command}\n`);
        } catch (error) {
            ctx.cmdWaiter = null;
            clearTimeout(waiter.timer);
            reject(error);
        }
    });
}

/*
 * 开一次流（一次换装 = 起一次，结束 stopStream）。
 * 设备不支持（没有 toybox netcat / 不是 RGBA 帧）时抛错，调用方应忽略并继续用一次性截图。
 */
async function startStream(options = {}) {
    if (streamActive()) return true;
    if (!serial) throw new Error(t('No emulator device selected'));

    const port = options.port || STREAM_PORT;

    // 上次异常退出可能留下转发布/监听进程，先幂等清理
    await stopStream().catch(() => {});

    // 能力探测：toybox 的 netcat 支持 "-l COMMAND" 吗（输出不要截断，-l 那行在后面）
    const help = await execAdb(
        withSerial(['shell', 'toybox netcat --help 2>&1'])
    );
    if (!/-l\b/.test(help || '')) {
        throw new Error(
            t('This emulator does not support the streaming capture backend')
        );
    }

    const encoded = Buffer.from(STREAM_DISPATCH, 'utf8').toString('base64');
    await execAdb(
        withSerial([
            'shell',
            `echo ${encoded} | base64 -d > ${STREAM_SCRIPT}; chmod 755 ${STREAM_SCRIPT}`,
        ])
    );
    await execAdb(withSerial(['forward', `tcp:${port}`, `tcp:${port}`]));

    // 帧头长度（12 或 16 字节）用一次普通截图探测，之后按固定长度分帧
    const probeBuffer = await runScreencap([]);
    const probe = parseRawScreencap(probeBuffer);
    if (!probe) {
        await execAdb(withSerial(['forward', '--remove', `tcp:${port}`])).catch(
            () => {}
        );
        throw new Error(
            t('Raw screen capture is not supported by this device')
        );
    }
    const headerSize = probeBuffer.length - probe.width * probe.height * 4;

    const listener = spawn(
        requireAdb(),
        withSerial([
            'shell',
            `toybox netcat -L -p ${port} sh ${STREAM_SCRIPT}`,
        ]),
        {
            windowsHide: true,
        }
    );
    listener.stderr.on('data', () => {});
    listener.on('error', () => {});

    const ctx = {
        port,
        headerSize,
        listener,
        frameSock: null,
        cmdSock: null,
        frameBuf: Buffer.alloc(0),
        cmdBuf: '',
        frameWaiter: null,
        cmdWaiter: null,
        broken: false,
        captures: 0,
        commands: 0,
        lastCaptureMs: 0,
    };

    try {
        await wait(250);
        ctx.frameSock = await connectSocket(port);
        ctx.frameSock.write('frames\n');
        ctx.cmdSock = await connectSocket(port);
        ctx.cmdSock.write('cmd\n');
        attachFrameSocket(ctx);
        attachCommandSocket(ctx);
    } catch (error) {
        try {
            listener.kill();
        } catch (e) {
            /* ignore */
        }
        try {
            ctx.frameSock && ctx.frameSock.destroy();
        } catch (e) {
            /* ignore */
        }
        try {
            ctx.cmdSock && ctx.cmdSock.destroy();
        } catch (e) {
            /* ignore */
        }
        await execAdb(withSerial(['forward', '--remove', `tcp:${port}`])).catch(
            () => {}
        );
        throw error;
    }

    stream = ctx;
    return true;
}

/*
 * 关流并清理：断开两个连接、杀掉宿主侧监听进程、移除 adb forward、删掉设备脚本。
 * 可重复调用（没有流时也做一次幂等清理，用来扫掉上次崩溃的残留）。
 */
async function stopStream() {
    const ctx = stream;
    stream = null;

    const port = (ctx && ctx.port) || STREAM_PORT;

    if (ctx) {
        if (ctx.frameWaiter) {
            clearTimeout(ctx.frameWaiter.timer);
            ctx.frameWaiter = null;
        }
        if (ctx.cmdWaiter) {
            clearTimeout(ctx.cmdWaiter.timer);
            ctx.cmdWaiter = null;
        }
        try {
            ctx.frameSock && ctx.frameSock.destroy();
        } catch (e) {
            /* ignore */
        }
        try {
            ctx.cmdSock && ctx.cmdSock.destroy();
        } catch (e) {
            /* ignore */
        }
        try {
            ctx.listener && ctx.listener.kill();
        } catch (e) {
            /* ignore */
        }
    }

    if (!serial) return;

    await execAdb(withSerial(['forward', '--remove', `tcp:${port}`])).catch(
        () => {}
    );
    await execAdb(withSerial(['shell', `rm -f ${STREAM_SCRIPT}`])).catch(
        () => {}
    );
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
    batch,
    currentFocus,
    startStream,
    stopStream,
    streamActive,
    streamStats,
    wait,
};
