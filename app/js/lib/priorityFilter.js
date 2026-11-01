const DominanceFilter = require('./dominanceFilter');

module.exports = {

    calculatePriorityScores: (params, items, baseStats, reforge) => {
        for (const gear of items) {
            calculateScore(gear, params, baseStats, reforge);
        }
    },

    /*
     * 候选装备预筛。
     *
     * 规则（滑块上的 Top% 原样生效，不会被自动下调）：
     *   1. 每个 (部位 × 套装) 取自己的前 Top%，件数下限：用户选中的套装至少 3 件、
     *      没选中的套装至少 1 件（套装效果可能更强，不能整体淘汰）；
     *   2. 这些加起来还不够该部位的前 Top% 时，再从该部位全套装里按排序补足到 Top%
     *      （各套装名额之和本来就不低于部位 Top%，所以这一步基本只是兜底）；
     *   3. 同分的先后由结果优先级决定（见 buildComparator），不是"存档里靠前的先留"。
     * 组合数只用于打日志提醒（搜得慢不慢），不改变候选。
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

        const compare = buildComparator(params, baseStats, reforge);

        const groups = buildGroups(items);
        const allGroupCounts = countGroups(allItems);
        for (const group of groups.values()) {
            group.items.sort(compare);
            group.total = groupTotal(group, allGroupCounts, inputSubstatMods);
        }

        const slots = buildSlots(groups, compare);
        const selectedSets = selectedSetNames(params);
        const percentage = humanPercent(params.inputFilterPriority);

        const pools = buildPools(slots, percentage, selectedSets);
        const counts = countSlots(pools);
        const combos = combinationCount(counts);

        console.log("Priority filter: Top " + percentage + "% -> " + JSON.stringify(counts) +
            " -> " + formatCount(combos) + " combinations" +
            (combos > LARGE_COMBO_WARNING ? " (很多，搜索会比较慢)" : ""));

        return flattenPools(pools);
    },
}

const GEAR_SET_SEPARATOR = '\u0000';

/* 每个 (部位 × 套装) 的件数下限：用户选中的套装 3 件，其它套装 1 件 */
const SELECTED_SET_MIN_KEEP = 3;
const OTHER_SET_MIN_KEEP = 1;

/* 组合数超过这个量级只打一条"会比较慢"的提示，不改变候选 */
const LARGE_COMBO_WARNING = 1e9;

/* 结果优先级里的字段 → 装备上可比较的属性（派生属性 ehp/dmg/s1… 在搜索前算不出来，跳过） */
const RESULT_STAT_KEYS = {
    atk: 'Attack',
    hp: 'Health',
    def: 'Defense',
    spd: 'Speed',
    cr: 'CriticalHitChancePercent',
    cd: 'CriticalHitDamagePercent',
    eff: 'EffectivenessPercent',
    res: 'EffectResistancePercent',
};

/*
 * 候选装备的排序：加权分数降序；**同分时按结果优先级依次比较**（disliked 的字段反向），
 * 再比未加权 roll 总和，最后比 id —— 保证同分谁被保留是确定的、且偏向你要的结果，
 * 而不是“存档里靠前的先留”。
 */
function buildComparator(params, baseStats, reforge) {
    const fields = (Array.isArray(params.resultPriority) ? params.resultPriority : [])
        .filter((field) => RESULT_STAT_KEYS[field])
        .map((field) => ({
            key: RESULT_STAT_KEYS[field],
            sign: Array.isArray(params.resultDislike) && params.resultDislike.includes(field) ? -1 : 1,
        }));

    const cache = new Map();
    const tiebreak = (item) => {
        let values = cache.get(item);
        if (!values) {
            const stats = DominanceFilter.getComparableStats(item, baseStats, reforge) || {};
            values = {
                fields: fields.map((field) => (Number(stats[field.key]) || 0) * field.sign),
                rolls: unweightedRolls(stats),
            };
            cache.set(item, values);
        }
        return values;
    };

    return (left, right) => {
        if (left.score !== right.score) {
            return right.score - left.score;
        }

        const a = tiebreak(left);
        const b = tiebreak(right);

        for (let i = 0; i < a.fields.length; i++) {
            if (a.fields[i] !== b.fields[i]) {
                return a.fields[i] > b.fields[i] ? -1 : 1;
            }
        }

        if (a.rolls !== b.rolls) {
            return a.rolls > b.rolls ? -1 : 1;
        }

        return compareIds(left.id, right.id);
    };
}

/* 未加权 roll 总和（和 dominanceFilter 的口径一致） */
function unweightedRolls(stats) {
    return (
        (stats.Attack || 0) / 8 +
        (stats.Health || 0) / 8 +
        (stats.Defense || 0) / 8 +
        (stats.Speed || 0) / 4 +
        (stats.CriticalHitChancePercent || 0) / 5 +
        (stats.CriticalHitDamagePercent || 0) / 7 +
        (stats.EffectivenessPercent || 0) / 8 +
        (stats.EffectResistancePercent || 0) / 8
    );
}

function compareIds(leftId, rightId) {
    const left = String(leftId == null ? '' : leftId);
    const right = String(rightId == null ? '' : rightId);
    if (left === right) {
        return 0;
    }

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber < rightNumber ? -1 : 1;
    }

    return left < right ? -1 : 1;
}

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

/* 滑块上的百分比：原样使用（不会被自动下调） */
function humanPercent(value) {
    const configured = Number(value);
    return Number.isFinite(configured) && configured > 0 ? configured : 100;
}

/* 把「部位 × 套装」的分组再聚合成部位：部位自己的候选排序 + 各套装分组 */
function buildSlots(groups, compare) {
    const slots = new Map();

    for (const group of groups.values()) {
        let slot = slots.get(group.slot);
        if (!slot) {
            slot = { slot: group.slot, items: [], total: 0, groups: [], groupOf: new Map() };
            slots.set(group.slot, slot);
        }

        slot.groups.push(group);
        slot.total += group.total;

        for (const item of group.items) {
            slot.items.push(item);
            slot.groupOf.set(item, group);
        }
    }

    for (const slot of slots.values()) {
        slot.items.sort(compare);
    }

    return slots;
}

/* Top% 名额：7% × 100 件应该是 7 件，浮点误差会让 ceil(7.000000000000001) 变成 8，这里减掉一点 */
function quotaOf(total, percentage) {
    return Math.ceil((percentage / 100) * total - 1e-9);
}

/*
 * 候选池：
 *   1. 每个 (部位 × 套装) 取自己的前 Top%，件数下限按「是否在用户选的套装范围内」：
 *        在范围内 → 至少 3 件；不在范围内 → 至少 1 件（套装效果可能更强，不能整体淘汰）；
 *   2. 如果这个部位加起来还不够该部位的前 Top%，再从**该部位全套装**里按排序补足到 Top%
 *      （补的这批就是该部位整体分数最高的那些）。
 * 所以最终件数一般等于「部位 Top%」，套装很分散时才会因为下限略多。
 */
function buildPools(slots, percentage, selectedSets) {
    const pools = [];

    for (const slot of slots.values()) {
        const keptByGroup = new Map();
        let keptCount = 0;

        for (const group of slot.groups) {
            const minimum = selectedSets.has(group.set) ? SELECTED_SET_MIN_KEEP : OTHER_SET_MIN_KEEP;
            const quota = Math.max(minimum, quotaOf(group.total, percentage));
            const kept = new Set();

            for (let i = 0; i < Math.min(quota, group.items.length); i++) {
                kept.add(group.items[i]);
            }

            keptByGroup.set(group, kept);
            keptCount += kept.size;
        }

        const slotQuota = Math.max(1, quotaOf(slot.total, percentage));
        if (keptCount < slotQuota) {
            for (const item of slot.items) {
                if (keptCount >= slotQuota) {
                    break;
                }
                const kept = keptByGroup.get(slot.groupOf.get(item));
                if (kept && !kept.has(item)) {
                    kept.add(item);
                    keptCount += 1;
                }
            }
        }

        for (const group of slot.groups) {
            const kept = keptByGroup.get(group);
            pools.push({
                slot: slot.slot,
                set: group.set,
                items: group.items,
                kept: group.items.filter((item) => kept.has(item)),
            });
        }
    }

    return pools;
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
 * 用户在「套装」里选中的套装名（4+2 / 2+2+2 / 只选 4 / 只选 2 / 2+2 都算）。
 * 选中的套装每组至少保留 SELECTED_SET_MIN_KEEP 件，其它套装至少 OTHER_SET_MIN_KEEP 件。
 */
function selectedSetNames(params) {
    const names = new Set();
    const groups = Array.isArray(params.inputSets)
        ? params.inputSets
        : [params.inputSetsOne, params.inputSetsTwo, params.inputSetsThree];

    for (const group of groups || []) {
        for (const name of group || []) {
            if (name) {
                names.add(name);
            }
        }
    }

    return names;
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
