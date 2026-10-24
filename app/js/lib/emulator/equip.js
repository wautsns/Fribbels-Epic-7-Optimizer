// Single-item gear swap over adb.
// Flow: verify page -> verify/set acquisition-ascending sort -> pick slot ->
//       apply filters -> select candidates -> verify values -> equip.

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
    grid: { x0: 771, y0: 300, dx: 100, dy: 125, cols: 5, rows: 3, cellW: 94, cellH: 118 },
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

// adb path comes from the settings tab; empty -> auto-detect (MuMu / LDPlayer / Nox ...)
function configureAdb() {
    let configured = '';

    try {
        const input = typeof document !== 'undefined' ? document.getElementById('settingAdbPath') : null;
        configured = input && input.value ? input.value.trim() : '';
    } catch (e) {
        configured = '';
    }

    adb.setAdbPath(configured || null);

    const path = adb.detectAdbPath();
    if (!path) {
        throw new Error('未找到 adb，请在设置页填写模拟器 adb 路径');
    }

    return path;
}

// Used before a run starts: make sure the game is on the Manage Equipment page with the
// slot tabs visible (the title alone also appears on some other screens).
async function ensureManagePage() {
    configureAdb();
    await adb.connect();
    await assertManagePage();

    const frame = await screen.capture();
    if (!readSelectedSlot(frame)) {
        throw new Error('当前不在「管理装备」界面（请先打开英雄的装备管理页）');
    }
}

async function assertManagePage() {
    const frame = await screen.capture();
    const match = await screen.matchTemplate(frame, 'page_manage.png', 40, 8, 6);
    if (match.score > 28) {
        throw new Error('当前不在「管理装备」界面（请先打开英雄的装备管理页）');
    }
    return frame;
}

async function readSortState(frame) {
    const selected = screen.luminance(frame, LAYOUT.sortRowProbe) > 150;
    const up = await screen.matchTemplate(frame, 'sort_up.png', LAYOUT.sortArrowRegion.x, LAYOUT.sortArrowRegion.y, 3);
    const down = await screen.matchTemplate(frame, 'sort_down.png', LAYOUT.sortArrowRegion.x, LAYOUT.sortArrowRegion.y, 3);
    const direction = up.score < down.score ? 'up' : 'down';
    return { selected, direction, upScore: up.score, downScore: down.score };
}

async function isSortMenuOpen(frame) {
    const up = await screen.matchTemplate(frame, 'sort_up.png', LAYOUT.sortArrowRegion.x, LAYOUT.sortArrowRegion.y, 3);
    const down = await screen.matchTemplate(frame, 'sort_down.png', LAYOUT.sortArrowRegion.x, LAYOUT.sortArrowRegion.y, 3);
    return Math.min(up.score, down.score) < 20;
}

// Opens the sort menu and verifies it actually opened: pressing back() on a closed
// menu would navigate away from the equipment page.
async function openSortMenu() {
    for (let attempt = 0; attempt < 2; attempt++) {
        await adb.tap(...LAYOUT.sortButton);
        await sleep(800);

        const frame = await screen.capture();
        if (await isSortMenuOpen(frame)) {
            return frame;
        }
    }

    throw new Error('无法打开排序菜单，请确认游戏仍停留在「管理装备」页面');
}

async function closeSortMenu(frame) {
    if (await isSortMenuOpen(frame)) {
        await adb.back();
        await sleep(500);
    }
}

async function setSortAcquisitionAscending() {
    let frame = await openSortMenu();
    let state = await readSortState(frame);

    if (!state.selected) {
        await adb.tap(...LAYOUT.sortAcquisitionRow);
        await sleep(800);
        frame = await openSortMenu();
        state = await readSortState(frame);
    }

    if (state.direction !== 'up') {
        await adb.tap(...LAYOUT.sortArrow);
        await sleep(800);
        frame = await openSortMenu();
        state = await readSortState(frame);

        if (state.direction !== 'up') {
            await closeSortMenu(frame);
            throw new Error('无法把排序切换到「获得（升序）」，请手动设置后重试');
        }
    }

    await closeSortMenu(frame);
}

const SLOT_ORDER = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

// The selected slot tab has a light highlight strip under the icon
function readSelectedSlot(frame) {
    let best = { slot: null, value: -1 };

    for (const slot of SLOT_ORDER) {
        const x = LAYOUT.slots[slot][0];
        const value = screen.luminance(frame, { x: x - 26, y: 118, w: 52, h: 14 });
        if (value > best.value) {
            best = { slot, value };
        }
    }

    return best.value > 70 ? best.slot : null;
}

async function selectSlot(slot) {
    const point = LAYOUT.slots[slot];
    if (!point) {
        throw new Error('未知部位: ' + slot);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
        await adb.tap(...point);
        await sleep(650);

        const frame = await screen.capture();
        const selected = readSelectedSlot(frame);

        if (selected === slot) {
            return frame;
        }
    }

    const slotName = typeof i18next !== 'undefined' ? i18next.t(slot) : slot;
    throw new Error('无法切换到部位「' + slotName + '」，请确认游戏停留在「管理装备」页面');
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
        const error = new Error(typeof i18next !== 'undefined' ? i18next.t('Operation cancelled') : 'Operation cancelled');
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
        const frame = await screen.capture();
        const delta = screen.regionDelta(before, frame, PANEL_REGION);

        if (wantOpen ? delta > 8 : delta < 4) {
            return frame;
        }
    }

    throw new Error(wantOpen ? '筛选面板没有弹出，请检查模拟器状态' : '筛选面板没有关闭，请检查模拟器状态');
}

// Waits until the panel is fully drawn: the open delta is large and two consecutive
// frames are nearly identical (the highlight is only painted at the end of the animation).
async function openPanelStable(before, timeout = 5000) {
    const started = Date.now();
    let previous = null;

    while (Date.now() - started < timeout) {
        await sleep(180);
        const frame = await screen.capture();

        if (screen.regionDelta(before, frame, PANEL_REGION) < 20) {
            previous = null;
            continue;
        }

        if (previous && screen.regionDelta(previous, frame, PANEL_REGION) < 6) {
            return frame;
        }

        previous = frame;
    }

    throw new Error('筛选面板没有弹出，请检查模拟器状态');
}

// The selected row in an open filter panel is drawn with a white background; the
// empty spot right of the label is sampled (no text/toggle there).
function readSelectedOption(frame) {
    let best = { key: null, value: -1 };

    for (const key of Object.keys(LAYOUT.options)) {
        const point = LAYOUT.options[key];
        const sampleX = point[0] < 900 ? 855 : 1122;
        const value = screen.luminance(frame, { x: sampleX - 10, y: point[1] - 5, w: 20, h: 10 });

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
    const left = screen.luminance(frame, { x: leftX, y: point[1] - 11, w: 22, h: 22 });
    const right = screen.luminance(frame, { x: leftX + 30, y: point[1] - 11, w: 22, h: 22 });
    return right > left ? 'desc' : 'asc';
}

// Opens the chip panel and reads its current value first. Nothing is tapped when the
// value already matches (a second tap would flip the sort direction).
async function ensureChip(chip, target) {
    const chipPoint = LAYOUT.filters[chip];
    const wantedKey = target || 'all';

    if (!chipPoint || !LAYOUT.options[wantedKey]) {
        throw new Error('未知筛选条件: ' + chip + '/' + target);
    }

    throwIfCancelled();

    let openFrame = null;

    for (let attempt = 0; attempt < 2 && !openFrame; attempt++) {
        const before = await screen.capture();
        await adb.tap(...chipPoint);

        try {
            openFrame = await openPanelStable(before, 2500);
        } catch (error) {
            // the tap probably closed a panel that was left open
            openFrame = null;
        }
    }

    if (!openFrame) {
        throw new Error('筛选面板没有弹出，请检查模拟器状态');
    }

    const current = readSelectedOption(openFrame);

    // unknown state: reset to "All" first, then reopen and pick (never tap blind, a tap
    // on the already selected stat would flip the sort direction)
    if (current === undefined) {
        await adb.tap(...LAYOUT.options.all);
        await sleep(600);
        const beforeRetry = await screen.capture();
        await adb.tap(...chipPoint);
        const retryFrame = await openPanelStable(beforeRetry);
        await adb.tap(...LAYOUT.options[wantedKey]);
        await sleep(550);
        const settled = await screen.capture();
        if (screen.regionDelta(retryFrame, settled, PANEL_REGION) < 15) {
            await adb.back();
            await sleep(500);
        }
        return 'applied';
    }

    if (current === (target || null)) {
        // already the wanted stat: only put the direction back to descending when it was
        // flipped to ascending (a fresh selection is always descending)
        if (target && readDirection(openFrame, wantedKey) === 'asc') {
            await adb.tap(...LAYOUT.options[wantedKey]);
            await sleep(550);
            const flipped = await screen.capture();
            if (screen.regionDelta(openFrame, flipped, PANEL_REGION) < 15) {
                await adb.back();
                await sleep(500);
            }
            return 'applied';
        }

        await adb.back();
        await sleep(500);
        return 'skipped';
    }

    throwIfCancelled();
    await adb.tap(...LAYOUT.options[wantedKey]);
    await sleep(550);

    // if the panel is still open the frame looks almost identical to the open one
    const after = await screen.capture();
    if (screen.regionDelta(openFrame, after, PANEL_REGION) < 15) {
        await adb.back();
        await sleep(500);
    }

    return 'applied';
}

async function setFilter(chip, statType) {
    if (!LAYOUT.filters[chip] || !(statType ? LAYOUT.options[statType] : LAYOUT.options.all)) {
        throw new Error('未知筛选条件: ' + chip + '/' + statType);
    }

    return ensureChip(chip, statType);
}

// Reads the five chips back (e.g. "All 副属性值1" vs "速度").
// Tapping an already selected substat only flips its sort direction, so we verify
// instead of blindly tapping again.
async function readChipLabels(frame) {
    const labels = {};

    for (const key of Object.keys(LAYOUT.chipRegions)) {
        const lines = await screen.ocr(screen.crop(frame, LAYOUT.chipRegions[key]), '', 3);
        labels[key] = lines.map(line => line.text).join(' ').trim();
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
        const frame = await screen.capture();
        if (setDialogVisible(frame)) {
            return true;
        }

        await adb.tap(...LAYOUT.filters.set);
        await sleep(900);
    }

    return setDialogVisible(await screen.capture());
}

// Scans the whole dialog for the set icon; the panel can be scrolled to any offset.
// Templates match their own icon at ~0-3 (mean absolute difference on 32x32 crops).
async function findSetIcon(frame, setKey) {
    const template = 'set-' + setKey + '.png';
    let best = { score: Infinity, x: 0, y: 0 };

    // templates are 28x28 crops of the icon itself (no row background)
    for (let y = 150; y <= 650; y += 2) {
        for (const colX of [165, 466]) {
            const match = await screen.matchTemplate(frame, template, colX - 14, y - 14, 3);
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
    return fs.existsSync(path.join(screen.appDir(), 'assets', 'emulator', 'set-' + setKey + '.png'));
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
    await sleep(700);
    await adb.tap(...LAYOUT.filters.set);
    await sleep(700);
    return true;
}

async function applySetFilter(setKey) {
    if (!(await openSetDialog())) {
        console.warn('[emulator] set dialog did not open, skipping set filter');
        return false;
    }

    // checkbox panel: reset to "All" first so only the wanted set stays ticked
    await adb.tap(...SET_ALL_POINT);
    await sleep(650);

    // 1) the set may already be visible where the list currently is
    if (await selectSetInFrame(await screen.capture(), setKey)) {
        return true;
    }

    // 2) otherwise go back to the top and page through the list
    for (let i = 0; i < 4; i++) {
        await adb.swipe(380, 380, 380, 620, 600);
        await sleep(260);
    }

    for (let page = 0; page < 4; page++) {
        if (await selectSetInFrame(await screen.capture(), setKey)) {
            return true;
        }

        await adb.swipe(380, 600, 380, 380, 800);
        await sleep(650);
    }

    console.warn('[emulator] set icon not matched, skipping set filter:', setKey);
    await adb.tap(...LAYOUT.filters.set);
    await sleep(700);
    return false;
}

function wantedFilters(item) {
    const fixedMain = FIXED_MAIN_SLOTS.includes(item.slot);
    const substats = item.substats || [];
    const wanted = { main: fixedMain ? null : item.mainType };

    for (let index = 0; index < 4; index++) {
        wanted['sub' + (index + 1)] = substats[index] ? substats[index].type : null;
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

    console.log('[emulator] filters changed:', applied.join(',') || '-',
        '| already correct:', skipped.join(',') || '-');

    filterCache = Object.assign({}, filterCache || {}, wanted);
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
        throw new Error('当前筛选条件下列表为空：装备可能在仓库、被其他英雄穿戴且开启了「隐藏配戴装备」，或部位不对');
    }
}

// Rank of the target inside the filtered list: sort by the active substat chips in
// order (descending), ties by acquisition, mirroring the in-game list order.
function computeRank(target, allItems, filters, descending = true, useBase = false) {
    if (!allItems || !target.id || !filters) {
        return -1;
    }

    const active = ['sub1', 'sub2', 'sub3', 'sub4']
        .map(key => filters[key])
        .filter(Boolean);

    const has = (item, type) => (item.substats || []).some(stat => stat.type === type);
    const valueOf = (item, type) => {
        const stat = (item.substats || []).find(entry => entry.type === type);
        if (!stat) {
            return -1;
        }
        if (!useBase && item.augmentedStats && item.augmentedStats[type] !== undefined) {
            return item.augmentedStats[type];
        }
        return stat.value;
    };

    const candidates = allItems.filter(item =>
        item.gear === target.slot &&
        !item.storage &&
        item.main &&
        (!filters.main || item.main.type === filters.main) &&
        (!filters.set || item.set === filters.set) &&
        active.every(type => has(item, type)));

    candidates.sort((a, b) => {
        for (const type of active) {
            const diff = valueOf(b, type) - valueOf(a, type);
            if (diff !== 0) {
                return diff;
            }
        }
        return Number(a.ingameId) - Number(b.ingameId);
    });

    const index = candidates.findIndex(item => String(item.id) === String(target.id));
    const total = candidates.length;

    return {
        index,
        total,
        rank: index < 0 ? -1 : (descending ? index : total - 1 - index),
    };
}

function findCandidates(frame) {
    const cells = [];

    for (let row = 0; row < LAYOUT.grid.rows; row++) {
        for (let col = 0; col < LAYOUT.grid.cols; col++) {
            const x = LAYOUT.grid.x0 + col * LAYOUT.grid.dx;
            const y = LAYOUT.grid.y0 + row * LAYOUT.grid.dy;
            const iconBrightness = screen.luminance(frame, { x: x - 32, y: y - 42, w: 64, h: 54 });
            if (iconBrightness > 32) {
                cells.push({ x, y, iconBrightness });
            }
        }
    }

    return cells;
}

// The panel always shows the values the game has; the optimizer data stores the base
// values, so those are the ones compared. If they do not match the data is stale and a
// fresh import is needed.
function expectedValueSets(item) {
    if (Array.isArray(item.baseValues)) {
        return [item.baseValues];
    }
    return [[item.mainValue].concat((item.substats || []).map(stat => stat.value))];
}

function matchesAny(numbers, sets) {
    return sets.some(set => matchesExpected(numbers, set));
}

function matchesExpected(numbers, expected) {
    const pool = numbers.map(entry => entry.value);
    const remaining = pool.slice();

    for (const value of expected) {
        const rounded = Math.round(value * 10) / 10;
        const index = remaining.findIndex(candidate => Math.abs(candidate - rounded) <= 0.51);
        if (index === -1) {
            return false;
        }
        remaining.splice(index, 1);
    }

    return true;
}

async function verifyCell(cell, item) {
    await adb.tap(cell.x, cell.y);
    await sleep(650);
    return readPanel(item);
}

// Taps a tile and verifies it. Handles the case where the tile was already selected
// (the game toggles selection), and deselects a wrong item so it is not left pending.
async function selectAndVerify(cell, item) {
    let result = await verifyCell(cell, item);

    if (result.ok) {
        return result;
    }

    // empty panel: the tap toggled an existing selection off -> tap once more
    if (!result.numbers || result.numbers.length === 0) {
        result = await verifyCell(cell, item);
        if (result.ok) {
            return result;
        }
    }

    // wrong item: toggle the pending selection off
    await adb.tap(cell.x, cell.y);
    await sleep(500);
    return result;
}

// reads the item panel of the currently selected tile
async function readPanel(item) {
    const frame = await screen.capture();
    const panel = screen.crop(frame, LAYOUT.valuePanel);

    const expectedSets = expectedValueSets(item);

    // Tesseract.js (bundled wasm) with a digit whitelist reads this panel far more
    // reliably than the Windows engine; the Windows OCR stays as the fallback.
    const tessJs = await screen.tesseractJsNumbers(frame, LAYOUT.valuePanelNumbers);
    if (tessJs && tessJs.length >= 5) {
        const numbers = tessJs.map(value => ({ value }));
        if (matchesAny(numbers, expectedSets)) {
            return { ok: true, numbers, source: 'tesseract-js' };
        }
    }

    // The zh engine is the more accurate one for this panel; the en engine is only run
    // when the first pass does not match (it covers percentages the zh pass sometimes
    // drops, at the cost of one extra OCR round).
    const chineseLines = await screen.ocr(panel, '', 4);
    const chineseNumbers = screen.extractNumbers(chineseLines);

    if (matchesAny(chineseNumbers, expectedSets)) {
        return { ok: true, numbers: chineseNumbers, lines: chineseLines };
    }

    const englishLines = await screen.ocr(panel, 'en-US', 4);
    const numbers = chineseNumbers.concat(screen.extractNumbers(englishLines));

    return { ok: matchesAny(numbers, expectedSets), numbers, lines: chineseLines.concat(englishLines) };
}

// A short/fast swipe triggers a fling and the list stops at an unpredictable offset;
// a slow drag moves ~1:1 with the finger (measured ~255px for a 260px drag).
async function scrollGrid(distance = 260) {
    const from = 560;
    await adb.swipe(995, from, 995, from - distance, 1200);
    await sleep(900);
}

// Scrolls the list back to the first row (used before a full fallback scan)
async function scrollToTop() {
    for (let i = 0; i < 8; i++) {
        const before = await screen.capture();
        await adb.swipe(995, 320, 995, 580, 1200);
        await sleep(700);
        const after = await screen.capture();

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
    const before = await screen.capture();
    const step = Math.max(60, Math.min(260, Math.abs(distance)));

    if (distance >= 0) {
        await adb.swipe(995, 560, 995, 560 - step, 1100);
    } else {
        await adb.swipe(995, 320, 995, 320 + step, 1100);
    }

    await sleep(800);
    const after = await screen.capture();
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
    const region = { x: 900, y: LAYOUT.gridTop, w: 120, h: LAYOUT.gridBottom - LAYOUT.gridTop };
    const a = screen.crop(before, region).bitmap;
    const b = screen.crop(after, region).bitmap;
    const width = a.width;
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
        throw new Error('缺少装备信息');
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
        filterCache = Object.assign({}, filterCache || {}, { set: item.set, setApplied });
    } else if (filterCache) {
        setApplied = !!filterCache.setApplied;
    }

    const filters = await applyItemFilters(item);
    filters.set = setApplied ? item.set : null;
    // changing a filter resets the list to the top
    gridScroll = 0;

    let frame = await screen.capture();
    await assertListNotEmpty(frame);

    if (!options.allItems || !item.id) {
        throw new Error('缺少装备索引，无法定位');
    }

    // Descending only: the chips define the sort keys and a fresh selection is always
    // descending. The computed rank plus its neighbours is probed; if nothing matches the
    // slot is skipped (no full-list scan).
    const info = computeRank(item, options.allItems, filters, true, true);

    const probes = [];
    if (info.rank >= 0) {
        for (const delta of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
            const candidate = info.rank + delta;
            if (candidate >= 0 && !probes.includes(candidate)) probes.push(candidate);
        }
    }

    if (probes.length) {
        for (let probeIndex = 0; probeIndex < probes.length; probeIndex++) {
            throwIfCancelled();
            const candidate = probes[probeIndex];
            if (candidate < 0) {
                continue;
            }

            const targetRow = Math.floor(candidate / LAYOUT.grid.cols);
            const position = await scrollToItemRow(targetRow);
            if (!position.ok) {
                continue;
            }

            const cell = {
                x: LAYOUT.grid.x0 + (candidate % LAYOUT.grid.cols) * LAYOUT.grid.dx,
                y: position.y,
            };

            const result = await selectAndVerify(cell, item);
            if (result.ok) {
                return { ok: true, cell, rank: candidate };
            }

            // the tile cannot be selected at all -> very likely already worn
            if (probeIndex === 0 && (!result.numbers || result.numbers.length === 0)) {
                console.warn('[emulator] tile not selectable, treating as already equipped:', item.slot);
                return { ok: true, cell, rank: candidate, alreadyEquipped: true };
            }
        }
    }

    const row = Math.floor(info.rank / LAYOUT.grid.cols) + 1;
    const column = (info.rank % LAYOUT.grid.cols) + 1;
    throw new Error('未找到目标装备（第 ' + row + ' 行第 ' + column
        + ' 列附近未命中）。若游戏内装备已重铸或刚变更，请先在导入页重新扫描装备数据');
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
