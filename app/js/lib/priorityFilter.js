module.exports = {

    calculatePriorityScores: (params, items, baseStats, reforge) => {
        for (const gear of items) {
            calculateScore(gear, params, baseStats, reforge);
        }
    },

    applyPriorityFilters: (params, items, baseStats, allItems, reforge, inputSubstatMods) => {
        var passed = [];

        if (filterDisabled(params)) {
            console.log("Priority filter disabled")
            return items;
        }

        console.log("Priority filter enabled", items)

        const groups = groupBy(items, 'gear');
        const allItemsGroups = groupBy(allItems, 'gear');

        console.log("Grouped gears", groups);
        console.log("AllItems grouped gears", allItemsGroups);

        module.exports.calculatePriorityScores(params, items, baseStats, reforge);

        for (var key of Object.keys(groups)) {
            var gearArr = groups[key];

            gearArr.sort((a, b) => b.score - a.score);

            // console.log("SORTED", key, gearArr);

            var groupLength = allItemsGroups[key].length
            if (inputSubstatMods) {
                groupLength = Math.max(groups[key].length, allItemsGroups[key].length);
            }

            const index = Math.ceil(params.inputFilterPriority / 100 * groupLength);
            passed = passed.concat(sliceWithTies(gearArr, index));
        }

        return passed;
    },
}

const SCORE_EPSILON = 1e-9;

/*
 * 截断候选装备时，把「和最后一条同分」的装备一起留下。
 *
 * 优先级分数很粗（比如只给速度 8 分时，一堆「速度主属性 45、没有速度副属性」的靴子
 * 全是 90 分），如果按位置硬切，同分里谁能留下完全取决于原始顺序 —— 极限一速要用的
 * 那双靴子就可能被这样丢掉（实测：速度 8 只能搜到 310，加个攻击 1/命中 1 打破平局
 * 就能搜到 315）。
 *
 * 两点收紧，避免候选池爆掉：
 *   - 分数为 0 的那一档照旧严格截断（否则整份装备池都会被放进来）；
 *   - 同分扩张最多放到名额的 2 倍，极端情况下同分特别多时仍然只多留一层。
 */
function sliceWithTies(sorted, index) {
    if (index <= 0) {
        return [];
    }
    if (index >= sorted.length) {
        return sorted;
    }

    const kept = sorted.slice(0, index);
    const boundary = kept[kept.length - 1].score;
    if (!(Math.abs(boundary) > SCORE_EPSILON)) {
        return kept;
    }

    const limit = Math.min(sorted.length, index * 2);
    for (var i = index; i < limit; i++) {
        if (Math.abs(sorted[i].score - boundary) > SCORE_EPSILON) {
            break;
        }
        kept.push(sorted[i]);
    }

    return kept;
}

var groupBy = function(xs, key) {
  return xs.reduce(function(rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
};

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
