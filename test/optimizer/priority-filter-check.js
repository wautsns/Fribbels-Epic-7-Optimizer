/*
 * 配装器「属性优先级过滤（Top %）」自测 —— 纯 Node，不依赖 Electron / Jest。
 *
 * 现行规则（背景见 README.md）：
 *   1. 组合数（各部位候选数的乘积）≤ 预算（2e8）时完全不截断；
 *   2. 超预算时从宽到紧试百分比（25 → 14 → 7 → 3 → 1，滑块值只是上限），取第一个落进预算的；
 *   3. 候选池 = 「每个 (部位 × 套装) 各自的 Top%」 ∪ 「每个部位整体的 Top%」，
 *      也就是每个套装在每个部位都至少按 Top% 保留，同时该部位整体分数最高的那批也在；
 *      允许最终件数超过 Top%；
 *   4. 还有预算余量时把边界同分补回来（补到名额 2 倍 / 预算用尽）；0 分档不补。
 *
 * 用法（仓库根目录）：node test/optimizer/priority-filter-check.js
 */
const path = require('path');

const ROOT = process.argv[2] || process.cwd();
const PriorityFilter = require(path.join(ROOT, 'app', 'js', 'lib', 'priorityFilter.js'));

const realLog = console.log;
console.log = () => {};

let failures = 0;
function check(name, condition, extra) {
    if (!condition) {
        failures++;
    }
    realLog(
        `  ${condition ? 'ok  ' : 'FAIL'} ${name}` +
            (condition || extra === undefined ? '' : ' -> ' + JSON.stringify(extra))
    );
}

const baseStats = { atk: 1000, hp: 5000, def: 400, spd: 100 };
const SLOTS = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];
const COMBO_BUDGET = 2e8;

/** 造一件装备：只关心速度（副属性 + 主属性），其它属性为 0 */
function item(id, gear, set, spdSub, spdMain) {
    const stats = {
        Attack: 0,
        AttackPercent: 0,
        Health: 0,
        HealthPercent: 0,
        Defense: 0,
        DefensePercent: 0,
        Speed: spdSub,
        CriticalHitChancePercent: 0,
        CriticalHitDamagePercent: 0,
        EffectivenessPercent: 0,
        EffectResistancePercent: 0,
        mainType: spdMain ? 'Speed' : 'AttackPercent',
        mainValue: spdMain || 60,
    };
    return {
        id,
        gear,
        set,
        main: { type: spdMain ? 'Speed' : 'AttackPercent', value: spdMain || 60 },
        augmentedStats: stats,
        reforgedStats: stats,
    };
}

function params(overrides) {
    return Object.assign(
        {
            inputAtkPriority: 0,
            inputHpPriority: 0,
            inputDefPriority: 0,
            inputSpdPriority: 8,
            inputCrPriority: 0,
            inputCdPriority: 0,
            inputEffPriority: 0,
            inputResPriority: 0,
            inputFilterPriority: 7,
        },
        overrides || {}
    );
}

function run(items, overrides) {
    return PriorityFilter.applyPriorityFilters(
        params(overrides),
        items,
        baseStats,
        items,
        true,
        false
    );
}

function countsBy(kept) {
    const bySlot = {};
    const bySlotSet = {};
    for (const it of kept) {
        bySlot[it.gear] = (bySlot[it.gear] || 0) + 1;
        const key = it.gear + '/' + it.set;
        bySlotSet[key] = (bySlotSet[key] || 0) + 1;
    }
    return { bySlot, bySlotSet };
}

function combos(bySlot) {
    return Object.values(bySlot).reduce((n, v) => n * (v || 1), 1);
}

/*
 * 每个部位 60 件（50 速度套 + 10 追击套）→ 60^6 ≈ 4.7e10，超过预算。
 * speedSpd / pursuitSpd 控制两边分数高低：
 *   - 速度套分数更高时：部位 Top% 会被速度套占满，追击套只按自己的 Top% 留
 *   - 追击套分数更高且全部同分时：追击套靠「同分保留」整批留下（允许超过 Top%）
 */
function pool(speedSpd, pursuitSpd) {
    const items = [];
    for (const slot of SLOTS) {
        for (let i = 0; i < 50; i++) {
            const spd = typeof speedSpd === 'function' ? speedSpd(i) : speedSpd;
            items.push(item(`${slot}-speed-${i}`, slot, 'SpeedSet', spd, 0));
        }
        for (let i = 0; i < 10; i++) {
            items.push(item(`${slot}-pursuit-${i}`, slot, 'PursuitSet', pursuitSpd, 0));
        }
    }
    return items;
}

realLog('\n[1] 组合数在预算内：完全不截断');

{
    const items = [];
    for (const slot of SLOTS) {
        items.push(item(`${slot}-a`, slot, 'SpeedSet', 8, 45));
        items.push(item(`${slot}-b`, slot, 'PursuitSet', 0, 0));
    }
    check('小池子（6 部位 × 2 件 = 64 组合）原样返回', run(items).length === items.length);
}

realLog('\n[2] 每个套装按自己的 Top% 保留，同时部位 Top% 也在（取并集）');

{
    // 速度套分数高且互不相同（部位 Top% = 5 件全是速度套），追击套分数 0（自己 Top% = 1 件）
    const kept = run(pool((i) => 4 + i * 0.5, 0));
    const { bySlot, bySlotSet } = countsBy(kept);

    check(
        '速度套每部位 5 件（部位 Top% = ceil(7% × 60) = 5）',
        SLOTS.every((slot) => bySlotSet[slot + '/SpeedSet'] === 5),
        bySlotSet
    );
    check(
        '追击套每部位 1 件（自己 Top% = ceil(7% × 10) = 1）',
        SLOTS.every((slot) => bySlotSet[slot + '/PursuitSet'] === 1),
        bySlotSet
    );
    check('每部位 6 件（并集，允许超过 Top%）', SLOTS.every((slot) => bySlot[slot] === 6), bySlot);
    check('落在预算内', combos(bySlot) <= COMBO_BUDGET, combos(bySlot));
}

realLog('\n[3] 同分一起保留：追击套 10 件同分 → 全部留下（超过 Top%）');

{
    // 追击套分数更高且 10 件同分，速度套分数更低且也同分
    const kept = run(pool(4, 8));
    const { bySlotSet } = countsBy(kept);
    check(
        '追击套每部位 10 件全留',
        SLOTS.every((slot) => bySlotSet[slot + '/PursuitSet'] === 10),
        bySlotSet
    );
    check('落在预算内', combos(countsBy(kept).bySlot) <= COMBO_BUDGET);
}

realLog('\n[4] 分数为 0 的组：只按名额保留，不参与同分扩张');

{
    const kept = run(pool((i) => 4 + i * 0.5, 0));
    const zero = kept.filter((it) => it.set === 'PursuitSet');
    check('0 分档每部位只留 1 件', zero.length === SLOTS.length, zero.length);
}

realLog('\n[5] 滑块只是上限：给 3% 时不会放宽到 7%');

{
    const items = pool((i) => 4 + i * 0.5, 0);
    const at3 = run(items, { inputFilterPriority: 3 });
    const at7 = run(items, { inputFilterPriority: 7 });
    check('3% 的候选数少于 7%', at3.length < at7.length, { at3: at3.length, at7: at7.length });
}

realLog('\n[6] 关闭过滤（Top 100%）时原样返回');

{
    const items = pool((i) => 4 + i * 0.5, 0);
    check('一件都不少', run(items, { inputFilterPriority: 100 }).length === items.length);
}

realLog('\n[7] 各部位保留数接近（不会偏袒某个部位）');

{
    const kept = run(pool((i) => 4 + i * 0.5, 0));
    const { bySlotSet } = countsBy(kept);
    const values = SLOTS.map((slot) => bySlotSet[slot + '/SpeedSet']);
    check('各部位速度套保留数差异 ≤ 1', Math.max(...values) - Math.min(...values) <= 1, values);
}

realLog(failures ? `\nFAILURES: ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
