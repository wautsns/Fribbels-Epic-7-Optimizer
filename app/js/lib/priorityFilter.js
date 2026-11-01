module.exports = {

    calculatePriorityScores: (params, items, baseStats, reforge) => {
        for (const gear of items) {
            calculateScore(gear, params, baseStats, reforge);
        }
    },

    /*
     * 候选装备预筛。
     *
     * 后端要把 6 个部位的候选两两组合全部过一遍，所以真正的成本是「各部位候选数的乘积」。
     * 规则：
     *   1. 组合数 ≤ 预算（COMBO_BUDGET）就完全不截断，保证结果是最优解；
     *   2. 超预算时从宽到紧试百分比（滑块值只作为上限），取第一个落进预算的；
     *   3. 候选池 = 「每个 (部位 × 套装) 各自的 Top%」 ∪ 「每个部位整体的 Top%」，
     *      也就是：每个套装在每个部位都至少按 Top% 保留，同时该部位整体分数最高的那批也在，
     *      允许最终件数超过 Top%（实测：少了套装代表时，极限一速只能搜到 310，改完 315）；
     *   4. 还有预算余量时，把各组的边界同分补回来（见 addTiesWithinBudget）。
     */
    applyPriorityFilters: (params, items, baseStats, allItems, reforge, inputSubstatMods) => {
        if (!items || items.length === 0) {
            return items;
        }

        if (filterDisabled(params)) {
            console.log("Priority filter disabled")
            return items;
        }

        module.exports.calculatePriorityScores(params, items, baseStats, reforge);

        const groups = buildGroups(items);
        const allGroupCounts = countGroups(allItems);
        for (const group of groups.values()) {
            group.items.sort((a, b) => b.score - a.score);
            group.total = groupTotal(group, allGroupCounts, inputSubstatMods);
        }

        const candidates = countSlots(groups);
        const candidateCombos = combinationCount(candidates);
        if (candidateCombos <= COMBO_BUDGET) {
            console.log("Priority filter: " + items.length + " candidates " + JSON.stringify(candidates) +
                " -> " + formatCount(candidateCombos) + " combinations, no truncation needed");
            return items;
        }

        console.log("Priority filter: " + items.length + " candidates " + JSON.stringify(candidates) +
            " -> " + formatCount(candidateCombos) + " combinations, over budget " + formatCount(COMBO_BUDGET));

        const slots = buildSlots(groups);
        const percentages = candidatePercentages(params.inputFilterPriority);
        let fallback = null;

        for (const percentage of percentages) {
            const pools = buildPools(slots, percentage);
            const counts = countSlots(pools);
            const combos = combinationCount(counts);
            fallback = pools;

            if (combos > COMBO_BUDGET) {
                console.log("Priority filter: Top " + percentage + "% -> " + JSON.stringify(counts) +
                    " -> " + formatCount(combos) + " combinations, still over budget");
                continue;
            }

            // 名额之内还有余量：把边界同分的装备按预算尽量补回来
            const filled = addTiesWithinBudget(pools, COMBO_BUDGET);
            console.log("Priority filter: Top " + percentage + "% -> " + JSON.stringify(countSlots(pools)) +
                " -> " + formatCount(filled) + " combinations");
            return flattenPools(pools);
        }

        const fallbackCounts = countSlots(fallback);
        console.log("Priority filter: tightest percentage " + JSON.stringify(fallbackCounts) +
            " -> " + formatCount(combinationCount(fallbackCounts)) + " combinations (over budget)");
        return flattenPools(fallback);
    },
}

/*
 * 组合数预算：6 个部位候选数的乘积超过这个量级就收紧候选。
 * 2e8 大致对应「GPU 通道几十秒内能跑完」的量级；调大 = 更准更慢，调小 = 更快但更容易漏解。
 * （每组至少留 1 件的下限本身就会占掉一部分：套装越分散，这个下限越高。）
 */
const COMBO_BUDGET = 2e8;

/* 收紧时试的百分比，从宽到紧；滑块上的值只作为上限，不会超过它 */
const PCT_STEPS = [25, 14, 7, 3, 1];

const SCORE_EPSILON = 1e-9;

const GEAR_SET_SEPARATOR = '\u0000';

/** 分组键：一律按「部位 × 套装」—— 即使没选套装，也要让每个套装都有机会被选中（套装效果可能更值） */
function groupKey(item) {
    return item.gear + GEAR_SET_SEPARATOR + (item.set || '');
}

function buildGroups(items) {
    const groups = new Map();

    for (const item of items) {
        const key = groupKey(item);
        let group = groups.get(key);
        if (!group) {
            group = { key, slot: item.gear, set: item.set, items: [], total: 0 };
            groups.set(key, group);
        }
        group.items.push(item);
    }

    return groups;
}

/* 全量装备里每个分组的件数，用来算名额基数 */
function countGroups(items) {
    const counts = new Map();

    for (const item of items || []) {
        const key = groupKey(item);
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return counts;
}

/* 名额基数：全量装备里同组的件数（和改造前的口径一致） */
function groupTotal(group, allGroupCounts, inputSubstatMods) {
    const total = allGroupCounts.get(group.key) || group.items.length;

    if (inputSubstatMods) {
        return Math.max(group.items.length, total);
    }

    return total;
}

function countSlots(collection) {
    const counts = {};
    const list = collection instanceof Map ? collection.values() : collection;

    for (const entry of list) {
        // 分组（groups）只有 items，池子（pools）有 kept + items，一律按「实际留下的」统计
        const size = entry.kept ? entry.kept.length : entry.items.length;
        counts[entry.slot] = (counts[entry.slot] || 0) + size;
    }

    return counts;
}

function combinationCount(counts) {
    return Object.values(counts).reduce((product, count) => product * (count || 1), 1);
}

function formatCount(value) {
    return value >= 1e6 ? value.toExponential(2) : String(Math.round(value));
}

/* 候选百分比：滑块值封顶，后面跟一串更紧的档位（去重、降序） */
function candidatePercentages(value) {
    const configured = Number(value);
    const cap = Number.isFinite(configured) && configured > 0 ? configured : 7;
    const list = [Math.min(cap, PCT_STEPS[0])];

    for (const step of PCT_STEPS) {
        if (step < list[0] && !list.includes(step)) {
            list.push(step);
        }
    }

    return list;
}

/* 把「部位 × 套装」的分组再聚合成部位：部位自己的候选排序 + 各套装分组 */
function buildSlots(groups) {
    const slots = new Map();

    for (const group of groups.values()) {
        let slot = slots.get(group.slot);
        if (!slot) {
            slot = { slot: group.slot, items: [], total: 0, groups: [] };
            slots.set(group.slot, slot);
        }

        slot.groups.push(group);
        slot.total += group.total;

        for (const item of group.items) {
            slot.items.push(item);
        }
    }

    for (const slot of slots.values()) {
        slot.items.sort((a, b) => b.score - a.score);
    }

    return slots;
}

/*
 * 候选池 = 「每个 (部位 × 套装) 各自的 Top%」 ∪ 「每个部位整体的 Top%」。
 *
 * - 前者保证每个套装在每个部位都按同样的百分比被保留（只选了 4 / 2 / 2+2 / 没选套装时，
 *   别的套装也可能是更好的搭配，不能因为分数低就被整体淘汰）；
 * - 后者保证该部位整体分数最高的那批一定在池子里；
 * - 两者取并集，所以最终件数允许超过 Top%。
 */
function buildPools(slots, percentage) {
    const pools = [];

    for (const slot of slots.values()) {
        const keepers = new Set();

        for (const group of slot.groups) {
            const quota = quotaFor(group.total, percentage);
            for (let i = 0; i < Math.min(quota, group.items.length); i++) {
                keepers.add(group.items[i]);
            }
        }

        const slotQuota = quotaFor(slot.total, percentage);
        for (let i = 0; i < Math.min(slotQuota, slot.items.length); i++) {
            keepers.add(slot.items[i]);
        }

        for (const group of slot.groups) {
            // 保持按分数排序，后面的同分扩张要用到 `kept` 的最后一条分数
            pools.push({
                slot: slot.slot,
                set: group.set,
                items: group.items,
                kept: group.items.filter((item) => keepers.has(item)),
            });
        }
    }

    return pools;
}

function quotaFor(total, percentage) {
    return Math.max(1, Math.ceil((percentage / 100) * total));
}

function flattenPools(pools) {
    const passed = [];

    for (const pool of pools) {
        for (const item of pool.kept) {
            passed.push(item);
        }
    }

    return passed;
}

/*
 * 在预算内把「和最后一条同分」的装备补回来。
 *
 * 优先级分数很粗（比如只给速度 8 分时，一堆「速度主属性 45、没有速度副属性」的靴子
 * 全是 90 分），按位置硬切的话，同分里谁能留下完全取决于原始顺序 —— 极限一速要用的
 * 那双靴子就可能被这样丢掉（实测：速度 8 只能搜到 310，加个攻击 1/命中 1 打破平局
 * 就能搜到 315）。
 *
 * 约束：补到名额的 2 倍为止；分数为 0 的那一档不补；整体不超过组合数预算。
 * 返回补完之后的总组合数。
 */
function addTiesWithinBudget(pools, budget) {
    const counts = countSlots(pools);
    let combos = combinationCount(counts);

    for (const pool of pools) {
        const kept = pool.kept;
        if (kept.length === 0) {
            continue;
        }

        const boundary = kept[kept.length - 1].score;
        if (!(Math.abs(boundary) > SCORE_EPSILON)) {
            continue;
        }

        const keptItems = new Set(kept);
        const limit = kept.length * 2;

        for (const item of pool.items) {
            if (kept.length >= limit) {
                break;
            }
            if (keptItems.has(item) || Math.abs(item.score - boundary) > SCORE_EPSILON) {
                continue;
            }

            const next = (combos / counts[pool.slot]) * (counts[pool.slot] + 1);
            if (next > budget) {
                return combos;
            }

            counts[pool.slot] += 1;
            combos = next;
            kept.push(item);
            keptItems.add(item);
        }

        kept.sort((a, b) => b.score - a.score);
    }

    return combos;
}

function mainTypeValue(stats, statType) {
    if (statType == stats.mainType) {
        return stats.mainValue
    }
    return 0;
}

function calculateScore(item, params, baseStats, reforge) {
    const stats = reforge ? item.reforgedStats : item.augmentedStats;

    const atkRolls = (stats.AttackPercent + mainTypeValue(stats, "AttackPercent") + (stats.Attack + mainTypeValue(stats, "Attack"))/baseStats.atk*100) / 8;
    const hpRolls = (stats.HealthPercent + mainTypeValue(stats, "HealthPercent") + (stats.Health + mainTypeValue(stats, "Health"))/baseStats.hp*100) / 8;
    const defRolls = (stats.DefensePercent + mainTypeValue(stats, "DefensePercent") + (stats.Defense + mainTypeValue(stats, "Defense"))/baseStats.def*100) / 8;
    const spdRolls = (stats.Speed + mainTypeValue(stats, "Speed")) / 4;
    const crRolls = (stats.CriticalHitChancePercent + mainTypeValue(stats, "CriticalHitChancePercent")) / 5;
    const cdRolls = (stats.CriticalHitDamagePercent + mainTypeValue(stats, "CriticalHitDamagePercent")) / 7;
    const effRolls = (stats.EffectivenessPercent + mainTypeValue(stats, "EffectivenessPercent")) / 8;
    const resRolls = (stats.EffectResistancePercent + mainTypeValue(stats, "EffectResistancePercent")) / 8;

    const score = atkRolls * params.inputAtkPriority +
                  hpRolls * params.inputHpPriority +
                  defRolls * params.inputDefPriority +
                  spdRolls * params.inputSpdPriority +
                  crRolls * params.inputCrPriority +
                  cdRolls * params.inputCdPriority +
                  effRolls * params.inputEffPriority +
                  resRolls * params.inputResPriority;


    if (isNaN(score) || item.main.value == 0 || item.main.value == null || item.main.value == undefined || isNaN(item.main.value)) {
        console.error("There's an unknown item in your gear data, go to the Gear tab to fix the stats on any Level 0 or Main stat 0 items. This is most likely caused by new Arena / Event / Automaton tower gear.", item, params, baseStats);
    }

    item.score = isNaN(score) ? 0 : score;
    item.priority = isNaN(score) ? 0 : Math.round(score);
}

function filterDisabled(params) {
    return params.inputFilterPriority == 100;
}
