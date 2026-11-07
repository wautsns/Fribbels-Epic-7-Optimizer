// Entry point for the emulator automation from the heroes tab:
// swaps all 6 equipped items (or the 6 items of the selected build).

const equip = require('./equip');
const adb = require('./adb');

const SLOT_ORDER = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

/**
 * 一轮跑完（「中断操作」变回「一键换装」）后，一键换装按钮还要再禁用这么久：
 * 连续点「中断操作」时很容易顺带点到刚变回来的「一键换装」，于是又启动一轮。
 */
const RESTART_COOLDOWN_MS = 3000;

let busy = false;
let stopping = false;
let cooldown = false;
let cooldownTimer = null;

// 运行状态变化时通知界面（builds 功能列的机器人图标、配装器页的一键换装按钮都看它）
const busyListeners = [];

/**
 * 给界面看的运行状态：
 *   busy     运行中（机器人图标变转圈，点它就是中断）
 *   stopping 已请求中断（转圈图标灰掉，点了没反应）
 *   cooldown 刚跑完的 3 秒（机器人图标灰掉，避免连点中断后一下又启动一轮）
 */
function currentState() {
    return { busy, stopping, cooldown };
}

function notifyState() {
    busyListeners.forEach((listener) => {
        try {
            listener(currentState());
        } catch (error) {
            console.warn('[emulator] busy listener failed', error);
        }
    });
}

function setBusy(value) {
    if (busy === value) {
        return;
    }
    busy = value;
    notifyState();
}

/** 开始冷却：只置状态 + 装定时器，不通知（调用方随后的状态通知会带上它） */
function startCooldown() {
    cooldown = true;

    if (cooldownTimer) {
        clearTimeout(cooldownTimer);
    }
    cooldownTimer = setTimeout(() => {
        cooldownTimer = null;
        cooldown = false;
        notifyState();
    }, RESTART_COOLDOWN_MS);
}

// 副属性按数值降序（同值按类型字母序）：chip 1 就是第一条
function sortedSubstats(item) {
    return (item.substats || [])
        .map((sub) => ({
            type: sub.type,
            value:
                item.augmentedStats &&
                item.augmentedStats[sub.type] !== undefined
                    ? item.augmentedStats[sub.type]
                    : sub.value,
        }))
        .sort((a, b) => b.value - a.value || a.type.localeCompare(b.type));
}

/** 没给规划时的默认顺序：chip 1 取最大数值，其余三条按类型字母序 */
function defaultChipOrder(sorted) {
    return sorted.length
        ? [sorted[0].type].concat(
              sorted
                  .slice(1)
                  .map((sub) => sub.type)
                  .sort((a, b) => a.localeCompare(b))
          )
        : [];
}

function orderSubstats(sorted, order) {
    if (!order || !order.length || order.length !== sorted.length) {
        return sorted;
    }

    const byType = new Map(sorted.map((sub) => [sub.type, sub]));
    const ordered = order
        .map((type) => byType.get(type))
        .filter((sub) => Boolean(sub));

    // 类型对不上（数据不一致）时退回默认顺序，不要丢副属性
    return ordered.length === sorted.length ? ordered : sorted;
}

function permutations(types) {
    if (types.length <= 1) {
        return [types.slice()];
    }

    const result = [];
    types.forEach((type, index) => {
        const rest = types.slice(0, index).concat(types.slice(index + 1));
        permutations(rest).forEach((tail) => result.push([type].concat(tail)));
    });
    return result;
}

/**
 * 一件装备所有合法的 chip 排列（4 条副属性 = 24 种）。
 * 没有全量装备数据时估不出排名，就只保留 chip1 = 数值最高那条的旧规则。
 */
function chipOrderCandidates(sorted, allItems) {
    const types = sorted.map((sub) => sub.type);
    if (!types.length) {
        return [[]];
    }

    const all = permutations(types);
    if (allItems && allItems.length) {
        return all;
    }

    return all.filter((order) => order[0] === types[0]);
}

/**
 * 从上一件的 chip 排列换到这一件，需要点几次。
 *
 * 游戏里有个细节：把某个 chip 设成**已经存在于别的 chip 上**的副属性时，两个 chip 会
 * 交换，而不是出现重复。所以「把 chip2 设成 chip3 现在那个属性」会顺带把 chip3 也变成
 * chip2 原来的属性 —— 如果那正好是这次想要的，chip3 就不用再点了。
 * 这里按 chip1..4 的顺序模拟一遍，返回实际需要点击的次数。
 */
function chipChangeCost(previous, next) {
    const live = previous.slice();
    let taps = 0;

    for (let index = 0; index < next.length; index += 1) {
        if (live[index] === next[index]) {
            continue;
        }

        const partner = live.indexOf(next[index]);
        const displaced = live[index];

        live[index] = next[index];
        if (partner >= 0 && partner !== index) {
            live[partner] = displaced;
        }

        taps += 1;
    }

    return taps;
}

// 两种代价都换算成秒，方便放在一起比较
const CHIP_CHANGE_SECONDS = 1.8; // 开面板 + 选一条 + 关面板
const ROW_SECONDS = 0.5; // 列表每滚一行（125px ≈ 半次 swipe，一次 swipe ≈ 1s 滚 2 行）

/** 这套 chip 下目标要滚动几行（chip1 是排序主键，直接决定它在列表里的位置） */
function rankRowsOf(item, order, allItems) {
    if (!allItems || !allItems.length) {
        return 0;
    }

    const target = buildTarget(item, order);
    const filters = equip.wantedFilters(target);
    const info = equip.computeRank(target, allItems, filters, true, true);
    if (!info || info.rank < 0) {
        return 0;
    }

    const cols = (equip.LAYOUT.grid && equip.LAYOUT.grid.cols) || 5;
    return Math.floor(info.rank / cols);
}

/**
 * 六件装备是按槽位一件件换的，过滤器（chip）会跨槽位保留：上一件已经设好的
 * 副属性 chip 如果这件也用到，那个 chip 就不用重设。
 *
 * 每个排列的代价 = 目标在列表里要滚动的行数（chip 1 是排序主键，决定目标位置）
 *              + 和上一件排列的差异数 × 一次 chip 切换的耗时。
 * 每件最多 24 种排列，对整轮做一次 DP 取总代价最小的组合。
 */
function planChipOrders(items, allItems, verbose = true) {
    const startedAt = Date.now();
    const layers = [];
    let states = new Map([['', { cost: 0, previousKey: null, order: null }]]);

    items.forEach((item) => {
        const next = new Map();

        chipOrderCandidates(sortedSubstats(item), allItems).forEach((order) => {
            const key = order.join('|');
            const scrollCost = rankRowsOf(item, order, allItems) * ROW_SECONDS;
            let best = null;

            states.forEach((state, previousKey) => {
                const cost =
                    state.cost +
                    scrollCost +
                    (state.order
                        ? chipChangeCost(state.order, order) * CHIP_CHANGE_SECONDS
                        : 0);
                if (!best || cost < best.cost) {
                    best = { cost, previousKey, order };
                }
            });

            if (best) {
                next.set(key, best);
            }
        });

        layers.push(next);
        states = next;
    });

    let bestKey = null;
    let bestCost = Infinity;
    states.forEach((state, key) => {
        if (state.cost < bestCost) {
            bestCost = state.cost;
            bestKey = key;
        }
    });

    const orders = new Array(layers.length).fill(null);
    let key = bestKey;
    for (let index = layers.length - 1; index >= 0; index -= 1) {
        const state = layers[index].get(key);
        if (!state) {
            break;
        }
        orders[index] = state.order;
        key = state.previousKey;
    }

    if (verbose) {
        console.log(
            '[emulator] chip plan:',
            bestCost.toFixed(1) + 's |',
            orders.map((order) => (order || []).join('/')).join(' -> '),
            '| planned in ' + (Date.now() - startedAt) + 'ms'
        );
    }
    return orders;
}

function buildTarget(item, chipOrder) {
    const sorted = sortedSubstats(item);
    const ordered = orderSubstats(
        sorted,
        chipOrder || defaultChipOrder(sorted)
    );

    // The panel shows the values the game has. For a reforged item those are the reforged
    // substats, for a normal one the base substats, so both sets are kept.
    //
    // The main stat is deliberately left out of both sets:
    //  - it is already pinned before the tile is even looked at (weapon/helmet/armor have a
    //    fixed main stat, the accessories are filtered by the wanted main type), and the
    //    four substats identify a tile well enough inside the probed rank window;
    //  - reforge changes the main stat value (reforge.js: for example 465 -> 525 attack),
    //    and the panel then shows the reforged one, so including it made every reforged
    //    piece fail the check and walk over the neighbour tiles.
    const baseValues = (item.substats || []).map((sub) => sub.value);
    // item.reforgedStats holds the real reforged numbers (itemAugmenter): the augmented
    // stats used above are the base ones, which is why reforged pieces never matched before.
    const reforgedValues = (item.substats || []).map((sub) => {
        const reforged = item.reforgedStats
            ? item.reforgedStats[sub.type]
            : undefined;
        return reforged === undefined || reforged === null
            ? sub.value
            : reforged;
    });

    return {
        id: item.id,
        slot: item.gear,
        set: item.set,
        mainType: item.main.type,
        mainValue: item.main.value,
        substats: ordered,
        baseValues,
        reforgedValues,
    };
}

// While a run is in progress the same button turns into the cancel button; once the
// cancel is requested it is disabled until the run actually stops.
function setButtonRunning(running) {
    const button = document.getElementById('emulatorSelectHero');
    if (!button) {
        return;
    }

    button.disabled = false;
    button.style.opacity = '';
    button.value = running
        ? i18next.t('Cancel operation')
        : i18next.t('One-Click Equip');
}

function setButtonStopping() {
    const button = document.getElementById('emulatorSelectHero');
    if (!button) {
        return;
    }

    button.disabled = true;
    button.style.opacity = '0.6';
    button.value = i18next.t('Stopping...');
}

let allItemsCache = null;

async function getAllItems() {
    if (!allItemsCache) {
        const response = await Api.getAllItems();
        allItemsCache = response.items || [];
    }

    return allItemsCache;
}

async function resolveItem(entry) {
    if (entry && entry.main) {
        return entry;
    }

    const response = await Api.getItemById(entry.id);
    return response && response.item ? response.item : null;
}

async function resolveItems(entries) {
    const items = [];

    for (const entry of entries) {
        const item = await resolveItem(entry);
        if (!item || !item.main) {
            throw new Error(i18next.t('Item not found'));
        }
        items.push(item);
    }

    return items.sort(
        (a, b) => SLOT_ORDER.indexOf(a.gear) - SLOT_ORDER.indexOf(b.gear)
    );
}

/**
 * 开跑前（ensureManagePage）失败的提示：
 * 分辨率不对 / 不在装备页都直接说清楚，别套「换装失败」；
 * adb 没配 / 连不上这类才带前缀。
 */
function preflightErrorMessage(error) {
    if (error.unsupportedResolution) {
        return error.message;
    }
    if (error.notOnManagePage) {
        return i18next.t('Please open the Manage Equipment page in game first');
    }
    return i18next.t('In-game equip failed: ') + error.message;
}

module.exports = {
    buildTarget,
    /** 供控制台排查：给定一组装备，打印最省切换次数的 chip 排列 */
    planChipOrders,
    defaultChipOrder,
    chipChangeCost,
    sortedSubstats,

    // 一键换装按钮已移除，取消入口改到 builds 功能列的机器人图标上
    isBusy: () => busy,
    /** 已请求中断、还在等这一步操作结束 */
    isStopping: () => stopping,
    /** 刚跑完的冷却期（按钮要灰 3 秒，避免连点中断后一下又启动一轮） */
    isCoolingDown: () => cooldown,
    getState: () => currentState(),

    onBusyChange: (listener) => {
        if (
            typeof listener === 'function' &&
            !busyListeners.includes(listener)
        ) {
            busyListeners.push(listener);
        }
    },

    cancel: () => {
        if (!busy || stopping) {
            return;
        }
        stopping = true;
        setButtonStopping();
        // 中断是「等这一步 adb 操作做完」，给个提示 + 把机器人图标灰掉，别让人以为没反应
        Notifier.info(i18next.t('Cancelling...'));
        notifyState();
        equip.requestCancel();
    },

    initialize: () => {
        const button = document.getElementById('emulatorSelectHero');
        if (button) {
            button.addEventListener('click', () => {
                if (busy) {
                    if (stopping) {
                        return;
                    }
                    stopping = true;
                    setButtonStopping();
                    Notifier.info(i18next.t('Cancelling...'));
                    notifyState();
                    equip.requestCancel();
                    return;
                }
                module.exports.equipHeroBuild();
            });
        }
    },

    // 6-piece flow: select all six pieces; the user presses 更换装备 once at the end
    // and the game applies all pending selections
    // heroArg / itemEntriesArg：GVG 的表格调用时显式传入（默认仍取英雄页的选中项）
    equipHeroBuild: async (heroArg, itemEntriesArg) => {
        // 冷却期内点了也不启动（图标本来就是灰的，这里再兜一次）
        if (busy || cooldown) {
            return;
        }

        const hero = heroArg || (HeroesGrid.getSelectedRow ? HeroesGrid.getSelectedRow() : null);
        if (!hero) {
            Dialog.htmlError(i18next.t('Select a hero first'));
            return;
        }

        const checked =
            Array.isArray(itemEntriesArg) && itemEntriesArg.length
                ? itemEntriesArg
                : HeroesTab.getSelectedGear
                  ? HeroesTab.getSelectedGear()
                  : [];
        if (checked.length !== 6) {
            Dialog.htmlError(
                i18next.t('Need 6 items: check all six, or select a build row')
            );
            return;
        }

        stopping = false;
        setBusy(true);
        let currentSlot = '';
        let cancelled = false;
        setButtonRunning(true);
        equip.clearCancel();

        // fail fast when the game is not on the manage equipment page
        try {
            await equip.ensureManagePage();
        } catch (error) {
            setBusy(false);
            setButtonRunning(false);
            Dialog.htmlError(preflightErrorMessage(error));
            return;
        }

        // 开流：截图 263ms -> ~140ms，点击 259ms -> ~143ms（批量再降到 ~40ms/条）。
        // 设备不支持（没有 toybox netcat / 非 RGBA 帧）时静默退回一次次性 adb 调用。
        await adb.startStream().catch((error) => {
            console.warn(
                '[emulator] streaming backend unavailable, using one-shot adb:',
                error && error.message
            );
        });

        try {
            const items = await resolveItems(checked);
            const allItems = await getAllItems();
            equip.resetFilterSession();

            // 副属性 chip 的顺序按整轮连续性 + 目标排名先规划好（顺序影响谁先排序）
            const chipOrders = planChipOrders(items, allItems);

            // the optimizer data may be stale, so every piece is attempted; a slot that
            // fails (e.g. already worn in game) does not stop the rest
            const failed = [];

            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                currentSlot = i18next.t(item.gear);

                // stays visible while this slot is being processed
                const progress = Notifier.stickyRaw
                    ? Notifier.stickyRaw(
                          `${i18next.t(
                              'Equipping in game...'
                          )} ${currentSlot} (${index + 1}/${items.length})`
                      )
                    : null;

                try {
                    // select only: the game keeps the pending selections and applies them
                    // when the user presses 更换装备 once at the end
                    await equip.selectItem(
                        module.exports.buildTarget(item, chipOrders[index]),
                        {
                            allItems,
                        }
                    );
                } catch (error) {
                    if (error.cancelled) {
                        cancelled = true;
                        break;
                    }

                    // a page problem on the very first slot means the game is not on the
                    // manage equipment page: stop instead of failing all six slots
                    if (index === 0 && error.notOnManagePage) {
                        Dialog.htmlError(
                            i18next.t(
                                'Please open the Manage Equipment page in game first'
                            )
                        );
                        return;
                    }

                    console.warn('[emulator] slot failed', item.gear, error);
                    failed.push({ slot: currentSlot, message: error.message });
                } finally {
                    // the toast stays until the slot is done, then the next slot shows its own
                    if (progress) {
                        progress.close();
                    }
                }
            }

            if (cancelled) {
                Notifier.info(i18next.t('Operation cancelled'));
                return;
            }

            if (failed.length === 0) {
                Dialog.htmlSuccessDisableOutsideClick(
                    i18next.t(
                        'All items are selected. Confirm and press Equip once in game.'
                    )
                );
                return;
            }

            const detail = failed
                .map((entry) => `${entry.slot}: ${entry.message}`)
                .join('<br>');
            if (failed.length === items.length) {
                Dialog.htmlError(
                    `${i18next.t('In-game equip failed: ')}<br>${detail}`
                );
            } else {
                Dialog.htmlError(
                    `${i18next.t(
                        'Some slots could not be equipped (may already be worn):'
                    )}<br>${detail}`
                );
            }
        } catch (error) {
            if (error.cancelled) {
                Notifier.info(i18next.t('Operation cancelled'));
                return;
            }

            Dialog.htmlError(
                i18next.t('In-game equip failed: ') + error.message
            );
        } finally {
            // 收尾：断开两个连接、杀掉监听进程、移除 adb forward、删掉设备脚本
            const stats = adb.streamStats();
            if (stats)
                console.log('[emulator] stream stats', JSON.stringify(stats));
            await adb.stopStream().catch(() => {});

            stopping = false;
            // 先置冷却再 setBusy(false)，图标一次就变灰（否则会先闪一下可点的机器人）
            startCooldown();
            setBusy(false);
            setButtonRunning(false);
        }
    },

    // single item helper (kept for future use)
    equipSingleItem: async (entry) => {
        if (busy) {
            return;
        }

        setBusy(true);
        try {
            const item = await resolveItem(entry);
            if (!item) {
                throw new Error(i18next.t('Item not found'));
            }
            Notifier.info(i18next.t('Locating the item in the emulator...'));
            await equip.selectItem(module.exports.buildTarget(item));
            Notifier.success(
                i18next.t(
                    'Item selected in the emulator. Check the panel, then tap Equip in game.'
                )
            );
        } catch (error) {
            Dialog.htmlError(
                i18next.t('In-game equip failed: ') + error.message
            );
        } finally {
            setBusy(false);
        }
    },
};
