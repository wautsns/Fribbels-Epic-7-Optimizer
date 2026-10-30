// Single-item gear swap over adb.
// Flow: verify page -> verify/set acquisition-ascending sort -> pick slot ->
//       apply filters -> select candidates -> verify values -> equip.

const os = require('os');
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
    sortArrow: [1176, 211],
    // empty part of the "获得" row background (right of the label, left of the arrow toggle)
    sortRowProbe: { x: 1108, y: 200, w: 8, h: 20 },
    sortArrowRegion: { x: 1158, y: 196 },
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
    // main value + four substats only (the score row is excluded)
    valuePanelNumbers: { x: 255, y: 262, w: 95, h: 162 },
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

// 出问题时把当前画面存一份到临时目录，方便事后对照（只在失败路径调用）
async function dumpFrame(frame, label) {
    if (!frame || typeof frame.writeAsync !== 'function') {
        return null;
    }

    const target = path.join(os.tmpdir(), `e7-${label}-${Date.now()}.png`);
    await frame.writeAsync(target);
    // eslint-disable-next-line no-console
    console.warn('[emulator] frame saved for diagnosis:', target);

    return target;
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
        const settled = await waitForSettledScreen();
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

async function readSortState(frame) {
    const selected = screen.luminance(frame, LAYOUT.sortRowProbe) > 150;
    const up = await screen.matchTemplate(
        frame,
        'sort_up.png',
        LAYOUT.sortArrowRegion.x,
        LAYOUT.sortArrowRegion.y,
        3
    );
    const down = await screen.matchTemplate(
        frame,
        'sort_down.png',
        LAYOUT.sortArrowRegion.x,
        LAYOUT.sortArrowRegion.y,
        3
    );
    const direction = up.score < down.score ? 'up' : 'down';
    return { selected, direction, upScore: up.score, downScore: down.score };
}

async function isSortMenuOpen(frame) {
    const up = await screen.matchTemplate(
        frame,
        'sort_up.png',
        LAYOUT.sortArrowRegion.x,
        LAYOUT.sortArrowRegion.y,
        3
    );
    const down = await screen.matchTemplate(
        frame,
        'sort_down.png',
        LAYOUT.sortArrowRegion.x,
        LAYOUT.sortArrowRegion.y,
        3
    );
    return Math.min(up.score, down.score) < 20;
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
    // 并且给三次机会（2s 轮询 + 稳定等待，最坏约 7s）
    for (let attempt = 0; attempt < 3; attempt++) {
        await waitForSettledScreen(1200).catch(() => null);
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

    const up = await screen.matchTemplate(frame, 'sort_up.png', LAYOUT.sortArrowRegion.x, LAYOUT.sortArrowRegion.y, 3);
    const down = await screen.matchTemplate(frame, 'sort_down.png', LAYOUT.sortArrowRegion.x, LAYOUT.sortArrowRegion.y, 3);
    console.warn('[emulator] sort menu did not open, arrow scores:', {
        up: Math.round(up.score * 10) / 10,
        down: Math.round(down.score * 10) / 10,
    });
    await dumpFrame(frame, 'sort-not-open').catch(() => null);

    throw new Error(
        t(
            'Could not open the sort menu. Make sure the game is still on the Manage Equipment page'
        )
    );
}

async function closeSortMenu(frame) {
    if (await isSortMenuOpen(frame)) {
        await dismissOverlay('sort menu');
    }
}

// 排序菜单里的某个控件被点一下之后，轮询到状态真的变成期望值为止（最多 timeout）。
// 固定等 800ms 时，偶尔被吞掉的一次点击会被当成「排序改不动」而整轮报错。
async function tapSortControl(point, predicate, timeout = 2000) {
    await inputThenWait({ tap: point }, 250);

    const deadline = Date.now() + timeout;
    let frame = await openSortMenu();
    let state = await readSortState(frame);

    while (!predicate(state) && Date.now() < deadline) {
        await adb.wait(120);
        const next = await captureFrame();

        if (await isSortMenuOpen(next)) {
            frame = next;
        } else {
            // 点击把菜单关掉了（点到了菜单外），重新打开再读
            frame = await openSortMenu();
        }

        state = await readSortState(frame);
    }

    return { frame, state };
}

async function setSortAcquisitionAscending() {
    let frame = await openSortMenu();
    let state = await readSortState(frame);

    if (!state.selected) {
        ({ frame, state } = await tapSortControl(LAYOUT.sortAcquisitionRow, (s) => s.selected));
    }

    if (state.direction !== 'up') {
        ({ frame, state } = await tapSortControl(LAYOUT.sortArrow, (s) => s.direction === 'up'));

        if (state.direction !== 'up') {
            await closeSortMenu(frame);
            throw new Error(
                t(
                    'Could not switch the sort to Acquisition (Ascending). Set it manually and retry'
                )
            );
        }
    }

    await closeSortMenu(frame);
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
            const settled = await waitForSettledScreen();

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

    await inputThenWait({ tap: [icon.x, icon.y] }, 700);
    await dismissOverlay('set dialog');
    return true;
}

async function applySetFilter(setKey) {
    if (!(await openSetDialog())) {
        console.warn('[emulator] set dialog did not open, skipping set filter');
        return false;
    }

    // checkbox panel: reset to "All" first so only the wanted set stays ticked
    await inputThenWait({ tap: SET_ALL_POINT }, 650);

    // 1) the set may already be visible where the list currently is
    if (await selectSetInFrame(await captureFrame(), setKey)) {
        return true;
    }

    // 2) otherwise go back to the top and page through the list
    for (let i = 0; i < 4; i++) {
        await inputThenWait({ swipe: [380, 380, 380, 620, 600] }, 260);
    }

    for (let page = 0; page < 4; page++) {
        if (await selectSetInFrame(await captureFrame(), setKey)) {
            return true;
        }

        await inputThenWait({ swipe: [380, 600, 380, 380, 800] }, 650);
    }

    console.warn(
        '[emulator] set icon not matched, skipping set filter:',
        setKey
    );
    await dismissOverlay('set dialog');
    return false;
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

    // compare each chip one by one: main, sub1, sub2, sub3, sub4
    for (const key of Object.keys(wanted)) {
        if (!force && filterCache && filterCache[key] === wanted[key]) {
            skipped.push(key);
            continue;
        }

        throwIfCancelled();
        const status = await setFilter(key, wanted[key]);
        (status === 'applied' ? applied : skipped).push(key);
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

// The game fades the item panel in after a selection. Capturing in the middle of that
// fade gives dimmer glyphs and the OCR then silently drops a value (measured: the flat
// speed substat), which looks like "wrong item" and triggers a walk over the neighbour
// tiles. So wait until the panel region stops changing instead of sleeping a fixed delay.
async function waitForPanelSettled(initialFrame, timeout = 1800) {
    const started = Date.now();
    let previous = initialFrame || (await captureFrame());

    while (Date.now() - started < timeout) {
        const frame = await captureFrame();
        if (screen.regionDelta(previous, frame, LAYOUT.valuePanel) < 2) {
            return frame;
        }
        previous = frame;
    }

    return previous;
}

async function verifyCell(cell, item) {
    await adb.tap(cell.x, cell.y);
    // let the press ripple pass, then OCR a settled panel
    await sleep(150);
    return readPanel(item, await waitForPanelSettled(await captureFrame()));
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
        LAYOUT.valuePanelNumbers
    );
    if (tessJs && tessJs.length >= 5) {
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
        await inputThenWait({ swipe: [995, 320, 995, 580, 1200] }, 700);
        const after = await captureFrame();

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

// Scrolls by roughly `distance` px (positive = further down the list) and measures
// the real movement in both directions so the offset stays accurate.
async function scrollGridBy(distance) {
    throwIfCancelled();
    const before = await captureFrame();
    const step = Math.max(60, Math.min(260, Math.abs(distance)));

    if (distance >= 0) {
        await adb.swipe(995, 560, 995, 560 - step, 1100);
    } else {
        await adb.swipe(995, 320, 995, 320 + step, 1100);
    }

    await sleep(800);
    const after = await captureFrame();
    const up = measureScroll(before, after);
    const down = measureScroll(after, before);
    const moved = up.score <= down.score ? up.d : -down.d;
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

    configureAdb();
    await adb.connect();
    throwIfCancelled();
    await assertManagePage();
    await selectSlot(item.slot);
    // switching slots shows the list from the top again
    gridScroll = 0;
    // the slot tap must not have navigated away
    await assertManagePage();

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
    } else if (filterCache) {
        setApplied = !!filterCache.setApplied;
    }

    const filters = await applyItemFilters(item);
    filters.set = setApplied ? item.set : null;
    // changing a filter resets the list to the top
    gridScroll = 0;

    const frame = await captureFrame();
    await assertListNotEmpty(frame);

    if (!options.allItems || !item.id) {
        throw new Error(t('Missing item index, cannot locate the item'));
    }

    // Descending only: the chips define the sort keys and a fresh selection is always
    // descending. The computed rank plus its neighbours is probed; if nothing matches the
    // slot is skipped (no full-list scan).
    const info = computeRank(item, options.allItems, filters, true, true);

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

            const targetRow = Math.floor(candidate / LAYOUT.grid.cols);
            const position = await scrollToItemRow(targetRow);
            if (!position.ok) {
                continue;
            }

            const cell = {
                x:
                    LAYOUT.grid.x0 +
                    (candidate % LAYOUT.grid.cols) * LAYOUT.grid.dx,
                y: position.y,
            };

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
    measureScroll,
    scrollGrid,
    scrollToItemRow,
    selectItem,
};
