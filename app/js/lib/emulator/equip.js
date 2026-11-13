// Single-item gear swap over adb.
// Flow: verify page -> verify/set acquisition-ascending sort -> pick slot ->
//       apply filters -> select candidates -> verify values -> equip.

const fs = require('fs');
const path = require('path');

const adb = require('./adb');
const screen = require('./screen');

const LAYOUT = {
    // measured icon centers (pitch ~59px); the rightmost tab is at ~1061, not 1095
    slots: {
        Weapon: [765, 105],
        Helmet: [825, 105],
        Armor: [884, 105],
        Necklace: [943, 105],
        Ring: [1001, 105],
        Boots: [1061, 105],
    },
    sortButton: [1160, 103],
    sortAcquisitionRow: [1000, 211],
    filters: {
        set: [810, 163],
        main: [810, 209],
        sub1: [967, 163],
        sub2: [967, 209],
        sub3: [1124, 163],
        sub4: [1124, 209],
    },
    options: {
        all: [740, 268],
        Attack: [740, 318],
        Defense: [740, 368],
        Health: [740, 418],
        AttackPercent: [740, 468],
        DefensePercent: [740, 518],
        HealthPercent: [1010, 268],
        Speed: [1010, 318],
        CriticalHitChancePercent: [1010, 368],
        CriticalHitDamagePercent: [1010, 418],
        EffectivenessPercent: [1010, 468],
        EffectResistancePercent: [1010, 518],
    },
    grid: {
        x0: 771,
        y0: 300,
        dx: 100,
        dy: 125,
        cols: 5,
        rows: 3,
        cellW: 94,
        cellH: 118,
    },
    gridTop: 240,
    gridBottom: 620,
    // label areas of the five filter chips, used to read back the applied state
    chipRegions: {
        main: { x: 735, y: 191, w: 150, h: 38 },
        sub1: { x: 893, y: 145, w: 150, h: 38 },
        sub2: { x: 893, y: 191, w: 150, h: 38 },
        sub3: { x: 1050, y: 145, w: 150, h: 38 },
        sub4: { x: 1050, y: 191, w: 150, h: 38 },
    },
    equipButton: [1130, 670],
    valuePanel: { x: 265, y: 265, w: 140, h: 200 },
    // 只截四个 substat —— 主属性（攻击 525 / 生命 8% 这类）不进 OCR：
    //   武器/头盔/盔甲主属性固定，项链/戒指/鞋子靠 chip 筛选类型
    // 旧坐标 y:262,h:162 包含主属性行（OCR y=14 处读到 525），
    // 裁图只收顶部空白，底部保持旧坐标 423（=298+125）不变
    // panel.png 实测旧裁图顶部 14px 是 panel 标题空白区，substat 第一行在裁图 y=14 处
    // 改后 y:303（往下移 5px），h=423-303=120，底部锚定 423 不动
    valuePanelNumbers: { x: 255, y: 303, w: 95, h: 120 },
    // delta 检测区域：往下移 30px（y:333 替代 y:303），避开装备槽特效
    // OCR 还是用上面的 valuePanelNumbers（strip 硬切要精准对齐 4 行 substat）
    panelDeltaRegion: { x: 255, y: 333, w: 95, h: 90 },
    gridRegion: { x: 723, y: 240, w: 542, h: 380 },
};

const sleep = adb.wait;

// 「点击/滑动 + 等待」合并成一次下发：省掉一次往返（流式通道下约 117ms，一次性模式约 259ms）。
// 设备侧 sleep 支持小数（实测 sleep 0.650 -> 655ms），语义与宿主侧等待一致。
async function inputThenWait(action, waitMs) {
    await adb.batch([action, { wait: waitMs }]);
}

// adb path comes from the settings tab; empty -> auto-detect (MuMu / LDPlayer / Nox ...)
// 每次开始一件装备前都会重读设置，这里只在路径真的变化时打日志
let lastLoggedAdbPath = null;

function configureAdb() {
    let configured = '';

    try {
        const input =
            typeof document !== 'undefined'
                ? document.getElementById('settingAdbPath')
                : null;
        configured = input && input.value ? input.value.trim() : '';
    } catch (e) {
        configured = '';
    }

    adb.setAdbPath(configured || null);

    const path = adb.detectAdbPath();
    if (!path) {
        throw new Error(
            t(
                'Emulator adb not found: checked the usual install folders, the registry and PATH. ' +
                    'Set the emulator adb path in the Settings tab.'
            )
        );
    }

    if (path !== lastLoggedAdbPath) {
        lastLoggedAdbPath = path;
        console.log('[emulator] adb:', path);
    }

    return path;
}

// User facing errors are translated from the keys in data/locales/*/translation.json
function t(key, options) {
    return typeof i18next !== 'undefined' ? i18next.t(key, options) : key;
}

// Errors that mean "the game is not on the manage equipment page" (as opposed to an
// adb/driver problem) carry this flag, so the caller can show the right hint.
function pageError(message) {
    const error = new Error(message);
    error.notOnManagePage = true;
    return error;
}

// ---- capture, stall detection and page recovery ----------------------------
// The emulator freezes for a second or two now and then. While it is frozen, taps are
// queued by the input system and executed later, on whatever screen happens to be there
// at that moment - which is how a run "clicks itself out" of the manage equipment page.
// So: a capture that takes far longer than usual marks a stall, and after a stall nothing
// taps again until the picture has settled and the page has been re-checked.
const recentCaptureTimes = [];
const STALL_FACTOR = 2.5;
const STALL_LOG_LIMIT = 8;

function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function fullFrameRegion(frame) {
    return { x: 0, y: 0, w: frame.bitmap.width, h: frame.bitmap.height };
}

// Same template/threshold as assertManagePage, but usable on an already captured frame.
async function looksLikeManagePage(frame) {
    const match = await screen.matchTemplate(
        frame,
        'page_manage.png',
        40,
        8,
        6
    );
    return match.score <= 28;
}

// Plain capture without the stall/settle handling (used by the recovery helpers to avoid
// recursing into captureFrame).
function rawCapture() {
    return captureVisible().then((result) => result.frame);
}

// Opening the substat filter panel makes the emulator go fully black for a second or two
// (measured: mean luminance 0.0 for >1.4s). A black frame must never be used for a page
// check, a panel check or an OCR read - acting on it is what made the run tap into a black
// screen and end up outside the manage equipment page. So keep polling until the picture
// is back, and fail loudly if it never comes back.
const BLACK_FRAME_LUMINANCE = 8;

function isBlackFrame(frame) {
    return (
        screen.luminance(frame, fullFrameRegion(frame)) < BLACK_FRAME_LUMINANCE
    );
}

async function captureVisible(timeout = 6000) {
    const started = Date.now();

    for (;;) {
        const captureStarted = Date.now();
        const frame = await screen.capture();
        const captureMs = Date.now() - captureStarted;

        if (!isBlackFrame(frame)) {
            return { frame, captureMs };
        }

        if (Date.now() - started > timeout) {
            throw pageError(
                t(
                    'The emulator screen is black. Bring the game to the front and retry'
                )
            );
        }

        await sleep(200);
    }
}

// Waits until two consecutive captures are nearly identical (the emulator caught up).
// IMPORTANT: a stall freezes the frame, so two consecutive captures are also identical
// during a stall — do NOT use this function after a stall is detected; use
// waitForStallRecovery() first.
async function waitForSettledScreen(timeout = 5000) {
    const started = Date.now();
    let previous = await rawCapture();

    while (Date.now() - started < timeout) {
        await sleep(140);
        const frame = await rawCapture();
        if (screen.regionDelta(previous, frame, fullFrameRegion(frame)) < 3) {
            return frame;
        }
        previous = frame;
    }

    return previous;
}

// After a stall: the emulator was frozen, so waitForSettledScreen() would have
// returned immediately (two identical frozen frames). Must wait for the picture
// to change first — that is the only reliable signal that the stall is over and
// the emulator is rendering again — THEN wait for normal settle.
const STALL_RECOVERY_DELTA = 10;
const STALL_RECOVERY_TIMEOUT = 6000;

async function waitForStallRecovery() {
    const started = Date.now();
    const baseline = await rawCapture();

    // phase 1: wait for the frozen frame to actually change (stall ending)
    let changed = false;
    while (Date.now() - started < STALL_RECOVERY_TIMEOUT) {
        await sleep(160);
        const frame = await rawCapture();
        if (
            screen.regionDelta(baseline, frame, fullFrameRegion(frame)) >=
            STALL_RECOVERY_DELTA
        ) {
            changed = true;
            break;
        }
    }

    if (!changed) {
        // stall never recovered; return whatever we have, the caller will fail loud
        console.warn('[emulator] stall did not recover within STALL_RECOVERY_TIMEOUT');
        return baseline;
    }

    // phase 2: now wait for normal settle (won't short-circuit on a frozen frame anymore)
    return waitForSettledScreen(3000);
}

// Recovery for "the page check failed". This never presses back: a back press on the
// wrong screen can open the game's "quit the game" confirmation, so the run stops with a
// clear message instead of guessing.
async function recoverToManagePage() {    throw pageError(
        t(
            'The emulator left the Manage Equipment page. Open that page again and retry'
        )
    );
}

// Capture wrapper used by the whole flow: skips black frames, records the capture time and
// settles + re-checks the page after a stall so the caller never taps into a frozen screen.
async function captureFrame() {
    const { frame, captureMs } = await captureVisible();

    const baseline = median(recentCaptureTimes);
    recentCaptureTimes.push(captureMs);
    if (recentCaptureTimes.length > STALL_LOG_LIMIT) {
        recentCaptureTimes.shift();
    }

    if (baseline && captureMs > baseline * STALL_FACTOR) {
        console.warn(
            '[emulator] stall detected: capture took',
            `${captureMs}ms (baseline ${baseline}ms)`
        );
        const settled = await waitForStallRecovery();
        if (!(await looksLikeManagePage(settled))) {
            await recoverToManagePage();
        }
    }

    return frame;
}

// Used before a run starts: make sure the game is on the Manage Equipment page with the
// slot tabs visible (the title alone also appears on some other screens).
async function ensureManagePage() {
    // 每次运行时把「已报告的 adb 路径」清空，这样一轮只会打一行
    lastLoggedAdbPath = null;
    configureAdb();
    await adb.connect();

    // 坐标按 1280x720 写死：分辨率不对就直接报错，一次点击都不发
    await adb.requireReferenceSize();

    await assertManagePage();

    // 刚打开的装备页标题已经在了，但列表还在转（这时候点任何按钮都会被吞掉），
    // 先等画面稳定再往下走
    const settled = await waitForSettledScreen(1500);

    if (!readSelectedSlot(settled)) {
        throw pageError(
            t(
                'Not on the Manage Equipment page (open the equipment page of a hero first)'
            )
        );
    }
}

async function assertManagePage() {
    const frame = await captureFrame();
    const match = await screen.matchTemplate(
        frame,
        'page_manage.png',
        40,
        8,
        6
    );
    if (match.score > 28) {
        throw pageError(
            t(
                'Not on the Manage Equipment page (open the equipment page of a hero first)'
            )
        );
    }
    return frame;
}

// ---- 排序菜单 ----
// 菜单打开时，当前被选中的那一行有一块白色圆角高亮（约 44px 高），行右端带一个
// ↑/↓ 圆钮。菜单里点任何一项（包括那个圆钮）都会把菜单关掉，所以「选中项不是
// 获得」时「获得」那一行既没有高亮也没有圆钮 —— 只看「获得」那一行会误判成
// 「菜单没打开」，随后又被点一下排序按钮关掉，结果永远切不到获得升序。
// 现在改成：先扫出任意一行的高亮，再用「高亮行右端有 ↑/↓ 圆钮」确认菜单真的打开。
const SORT_MENU_PROBE = { x: 1100, w: 24, yFrom: 150, yTo: 440 };
const SORT_ROW_MIN_HEIGHT = 20;
const SORT_ARROW_X = 1158;
const SORT_ARROW_MATCH_SCORE = 20;
const SORT_ACQUISITION_ROW_Y = 211;
const SORT_ACQUISITION_ROW_TOLERANCE = 12;

/** 菜单里被选中那一行的高亮带（从上到下的 y 区间） */
function sortRowBands(frame) {
    const bands = [];
    let current = null;

    for (let y = SORT_MENU_PROBE.yFrom; y <= SORT_MENU_PROBE.yTo; y += 1) {
        const value = screen.luminance(frame, {
            x: SORT_MENU_PROBE.x,
            y,
            w: SORT_MENU_PROBE.w,
            h: 1,
        });

        if (value > 150) {
            if (current) {
                current.to = y;
            } else {
                current = { from: y, to: y };
            }
        } else if (current) {
            bands.push(current);
            current = null;
        }
    }

    if (current) {
        bands.push(current);
    }

    return bands.filter((band) => band.to - band.from >= SORT_ROW_MIN_HEIGHT);
}

/** 高亮行右端的 ↑/↓ 圆钮：分数低的是真的那个 */
async function readSortArrow(frame, band) {
    const y = band.from + 7;
    const up = await screen.matchTemplate(frame, 'sort_up.png', SORT_ARROW_X, y, 3);
    const down = await screen.matchTemplate(frame, 'sort_down.png', SORT_ARROW_X, y, 3);

    return {
        // 菜单关着时这里只是列表背景，两个模板都对不上（实测 0.2 vs 89）
        matched: Math.min(up.score, down.score) < SORT_ARROW_MATCH_SCORE,
        direction: up.score < down.score ? 'up' : 'down',
        y,
        upScore: up.score,
        downScore: down.score,
    };
}

/**
 * 读排序菜单：open / 选中的是不是「获得」/ 方向，以及圆钮的点击坐标。
 * 菜单关着时 open = false（列表里没有那块行高亮 + 圆钮）。
 */
async function readSortState(frame) {
    for (const band of sortRowBands(frame)) {
        const arrow = await readSortArrow(frame, band);
        if (!arrow.matched) {
            continue;
        }

        const center = Math.round((band.from + band.to) / 2);

        return {
            open: true,
            center,
            acquisition:
                Math.abs(center - SORT_ACQUISITION_ROW_Y) <=
                SORT_ACQUISITION_ROW_TOLERANCE,
            direction: arrow.direction,
            arrowPoint: [SORT_ARROW_X + 19, arrow.y + 17],
            band,
            upScore: arrow.upScore,
            downScore: arrow.downScore,
        };
    }

    return { open: false, acquisition: false, direction: null };
}

async function isSortMenuOpen(frame) {
    return (await readSortState(frame)).open;
}

// An empty corner of the manage equipment page (bottom-left, below the stats panel).
// Tapping it closes an open dropdown / sort menu / set dialog and does nothing while
// nothing is open (measured: frame delta 0.0 for all four cases, and the page stays
// intact). `back` is never used to close overlays: a back press on the wrong screen can
// open the game's "quit the game" confirmation.
const OVERLAY_DISMISS_POINT = [60, 690];

async function dismissOverlay(label) {
    await inputThenWait({ tap: OVERLAY_DISMISS_POINT }, 300);
    const frame = await captureFrame();
    // 正常收尾动作（关排序菜单 / 筛选浮层），不是异常：用 log 而不是 warn
    // eslint-disable-next-line no-console
    console.log(
        `[emulator] closed the ${
            label || 'filter'
        } overlay by tapping outside it`
    );
    return frame;
}

// Opens the sort menu and verifies it actually opened.
async function openSortMenu() {
    let frame = await captureFrame();

    // 菜单可能已经开着（排序设置完还没关），先看一眼再决定要不要点：
    // 对着已经打开的菜单再点一次排序按钮会把它关掉
    if (await isSortMenuOpen(frame)) {
        return frame;
    }

    // 列表还在加载 / 重排时点击会被吞掉，所以每次点之前先等画面稳定，
    // 并且给三次机会（2s 轮询 + 稳定等待，最坏约 7s）。
    // captureFrame 内部做 stall 检测 + stall 恢复；stall 时不能用
    // waitForSettledScreen，因为 stall 画面冻结会让它秒返回
    for (let attempt = 0; attempt < 3; attempt++) {
        await captureFrame();
        await inputThenWait({ tap: LAYOUT.sortButton }, 250);

        const deadline = Date.now() + 2000;

        for (;;) {
            frame = await captureFrame();

            if (await isSortMenuOpen(frame)) {
                return frame;
            }

            if (Date.now() > deadline) {
                break;
            }

            await adb.wait(120);
        }
    }

    console.warn('[emulator] sort menu did not open, bands:', JSON.stringify(sortRowBands(frame)));

    throw new Error(
        t(
            'Could not open the sort menu. Make sure the game is still on the Manage Equipment page'
        )
    );
}

async function closeSortMenu(frame) {
    if (frame && (await isSortMenuOpen(frame))) {
        await dismissOverlay('sort menu');
    }
}

// 菜单里点任何一项都会把菜单关掉（点行 = 选这个排序键，点圆钮 = 翻转方向），
// 所以每次改完都要重新打开菜单再读一遍，最多试几次，避免一次被吞掉的点击就报错。
const SORT_SWITCH_ATTEMPTS = 4;

async function setSortAcquisitionAscending() {
    for (let attempt = 0; attempt < SORT_SWITCH_ATTEMPTS; attempt++) {
        const frame = await openSortMenu();
        const state = await readSortState(frame);

        if (state.acquisition && state.direction === 'up') {
            await closeSortMenu(frame);
            return;
        }

        const point = state.acquisition
            ? state.arrowPoint
            : LAYOUT.sortAcquisitionRow;

        await inputThenWait({ tap: point }, 250);
        // captureFrame internally handles stall detection + recovery; stall can
        // kick in right after the sort-menu tap and waitForSettledScreen would
        // short-circuit on the frozen frame
        await captureFrame();
    }

    await closeSortMenu(await captureFrame().catch(() => null));

    throw new Error(
        t(
            'Could not switch the sort to Acquisition (Ascending). Set it manually and retry'
        )
    );
}

const SLOT_ORDER = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

// The selected slot tab has a light highlight strip under the icon
function slotStripLuminance(frame, slot) {
    const x = LAYOUT.slots[slot][0];

    return screen.luminance(frame, {
        x: x - 26,
        y: 118,
        w: 52,
        h: 14,
    });
}

function readSelectedSlot(frame) {
    let best = { slot: null, value: -1 };

    for (const slot of SLOT_ORDER) {
        const value = slotStripLuminance(frame, slot);
        if (value > best.value) {
            best = { slot, value };
        }
    }

    return best.value > 70 ? best.slot : null;
}

async function selectSlot(slot) {
    const point = LAYOUT.slots[slot];
    if (!point) {
        throw new Error(t('Unknown gear slot: {{slot}}', { slot }));
    }

    // the tap also resets the grid scroll, so it is issued even when the slot already looks
    // selected (two items of the same slot must still start from the top of the list)
    let frame = await captureFrame();

    for (let attempt = 0; attempt < 2; attempt++) {
        await inputThenWait({ tap: point }, 250);

        // The tab does occasionally take a moment longer than the animation (list re-layout
        // while the grid is still scrolling), so poll instead of judging from one frame:
        // a fixed 650ms wait used to fail here every now and then.
        const deadline = Date.now() + 2000;

        for (;;) {
            frame = await captureFrame();

            if (readSelectedSlot(frame) === slot) {
                return frame;
            }

            if (Date.now() > deadline) {
                break;
            }

            await adb.wait(120);
        }

        // the tab did not switch: either the tap was swallowed by a stall or it landed on
        // another screen. Never tap again before the page is confirmed.
        if (!(await looksLikeManagePage(frame))) {
            await recoverToManagePage();
        }
    }

    const readings = SLOT_ORDER.map(
        (name) => `${name}=${Math.round(slotStripLuminance(frame, name))}`
    ).join(' ');
    console.warn('[emulator] slot tab did not switch, highlight strip:', readings);

    const slotName = t(slot);
    throw pageError(
        t(
            'Could not switch to the {{slot}} slot. Make sure the game is still on the Manage Equipment page',
            { slot: slotName }
        )
    );
}

// ---- cancellation ----
let cancelRequested = false;

function requestCancel() {
    cancelRequested = true;
}

function clearCancel() {
    cancelRequested = false;
}

function throwIfCancelled() {
    if (cancelRequested) {
        const error = new Error(
            typeof i18next !== 'undefined'
                ? i18next.t('Operation cancelled')
                : 'Operation cancelled'
        );
        error.cancelled = true;
        throw error;
    }
}

// ---- filter panel timing ----
// The filter panel does not appear instantly, so wait for it instead of using a fixed
// delay; the panel footprint is compared against the frame taken before the tap.
const PANEL_REGION = { x: 628, y: 238, w: 612, h: 307 };

async function waitForPanel(before, wantOpen, timeout = 4000) {
    const started = Date.now();

    while (Date.now() - started < timeout) {
        await sleep(160);
        const frame = await captureFrame();
        const delta = screen.regionDelta(before, frame, PANEL_REGION);

        if (wantOpen ? delta > 8 : delta < 4) {
            return frame;
        }
    }

    throw new Error(
        t(
            wantOpen
                ? 'The filter panel did not open. Check the emulator'
                : 'The filter panel did not close. Check the emulator'
        )
    );
}

// Waits until the panel is fully drawn: the open delta is large and two consecutive
// frames are nearly identical (the highlight is only painted at the end of the animation).
async function openPanelStable(before, timeout = 5000) {
    const started = Date.now();
    let previous = null;

    while (Date.now() - started < timeout) {
        await sleep(180);
        const frame = await captureFrame();

        if (screen.regionDelta(before, frame, PANEL_REGION) < 20) {
            previous = null;
            continue;
        }

        if (previous && screen.regionDelta(previous, frame, PANEL_REGION) < 6) {
            return frame;
        }

        previous = frame;
    }

    throw new Error(t('The filter panel did not open. Check the emulator'));
}

// The selected row in an open filter panel is drawn with a white background; the
// empty spot right of the label is sampled (no text/toggle there).
function readSelectedOption(frame) {
    let best = { key: null, value: -1 };

    for (const key of Object.keys(LAYOUT.options)) {
        const point = LAYOUT.options[key];
        const sampleX = point[0] < 900 ? 855 : 1122;
        const value = screen.luminance(frame, {
            x: sampleX - 10,
            y: point[1] - 5,
            w: 20,
            h: 10,
        });

        if (value > best.value) {
            best = { key, value };
        }
    }

    if (best.value < 120) {
        return undefined;
    }

    return best.key === 'all' ? null : best.key;
}

// The selected row carries a two-arrow toggle: the active arrow sits in a white circle
// (down = descending)
function readDirection(frame, optionKey) {
    const point = LAYOUT.options[optionKey];
    // the toggle sits at the right edge of the row, which differs per column
    const leftX = point[0] < 900 ? 872 : 1166;
    const left = screen.luminance(frame, {
        x: leftX,
        y: point[1] - 11,
        w: 22,
        h: 22,
    });
    const right = screen.luminance(frame, {
        x: leftX + 30,
        y: point[1] - 11,
        w: 22,
        h: 22,
    });
    return right > left ? 'desc' : 'asc';
}

// Opens the chip panel and reads its current value first. Nothing is tapped when the
// value already matches (a second tap would flip the sort direction).
async function ensureChip(chip, target) {
    const chipPoint = LAYOUT.filters[chip];
    const wantedKey = target || 'all';

    if (!chipPoint || !LAYOUT.options[wantedKey]) {
        throw new Error(
            t('Unknown filter: {{chip}}/{{value}}', { chip, value: target })
        );
    }

    throwIfCancelled();

    let openFrame = await openChipPanel(chipPoint, chip);
    if (!openFrame) {
        throw new Error(t('The filter panel did not open. Check the emulator'));
    }

    let current = readSelectedOption(openFrame);

    // the panel is open but its highlight is only painted at the end of the animation:
    // wait for it instead of tapping anything blind
    if (current === undefined) {
        const highlighted = await waitForOptionHighlight(openFrame, chip);
        if (highlighted) {
            openFrame = highlighted;
            current = readSelectedOption(highlighted);
        }
    }

    // still unreadable: close the panel, reopen it once, and give up cleanly if the panel
    // cannot be read. No option is ever tapped while the selected row is unknown.
    if (current === undefined) {
        await dismissOverlay(chip);

        openFrame = await openChipPanel(chipPoint, chip);
        current = openFrame ? readSelectedOption(openFrame) : undefined;

        if (!openFrame || current === undefined) {
            if (openFrame) {
                await dismissOverlay(chip);
            }
            throw new Error(
                t('Could not read the filter panel. Check the emulator')
            );
        }
    }

    if (current === (target || null)) {
        // already the wanted stat: only put the direction back to descending when it was
        // flipped to ascending (a fresh selection is always descending)
        if (target && readDirection(openFrame, wantedKey) === 'asc') {
            await adb.tap(...LAYOUT.options[wantedKey]);
            await ensurePanelClosed(openFrame, chip);
            return 'applied';
        }

        await dismissOverlay(chip);
        return 'skipped';
    }

    throwIfCancelled();
    await adb.tap(...LAYOUT.options[wantedKey]);
    await ensurePanelClosed(openFrame, chip);

    return 'applied';
}

// Polls until the open panel actually shows a highlighted row (its animation finishes).
async function waitForOptionHighlight(openFrame, chip, timeout = 1600) {
    const started = Date.now();
    let frame = openFrame;

    while (Date.now() - started < timeout) {
        await sleep(150);
        frame = await captureFrame();
        if (readSelectedOption(frame) !== undefined) {
            return frame;
        }
    }

    console.warn(
        `[emulator] filter panel (${chip}) has no readable highlighted row`
    );
    return null;
}

// A tap on a chip is the step that suffers most from emulator stalls: the panel can open
// seconds late, and a tap issued into the stall is delivered afterwards, which is how a
// second tap ends up closing the panel that just opened. So this waits for the panel,
// and never taps a second time before the screen has settled again.
async function openChipPanel(chipPoint, chip) {
    let before = await captureFrame();

    for (let attempt = 0; attempt < 2; attempt++) {
        await adb.tap(...chipPoint);

        try {
            return await openPanelStable(before, 2500);
        } catch (error) {
            // stall freezes the frame so waitForSettledScreen returns immediately
            // on a still-frozen frame. Use stall recovery here instead: it waits
            // for the stall to end (picture actually changes) *then* settles
            const settled = await waitForStallRecovery();

            if (!(await looksLikeManagePage(settled))) {
                await recoverToManagePage();
                return null;
            }

            // the picture changed a lot while waiting -> the panel did open, only later
            if (screen.regionDelta(before, settled, PANEL_REGION) > 20) {
                // 已经等到画面稳定且面板确实打开了，属于可接受的慢响应，不是异常
                // eslint-disable-next-line no-console
                console.log(
                    `[emulator] filter panel (${chip}) opened late, continuing with the settled frame`
                );
                return settled;
            }

            // the panel really is closed: the tap was lost, tap again
        }

        before = await captureFrame();
    }

    return null;
}

// Waits until the option panel is gone again. A tap queued during a stall can keep it
// open for a while, so this polls the panel region instead of sleeping a fixed delay.
async function ensurePanelClosed(openFrame, chip, timeout = 2200) {
    const started = Date.now();
    let frame = await captureFrame();

    while (Date.now() - started < timeout) {
        if (screen.regionDelta(openFrame, frame, PANEL_REGION) > 20) {
            return frame;
        }
        frame = await captureFrame();
    }

    console.warn(`[emulator] filter panel (${chip}) still open, pressing back`);
    await dismissOverlay(chip);

    frame = await captureFrame();
    if (!(await looksLikeManagePage(frame))) {
        await recoverToManagePage();
    }

    return frame;
}

async function setFilter(chip, statType) {
    if (
        !LAYOUT.filters[chip] ||
        !(statType ? LAYOUT.options[statType] : LAYOUT.options.all)
    ) {
        throw new Error(
            t('Unknown filter: {{chip}}/{{value}}', { chip, value: statType })
        );
    }

    return ensureChip(chip, statType);
}

// Reads the five chips back (e.g. "All 副属性值1" vs "速度").
// Tapping an already selected substat only flips its sort direction, so we verify
// instead of blindly tapping again.
async function readChipLabels(frame) {
    const labels = {};

    for (const key of Object.keys(LAYOUT.chipRegions)) {
        const lines = await screen.ocr(
            screen.crop(frame, LAYOUT.chipRegions[key]),
            '',
            3
        );
        labels[key] = lines
            .map((line) => line.text)
            .join(' ')
            .trim();
    }

    return labels;
}

// Unset chips still show the "副能力值N" placeholder, set ones show the stat name
function chipIsUnset(label) {
    return !label || /能力值|All|全部/i.test(label);
}

// Filters persist across slots, so a chip that already has the wanted value can be
// left alone (re-tapping also flips its sort direction).
let filterCache = null;

let sessionReady = false;

function resetFilterSession() {
    filterCache = null;
    sessionReady = false;
}

// Weapon / Helmet / Armor have a fixed main stat, so their main filter is left at "All"
// (it must still be cleared if a previous accessory slot set a different one).
const FIXED_MAIN_SLOTS = ['Weapon', 'Helmet', 'Armor'];

// ---- set filter (icons only, language independent) ----
const SET_PANEL_REGION = { x: 95, y: 128, w: 620, h: 522 };
const SET_ALL_POINT = [400, 165];

// 1280x720 下套装对话框 (重置"全部"后) 每个图标的精确 tap 坐标。
// 打开 dialog 默认在 page0 (顶部)。24 套装备中:
//   page0 可见 16 个 (2 列 × 8 行): AttackSet ... InjurySet
//   page1 额外 8 个 (swipe 上 1 次后才出现): ProtectionSet ... WarfareSet
// col0 x=165, col1 x=465, 8 行 cy=[218, 271, 324, 377, 430, 483, 536, 589]
// 坐标固定 — 装备页渲染缩放在模拟器配置好后就不会变。
// 找不到对应 key 时 fallback 到模板匹配 (findSetIcon)。
const SUITE_COORDS = {
    // ============ page 0 (dialog open 默认位置) ============
    AttackSet:      { page: 0, x: 165, y: 218 },
    DefenseSet:     { page: 0, x: 465, y: 218 },
    HealthSet:      { page: 0, x: 165, y: 271 },
    SpeedSet:       { page: 0, x: 465, y: 271 },
    CriticalSet:    { page: 0, x: 165, y: 324 },
    DestructionSet: { page: 0, x: 465, y: 324 },
    HitSet:         { page: 0, x: 165, y: 377 },
    ResistSet:      { page: 0, x: 465, y: 377 },
    LifestealSet:   { page: 0, x: 165, y: 430 },
    CounterSet:     { page: 0, x: 465, y: 430 },
    UnitySet:       { page: 0, x: 165, y: 483 },
    ImmunitySet:    { page: 0, x: 465, y: 483 },
    RageSet:        { page: 0, x: 165, y: 536 },
    PenetrationSet: { page: 0, x: 465, y: 536 },
    RevengeSet:     { page: 0, x: 165, y: 589 },
    InjurySet:      { page: 0, x: 465, y: 589 },
    // ============ page 1 (scrollSetListToTop 后再 swipe 上 1 次) ============
    // page1 row0-row3 是 page0 row3-row6 的重叠区域，只有 row4-row7 是新套装
    // 2026-11-13 重新标定：scrollSetListToTop swipes 220px，叠加 dialog 首行不完整偏移 +32px
    ProtectionSet:  { page: 1, x: 165, y: 462 },
    TorrentSet:     { page: 1, x: 465, y: 462 },
    ReversalSet:    { page: 1, x: 165, y: 515 },
    RiposteSet:     { page: 1, x: 465, y: 515 },
    FervorSet:      { page: 1, x: 165, y: 568 },
    PursuitSet:     { page: 1, x: 465, y: 568 },
    WeakeningSet:   { page: 1, x: 165, y: 621 },
    WarfareSet:     { page: 1, x: 465, y: 621 },
};

// The open dialog is almost black (mean brightness ~19) while the item grid behind it
// is much brighter (~39), so brightness alone tells whether it is open. This also
// handles a dialog that was left open by an earlier run.
function setDialogVisible(frame) {
    return screen.luminance(frame, SET_PANEL_REGION) < 28;
}

async function openSetDialog() {
    for (let attempt = 0; attempt < 3; attempt++) {
        const frame = await captureFrame();
        if (setDialogVisible(frame)) {
            return true;
        }

        await inputThenWait({ tap: LAYOUT.filters.set }, 900);
    }

    return setDialogVisible(await captureFrame());
}

// Scans the whole dialog for the set icon; the panel can be scrolled to any offset.
// Templates match their own icon at ~0-3 (mean absolute difference on 32x32 crops).
async function findSetIcon(frame, setKey) {
    const template = `set-${setKey}.png`;
    let best = { score: Infinity, x: 0, y: 0 };

    // templates are 28x28 crops of the icon itself (no row background)
    for (let y = 150; y <= 650; y += 2) {
        for (const colX of [165, 466]) {
            const match = await screen.matchTemplate(
                frame,
                template,
                colX - 14,
                y - 14,
                3
            );
            if (match.score < best.score) {
                best = { score: match.score, x: match.x + 14, y: match.y + 14 };
            }
        }
    }

    return best;
}

async function templateExists(setKey) {
    const path = require('path');
    const fs = require('fs');
    return fs.existsSync(
        path.join(screen.appDir(), 'assets', 'emulator', `set-${setKey}.png`)
    );
}

// Tries to select the set in the currently visible part of the dialog
async function selectSetInFrame(frame, setKey) {
    let exists = true;
    try {
        exists = await templateExists(setKey);
    } catch (error) {
        exists = false;
    }

    if (!exists) {
        return false;
    }

    // templates match their own icon at ~0-5; anything above this is a different icon
    // (for example after the game was restarted with a different render scale), and
    // picking the closest row would select the wrong set
    const icon = await findSetIcon(frame, setKey);
    if (icon.score >= 12) {
        return false;
    }

    await adb.tap(icon.x, icon.y);

    // the dialog closes automatically after selecting a set — poll until it really
    // disappears instead of sleeping a fixed time; stall delays can push a fixed sleep
    // off into "tap lands into the wrong place on a still-open dialog" territory
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
        await sleep(120);
        const postTap = await captureFrame();
        if (!setDialogVisible(postTap)) {
            // 选完后 dialog 关了，还要等列表刷新稳定（游戏会重绘一遍）
            await waitForGridStable(frame, 2000).catch(() => null);
            return true;
        }
    }

    // stall or very slow response: dialog still open after the deadline,
    // just dismiss and report success — the icon tap most likely landed
    // and only the close animation is lagging
    console.warn(
        '[emulator] set dialog stayed open after set tap, dismissing manually'
    );
    await dismissOverlay('set dialog');
    return true;
}

// Scrolls the set list back to the top: one slow swipe is enough (2 columns, 16 sets per page).
// The old default of 3 swipes was paranoid, and waiting after each swipe was pointless
// because the game needs ~1.2s before a swipe even starts moving — they coalesce anyway.
async function scrollSetListToTop() {
    const baseline = await captureFrame();
    await inputThenWait({ swipe: [200, 380, 200, 620, 450] }, 120);

    const result = await waitForRegionStable(
        baseline,
        SET_PANEL_REGION,
        5000
    );

    // result.moved === false means the list was already at the top
    return result.frame;
}

async function applySetFilter(setKey) {
    if (!(await openSetDialog())) {
        console.warn('[emulator] set dialog did not open, skipping set filter');
        return false;
    }

    // reset All + 回顶 (幂等, 确保 SUITE_COORDS 坐标准确)
    let before = await captureFrame();
    await inputThenWait({ tap: SET_ALL_POINT }, 150);
    await waitForRegionStable(before, SET_PANEL_REGION, 2600);
    let frame = await scrollSetListToTop();

    // ---- page 0: SUITE_COORDS fast path → 失败 fallback 模板匹配 ----
    const fixed = SUITE_COORDS[setKey];
    if (fixed && fixed.page === 0 && (await tapFixedSetAndWait(fixed.x, fixed.y, frame))) {
        return true;
    }
    if (await selectSetInFrame(frame, setKey)) {
        return true;
    }

    // ---- page 1: swipe 一次 → SUITE_COORDS fast path → fallback 模板匹配 ----
    const pageStart = await captureFrame();
    await inputThenWait({ swipe: [200, 600, 200, 380, 600] }, 150);
    const scrolled = await waitForRegionStable(
        pageStart,
        SET_PANEL_REGION,
        3600
    );

    if (scrolled.moved) {
        if (fixed && fixed.page === 1 && (await tapFixedSetAndWait(fixed.x, fixed.y, scrolled.frame))) {
            return true;
        }
        if (await selectSetInFrame(scrolled.frame, setKey)) {
            return true;
        }
    }

    console.warn(
        '[emulator] set icon not matched, skipping set filter:',
        setKey
    );
    await dismissOverlay('set dialog');
    return false;
}

// Tap a known-good (x, y) inside the set dialog and wait for it to close,
// then wait for the item grid to finish redrawing. Returns true on success.
async function tapFixedSetAndWait(x, y, baselineFrame) {
    await adb.tap(x, y);

    // tap 套装 icon 只是勾上, dialog 不会自动关 — 和 selectSetInFrame 一样
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
        await sleep(120);
        const postTap = await captureFrame();
        if (!setDialogVisible(postTap)) {
            await waitForGridStable(baselineFrame, 2000).catch(() => null);
            return true;
        }
    }

    // 超时 — 和 selectSetInFrame 一样, 手动 dismiss 并返回 true
    // (tap 已经勾上套装了, 只是关 dialog 的动画卡了)
    console.warn('[emulator] fixed coord tap (', x, ',', y, ') dialog stayed open, dismissing manually');
    await dismissOverlay('set dialog');
    await waitForGridStable(baselineFrame, 2000).catch(() => null);
    return true;
}

function wantedFilters(item) {
    const fixedMain = FIXED_MAIN_SLOTS.includes(item.slot);
    const substats = item.substats || [];
    const wanted = { main: fixedMain ? null : item.mainType };

    for (let index = 0; index < 4; index++) {
        wanted[`sub${index + 1}`] = substats[index]
            ? substats[index].type
            : null;
    }

    return wanted;
}

async function applyItemFilters(item, force = false) {
    const wanted = wantedFilters(item);
    const applied = [];
    const skipped = [];
    // 预测游戏里的状态：把某个 chip 设成别的 chip 已经有的副属性时，两者会交换（不产生重复）。
    // 交换**只发生在副属性 chip 之间**，主属性那个 chip 不参与（所以下面的交换伙伴只在
    // SUB_KEYS 里找，即使主属性正好也是同名属性也不会被当成交换对象）。
    //
    // 这套预测只用来打日志 / 给规划算代价（emulatorEquip.chipChangeCost），**不用来跳过设置**：
    // 交换顺带设对的那个 chip 仍然会打开面板读一次确认（读到就是目标值时不点，只多花一次读数）。
    // 曾经考虑过直接按预测跳过这次读取，省 ~0.8s，但万一游戏某次不是交换而是清空/覆盖，
    // 就会跳错一格 -> 列表不对 -> 又去跑 ±4 探测。这点时间不值得，保持读一次。
    const predicted = { ...(filterCache || {}) };
    const SUB_KEYS = ['sub1', 'sub2', 'sub3', 'sub4'];

    // compare each chip one by one: main, sub1, sub2, sub3, sub4
    for (const key of Object.keys(wanted)) {
        if (!force && filterCache && filterCache[key] === wanted[key]) {
            skipped.push(key);
            predicted[key] = wanted[key];
            continue;
        }

        throwIfCancelled();
        const status = await setFilter(key, wanted[key]);
        (status === 'applied' ? applied : skipped).push(key);

        if (SUB_KEYS.includes(key)) {
            const partner = SUB_KEYS.find(
                (other) => other !== key && predicted[other] === wanted[key]
            );
            if (partner) {
                const displaced = predicted[key];
                predicted[partner] = displaced;
                console.log(
                    '[emulator] chip swap:',
                    key,
                    '->',
                    wanted[key],
                    '|',
                    partner,
                    '->',
                    displaced
                );
            }
        }

        predicted[key] = wanted[key];
    }

    console.log(
        '[emulator] filters changed:',
        applied.join(',') || '-',
        '| already correct:',
        skipped.join(',') || '-'
    );

    filterCache = { ...(filterCache || {}), ...wanted };
    return wanted;
}

// "没有符合条件的装备。" -> stop right away instead of scrolling an empty list
async function assertListNotEmpty(frame) {
    const region = {
        x: LAYOUT.gridRegion.x,
        y: LAYOUT.gridRegion.y,
        w: LAYOUT.gridRegion.w,
        h: LAYOUT.gridRegion.h,
    };

    // language neutral: an empty list has no item tiles
    if (findCandidates(frame).length === 0) {
        throw new Error(
            t(
                'The filtered list is empty: the item may be in storage, worn by another hero with equipped gear hidden, or the slot is wrong'
            )
        );
    }
}

// ---- waiting for what should appear (instead of sleeping a fixed time) ----------------
const GRID_STABLE_DELTA = 6;
const GRID_STABLE_TIMEOUT = 4000;
const TILE_APPEAR_TIMEOUT = 1600;

// 选完最后一个副属性 chip 后，列表要过一会儿才开始重画。「连续两帧一样」在重画开始前
// 就已经成立，慢一点的机器上（渲染 + 编码延迟）会被误判成「已经稳定」，于是拿着旧列表
// 去算行列、点格子 —— 点错之后又以为装备不存在，白跑一圈 ±4 探测。所以：
//   * 先等列表真的变过一次（最多 GRID_CHANGE_TIMEOUT）
//   * 再要求连续 GRID_READY_SAMPLES 次采样都不动
const GRID_READY_INTERVAL = 100;
const GRID_READY_SAMPLES = 3;
const GRID_CHANGE_TIMEOUT = 1200;

function gridRegion() {
    return {
        x: LAYOUT.gridRegion.x,
        y: LAYOUT.gridRegion.y,
        w: LAYOUT.gridRegion.w,
        h: LAYOUT.gridRegion.h,
    };
}

// True when the tile at the given cell is drawn (same sampling as findCandidates).
// The y tolerance is generous on purpose: the row y comes from the measured scroll offset,
// which is accurate to a few pixels and must not turn into a false "tile missing".
function hasTileAt(frame, cell) {
    return findCandidates(frame).some(
        (candidate) =>
            Math.abs(candidate.x - cell.x) <= 2 &&
            Math.abs(candidate.y - cell.y) <= 14
    );
}

// Waits until a screen region stops changing (the list decelerates / icons bounce after a
// swipe). `baseline` is the frame captured *before* the input: the returned `moved` flag
// tells the caller whether that input had any effect at all.
//
// Two phases on purpose: the game needs up to ~1.2s before the list even starts to move
// (measured: delta stays at 0 for ~1s, then jumps to ~23 while it scrolls). Treating the
// quiet moment right after the swipe as "settled" would scan a frame that is about to
// move, which is exactly how a click ends up on the wrong place. So first wait for the
// motion to start, then for it to stop (two consecutive stable pairs).
const MOTION_START_DELTA = 8;
const MOTION_START_TIMEOUT = 1400;

async function waitForRegionStable(baseline, region, timeout = 2000, delta = 4) {
    const started = Date.now();
    let previous = await captureFrame();
    let motionStarted = false;
    let stablePairs = 0;

    while (Date.now() - started < timeout) {
        const frame = await captureFrame();
        const step = screen.regionDelta(previous, frame, region);

        if (!motionStarted) {
            if (step >= MOTION_START_DELTA) {
                motionStarted = true;
                stablePairs = 0;
            } else if (Date.now() - started > MOTION_START_TIMEOUT) {
                // stall can freeze the picture for > MOTION_START_TIMEOUT; don't jump to
                // {moved: false} yet — give stall recovery a moment, then confirm once
                await sleep(500);
                const confirmFrame = await captureFrame();
                if (
                    screen.regionDelta(previous, confirmFrame, region) <
                    MOTION_START_DELTA
                ) {
                    return { frame: confirmFrame, moved: false };
                }
                previous = confirmFrame;
                motionStarted = true;
                stablePairs = 0;
                continue;
            }
        } else if (step < delta) {
            stablePairs += 1;
            if (stablePairs >= 2) {
                return { frame, moved: true };
            }
        } else {
            stablePairs = 0;
        }

        previous = frame;
        await sleep(80);
    }

    return { frame: previous, moved: motionStarted };
}

// Waits until the grid content stops moving. Used after a swipe (the list decelerates and
// measuring a moving list gives a wrong scroll offset) and after a filter change.
async function waitForGridStable(previous, timeout = 2000) {
    const result = await waitForRegionStable(
        previous,
        gridRegion(),
        timeout,
        GRID_STABLE_DELTA
    );
    return result.frame;
}

// Waits until the item list is drawn *and* settled. A single capture right after the last
// filter chip is not proof that the list finished refreshing, and tapping into a list that
// is still rendering is what made the target tile get missed.
//
// expectChange: 这次筛选确实换了 chip，列表一定会重画 —— 那就先等它变（见上面的常量），
// 避免把「还没开始重画」当成「已经稳定」。
async function waitForGridReady({
    timeout = GRID_STABLE_TIMEOUT,
    expectChange = false,
} = {}) {
    const started = Date.now();
    let previous = await captureFrame();
    const baseline = previous;
    let changed = !expectChange;
    let stableSamples = 0;
    let requiredSamples = GRID_READY_SAMPLES;

    while (Date.now() - started < timeout) {
        const frame = await captureFrame();
        const delta = screen.regionDelta(previous, frame, gridRegion());

        if (
            !changed &&
            screen.regionDelta(baseline, frame, gridRegion()) >= GRID_STABLE_DELTA
        ) {
            changed = true;
        }

        // 等不到变化说明这次筛选本来就不会改变列表，别一直空等；
        // 但慢机器上「还没开始重画」也会这样，所以从这一刻起再要求一段静止时间
        if (!changed && Date.now() - started >= GRID_CHANGE_TIMEOUT) {
            changed = true;
            requiredSamples = GRID_READY_SAMPLES + 5;
            stableSamples = 0;
        }

        const hasTiles = findCandidates(frame).length > 0;
        stableSamples = delta < GRID_STABLE_DELTA ? stableSamples + 1 : 0;

        if (changed && hasTiles && stableSamples >= requiredSamples) {
            return frame;
        }

        previous = frame;
        await sleep(GRID_READY_INTERVAL);
    }

    console.warn(
        '[emulator] the item list did not settle within',
        timeout + 'ms'
    );
    return previous;
}

// Waits until the tile at the computed cell shows up (after a scroll / list refresh the
// tile can be painted a moment later than the coordinates are known).
async function waitForTileAt(cell, timeout = TILE_APPEAR_TIMEOUT) {
    const started = Date.now();
    let frame = await captureFrame();

    while (Date.now() - started < timeout) {
        if (hasTileAt(frame, cell)) {
            return frame;
        }
        await sleep(80);
        frame = await captureFrame();
    }

    console.warn(
        '[emulator] no tile appeared at',
        cell.x + ',' + cell.y,
        'within ' + timeout + 'ms'
    );
    return null;
}


// Rank of the target inside the filtered list: sort by the active substat chips in
// order (descending), ties by acquisition, mirroring the in-game list order.
function computeRank(
    target,
    allItems,
    filters,
    descending = true,
    useBase = false
) {
    if (!allItems || !target.id || !filters) {
        return -1;
    }

    const active = ['sub1', 'sub2', 'sub3', 'sub4']
        .map((key) => filters[key])
        .filter(Boolean);

    const has = (item, type) =>
        (item.substats || []).some((stat) => stat.type === type);
    const valueOf = (item, type) => {
        const stat = (item.substats || []).find((entry) => entry.type === type);
        if (!stat) {
            return -1;
        }
        if (
            !useBase &&
            item.augmentedStats &&
            item.augmentedStats[type] !== undefined
        ) {
            return item.augmentedStats[type];
        }
        return stat.value;
    };

    const candidates = allItems.filter(
        (item) =>
            item.gear === target.slot &&
            !item.storage &&
            item.main &&
            (!filters.main || item.main.type === filters.main) &&
            (!filters.set || item.set === filters.set) &&
            active.every((type) => has(item, type))
    );

    candidates.sort((a, b) => {
        for (const type of active) {
            const diff = valueOf(b, type) - valueOf(a, type);
            if (diff !== 0) {
                return diff;
            }
        }
        return Number(a.ingameId) - Number(b.ingameId);
    });

    const index = candidates.findIndex(
        (item) => String(item.id) === String(target.id)
    );
    const total = candidates.length;

    return {
        index,
        total,
        rank: index < 0 ? -1 : descending ? index : total - 1 - index,
    };
}

function findCandidates(frame) {
    const cells = [];

    for (let row = 0; row < LAYOUT.grid.rows; row++) {
        for (let col = 0; col < LAYOUT.grid.cols; col++) {
            const x = LAYOUT.grid.x0 + col * LAYOUT.grid.dx;
            const y = LAYOUT.grid.y0 + row * LAYOUT.grid.dy;
            const iconBrightness = screen.luminance(frame, {
                x: x - 32,
                y: y - 42,
                w: 64,
                h: 54,
            });
            if (iconBrightness > 32) {
                cells.push({ x, y, iconBrightness });
            }
        }
    }

    return cells;
}

// The panel shows the values the game has, so both the base and the reforged substat sets
// are accepted (a reforged piece shows the reforged numbers).
// The main stat is not part of the check: it is already pinned by the slot (weapon /
// helmet / armor) or by the accessory main-stat filter, and reforge changes its value, so
// comparing it only produced false negatives on reforged gear.
function expectedValueSets(item) {
    const sets = [];

    if (Array.isArray(item.baseValues)) {
        sets.push(item.baseValues);
    }
    if (Array.isArray(item.reforgedValues)) {
        sets.push(item.reforgedValues);
    }
    if (!sets.length) {
        sets.push((item.substats || []).map((stat) => stat.value));
    }

    return sets;
}

function matchesAny(numbers, sets) {
    return sets.some((set) => matchesExpected(numbers, set));
}

function matchesExpected(numbers, expected) {
    const pool = numbers.map((entry) => entry.value);
    const remaining = pool.slice();

    for (const value of expected) {
        const rounded = Math.round(value * 10) / 10;
        const index = remaining.findIndex(
            (candidate) => Math.abs(candidate - rounded) <= 0.51
        );
        if (index === -1) {
            return false;
        }
        remaining.splice(index, 1);
    }

    return true;
}

// The game fades the item panel in after a selection, and the substat values are
// rendered *after* the panel chrome settles. Waiting for "panel region stops changing"
// 等两件事都成立：
//   1. baseline（tap 前帧）和当前帧的 delta 够大 → panel 真的弹出来了
//      （和 waitForPanel 检测 filter panel 开闭同一个套路，比亮度靠谱）
//   2. 先看到 motion（self-delta > 2，说明动画在走），然后 motion 结束
//      （连续 2 帧 self-delta < 2）→ 彻底稳定
//
// phase 2 加 motion 检测是为了防卡死：如果模拟器完全冻结，帧帧一样，
// self-delta 永远 0，旧逻辑"连续两帧稳定"会秒通过返回冻结帧。
// 现在必须先看到"动起来"再等"停下来"——卡死场景下 motionStarted 永远不触发，
// 自然 timeout 并让上层 stall 检测接管。
async function waitForPanelSettled(baseline, timeout = 3000) {
    const started = Date.now();
    // delta 检测用下移区（避开装备槽特效），OCR 裁图还是用 valuePanelNumbers
    const region = LAYOUT.panelDeltaRegion;

    // phase 1：先等 200ms（tap 指令传回模拟器的延迟 + 游戏开始响应），
    // 然后每隔 100ms 轮询一次 delta，比 baseline 差 15 以上说明 panel 弹出来了
    await sleep(200);
    let lastFrame = baseline;
    if (!lastFrame) {
        lastFrame = await captureFrame();
    }
    while (Date.now() - started < timeout) {
        const frame = await captureFrame();
        const delta = screen.regionDelta(baseline, frame, region);
        if (delta > 15) {
            lastFrame = frame;
            break;
        }
        lastFrame = frame;
        await sleep(100);
    }

    // phase 2：先看 motion 开始（self-delta > 2），再等 motion 结束（连续 2 帧稳定）
    let previous = lastFrame;
    let motionStarted = false;
    let stableSamples = 0;
    const MOTION_START_DELTA = 2;
    const MOTION_TIMEOUT = 1200; // 等 panel 动起来最多 1.2s

    while (Date.now() - started < timeout) {
        const frame = await captureFrame();
        const selfDelta = screen.regionDelta(previous, frame, region);

        if (!motionStarted) {
            // 还没看到动起来
            if (selfDelta >= MOTION_START_DELTA) {
                motionStarted = true;
            } else if (Date.now() - started > MOTION_TIMEOUT + 200) {
                // 连 motion 都没看到，可能 panel 直接弹完不动了（淡入极快），
                // 给一次机会直接判稳定：再采 3 帧，至少 2 帧 self-delta < 2 就算
                let p = frame;
                let sc = 0;
                for (let i = 0; i < 3 && Date.now() - started < timeout; i++) {
                    await sleep(100);
                    const f = await captureFrame();
                    if (screen.regionDelta(p, f, region) < 2) sc++;
                    p = f;
                }
                if (sc >= 2) return p;
                // 卡住也没看到稳定，继续 motion 检测（但大概率会 timeout）
            }
        } else {
            // 动起来了，等停下来
            stableSamples = selfDelta < 2 ? stableSamples + 1 : 0;
            if (stableSamples >= 2) {
                return frame;
            }
        }

        previous = frame;
        await sleep(100);
    }

    return previous;
}

// OCR 结果合理性检查：substat + 主属性里，任何单一数值不可能超过这个阈值
// （最高的主属性攻击才 525，其他更低）。超过的话说明 panel 截偏了，读到了
// 装备分数（44534）或强化等级（1859）这类数值。
function looksLikePanelOCR(numbers) {
    if (!numbers || numbers.length < 4) return false;
    const values = numbers.map((n) => (typeof n === 'object' ? n.value : n));
    const max = Math.max(...values);
    return max <= 600; // 主属性攻击 525，留 75 余量
}

async function verifyCell(cell, item) {
    const t0 = Date.now();
    // tap 前抓 baseline，用来判断 panel 有没有真的打开（regionDelta 比亮度靠谱）
    const beforeTap = await captureFrame();
    await adb.tap(cell.x, cell.y);
    const settledFrame = await waitForPanelSettled(beforeTap);
    let result = await readPanel(item, settledFrame);

    // OCR 结果里有明显不属于 substat 的数值 → panel 截偏了，重等一次再读
    if (result.numbers && !looksLikePanelOCR(result.numbers)) {
        console.warn(
            '[emulator:ocr] panel 可疑（OCR 读到 %O），重等 panel',
            result.numbers.map((n) => (typeof n === 'object' ? n.value : n))
        );
        await sleep(150);
        const retryFrame = await waitForPanelSettled(beforeTap);
        result = await readPanel(item, retryFrame);
    }

    return result;
}

// Taps a tile and verifies it. Handles the case where the tile was already selected
// (the game toggles selection), and deselects a wrong item so it is not left pending.
async function selectAndVerify(cell, item) {
    let result = await verifyCell(cell, item);

    if (result.ok) {
        return result;
    }

    // empty panel: the tap toggled an existing selection off -> tap once more, but only
    // after confirming the game is still on the manage page (a stalled tap can drop the
    // run onto another screen)
    if (!result.numbers || result.numbers.length === 0) {
        if (!(await looksLikeManagePage(await captureFrame()))) {
            await recoverToManagePage();
        }

        result = await verifyCell(cell, item);
        if (result.ok) {
            return result;
        }
    }

    // wrong item: toggle the pending selection off, but only on the manage page
    if (!(await looksLikeManagePage(await captureFrame()))) {
        await recoverToManagePage();
    }

    await inputThenWait({ tap: [cell.x, cell.y] }, 500);
    return result;
}

// reads the item panel of the currently selected tile
async function readPanel(item, settledFrame) {
    const frame = settledFrame || (await captureFrame());
    // Both OCR engines read the value column only: the wider panel region also catches the
    // "装备分数" row and (measured) often drops the flat substat such as speed, which made
    // every verification fail into a second, useless OCR round.
    const values = screen.crop(frame, LAYOUT.valuePanelNumbers);

    const expectedSets = expectedValueSets(item);

    // Tesseract.js (bundled wasm) with a digit whitelist reads this panel far more
    // reliably than the Windows engine; the Windows OCR stays as the fallback.
    const tessJs = await screen.tesseractJsNumbers(
        frame,
        LAYOUT.valuePanelNumbers,
        1,
        (item && item.slot) || '?'
    );
    // 裁图范围已经切掉了主属性行（commit 8e4db4f），tesseract-js 读到的就是
    // 4 个 substat 数值。之前的 >=5 是留着主属性时的阈值，现在必须改成 >=4
    // 否则 tess 永远被跳过、每次都白跑 zh + en 两轮 OCR
    if (tessJs && tessJs.length >= 4) {
        const numbers = tessJs.map((value) => ({ value }));
        if (matchesAny(numbers, expectedSets)) {
            return { ok: true, numbers, source: 'tesseract-js' };
        }
    }

    // The zh engine is the more accurate one for this panel; the en engine is only run
    // when the first pass does not match (it covers percentages the zh pass sometimes
    // drops, at the cost of one extra OCR round).
    const chineseLines = await screen.ocr(values, '', 4);
    const chineseNumbers = screen.extractNumbers(chineseLines);

    if (matchesAny(chineseNumbers, expectedSets)) {
        return {
            ok: true,
            numbers: chineseNumbers,
            lines: chineseLines,
            source: 'winocr-zh',
        };
    }

    const englishLines = await screen.ocr(values, 'en-US', 4);
    const numbers = chineseNumbers.concat(screen.extractNumbers(englishLines));

    return {
        ok: matchesAny(numbers, expectedSets),
        numbers,
        lines: chineseLines.concat(englishLines),
        source: 'winocr-en',
    };
}

// A short/fast swipe triggers a fling and the list stops at an unpredictable offset;
// a slow drag moves ~1:1 with the finger (measured ~255px for a 260px drag).
async function scrollGrid(distance = 260) {
    const from = 560;
    await inputThenWait(
        { swipe: [995, from, 995, from - distance, 1200] },
        900
    );
}

// Scrolls the list back to the first row (used before a full fallback scan)
async function scrollToTop() {
    for (let i = 0; i < 8; i++) {
        const before = await captureFrame();
        await inputThenWait({ swipe: [995, 320, 995, 580, 700] }, 60);
        const after = await waitForGridStable(before, 2600);

        if (measureScroll(after, before).d < 20) {
            return;
        }
    }
}

// Tracks how far the grid is currently scrolled (0 = top). The rank maths and the
// neighbour probing both rely on it, and it is reset whenever the list refreshes.
let gridScroll = 0;

function resetGridScroll() {
    gridScroll = 0;
}

// Slow drag (~700ms) moves roughly 1:1 with the finger — measured ~255px list travel for
// a 260px swipe. Short swipes (faster duration) produce less movement due to fling inertia.
const SWIPE_DISTANCE_RATIO = 0.9;

// Scrolls by roughly `distance` px (positive = further down the list).
// 不再用 measureScroll 逐像素匹配（34 万次减法，同步 CPU 密集）：scrollToItemRow 的
// 收敛循环（20 步自适应）会自己纠正 over/under scroll，1:0.9 经验系数已经够用。
async function scrollGridBy(distance) {
    throwIfCancelled();
    const before = await captureFrame();
    const step = Math.max(60, Math.min(260, Math.abs(distance)));

    if (distance >= 0) {
        await inputThenWait({ swipe: [995, 560, 995, 560 - step, 700] }, 60);
    } else {
        await inputThenWait({ swipe: [995, 320, 995, 320 + step, 700] }, 60);
    }

    // the list decelerates after the swipe: measure a moving list
    const after = await waitForGridStable(before);
    const moved = Math.round(step * SWIPE_DISTANCE_RATIO);
    gridScroll += moved;
    return after;
}

// Scrolls until the given row (0 based) is inside the visible grid band and returns
// its y coordinate on screen.
async function scrollToItemRow(targetRow) {
    const rowPx = LAYOUT.grid.dy;
    const top = LAYOUT.gridTop + 40;
    const bottom = LAYOUT.gridBottom - 30;

    for (let i = 0; i < 20; i++) {
        throwIfCancelled();
        const y = LAYOUT.grid.y0 + targetRow * rowPx - gridScroll;

        if (y >= top && y <= bottom) {
            return { ok: true, y, scrolled: gridScroll };
        }

        if (y > bottom) {
            await scrollGridBy(Math.min(260, y - 520));
        } else {
            // the row is above the current view: scroll back up
            const frame = await scrollGridBy(-Math.min(260, top - y + 60));
            const again = LAYOUT.grid.y0 + targetRow * rowPx - gridScroll;
            if (gridScroll <= 0 && again < top) {
                return { ok: false, reason: 'top' };
            }
            void frame;
        }
    }

    return { ok: false, reason: 'limit' };
}

// The swipe distance is not reliable, so measure how far the list actually scrolled
// by matching the grid content against the previous frame (content moves up by d).
function measureScroll(before, after) {
    const region = {
        x: 900,
        y: LAYOUT.gridTop,
        w: 120,
        h: LAYOUT.gridBottom - LAYOUT.gridTop,
    };
    const a = screen.crop(before, region).bitmap;
    const b = screen.crop(after, region).bitmap;
    const { width } = a;
    let best = { d: 0, score: Infinity };

    for (let d = 0; d <= 300; d++) {
        let sum = 0;
        let count = 0;

        for (let y = 0; y + d < a.height; y += 4) {
            for (let x = 0; x < width; x += 10) {
                const ia = ((y + d) * width + x) * 4;
                const ib = (y * width + x) * 4;
                sum += Math.abs(a.data[ia] - b.data[ib]);
                count++;
            }
        }

        const score = count ? sum / count : Infinity;
        if (score < best.score) {
            best = { d, score };
        }
    }

    return best;
}

// Finds the item in the emulator and selects it (the user confirms and equips).
// options.allItems lets us jump straight to the item's row/column instead of scanning.
async function selectItem(item, options = {}) {
    if (!item || !item.slot) {
        throw new Error(t('Missing item information'));
    }

    // configureAdb / adb.connect / assertManagePage 全部由入口 ensureManagePage() 做完，
    // selectSlot 内部自己也带 stall 检测 + page check，这里再跑一遍纯属浪费截图往返
    throwIfCancelled();
    await selectSlot(item.slot);
    // switching slots shows the list from the top again
    gridScroll = 0;

    // the acquisition sort and the "All" set filter only have to be confirmed once per
    // run: neither is changed by switching slots
    if (!sessionReady) {
        await setSortAcquisitionAscending();
        sessionReady = true;
    }

    // set filter (by icon): re-applied only when the set differs from the previous slot
    let setApplied = false;

    if (item.set && (!filterCache || filterCache.set !== item.set)) {
        setApplied = await applySetFilter(item.set);
        filterCache = { ...(filterCache || {}), set: item.set, setApplied };
        console.log('[emulator] applySetFilter(%s) → %s', item.set, setApplied ? 'OK' : 'FAIL');
    } else if (filterCache) {
        setApplied = !!filterCache.setApplied;
        console.log('[emulator] applySetFilter(%s) → cache hit (applied=%s)', item.set, setApplied);
    }

    // 这次会不会真的重设 chip：只有变了才需要等「重画 -> 稳定」，不然只是白等
    const wantedChips = wantedFilters(item);
    const chipsWillChange = ['main', 'sub1', 'sub2', 'sub3', 'sub4'].some(
        (key) => !filterCache || filterCache[key] !== wantedChips[key]
    );

    const filters = await applyItemFilters(item);
    filters.set = setApplied ? item.set : null;
    // changing a filter resets the list to the top
    gridScroll = 0;

    // the list re-renders after the last chip; wait until it is drawn and settled instead
    // of assuming the next capture already shows the filtered result
    let frame = await waitForGridReady({
        expectChange: chipsWillChange || setApplied,
    });
    await assertListNotEmpty(frame);

    if (!options.allItems || !item.id) {
        throw new Error(t('Missing item index, cannot locate the item'));
    }

    // Descending only: the chips define the sort keys and a fresh selection is always
    // descending. The computed rank plus its neighbours is probed; if nothing matches the
    // slot is skipped (no full-list scan).
    const info = computeRank(item, options.allItems, filters, true, true);
    console.log(
        '[emulator] slot=%s computeRank rank=%d (total=%d) filters=%O setApplied=%s gridScroll=%d',
        item.slot,
        info.rank,
        info.total,
        filters,
        setApplied,
        gridScroll
    );

    const probes = [];
    if (info.rank >= 0) {
        for (const delta of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
            const candidate = info.rank + delta;
            if (candidate >= 0 && !probes.includes(candidate))
                probes.push(candidate);
        }
    }

    if (probes.length) {
        for (let probeIndex = 0; probeIndex < probes.length; probeIndex++) {
            throwIfCancelled();
            const candidate = probes[probeIndex];
            if (candidate < 0) {
                continue;
            }

            // a failed probe can be the result of a stalled tap that landed elsewhere:
            // confirm the page before probing the next tile
            if (
                probeIndex > 0 &&
                !(await looksLikeManagePage(await captureFrame()))
            ) {
                await recoverToManagePage();
            }

            // 上一次没点中，很可能只是列表还在刷新/还没滚稳：等它彻底停下来再点下一个
            if (probeIndex > 0) {
                await waitForGridReady({ expectChange: false });
            }

            const targetRow = Math.floor(candidate / LAYOUT.grid.cols);
            const position = await scrollToItemRow(targetRow);
            if (!position.ok) {
                console.warn('[emulator] skip rank=%d: scrollToItemRow failed (%s)', candidate, position.reason);
                continue;
            }

            const cell = {
                x:
                    LAYOUT.grid.x0 +
                    (candidate % LAYOUT.grid.cols) * LAYOUT.grid.dx,
                y: position.y,
            };
            console.log(
                '[emulator] probing rank=%d row=%d cell=(%d,%d) gridScroll=%d',
                candidate, targetRow, cell.x, cell.y, gridScroll
            );

            // a tile that is painted a moment later must not be clicked into the void
            if (!(await waitForTileAt(cell))) {
                continue;
            }

            const result = await selectAndVerify(cell, item);
            if (result.ok) {
                return { ok: true, cell, rank: candidate };
            }

            // the tile cannot be selected at all -> very likely already worn
            if (
                probeIndex === 0 &&
                (!result.numbers || result.numbers.length === 0)
            ) {
                console.warn(
                    '[emulator] tile not selectable, treating as already equipped:',
                    item.slot
                );
                return {
                    ok: true,
                    cell,
                    rank: candidate,
                    alreadyEquipped: true,
                };
            }
        }
    }

    const row = Math.floor(info.rank / LAYOUT.grid.cols) + 1;
    const column = (info.rank % LAYOUT.grid.cols) + 1;
    throw new Error(
        t(
            'Item not found around row {{row}} column {{column}}. If the in-game item was reforged or just changed, rescan your items on the Import tab first',
            { row, column }
        )
    );
}

module.exports = {
    LAYOUT,
    configureAdb,
    assertManagePage,
    readSlot: readSelectedSlot,
    readSelectedSlot,
    readSortState,
    setSortAcquisitionAscending,
    selectSlot,
    setFilter,
    wantedFilters,
    computeRank,
    applySetFilter,
    findSetIcon,
    applyItemFilters,
    resetFilterSession,
    requestCancel,
    clearCancel,
    assertListNotEmpty,
    ensureManagePage,
    openPanelStable,
    readSelectedOption,
    readDirection,
    readChipLabels,
    chipIsUnset,
    findCandidates,
    verifyCell,
    waitForGridReady,
    waitForGridStable,
    waitForRegionStable,
    scrollSetListToTop,
    waitForTileAt,
    hasTileAt,
    measureScroll,
    scrollGrid,
    scrollGridBy,
    scrollToItemRow,
    selectItem,
};
