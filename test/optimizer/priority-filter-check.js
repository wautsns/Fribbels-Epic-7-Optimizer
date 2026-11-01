/*
 * 配装器「属性优先级过滤（Top %）」自测 —— 纯 Node，不依赖 Electron / Jest。
 *
 * 覆盖的是截断规则：按滑块加权分数排序后，逐部位保留 ceil(Top% × 该部位全部装备数) 件。
 * 这里验证两点（都是实际踩过的坑）：
 *   1. 边界上的「同分装备」要一起留下，否则同分里谁被丢掉完全取决于原始顺序。
 *      实测：利纳柯只要速度 8 分时，一堆「速度主属性 45、没有速度副属性」的靴子都是 90 分，
 *      极限一速要用的那双排名靠后被切掉 → 最高只能搜到 310；加攻击 1 / 命中 1 打破平局
 *      才能搜到 315。
 *   2. 同分扩张有上限（名额的 2 倍），分数为 0 的那一档照旧严格截断，避免候选池爆炸。
 *
 * 用法（仓库根目录）：node test/optimizer/priority-filter-check.js
 */
const path = require('path');

const ROOT = process.argv[2] || process.cwd();
const PriorityFilter = require(path.join(
    ROOT,
    'app',
    'js',
    'lib',
    'priorityFilter.js'
));

// 模块里有大量调试日志，测试时静音
const realLog = console.log;
console.log = () => {};

let failures = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures++;
    }
    realLog(
        `  ${ok ? 'ok  ' : 'FAIL'} ${name}${
            ok ? '' : ' -> ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')'
        }`
    );
}

const baseStats = { atk: 1000, hp: 5000, def: 400, spd: 100 };

/** 造一件装备：只关心速度副属性 + 主属性，其它都为 0 */
function item(id, gear, spdSub, mainType, mainValue) {
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
        mainType,
        mainValue,
    };
    return {
        id,
        gear,
        set: 'SpeedSet',
        main: { type: mainType, value: mainValue },
        augmentedStats: stats,
        reforgedStats: stats,
    };
}

/** 只给速度 8 分、Top 20% */
const params = {
    inputAtkPriority: 0,
    inputHpPriority: 0,
    inputDefPriority: 0,
    inputSpdPriority: 8,
    inputCrPriority: 0,
    inputCdPriority: 0,
    inputEffPriority: 0,
    inputResPriority: 0,
    inputFilterPriority: 20,
};

function run(items, allItems) {
    return PriorityFilter.applyPriorityFilters(
        params,
        items,
        baseStats,
        allItems || items,
        true,
        false
    ).map((x) => x.id);
}

function fillers(count, gear) {
    return Array.from({ length: count }, (_, i) =>
        item(`filler${i}`, gear, 0, 'Attack', 100)
    );
}

realLog('\n[1] 边界同分：整块保留');
{
    // 5 双靴子同分（速度主属性 45、没有速度副属性 → 90 分），名额只有 1 个
    const items = [
        item('a', 'Boots', 0, 'Speed', 45),
        item('b', 'Boots', 0, 'Speed', 45),
        item('c', 'Boots', 0, 'Speed', 45),
        item('d', 'Boots', 0, 'Speed', 45),
        item('e', 'Boots', 0, 'Speed', 45),
    ];
    check('同分按名额的 2 倍扩张（1 → 2）', run(items).sort(), ['a', 'b']);
}

realLog('\n[2] 分数为 0 的一档：照旧严格截断');
{
    const items = [
        item('zero1', 'Boots', 0, 'Attack', 100),
        item('zero2', 'Boots', 0, 'Attack', 100),
        item('zero3', 'Boots', 0, 'Attack', 100),
        item('zero4', 'Boots', 0, 'Attack', 100),
        item('zero5', 'Boots', 0, 'Attack', 100),
    ];
    check('只留名额内的一条', run(items).sort(), ['zero1']);
}

realLog('\n[3] 分数不同：按分数取前 N');
{
    const items = [
        item('top', 'Boots', 20, 'Speed', 45), // 130 分
        item('mid', 'Boots', 8, 'Speed', 45), // 106 分
        item('low', 'Boots', 0, 'Speed', 45), // 90 分
    ];
    check('只留最高分', run(items), ['top']);
}

realLog('\n[4] 名额边界落在同分块中间：整块留下');
{
    const items = [
        item('first', 'Boots', 24, 'Speed', 45), // 138 分
        item('tie1', 'Boots', 20, 'Speed', 45), // 130 分
        item('tie2', 'Boots', 20, 'Speed', 45), // 130 分
        item('tie3', 'Boots', 20, 'Speed', 45), // 130 分
        item('last', 'Boots', 0, 'Speed', 45), // 90 分
    ];
    // 该部位共 15 件装备 → 名额 = ceil(20% × 15) = 3，第 3 名是 130 分 → 130 分的都留下
    const allItems = items.concat(fillers(10, 'Boots'));
    check('138 + 3×130', run(items, allItems).sort(), ['first', 'tie1', 'tie2', 'tie3']);
}

realLog('\n[5] 名额超过候选数：原样返回');
{
    const items = [item('x', 'Boots', 4, 'Speed', 45), item('y', 'Boots', 0, 'Speed', 45)];
    check('两件都留', run(items, items.concat(fillers(20, 'Boots'))).length, 2);
}

realLog('\n[6] 逐部位独立截断');
{
    const items = [
        item('b1', 'Boots', 8, 'Speed', 45),
        item('b2', 'Boots', 8, 'Speed', 45),
        item('w1', 'Weapon', 8, 'Attack', 100),
        item('w2', 'Weapon', 4, 'Attack', 100),
        item('w3', 'Weapon', 0, 'Attack', 100),
    ];
    check('同分靴子都留、武器只留最高分', run(items).sort(), ['b1', 'b2', 'w1']);
}

realLog('\n[7] 关闭过滤（Top 100%）时原样返回');
{
    const items = [item('a', 'Boots', 0, 'Attack', 100), item('b', 'Boots', 0, 'Attack', 100)];
    const disabled = Object.assign({}, params, { inputFilterPriority: 100 });
    const result = PriorityFilter.applyPriorityFilters(
        disabled,
        items,
        baseStats,
        items,
        true,
        false
    );
    check('一件都不少', result.length, 2);
}

console.log = realLog;
realLog(failures ? `\nFAILURES: ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
