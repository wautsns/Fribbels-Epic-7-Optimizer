/*
 * 配装器「属性优先级过滤（Top %）」自测 —— 纯 Node，不依赖 Electron / Jest。
 *
 * 现行规则（背景见 README.md）：
 *   1. 滑块上的 Top% **原样生效**，不会被自动下调；
 *   2. 每个 (部位 × 套装) 组的名额 = max(下限, ceil(Top% × 该组件数))，
 *      下限：**选中的套装 3 件、未选中的套装 1 件**；
 *   3. 排序：加权分数 → 结果优先级 → 未加权 roll → id（同分也能确定顺序）。
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

/** 造一件装备：关心速度（副属性 + 主属性）和攻击%，其它属性为 0 */
function item(id, gear, set, spdSub, spdMain, atkPercent) {
    const stats = {
        Attack: 0,
        AttackPercent: atkPercent || 0,
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
            // 默认：只选了速度套（4 件套）
            inputSets: [['SpeedSet'], [], []],
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

/* 每部位 100 速度套（选中）+ 4 追击套（未选中）→ 7% 名额：速度 7、追击 1 */
function bigPool(pursuitAtk) {
    const items = [];
    for (const slot of SLOTS) {
        for (let i = 0; i < 100; i++) {
            items.push(item(`${slot}-speed-${i}`, slot, 'SpeedSet', 4 + i * 0.25, 0));
        }
        for (let i = 0; i < 4; i++) {
            const atk = pursuitAtk ? pursuitAtk[i] : 0;
            items.push(item(`${slot}-pursuit-${i}`, slot, 'PursuitSet', 0, 45, atk));
        }
    }
    return items;
}

realLog('\n[1] 候选很少时：名额足够，全部保留');

{
    const items = [];
    for (const slot of SLOTS) {
        items.push(item(`${slot}-a`, slot, 'SpeedSet', 8, 45));
        items.push(item(`${slot}-b`, slot, 'PursuitSet', 0, 0));
    }
    check('小池子（6 部位 × 2 件）原样返回', run(items).length === items.length);
}

realLog('\n[2] 名额：选中的套装每部位 7 件（ceil(7% × 100)），未选中的 1 件');

{
    const kept = run(bigPool());
    const { bySlot, bySlotSet } = countsBy(kept);
    check(
        '速度套每部位 7 件',
        SLOTS.every((slot) => bySlotSet[slot + '/SpeedSet'] === 7),
        bySlotSet
    );
    check(
        '追击套每部位 1 件（未选中，下限 1）',
        SLOTS.every((slot) => bySlotSet[slot + '/PursuitSet'] === 1),
        bySlotSet
    );
    check('每部位 8 件', SLOTS.every((slot) => bySlot[slot] === 8), bySlot);
}

realLog('\n[3] 选中套装的下限是 3 件（即使 7% 只算出 1 件）');

{
    // 每部位：选中套装 10 件（7% → 1 件，但下限 3）、未选中套装 4 件、其它套装 90 件
    const items = [];
    for (const slot of SLOTS) {
        for (let i = 0; i < 10; i++) {
            items.push(item(`${slot}-speed-${i}`, slot, 'SpeedSet', 4 + i * 2, 0));
        }
        for (let i = 0; i < 4; i++) {
            items.push(item(`${slot}-pursuit-${i}`, slot, 'PursuitSet', 0, 45));
        }
        for (let i = 0; i < 90; i++) {
            items.push(item(`${slot}-hit-${i}`, slot, 'HitSet', 0, 0));
        }
    }
    const kept = run(items);
    const { bySlotSet } = countsBy(kept);
    check(
        '选中套装每部位 3 件（下限）',
        SLOTS.every((slot) => bySlotSet[slot + '/SpeedSet'] === 3),
        bySlotSet
    );
    check(
        '未选中套装：小套装（4 件）1 件、大套装（90 件）按 7% → 7 件',
        SLOTS.every(
            (slot) => bySlotSet[slot + '/PursuitSet'] === 1 && bySlotSet[slot + '/HitSet'] === 7
        ),
        bySlotSet
    );
}

realLog('\n[4] 每部位保留数不低于该部位的 Top%');

{
    const kept = run(bigPool());
    const { bySlot } = countsBy(kept);
    check('每部位 ≥ ceil(7% × 104) = 8', SLOTS.every((slot) => bySlot[slot] >= 8), bySlot);
    check('组合数 = 各部位名额的乘积', combos(bySlot) === 8 ** SLOTS.length, combos(bySlot));
}

realLog('\n[5] 同分时按结果优先级取舍（未选中套装名额 1 → 留攻击最高的那件）');

{
    const kept = run(bigPool([10, 40, 70, 100]), { resultPriority: ['spd', 'atk'] });
    const atk = kept
        .filter((it) => it.gear === 'Boots' && it.set === 'PursuitSet')
        .map((it) => it.augmentedStats.AttackPercent);
    check('留攻击 100 的那件', JSON.stringify(atk), JSON.stringify([100]));
}

realLog('\n[6] disliked 字段反向：同分时留攻击最低的');

{
    const kept = run(bigPool([10, 40, 70, 100]), {
        resultPriority: ['spd', 'atk'],
        resultDislike: ['atk'],
    });
    const atk = kept
        .filter((it) => it.gear === 'Boots' && it.set === 'PursuitSet')
        .map((it) => it.augmentedStats.AttackPercent);
    check('留攻击 10 的那件', JSON.stringify(atk), JSON.stringify([10]));
}

realLog('\n[7] 所有属性都相同时按 id 升序（结果可复现）');

{
    const items = [];
    for (const slot of SLOTS) {
        for (let i = 0; i < 100; i++) {
            items.push(item(`${slot}-speed-${i}`, slot, 'SpeedSet', 4 + i * 0.25, 0));
        }
        // id 乱序传入，看是否按 id 升序取
        for (const id of [930, 130, 560, 220]) {
            items.push(item(`${slot}-pursuit-${id}`, slot, 'PursuitSet', 0, 45));
        }
    }
    const kept = run(items, { resultPriority: ['spd'] })
        .filter((it) => it.gear === 'Boots' && it.set === 'PursuitSet')
        .map((it) => it.id);
    check('留 id 最小的那件', JSON.stringify(kept), JSON.stringify(['130']));
}

realLog('\n[8] 滑块直接决定名额：给 3% 时名额更少');

{
    const items = bigPool();
    const at3 = run(items, { inputFilterPriority: 3 });
    const at7 = run(items, { inputFilterPriority: 7 });
    check('3% 的候选数少于 7%', at3.length < at7.length, { at3: at3.length, at7: at7.length });
}

realLog('\n[9] 关闭过滤（Top 100%）时原样返回');

{
    const items = bigPool();
    check('一件都不少', run(items, { inputFilterPriority: 100 }).length === items.length);
}

realLog(failures ? `\nFAILURES: ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
