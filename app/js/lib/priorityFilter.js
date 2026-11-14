const DominanceFilter = require('./dominanceFilter');

module.exports = {

    calculatePriorityScores: (params, items, baseStats, reforge) => {
        for (const gear of items) {
            calculateScore(gear, params, baseStats, reforge);
        }
    },

    /*
     * 候选装备预筛（Top K + 套装权重分配）。
     *
     * 规则（K = 用户在滑块设的值，默认 20），按部位处理：
     *   1. 计算每个套装的权重 = 在 inputSets 里被选中的次数 × (4件套? 1.5 : 1)；
     *   2. 未选中的套装**合并成一个池**，权重固定 1；
     *   3. 每个套装 quota = round(K × 套装权重 / 总权重)；
     *   4. 选中套装：实际保留 = max(SELECTED_SET_MIN_KEEP(3), quota)，但不会超过该套装
     *      Dominance 后实际剩的件数；
     *   5. 未选中套装合并池：整体分一个 quota，内部按 score 排序取前 N；
     *   6. 选中套装 quota 没用完的 spare 回收到选中套装内部按 score 顺序瓜分；
     *   7. 同套装内按 score 排序取前 N，同分按属性优先级滑块数值降序依次比较，
     *      同数值按默认顺序（速度 → 生命 → 防御 → 攻击 → 暴率 → 爆伤 → 抗性 → 命中）。
     */
    applyPriorityFilters: (params, items, baseStats, reforge) => {
        if (!items || items.length === 0) {
            return items;
        }

        const K = clampK(Number(params.inputFilterPriority));
        const groups = buildGroups(items);

        const slots = new Map();
        for (const group of groups.values()) {
            let slot = slots.get(group.slot);
            if (!slot) {
                slot = { slot: group.slot, groups: [], selected: [], others: [] };
                slots.set(group.slot, slot);
            }
            slot.groups.push(group);
            if (isSelectedSet(group.set, params)) {
                slot.selected.push(group);
            } else {
                slot.others.push(group);
            }
        }

        // K 足够大时跳过排序/筛选，直接全留（score 只用于排序/淘汰，不影响 Dominance）
        let needScores = false;
        for (const slot of slots.values()) {
            if (slot.selected.some(group => group.items.length > SELECTED_SET_MIN_KEEP)) {
                needScores = true; break;
            }
            if (slot.others.length > 0) {
                needScores = true; break;
            }
        }

        if (needScores) {
            module.exports.calculatePriorityScores(params, items, baseStats, reforge);
        }

        const compare = buildComparator(params, baseStats, reforge);
        const setWeights = computeSetWeights(params);

        const pools = buildTopKPools(slots, K, setWeights, compare);
        const counts = countSlots(pools);
        const combos = combinationCount(counts);

        console.log("Priority filter: Top " + K + " -> " + JSON.stringify(counts) +
            " -> " + formatCount(combos) + " combinations" +
            (combos > LARGE_COMBO_WARNING ? " (lots, search will be slow)" : ""));

        return flattenPools(pools);
    },
}

const GEAR_SET_SEPARATOR = '\u0000';

/* K 滑块范围最小 10，最大 50 */
const K_MIN = 10;
const K_MAX = 50;

function clampK(K) {
    if (!Number.isFinite(K)) return K_MIN;
    return Math.max(K_MIN, Math.min(K_MAX, K));
}

/* 这套件数下限：用户选中的套装每个至少 SELECTED_SET_MIN_KEEP 件保底 */
const SELECTED_SET_MIN_KEEP = 3;

/*
 * 4 件套比 2 件套难凑（需要 4 个部位都有货），所以权重 x1.5。
 * 套装名来源：optimizerTab.js 的 fourPieceSets / twoPieceSets，这里独立维护避免跨模块依赖。
 */
const FOUR_PIECE_SETS = new Set([
    "AttackSet", "SpeedSet", "DestructionSet", "LifestealSet",
    "ProtectionSet", "CounterSet", "RageSet", "RevengeSet",
    "InjurySet", "ReversalSet", "RiposteSet", "WarfareSet", "WeakeningSet",
]);
const FOUR_PIECE_WEIGHT_MULTIPLIER = 1.5;

/* 组合数超过这个量级只打一条 "会比较慢" 的提示，不改变候选 */
const LARGE_COMBO_WARNING = 1e9;

/*
 * 同分时的默认 tiebreaker 顺序（属性优先级数值相同时按此顺序依次比较）。
 * 顺序：速度 -> 生命 -> 防御 -> 攻击 -> 暴率 -> 爆伤 -> 抗性 -> 命中
 */
const DEFAULT_TIEBREAKER_ORDER = [
    { field: 'spd', key: 'Speed',                      priorityKey: 'inputSpdPriority' },
    { field: 'hp',  key: 'Health',                      priorityKey: 'inputHpPriority' },
    { field: 'def', key: 'Defense',                     priorityKey: 'inputDefPriority' },
    { field: 'atk', key: 'Attack',                      priorityKey: 'inputAtkPriority' },
    { field: 'cr',  key: 'CriticalHitChancePercent',    priorityKey: 'inputCrPriority' },
    { field: 'cd',  key: 'CriticalHitDamagePercent',     priorityKey: 'inputCdPriority' },
    { field: 'res', key: 'EffectResistancePercent',     priorityKey: 'inputResPriority' },
    { field: 'eff', key: 'EffectivenessPercent',        priorityKey: 'inputEffPriority' },
];

/*
 * 候选装备的排序：加权分数降序；**同分时按属性优先级滑块数值降序依次比较**，
 * 同权重的属性合并成一个维度求和比（无需人为设同权重时的顺序），disliked 字段
 * 反向，再比未加权 roll 总和，最后比 id —— 保证同分谁被保留是确定的。
 */
function buildComparator(params, baseStats, reforge) {
    // 构造 tiebreaker：先按滑块权重降序分组，同权重属性合并成一个 sum 维度
    const disliked = new Set(Array.isArray(params.resultDislike) ? params.resultDislike : []);
    const byWeight = new Map(); // weight -> [{key, sign}]
    for (const entry of DEFAULT_TIEBREAKER_ORDER) {
        const weight = Number(params[entry.priorityKey]) || 0;
        if (weight <= 0) continue;
        const sign = disliked.has(entry.field) ? -1 : 1;
        if (!byWeight.has(weight)) byWeight.set(weight, []);
        byWeight.get(weight).push({ key: entry.key, sign });
    }
    const weightBuckets = [...byWeight.entries()]
        .sort((a, b) => b[0] - a[0])  // 权重降序
        .map(([weight, fields]) => ({ weight, fields }));

    const cache = new Map();
    const tiebreak = (item) => {
        let values = cache.get(item);
        if (!values) {
            const stats = DominanceFilter.getComparableStats(item, baseStats, reforge) || {};
            values = {
                // 每个权重桶合并成一个 sum
                sums: weightBuckets.map(b => b.fields.reduce(
                    (acc, f) => acc + (Number(stats[f.key]) || 0) * f.sign, 0
                )),
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

        for (let i = 0; i < a.sums.length; i++) {
            if (a.sums[i] !== b.sums[i]) {
                return a.sums[i] > b.sums[i] ? -1 : 1;
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

/** 分组键：一律按 [部位 x 套装] */
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

function countSlots(collection) {
    const counts = {};
    const list = collection instanceof Map ? collection.values() : collection;

    for (const entry of list) {
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

function flattenPools(pools) {
    const passed = [];
    for (const pool of pools) {
        for (const item of pool.kept) {
            passed.push(item);
        }
    }
    return passed;
}

/* 判断套装是否在用户选中的列表里 */
function isSelectedSet(setName, params) {
    const groups = Array.isArray(params.inputSets)
        ? params.inputSets
        : [params.inputSetsOne, params.inputSetsTwo, params.inputSetsThree];
    for (const group of groups || []) {
        for (const name of group || []) {
            if (name && name === setName) return true;
        }
    }
    return false;
}

/*
 * 选中套装的权重计算：
 *   权重 = 在 inputSets 里出现的次数 x (4件套? 1.5 : 1.0)
 *   4 件套需要 4 个部位都有货才能激活，比 2 件套难凑，所以加权 x1.5。
 */
function computeSetWeights(params) {
    const weights = new Map();
    const groups = Array.isArray(params.inputSets)
        ? params.inputSets
        : [params.inputSetsOne, params.inputSetsTwo, params.inputSetsThree];
    for (const group of groups || []) {
        for (const name of group || []) {
            if (name) {
                const base = FOUR_PIECE_SETS.has(name) ? FOUR_PIECE_WEIGHT_MULTIPLIER : 1;
                weights.set(name, (weights.get(name) || 0) + base);
            }
        }
    }
    return weights;
}

/*
 * Top K 套装权重分配。
 *
 * 对每个部位：
 *   - 选中套装：每个套装 quota = max(SELECTED_SET_MIN_KEEP, round(K x 权重/总权重))
 *   - 未选中套装：合并池，权重固定 1，整体分一个 quota
 *   - 每个套装内部按 score 排序取前 quota 件（不超过该套装实际件数）
 *   - 选中套装保底 minKeep，即使算出来的 quota 更小
 */
function buildTopKPools(slots, K, setWeights, compare) {
    const pools = [];

    for (const slot of slots.values()) {
        let totalWeight = 0;
        for (const group of slot.selected) {
            totalWeight += setWeights.get(group.set) || 1;
        }
        if (slot.others.length > 0) {
            totalWeight += 1; // 未选中合并池权重固定 1
        }

        // 选中套装：按权重分配 quota，保底 SELECTED_SET_MIN_KEEP
        const quotas = new Map();
        for (const group of slot.selected) {
            const w = setWeights.get(group.set) || 1;
            let quota = Math.round(K * w / totalWeight);
            quota = Math.max(SELECTED_SET_MIN_KEEP, quota);
            quotas.set(group, quota);
        }
        // 未选中合并池
        if (slot.others.length > 0) {
            let quota = Math.round(K * 1 / totalWeight);
            quota = Math.max(1, quota);
            quotas.set('__others__', quota);
        }

        // ---- 第一轮：每个套装按初始 quota 取前 N ----
        const keptByGroup = new Map();
        let spare = 0;

        // 选中套装
        for (const group of slot.selected) {
            group.items.sort(compare);
            const quota = quotas.get(group);
            const kept = group.items.slice(0, Math.min(quota, group.items.length));
            keptByGroup.set(group, kept);
            spare += Math.max(0, quota - group.items.length);
        }

        // 未选中合并池（也先按初始 quota 取，可能也有剩余）
        let othersKept = [];
        let othersGroupMap = new Map(); // group -> 保留的装备列表
        if (slot.others.length > 0) {
            const merged = [];
            for (const group of slot.others) {
                group.items.sort(compare);
                for (const item of group.items) {
                    merged.push({ group, item });
                }
            }
            merged.sort((a, b) => compare(a.item, b.item));

            const quota = quotas.get('__others__');
            for (const group of slot.others) othersGroupMap.set(group, []);
            const take = Math.min(quota, merged.length);
            for (let i = 0; i < take; i++) {
                othersGroupMap.get(merged[i].group).push(merged[i].item);
                othersKept.push(merged[i].item);
            }
            spare += Math.max(0, quota - merged.length);
        }

        // ---- 第二轮：spare 配额在选中套装里按 score 顺序 rebalance ----
        if (spare > 0 && slot.selected.length > 0) {
            const candidateSlots = []; // { group, index }
            for (const group of slot.selected) {
                const alreadyKept = keptByGroup.get(group).length;
                for (let idx = alreadyKept; idx < group.items.length; idx++) {
                    candidateSlots.push({ group, idx });
                }
            }
            candidateSlots.sort((a, b) => compare(a.group.items[a.idx], b.group.items[b.idx]));

            for (let i = 0; i < Math.min(spare, candidateSlots.length); i++) {
                const { group, idx } = candidateSlots[i];
                keptByGroup.get(group).push(group.items[idx]);
            }
        }

        // 选中套装写回 pools
        for (const group of slot.selected) {
            pools.push({ slot: slot.slot, set: group.set, items: group.items, kept: keptByGroup.get(group) });
        }
        // 未选中套装写回 pools
        if (slot.others.length > 0) {
            for (const group of slot.others) {
                pools.push({ slot: slot.slot, set: group.set, items: group.items, kept: othersGroupMap.get(group) });
            }
        }
    }

    return pools;
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
