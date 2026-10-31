/*
 * 装备评分表（来源 docs/score.xls v5.0，规范化说明见 docs/score-table.md）
 *
 * 规则：
 *  - 装等 = 装备「分数」列的值（重铸后），比较阈值时向下取整；不含主属性。
 *  - 每个类别独立计算（互斥/顺序不再需要），低于第一档记 0。
 *  - 命中条件（全部硬性）：
 *      1) 套装在该类别的套装列表内；
 *      2) 部位主属性在该部位的主属性列表内（null = 不限，武器/头盔/盔甲固定主属性）；
 *      3) 该装备的【全部】副属性都落在该类别「有效属性」列表内（规则 A）。
 *  - 「小圈统计数量」这一列不参与计算。
 *
 * tiers 每档写成 [起始装等, 斜率, 截距]，区间为 [起始装等, 下一档起始装等)；
 * 分值 = 斜率 × 装等 + 截距。
 */

const SLOTS = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

// 副属性 key
const ATK_PCT = 'AttackPercent';
const ATK = 'Attack';
const HP_PCT = 'HealthPercent';
const HP = 'Health';
const DEF_PCT = 'DefensePercent';
const DEF = 'Defense';
const SPD = 'Speed';
const CR = 'CriticalHitChancePercent';
const CD = 'CriticalHitDamagePercent';
const EFF = 'EffectivenessPercent';
const RES = 'EffectResistancePercent';

// 套装 key
const HEALTH = 'HealthSet';
const DEFENSE = 'DefenseSet';
const ATTACK = 'AttackSet';
const SPEED = 'SpeedSet';
const CRIT = 'CriticalSet';
const HIT = 'HitSet';
const DESTRUCTION = 'DestructionSet';
const LIFESTEAL = 'LifestealSet';
const PROTECTION = 'ProtectionSet';
const COUNTER = 'CounterSet';
const RESIST = 'ResistSet';
const UNITY = 'UnitySet';
const RAGE = 'RageSet';
const IMMUNITY = 'ImmunitySet';
const REVENGE = 'RevengeSet';
const INJURY = 'InjurySet';
const PENETRATION = 'PenetrationSet';
const TORRENT = 'TorrentSet';
const REVERSAL = 'ReversalSet';
const RIPOSTE = 'RiposteSet';
const WARFARE = 'WarfareSet';
const PURSUIT = 'PursuitSet';
const WEAKENING = 'WeakeningSet';
const FERVOR = 'FervorSet';

const ALL_SET_KEYS = [
    HEALTH, DEFENSE, ATTACK, SPEED, CRIT, HIT, DESTRUCTION, LIFESTEAL,
    PROTECTION, COUNTER, RESIST, UNITY, RAGE, IMMUNITY, REVENGE, INJURY,
    PENETRATION, TORRENT, REVERSAL, RIPOSTE, WARFARE, PURSUIT, WEAKENING, FERVOR,
];

// 表里的写法 → 程序里的套装 key（程序的中文名见 SET_LABELS）
// 「血 / 防 / 效抗 / 效命」是表里的缩写；「穿透/贯穿」「追击/追加」「破灭/爆伤」是同一套装的两种叫法
const SET_ALIASES = {
    '血': HEALTH,
    '生命': HEALTH,
    '防': DEFENSE,
    '防御': DEFENSE,
    '攻': ATTACK,
    '攻击': ATTACK,
    '效抗': RESIST,
    '抵抗': RESIST,
    '效命': HIT,
    '命中': HIT,
    '速': SPEED,
    '速度': SPEED,
    '暴击': CRIT,
    '爆伤': DESTRUCTION,
    '破灭': DESTRUCTION,
    '吸血': LIFESTEAL,
    '守护': PROTECTION,
    '反击': COUNTER,
    '免疫': IMMUNITY,
    '贯穿': PENETRATION,
    '穿透': PENETRATION,
    '激流': TORRENT,
    '伤口': INJURY,
    '开战': WARFARE,
    '追加': PURSUIT,
    '追击': PURSUIT,
    '弱化': WEAKENING,
    '全力': FERVOR,
    '回击': RIPOSTE,
    '逆袭': REVERSAL,
    '夹攻': UNITY,
    '团结': UNITY,
    '愤怒': RAGE,
    '复仇': REVENGE,
};

// 程序里的中文名（取自 data/locales/zh/translation.json）
const SET_LABELS = {
    [ATTACK]: '攻击',
    [COUNTER]: '反击',
    [DESTRUCTION]: '破灭',
    [INJURY]: '伤口',
    [LIFESTEAL]: '吸血',
    [PROTECTION]: '守护',
    [RAGE]: '愤怒',
    [REVENGE]: '复仇',
    [REVERSAL]: '逆袭',
    [RIPOSTE]: '回击',
    [WARFARE]: '开战',
    [WEAKENING]: '弱化',
    [SPEED]: '速度',
    [CRIT]: '暴击',
    [DEFENSE]: '防御',
    [HEALTH]: '生命',
    [HIT]: '命中',
    [IMMUNITY]: '免疫',
    [PENETRATION]: '穿透',
    [RESIST]: '抵抗',
    [TORRENT]: '激流',
    [UNITY]: '夹攻',
    [PURSUIT]: '追击',
    [FERVOR]: '全力',
};

const STAT_ALIASES = {
    '攻击%': ATK_PCT,
    '攻击': ATK,
    '生命%': HP_PCT,
    '生命': HP,
    '防御%': DEF_PCT,
    '防御': DEF,
    '速度': SPD,
    '暴率': CR,
    '爆率': CR,
    '爆伤': CD,
    '命中': EFF,
    '抵抗': RES,
};

/* ---------------- 三个雷达图的轴 ---------------- */

/*
 * 雷达图的轴（12 项）
 * 外圈 = 「装等 70 分」时的分值 —— 70 分是玩家口中的毕业线，超过它的部分画到圈外。
 * 一速由速度值分档（与装等无关），外圈取速度 28（理论上限）；
 * 未来可期要装等 75 才起步，70 分时是 0，给个 10 当外圈。
 * 其余轴：某个类别在装等 70 时还拿不到分（门槛 72/75）的，也兜底 10。
 */
const RADAR_AXES = [
    { key: 'FirstSpeed', label: '一速', max: 70 },
    { key: 'Speed', label: '速度', max: 10 },
    { key: 'Output', label: '输出', max: 10 },
    { key: 'CritOutput', label: '必爆输出', max: 40 },
    { key: 'Bruiser', label: '半肉', max: 10 },
    { key: 'FlatBruiser', label: '白字半肉', max: 10 },
    { key: 'HpDefBruiser', label: '血防半肉', max: 10 },
    { key: 'ResTank', label: '抗性坦', max: 11 },
    { key: 'HitTank', label: '命中坦', max: 11 },
    { key: 'PureTank', label: '纯肉坦', max: 31 },
    { key: 'DualEffect', label: '双效', max: 10 },
    { key: 'Potential', label: '未来可期', max: 10 },
];

// 兼容旧接口：现在只有一张雷达图
const RADAR_GROUPS = [{ key: 'scoreRadar', axes: RADAR_AXES }];

const AXIS_KEYS = RADAR_GROUPS.reduce((acc, g) => acc.concat(g.axes.map((a) => a.key)), []);

/* ---------------- 九个类别 ---------------- */

// slots 里没列出的部位 = 该类别不给这个部位计分
const CATEGORIES = [
    {
        key: 'Output',
        label: '输出',
        sets: [SPEED, DESTRUCTION, CRIT, PENETRATION, FERVOR, TORRENT, COUNTER, LIFESTEAL, IMMUNITY, RIPOSTE, WARFARE],
        stats: [ATK_PCT, ATK, CR, CD, SPD],
        slots: {
            Weapon: { tiers: [[70, 1.4, -97], [75, 2, -142], [78, 3, -220]] },
            Helmet: { tiers: [[70, 1.4, -97], [75, 2, -142], [78, 3, -220]] },
            Armor: { tiers: [[64, 1.4, -88.6], [69, 2, -130], [73, 3, -203]] },
            Necklace: { main: [CR, CD], tiers: [[66, 1.5, -98], [71, 2.5, -169], [74, 4, -280]] },
            Ring: { main: [ATK_PCT], tiers: [[66, 1.5, -98], [71, 2.5, -169], [74, 4, -280]] },
            Boots: { main: [SPD, ATK_PCT], tiers: [[65, 1.5, -95.5], [71, 2.5, -166.5], [74, 4, -277.5]] },
        },
    },
    {
        key: 'CritOutput',
        label: '必爆输出',
        sets: [SPEED, DESTRUCTION, PENETRATION, FERVOR, TORRENT, IMMUNITY, RIPOSTE],
        stats: [ATK_PCT, ATK, CD, SPD],
        slots: {
            Weapon: { tiers: [[63, 1.5, -92.5], [68, 2.5, -160.5], [72, 5, -340.5]] },
            Helmet: { tiers: [[66, 1.5, -97], [71, 2.5, -168], [75, 5, -355.5]] },
            // 衣服：原表写「不给额外计算」→ 不参与
            Necklace: { main: [CD], tiers: [[59, 2, -115.5], [63, 3, -178.5], [66, 5, -310.5]] },
            Ring: { main: [ATK_PCT], tiers: [[59, 2, -115.5], [63, 3, -178.5], [66, 5, -310.5]] },
            Boots: { main: [SPD, ATK_PCT], tiers: [[59, 2, -115.5], [63, 3, -178.5], [66, 5, -310.5]] },
        },
    },
    {
        key: 'ResTank',
        label: '抗性坦克',
        sets: [SPEED, HEALTH, DEFENSE, RESIST, PROTECTION, COUNTER, IMMUNITY, REVERSAL, WARFARE, PURSUIT],
        stats: [HP_PCT, HP, DEF_PCT, DEF, SPD, RES],
        slots: {
            Weapon: { tiers: [[64, 1.5, -95], [70, 2, -130], [74, 3, -204]] },
            Helmet: { tiers: [[70, 1.5, -104], [76, 2, -142], [79, 3, -221]] },
            Armor: { tiers: [[70, 1.5, -104], [76, 2, -142], [79, 3, -221]] },
            Necklace: { main: [HP_PCT, DEF_PCT], tiers: [[64, 1.5, -94], [70, 2, -129], [74, 3, -203]] },
            Ring: { main: [HP_PCT, DEF_PCT, RES], tiers: [[64, 1.5, -94], [70, 2, -129], [74, 3, -203]] },
            Boots: { main: [HP_PCT, DEF_PCT, SPD], tiers: [[64, 1.5, -94], [70, 2, -129], [74, 3, -203]] },
        },
    },
    {
        key: 'PureTank',
        label: '纯肉坦克',
        sets: [SPEED, HEALTH, DEFENSE, PROTECTION, IMMUNITY, REVERSAL, WARFARE],
        stats: [HP_PCT, HP, DEF_PCT, DEF, SPD],
        slots: {
            // 原表「不单独计算，同抗坦」
            Weapon: { tiers: [[64, 1.5, -95], [70, 2, -130], [74, 3, -204]] },
            Helmet: { tiers: [[63, 1.8, -112.4], [68, 2, -126], [74, 3.5, -237]] },
            Armor: { tiers: [[63, 1.8, -112.4], [68, 2, -126], [74, 3.5, -237]] },
            Necklace: { main: [HP_PCT], tiers: [[58, 1.5, -85], [64, 3, -181], [70, 5, -321]] },
            Ring: { main: [HP_PCT], tiers: [[58, 1.5, -85], [64, 2.5, -149], [68, 5, -319]] },
            Boots: { main: [HP_PCT, SPD], tiers: [[58, 1.5, -85], [64, 2.5, -149], [68, 5, -319]] },
        },
    },
    {
        key: 'HitTank',
        label: '命中坦克',
        sets: [SPEED, HEALTH, DEFENSE, HIT, IMMUNITY, PURSUIT, WEAKENING],
        stats: [HP_PCT, HP, DEF_PCT, DEF, SPD, EFF],
        slots: {
            Weapon: { tiers: [[64, 1.5, -95], [70, 2, -130], [74, 3, -204]] },
            Helmet: { tiers: [[70, 1.5, -104], [76, 2, -142], [79, 3, -221]] },
            Armor: { tiers: [[70, 1.5, -104], [76, 2, -142], [79, 3, -221]] },
            Necklace: { main: [HP_PCT, DEF_PCT], tiers: [[64, 1.5, -94], [70, 2, -129], [74, 3, -203]] },
            Ring: { main: [HP_PCT, DEF_PCT, EFF], tiers: [[64, 1.5, -94], [70, 2, -129], [74, 3, -203]] },
            Boots: { main: [SPD], tiers: [[64, 1.5, -94], [70, 2, -129], [74, 3, -203]] },
        },
    },
    {
        key: 'DualEffect',
        label: '双效',
        sets: [SPEED, HEALTH, DEFENSE, HIT, RESIST, COUNTER, IMMUNITY],
        stats: [SPD, HP_PCT, DEF_PCT, DEF, RES, EFF, ATK_PCT],
        // 原表附加条件：主属性/套装/副属性 需要包含至少一条命中或抵抗；
        // 只有「命中 + 抵抗 + 攻击%」三者同时出现在副属性里时才排除
        extraCheck: (item, substats) => {
            const types = substats.map((s) => s.type);
            const mainType = item.main && item.main.type;
            const hasEff = types.includes(EFF) || mainType === EFF || item.set === HIT;
            const hasRes = types.includes(RES) || mainType === RES || item.set === RESIST;
            if (!hasEff && !hasRes) return false;

            // 三个条件只看副属性
            const subHasEff = types.includes(EFF);
            const subHasRes = types.includes(RES);
            const subHasAtkPct = types.includes(ATK_PCT);
            return !(subHasEff && subHasRes && subHasAtkPct);
        },
        slots: {
            Weapon: { tiers: [[72, 1, -71], [75, 2, -146]] },
            Helmet: { tiers: [[72, 1, -71], [75, 2, -146]] },
            Armor: { tiers: [[72, 1, -71], [75, 2, -146]] },
            Necklace: { main: [HP_PCT, DEF_PCT, ATK_PCT], tiers: [[72, 1, -71], [75, 2, -146]] },
            Ring: { main: [HP_PCT, DEF_PCT, ATK_PCT, RES, EFF], tiers: [[72, 1, -71], [75, 2, -146]] },
            Boots: { main: [SPD], tiers: [[72, 1, -71], [75, 2, -146]] },
        },
    },
    {
        key: 'HpDefBruiser',
        label: '血防半肉',
        sets: [HEALTH, DEFENSE, SPEED, DESTRUCTION, COUNTER, INJURY, IMMUNITY, PENETRATION, PURSUIT, FERVOR],
        stats: [CR, CD, SPD, HP_PCT, DEF_PCT, DEF],
        slots: {
            Weapon: { tiers: [[71, 1, -70], [74, 2, -144], [77, 3, -221]] },
            Helmet: { tiers: [[71, 1, -70], [74, 2, -144], [77, 3, -221]] },
            Armor: { tiers: [[71, 1, -70], [74, 2, -144], [77, 3, -221]] },
            Necklace: { main: [CR, CD], tiers: [[68, 1, -67], [74, 2, -141], [77, 4, -295]] },
            Ring: { main: [HP_PCT, DEF_PCT], tiers: [[68, 1, -67], [74, 2, -141], [77, 4, -295]] },
            Boots: { main: [SPD], tiers: [[68, 1, -67], [74, 2, -141], [77, 4, -295]] },
        },
    },
    {
        key: 'Bruiser',
        label: '半肉',
        sets: [HEALTH, DEFENSE, SPEED, CRIT, DESTRUCTION, COUNTER, INJURY, LIFESTEAL, IMMUNITY, PENETRATION, RIPOSTE],
        stats: [ATK_PCT, CR, CD, SPD, HP_PCT, DEF_PCT, DEF],
        slots: {
            Weapon: { tiers: [[72, 1, -71], [75, 2, -146]] },
            Helmet: { tiers: [[72, 1, -71], [75, 2, -146]] },
            Armor: { tiers: [[72, 1, -71], [75, 2, -146]] },
            Necklace: { main: [CR, CD], tiers: [[72, 1, -71], [75, 2, -146]] },
            Ring: { main: [HP_PCT, DEF_PCT, ATK_PCT], tiers: [[72, 1, -71], [75, 2, -146]] },
            Boots: { main: [SPD], tiers: [[72, 1, -71], [75, 2, -146]] },
        },
    },
    {
        key: 'FlatBruiser',
        label: '白字半肉',
        sets: [HEALTH, DEFENSE, SPEED, COUNTER, IMMUNITY, WARFARE, PURSUIT],
        stats: [ATK_PCT, ATK, SPD, HP_PCT, HP, DEF_PCT, DEF],
        slots: {
            Weapon: { tiers: [[65, 1.5, -95], [70, 2, -130], [74, 3, -204]] },
            Helmet: { tiers: [[71, 1.5, -104], [76, 2, -142], [79, 3, -221]] },
            Armor: { tiers: [[65, 1.5, -95], [70, 2, -130], [74, 3, -204]] },
            Necklace: { main: [DEF_PCT, HP_PCT, ATK_PCT], tiers: [[67, 1.5, -98], [71, 2.5, -169], [74, 4, -280]] },
            Ring: { main: [HP_PCT, DEF_PCT, ATK_PCT], tiers: [[67, 1.5, -98], [71, 2.5, -169], [74, 4, -280]] },
            Boots: { main: [SPD], tiers: [[67, 1.5, -98], [71, 2.5, -169], [74, 4, -280]] },
        },
    },
];

/* ---------------- 一速 / 速度 / 未来可期 ---------------- */

// 一速：按【速度】值分档，不分套装，鞋子恒为 0
const FIRST_SPEED_TIERS = [[22, 5, -105], [25, 10, -225], [27, 20, -490]];

// 速度（速度套）：要求速度 >= 18，档位看装等
const SPEED_SET_TIERS = [[68, 2, -134], [73, 3, -207], [78, 4, -285]];

// 速度（其余 9 套）：要求速度 >= 18
const SPEED_OTHER_SETS = [CRIT, HEALTH, DEFENSE, IMMUNITY, PENETRATION, TORRENT, HIT, RESIST, FERVOR];
const SPEED_OTHER_TIERS = [[70, 0.8, -54], [75, 1, -69]];

// 未来可期：装等 >= 75，2/3 × (装等 − 73.5)
const POTENTIAL_TIERS = [[75, 2 / 3, -49]];

const SPEED_MIN_FOR_LAYER = 18;

/* ---------------- 计算 ---------------- */

/*
 * 副属性权重 = 程序里「分数」那一列（reforgedWss）的权重，见 backend ItemDb.calculateWss
 */
const SUBSTAT_WEIGHTS = {
    [ATK_PCT]: 1,
    [DEF_PCT]: 1,
    [HP_PCT]: 1,
    [EFF]: 1,
    [RES]: 1,
    [SPD]: 8 / 4,
    [CD]: 1.125,
    [CR]: 1.5,
    [ATK]: 3.46 / 39,
    [DEF]: 4.99 / 31,
    [HP]: 3.09 / 174,
};

const ALL_STAT_TYPES = Object.keys(SUBSTAT_WEIGHTS);

function realSubstats(item) {
    return (item.substats || []).filter((s) => s && s.type && s.type !== 'None');
}

/*
 * 按给定属性集算加权分：
 *  - 优先用后端聚合好的 reforgedStats（键就是 StatType 字符串，不含主属性）
 *  - 没有就退回逐条副属性累加（用 reforgedValue）
 */
function weightedScore(item, statTypes) {
    const stats = item.reforgedStats || item.augmentedStats;
    if (stats) {
        let total = 0;
        for (const type of statTypes) {
            const value = Number(stats[type]);
            if (Number.isFinite(value)) {
                total += value * (SUBSTAT_WEIGHTS[type] || 0);
            }
        }
        return total;
    }

    let total = 0;
    for (const substat of realSubstats(item)) {
        if (!statTypes.includes(substat.type)) continue;
        const weight = SUBSTAT_WEIGHTS[substat.type] || 0;
        if (!weight) continue;
        const raw = substat.reforgedValue != null ? substat.reforgedValue : substat.value;
        total += (Number(raw) || 0) * weight;
    }
    return total;
}

/* 装等 = 该类别「有效属性」范围内的加权分，向下取整（statTypes 省略 = 全部副属性） */
function levelFor(item, statTypes) {
    return Math.floor(weightedScore(item, statTypes || ALL_STAT_TYPES));
}

function toLevel(item) {
    return levelFor(item, ALL_STAT_TYPES);
}

function evalTiers(tiers, value) {
    if (!tiers) return 0;
    for (let i = 0; i < tiers.length; i++) {
        const [from, mul, add] = tiers[i];
        const to = i + 1 < tiers.length ? tiers[i + 1][0] : Infinity;
        if (value >= from && value < to) {
            return Math.round((mul * value + add) * 100) / 100;
        }
    }
    return 0;
}

function speedSubstatValue(item) {
    const stats = item.reforgedStats || item.augmentedStats;
    if (stats && Number.isFinite(Number(stats[SPD]))) {
        return Number(stats[SPD]);
    }
    const substat = realSubstats(item).find((s) => s.type === SPD);
    if (!substat) return null;
    const raw = substat.reforgedValue != null ? substat.reforgedValue : substat.value;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function matchesCategory(category, item, substats) {
    if (!category || !category.sets.includes(item.set)) return false;

    const slotDef = category.slots[item.gear];
    if (!slotDef) return false;

    if (slotDef.main && !slotDef.main.includes(item.main && item.main.type)) return false;

    return !category.extraCheck || category.extraCheck(item, substats);
}

/*
 * 每个类别用自己的「有效属性」范围算装等：
 * 只有列表内的副属性计入分数，列表外的副属性不计入、但也不淘汰。
 */
function categoryLevel(category, item) {
    return levelFor(item, category.stats);
}

function scoreCategory(category, item, substats) {
    if (!matchesCategory(category, item, substats)) return 0;
    return evalTiers(category.slots[item.gear].tiers, categoryLevel(category, item));
}

/*
 * 速度层的装等：把「速度」额外计入有效属性后，取该装备能归入的 9 个类别里最高的那个装等。
 * 一个类别都归不进（套装/主属性不匹配）就返回 -1 —— 对应原表那句
 * 「若只有速度词条，无法归入后面 9 种中任意一种，则不计分」。
 */
function speedLayerLevel(item) {
    const substats = realSubstats(item);
    let best = -1;

    for (const category of CATEGORIES) {
        if (!matchesCategory(category, item, substats)) continue;
        const statTypes = category.stats.includes(SPD) ? category.stats : category.stats.concat([SPD]);
        const level = Math.floor(weightedScore(item, statTypes));
        if (level > best) best = level;
    }

    return best;
}

function scoreFirstSpeed(item) {
    if (item.gear === 'Boots') return 0;
    const speed = speedSubstatValue(item);
    if (speed === null) return 0;
    return evalTiers(FIRST_SPEED_TIERS, Math.floor(speed));
}

// 速度层：速度 >= 18；装等见 speedLayerLevel()
function scoreSpeedLayer(item) {
    if (item.gear === 'Boots') return 0;
    const speed = speedSubstatValue(item);
    if (speed === null || speed < SPEED_MIN_FOR_LAYER) return 0;

    if (item.set !== SPEED && !SPEED_OTHER_SETS.includes(item.set)) return 0;

    const level = speedLayerLevel(item);
    if (level < 0) return 0;

    return item.set === SPEED
        ? evalTiers(SPEED_SET_TIERS, level)
        : evalTiers(SPEED_OTHER_TIERS, level);
}

function scorePotential(item) {
    // 有效属性 = 全部
    return evalTiers(POTENTIAL_TIERS, toLevel(item));
}

/*
 * 返回 12 个雷达轴的分值（0 = 不适用 / 未达第一档）
 * 「未来可期」只在其它 11 个轴全为 0 时才计分
 */
function scoreItem(item) {
    const result = {};
    AXIS_KEYS.forEach((key) => { result[key] = 0; });
    if (!item) return result;

    const substats = realSubstats(item);

    for (const category of CATEGORIES) {
        result[category.key] = scoreCategory(category, item, substats);
    }

    result.FirstSpeed = scoreFirstSpeed(item);
    result.Speed = scoreSpeedLayer(item);

    const others = AXIS_KEYS
        .filter((key) => key !== 'Potential')
        .map((key) => result[key]);
    result.Potential = others.some((score) => score > 0) ? 0 : scorePotential(item);

    return result;
}

module.exports = {
    SLOTS,
    CATEGORIES,
    RADAR_AXES,
    RADAR_GROUPS,
    AXIS_KEYS,
    SET_ALIASES,
    SET_LABELS,
    STAT_ALIASES,
    ALL_SET_KEYS,
    SUBSTAT_WEIGHTS,
    ALL_STAT_TYPES,
    FIRST_SPEED_TIERS,
    SPEED_SET_TIERS,
    SPEED_OTHER_SETS,
    SPEED_OTHER_TIERS,
    POTENTIAL_TIERS,
    toLevel,
    levelFor,
    weightedScore,
    categoryLevel,
    speedLayerLevel,
    evalTiers,
    scoreItem,
};
