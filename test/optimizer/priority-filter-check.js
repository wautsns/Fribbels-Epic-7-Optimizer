/*
 * 配装器「属性优先级过滤（Top %）」自测 —— 纯 Node，不依赖 Electron / Jest。
 *
 * 现行规则（背景见 README.md）：
 *   1. 组合数（各部位候选数的乘积）≤ 预算（1e8）时完全不截断；
 *   2. 超预算时从宽到紧试百分比（25 → 14 → 7 → 3 → 1，滑块值只是上限），取第一个落进预算的；
 *   3. 有套装约束（4 件套 + 2 件套 / 2+2+2）时按「部位 × 套装」分组，**每组至少留 1 件**
 *      —— 否则某个套装会在某个部位被整体淘汰，套装搭配只能去别的部位凑，极限速度被拉低；
 *   4. 没有套装约束时按部位分组（和改造前一致）；
 *   5. 两种模式都保留边界同分（上限为名额的 2 倍），分数为 0 的一档严格截断。
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

function run(items, overrides, setConstrained) {
    return PriorityFilter.applyPriorityFilters(
        params(overrides),
        items,
        baseStats,
        items,
        true,
        false,
        setConstrained
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

/* 6 部位 × 每部位 32 件（28 速度套 + 4 追击套）→ 32^6 ≈ 1.07e9，超过 1e8 预算 */
function bigPool() {
    const items = [];
    for (const slot of SLOTS) {
        for (let i = 0; i < 28; i++) {
            items.push(item(`${slot}-speed-${i}`, slot, 'SpeedSet', 4 + (i % 8) * 4, i % 3 === 0 ? 45 : 0));
        }
        for (let i = 0; i < 4; i++) {
            items.push(item(`${slot}-pursuit-${i}`, slot, 'PursuitSet', 0, 45));
        }
    }
    return items;
}

realLog('\n[1] 组合数在预算内：完全不截断（两种模式都一样）');

{
    const items = [];
    for (const slot of SLOTS) {
        items.push(item(`${slot}-a`, slot, 'SpeedSet', 8, 45));
        items.push(item(`${slot}-b`, slot, 'PursuitSet', 0, 0));
    }
    check('有套装约束：原样返回', run(items, {}, true).length === items.length);
    check('无套装约束：原样返回', run(items, {}, false).length === items.length);
}

realLog('\n[2] 有套装约束：逐 (部位 × 套装) 截断，每个组都有代表');

{
    const items = bigPool();
    const kept = run(items, {}, true);
    const { bySlot, bySlotSet } = countsBy(kept);

    check('确实做了截断', kept.length < items.length);
    check('每个部位都有候选', SLOTS.every((slot) => bySlot[slot] > 0), bySlot);
    check(
        '速度套与追击套在每个部位都保留',
        SLOTS.every((slot) => bySlotSet[slot + '/SpeedSet'] > 0 && bySlotSet[slot + '/PursuitSet'] > 0),
        bySlotSet
    );
    check('落在预算内（≤ 1e8）', combos(bySlot) <= 1e8, combos(bySlot));
}

realLog('\n[3] 有套装约束：同分一起保留（追击套 4 件同分，名额 1 → 留 2）');

{
    const kept = run(bigPool(), {}, true);
    const pursuit = kept.filter((it) => it.gear === 'Boots' && it.set === 'PursuitSet');
    check('Boots/追击套 4 件同为 90 分 → 保留 2 件', pursuit.length === 2, pursuit.length);
}

realLog('\n[4] 无套装约束：按部位截断，不保证每个套装都有代表');

{
    // Weapon 里 40 件速度套（有速度）+ 1 件追击套（没有速度，分数垫底）
    const items = [];
    items.push(item('weapon-pursuit-weak', 'Weapon', 'PursuitSet', 0, 0));
    for (let i = 0; i < 40; i++) {
        items.push(item(`weapon-speed-${i}`, 'Weapon', 'SpeedSet', 4 + (i % 8) * 4, 0));
    }
    for (const slot of ['Helmet', 'Armor', 'Necklace', 'Ring', 'Boots']) {
        for (let i = 0; i < 32; i++) {
            items.push(item(`${slot}-speed-${i}`, slot, 'SpeedSet', 4 + (i % 8) * 4, 0));
        }
    }

    const unconstrained = run(items, {}, false);
    check(
        '无约束：垫底的追击套武器被裁掉（允许）',
        !unconstrained.some((it) => it.id === 'weapon-pursuit-weak'),
        unconstrained.filter((it) => it.gear === 'Weapon').length
    );

    const constrained = run(items, {}, true);
    check(
        '有约束：同一件被保留（每组至少 1 件）',
        constrained.some((it) => it.id === 'weapon-pursuit-weak')
    );
}

realLog('\n[5] 滑块只是上限：给 3% 时不会放宽到 7%');

{
    const items = bigPool();
    const at3 = run(items, { inputFilterPriority: 3 }, true);
    const at7 = run(items, { inputFilterPriority: 7 }, true);
    check('3% 的候选数少于 7%', at3.length < at7.length, { at3: at3.length, at7: at7.length });
}

realLog('\n[6] 分数为 0 的组：严格截断（不整组扩张）');

{
    // 每个部位 1 件有速度的（速度套）+ 30 件 0 分的（追击套）
    const items = [];
    for (const slot of SLOTS) {
        items.push(item(`${slot}-good`, slot, 'SpeedSet', 20, 45));
        for (let i = 0; i < 30; i++) {
            items.push(item(`${slot}-zero-${i}`, slot, 'PursuitSet', 0, 0));
        }
    }
    const kept = run(items, { inputFilterPriority: 1 }, true);
    const zeroKept = kept.filter((it) => it.set === 'PursuitSet');
    check('0 分档每组只留 1 件', zeroKept.length === SLOTS.length, zeroKept.length);
}

realLog('\n[7] 关闭过滤（Top 100%）时原样返回');

{
    const items = bigPool();
    check('一件都不少', run(items, { inputFilterPriority: 100 }, true).length === items.length);
}

realLog('\n[8] 有套装约束时各部位保留数接近（不会偏袒某个部位）');

{
    const kept = run(bigPool(), {}, true);
    const { bySlotSet } = countsBy(kept);
    const values = SLOTS.map((slot) => bySlotSet[slot + '/SpeedSet']);
    check('各部位速度套保留数差异 ≤ 2', Math.max(...values) - Math.min(...values) <= 2, values);
}

realLog(failures ? `\nFAILURES: ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
