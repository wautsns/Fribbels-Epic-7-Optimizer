/**
 * GVG 作业（plan）数据层 —— 对标 docs/gvg/design.md 第 4 / 6.4 / 10 / 11 节。
 *
 * 职责边界：
 *   - 只做数据：规范化 / 校验 / 排序 / 置队 / 判重 / 去重 / 压缩编解码 / 导出包
 *   - 不碰 DOM：改完数据统一走 commit()，由 commit 触发自动保存和列表重绘
 *   - 进攻成员通过 heroId 引用英雄列表条目（hero tab），不再独立存 name/artifact 副本
 *   - 防守成员仍然使用 heroCode（跨设备稳定标识）
 */
const { v4: uuidv4 } = require('uuid');
const zlib = require('zlib');

const SCHEMA_VERSION = 1;
const PACKAGE_SCHEMA = 'e7-gvg-plans';
const CLIPBOARD_PREFIX = 'E7GVG1:';

/* 进攻阵容 1 / 2：本机状态，存在 localStorage 里。
   不进作业数据、不随导出/粘贴走，作业的排序位置也不再决定归属哪个进攻阵容（design.md 6.4）。 */
const TEAMS_STORAGE_KEY = 'e7gvg.teams';

/* 站位展示顺序：前 → 下 → 上 → 后（design.md 6.2） */
const POSITIONS = ['front', 'bottom', 'top', 'back'];

/*
 * 运行期字段：不是「面板要求」的一部分，跨账号/跨设备会算错（design.md 4.3）。
 *
 * executionId 必须在这里：它是每次优化的执行 id，配装器每次跑都会换成新的 uuid
 * （optimizerTab 里 `currentExecutionId = await Api.prepareExecution()`），
 * 所以作业里存的和角色条目里存的永远不一样 —— 不剔除的话「置为进攻阵容 1」会一直判定
 * 条目缺失，重复弹新建。
 */
const RUNTIME_REQUEST_KEYS = [
    'excludeFilter',
    'inputAllowEquippedItems',
    'inputPredictReforges',
    'excludedGearIds',
    'executionId',
    // 配装器每跑一次都会填的新值 / 后端保存时会被置空的两个内部字段
    'items',
    'boolArr',
    // 只是「候选装备取多少」的搜索空间设置，改了不影响这是不是同一个条目；
    // 属性优先级滑块 / 结果优先级 **要** 参与指纹（它们决定最终搜出来的是哪套装备）
    'inputFilterPriority',
];

let plans = [];
let heroCodeToName = null;

/* { first: id|null, second: id|null } —— 懒加载，见 loadTeams() */
let teams = null;

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowMillis() {
    return Date.now();
}

/** 键顺序无关的稳定序列化，用于判重 */
function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;

    const keys = Object.keys(value).sort();
    return `{${keys
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

function asString(value) {
    return value == null ? '' : String(value);
}

/* 后端「上限」的默认最大值：等于它就说明这条上限没启用 */
const DEFAULT_MAX_LIMIT = 2147483647;

/*
 * 归一化「下限 / 上限是否启用」的标记：
 *   - 下限 <= 0（含没填）→ 等于没有下限，标记删掉；
 *   - 上限 >= 后端默认最大值（或没填）→ 等于没有上限，标记删掉。
 * 否则「输入框留空」和「填了 0 再清空」这类等价配置会让指纹对不上：
 * 实测作业里 inputSpdMinConfigured=true + 0，条目里 false，明明没设速度下限却判定为不同配置。
 */
function normalizeLimitFlags(copy) {
    for (const key of Object.keys(copy)) {
        if (key.endsWith('MinConfigured')) {
            const value = Number(copy[key.slice(0, -'Configured'.length)]);
            if (!(value > 0)) delete copy[key];
        } else if (key.endsWith('MaxConfigured')) {
            const value = Number(copy[key.slice(0, -'Configured'.length)]);
            if (!(value < DEFAULT_MAX_LIMIT)) delete copy[key];
        }
    }
}

function asIntegerOrNull(value, min, max) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const rounded = Math.round(number);
    if (rounded < min || rounded > max) return null;
    return rounded;
}

/* ------------------------------------------------------------------ *
 * 进攻阵容 1 / 2（本机状态）
 * ------------------------------------------------------------------ */

function teamStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (error) {
        return null;
    }
}

function loadTeams() {
    if (teams) return teams;

    teams = { first: null, second: null };

    const store = teamStorage();
    if (!store) return teams;

    try {
        const parsed = JSON.parse(store.getItem(TEAMS_STORAGE_KEY) || 'null');
        if (parsed && typeof parsed === 'object') {
            teams.first = parsed.first ? asString(parsed.first) : null;
            teams.second = parsed.second ? asString(parsed.second) : null;
        }
    } catch (error) {
        console.warn('GVG: unable to read the saved teams', error);
    }

    return teams;
}

function saveTeams() {
    const store = teamStorage();
    if (!store) return;

    try {
        store.setItem(TEAMS_STORAGE_KEY, JSON.stringify(loadTeams()));
    } catch (error) {
        console.warn('GVG: unable to save the teams', error);
    }
}

/** 作业被删除 / 清空 / 整表替换后，清掉指向不存在作业的进攻阵容 1、2 的引用 */
function pruneTeams() {
    const current = loadTeams();
    let changed = false;

    for (const slot of ['first', 'second']) {
        if (current[slot] && !plans.some((plan) => plan.id === current[slot])) {
            current[slot] = null;
            changed = true;
        }
    }

    if (changed) saveTeams();
}

/** herodata.json 的 code 索引（懒建；code 是跨设备稳定标识） */
function heroIndex() {
    if (heroCodeToName) return heroCodeToName;

    heroCodeToName = {};
    try {
        const allHeroData = HeroData.getAllHeroData();
        for (const name of Object.keys(allHeroData)) {
            const code = allHeroData[name] && allHeroData[name].code;
            if (code) heroCodeToName[code] = name;
        }
    } catch (error) {
        console.warn(
            'GVG: herodata unavailable while indexing hero codes',
            error
        );
    }
    return heroCodeToName;
}

/** artifactdata.json 的 code 索引（懒建；作业里存 code，不存名字 —— 名字会变、code 稳定） */
let artifactCodeToName = null;

function artifactIndex() {
    if (artifactCodeToName) return artifactCodeToName;

    artifactCodeToName = {};
    try {
        const allArtifactData = HeroData.getAllArtifactData();
        for (const name of Object.keys(allArtifactData)) {
            const code = allArtifactData[name] && allArtifactData[name].code;
            if (code) artifactCodeToName[code] = name;
        }
    } catch (error) {
        console.warn(
            'GVG: artifactdata unavailable while indexing artifact codes',
            error
        );
    }
    return artifactCodeToName;
}

module.exports = {
    SCHEMA_VERSION,
    PACKAGE_SCHEMA,
    CLIPBOARD_PREFIX,
    POSITIONS,

    /* ---------------- 读取 ---------------- */

    getAll: () => clone(plans),

    getSorted: () => module.exports.sortPlans(clone(plans)),

    getById: (id) => clone(plans.find((plan) => plan.id === id) || null),

    /**
     * 当前的进攻阵容 1 / 2。指向已删除作业的引用按"未设置"处理，不会返回脏 id。
     * 这个状态只在本机（localStorage），不进作业、不进导出包。
     */
    getTeams: () => {
        const current = loadTeams();
        const exists = (id) => !!id && plans.some((plan) => plan.id === id);
        return {
            first: exists(current.first) ? current.first : null,
            second: exists(current.second) ? current.second : null,
        };
    },

    /** 清掉进攻阵容 1 / 2（作业数据里的排序位置不变） */
    clearTeams: () => {
        const current = loadTeams();
        current.first = null;
        current.second = null;
        saveTeams();
        module.exports.commit();
    },

    heroNameForCode: (code) => heroIndex()[code] || null,

    /** 英雄名（herodata 的 key）→ code：把角色条目带进作业时用它定位英雄 */
    heroCodeForName: (name) => {
        try {
            const allHeroData = HeroData.getAllHeroData();
            const info = allHeroData && allHeroData[name];
            return (info && info.code) || null;
        } catch (error) {
            console.warn(
                'GVG: herodata unavailable while resolving hero code',
                error
            );
            return null;
        }
    },

    isKnownHeroCode: (code) => !!heroIndex()[code],

    /* ---------------- 神器（存 code；名字只用于显示） ---------------- */

    artifactNameForCode: (code) => artifactIndex()[code] || null,

    artifactCodeForName: (name) => {
        try {
            const allArtifactData = HeroData.getAllArtifactData();
            const artifact = allArtifactData && allArtifactData[name];
            return (artifact && artifact.code) || null;
        } catch (error) {
            console.warn(
                'GVG: artifactdata unavailable while resolving artifact code',
                error
            );
            return null;
        }
    },

    /** 神器下拉的选项（按名字排序）：[{ code, name }]，code 与名字现在是一一对应的 */
    getArtifactOptions: () => {
        try {
            const allArtifactData = HeroData.getAllArtifactData() || {};
            return Object.keys(allArtifactData)
                .map((name) => {
                    const artifact = allArtifactData[name];
                    return {
                        code: (artifact && artifact.code) || '',
                        name,
                    };
                })
                .filter((option) => option.code)
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            console.warn('GVG: artifact data unavailable', error);
            return [];
        }
    },

    /**
     * 从 Api.getAllHeroes() 拿全部角色条目，导入匹配 / 下拉框用。
     * 返回 [{ id, name, artifactName, ...entry }] 数组，同时刷新同步缓存。
     */
    _heroEntriesCache: null,

    getHeroEntries: async () => {
        if (
            typeof Api !== 'undefined' &&
            typeof Api.getAllHeroes === 'function'
        ) {
            try {
                const response = await Api.getAllHeroes();
                module.exports._heroEntriesCache =
                    (response && response.heroes) || [];
            } catch (e) {
                console.warn('GVG: unable to load hero entries', e);
            }
        }
        return module.exports._heroEntriesCache || [];
    },

    /** 用表格刷新时已经拉到的英雄快照灌同步缓存 */
    setHeroEntries: (entries) => {
        if (Array.isArray(entries)) {
            module.exports._heroEntriesCache = entries;
        }
    },

    /** 同步缓存是否已经可用（决定列表能否直接渲染头像，不用等网络） */
    hasHeroEntries: () => Array.isArray(module.exports._heroEntriesCache),

    /** 清除条目缓存（条目变更时调） */
    invalidateHeroEntriesCache: () => {
        module.exports._heroEntriesCache = null;
    },

    /** 根据 heroId 找 hero entry（同步）；缓存由表格刷新 / getHeroEntries 灌入 */
    resolveHeroEntry: (heroId) => {
        if (!heroId) return null;
        const cached = module.exports._heroEntriesCache;
        return cached ? cached.find((h) => h.id === heroId) || null : null;
    },

    /** 列表筛选框的选项：只列作业里防守阵容出现过的 heroCode */
    getDefenseFilterOptions: () => {
        const codes = new Set();
        plans.forEach((plan) =>
            plan.defense.heroCodes.forEach((code) => codes.add(code))
        );

        return [...codes]
            .map((code) => {
                const name = module.exports.heroNameForCode(code) || code;
                return {
                    code,
                    name,
                    label: i18next.t(name),
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    },

    /** 成员对应的 heroCode：优先用保存时缓存的，老数据回退到条目名反查 */
    heroCodeOfMember: (member) => {
        if (!member) return '';
        if (member.heroCode) return member.heroCode;
        const entry = module.exports.resolveHeroEntry(member.heroId);
        return (entry && module.exports.heroCodeForName(entry.name)) || '';
    },

    /** 列表筛选框的选项：只列作业里进攻阵容出现过的 heroCode */
    getAttackFilterOptions: () => {
        const codes = new Set();
        plans.forEach((plan) =>
            plan.offense.members.forEach((member) => {
                const code = module.exports.heroCodeOfMember(member);
                // 老数据没有缓存 code，顺手补上，之后筛选/头像都不用再反查条目
                if (code) {
                    member.heroCode = member.heroCode || code;
                    codes.add(code);
                }
            })
        );

        return [...codes]
            .map((code) => {
                const name = module.exports.heroNameForCode(code) || code;
                return {
                    code,
                    name,
                    label: i18next.t(name),
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    },

    /* ---------------- 写入（都会 commit） ---------------- */

    setAll: (rawList) => {
        const result = { skipped: 0 };
        const next = [];

        if (Array.isArray(rawList)) {
            for (const raw of rawList) {
                const normalized = module.exports.normalizePlan(raw);
                if (normalized) {
                    next.push(normalized);
                } else {
                    result.skipped++;
                }
            }
        } else if (rawList != null) {
            result.skipped++;
        }

        plans = next;
        pruneTeams();
        return result;
    },

    upsert: (rawPlan) => {
        const normalized = module.exports.normalizePlan(rawPlan);
        if (!normalized) return null;

        const existingIndex = plans.findIndex(
            (plan) => plan.id === normalized.id
        );
        if (existingIndex >= 0) {
            normalized.createdAt = plans[existingIndex].createdAt;
            // lastUsedAt 允许调用方显式更新（dialog 手动改 → null/新时间戳；
            // pinFirst/pinSecond 置队 → 新时间戳），不再盲保留旧值
            plans[existingIndex] = normalized;
        } else {
            normalized.createdAt = nowMillis();
            // 新作业沿用 dialog 传入的 lastUsedAt（勾选「最近使用」时不再是未使用）
            plans.push(normalized);
        }

        module.exports.commit();
        return normalized;
    },

    remove: (id) => {
        const before = plans.length;
        plans = plans.filter((plan) => plan.id !== id);
        if (plans.length !== before) {
            pruneTeams();
            module.exports.commit();
        }
        return before !== plans.length;
    },

    clear: () => {
        plans = [];
        pruneTeams();
        module.exports.commit();
    },

    /* ---------------- 排序 / 进攻阵容 1 / 2（design.md 6.4） ---------------- */

    sortPlans: (list) => {
        const byIdDesc = (a, b) => (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
        const teams = loadTeams();

        // 先置顶进攻阵容 1（其次阵容 2），其余按已使用 lastUsedAt 倒序 / 未使用 createdAt 倒序
        const rank = (plan) => {
            if (teams.first && plan.id === teams.first) return 0;
            if (teams.second && plan.id === teams.second) return 1;
            return 2;
        };

        return list.slice().sort((a, b) => {
            const ra = rank(a);
            const rb = rank(b);
            if (ra !== rb) return ra - rb;

            const aUsed = a.lastUsedAt != null;
            const bUsed = b.lastUsedAt != null;
            if (aUsed !== bUsed) return aUsed ? -1 : 1;

            const ta = aUsed ? a.lastUsedAt : a.createdAt || 0;
            const tb = bUsed ? b.lastUsedAt : b.createdAt || 0;
            if (ta !== tb) return tb - ta;
            return byIdDesc(a, b);
        });
    },

    /** 防同毫秒连点产生并列：至少比现有最大值大 1 */
    nextUseTimestamp: () => {
        const maxUsed = plans.reduce(
            (max, plan) => Math.max(max, plan.lastUsedAt || 0),
            0
        );
        return Math.max(nowMillis(), maxUsed + 1);
    },

    pinFirst: (id) => {
        const plan = plans.find((item) => item.id === id);
        if (!plan) return false;

        // 进攻阵容 1 同时只能有一份：直接覆盖，原来的进攻阵容 1 自然回到普通徽章
        const current = loadTeams();
        current.first = plan.id;
        if (current.second === plan.id) current.second = null;
        saveTeams();

        // 只设置阵容标记，不自动更新 lastUsedAt（design.md：使用时间由用户手动标记）
        module.exports.commit();
        return true;
    },

    pinSecond: (id) => {
        const plan = plans.find((item) => item.id === id);
        if (!plan) return false;

        // 进攻阵容 2 同样只能有一份
        const current = loadTeams();
        current.second = plan.id;
        if (current.first === plan.id) current.first = null;
        saveTeams();

        // 只设置阵容标记，不自动更新 lastUsedAt（design.md：使用时间由用户手动标记）
        module.exports.commit();
        return true;
    },

    /**
     * 手动标记「进攻阵容 1 / 2」已使用：把这两个作业的 lastUsedAt 刷到当前时间。
     * 用来替代原来「置队 = 隐式使用」的副作用 —— 用户想"设为阵容"和"标记用过"分开。
     * 返回 { marked: 数字 } 表示成功标记了几条。
     */
    markUsed: () => {
        const teams = loadTeams();
        const ids = [teams.first, teams.second].filter(Boolean);
        if (!ids.length) return { marked: 0 };

        const timestamp = module.exports.nextUseTimestamp();
        let marked = 0;
        for (const id of ids) {
            const plan = plans.find((item) => item.id === id);
            if (plan) {
                // 阵容2 使用时间 = 阵容1 - 1；列表顺序由阵容标记决定（1 在前、2 在后）
                plan.lastUsedAt =
                    id === teams.first ? timestamp : timestamp - 1;
                marked++;
            }
        }

        if (marked > 0) module.exports.commit();
        return { marked };
    },

    /* ---------------- 判重 / 去重（design.md 10） ---------------- */

    dedupeKey: (plan) => {
        const members = plan.offense.members
            .slice()
            .sort(
                (a, b) =>
                    POSITIONS.indexOf(a.position) -
                    POSITIONS.indexOf(b.position)
            )
            .map((member) => ({
                heroId: member.heroId,
                position: member.position,
                imprintMode: member.imprintMode,
                ee: member.ee,
                artifactLevel: member.artifactLevel,
                requirement:
                    module.exports.requirementFingerprint(
                        member.requirement
                    ) || null,
            }));

        return stableStringify({
            defense: plan.defense.heroCodes.slice().sort(),
            members,
            defenseNote: plan.defenseNote,
            intel: plan.intel,
            strategy: plan.strategy,
        });
    },

    findDuplicate: (plan, excludeId) =>
        plans.find(
            (item) =>
                item.id !== excludeId &&
                module.exports.dedupeKey(item) ===
                    module.exports.dedupeKey(plan)
        ) || null,

    /* ---------------- 导入 / 导出（design.md 8 / 9） ---------------- */

    /** 导出前一概剔除使用痕迹（design.md 4.2-6） */
    stripUsage: (plan) => {
        const copy = clone(plan);
        if (copy) delete copy.lastUsedAt;
        return copy;
    },

    /**
     * 「配装器配置」指纹：剔除运行期字段 + 搜索偏好后做键顺序无关序列化。
     * 用来判断某个角色条目是不是就是作业里指定的那套配置（GVG 页下方列表 / 自动建条目）。
     */
    requirementFingerprint: (request) => {
        if (!request || typeof request !== 'object' || Array.isArray(request))
            return '';

        const copy = clone(request);
        for (const key of RUNTIME_REQUEST_KEYS) delete copy[key];
        delete copy.hero;
        delete copy.heroId;
        normalizeLimitFlags(copy);

        return Object.keys(copy).length ? stableStringify(copy) : '';
    },

    buildPackage: async () => {
        const entries = await module.exports.getHeroEntries();

        // 收集作业里用到的全部 heroId
        const usedIds = new Set();
        plans.forEach((plan) =>
            plan.offense.members.forEach((m) => usedIds.add(m.heroId))
        );

        const usedEntries = entries
            .filter((e) => usedIds.has(e.id))
            .map((e) => ({
                // 导出 entry 去掉 builds/equipment/items/modIds/mods
                id: e.id,
                name: e.name,
                index: e.index,
                rarity: e.rarity,
                stars: e.stars,
                attribute: e.attribute,
                role: e.role,
                artifactName: e.artifactName,
                artifactLevel: e.artifactLevel,
                artifactAttack: e.artifactAttack,
                artifactHealth: e.artifactHealth,
                artifactDefense: e.artifactDefense,
                imprintNumber: e.imprintNumber,
                eeNumber: e.eeNumber,
                optimizationRequest: e.optimizationRequest
                    ? clone(e.optimizationRequest)
                    : null,
            }));

        return {
            schema: PACKAGE_SCHEMA,
            schemaVersion: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            plans: module.exports.getSorted().map(module.exports.stripUsage),
            heroes: usedEntries,
        };
    },

    /**
     * 导入：raw 是 { plans, heroes }。heroes 里的每个 entry 要与本地现有 entries 匹配（按 name / artifact / imprint / ee / optReq），
     * 匹配成功则复用本地 id，否则创建新 entry（Api.addHero）。然后 plans 里 member.heroId 映射为本地 id。
     */
    importPlans: async (raw) => {
        const result = {
            added: 0,
            duplicates: 0,
            invalid: 0,
            heroesImported: 0,
        };

        if (!raw || typeof raw !== 'object') return result;
        if (!Array.isArray(raw.plans)) return result;

        // 1. 先同步 heroes
        const currentEntries = await module.exports.getHeroEntries();
        const incomingHeroes = Array.isArray(raw.heroes) ? raw.heroes : [];

        // incomingHeroes → 本地 id 映射
        const heroIdMap = new Map(); // incomingId → localId

        for (const incoming of incomingHeroes) {
            // 尝试匹配现有 entry
            const matched = currentEntries.find((local) => {
                if (local.name !== incoming.name) return false;
                if (local.artifactName !== incoming.artifactName) return false;
                if (
                    local.imprintNumber !== incoming.imprintNumber &&
                    !(
                        local.imprintNumber == null &&
                        incoming.imprintNumber == null
                    )
                )
                    return false;
                if (local.eeNumber !== incoming.eeNumber) return false;
                // optReq 剔除 executionId 后比对
                const localReq = module.exports.requirementFingerprint(
                    local.optimizationRequest
                );
                const incReq = module.exports.requirementFingerprint(
                    incoming.optimizationRequest
                );
                return localReq === incReq;
            });

            if (matched) {
                heroIdMap.set(incoming.id, matched.id);
            } else {
                // 新建
                try {
                    if (
                        typeof Api !== 'undefined' &&
                        typeof Api.addHero === 'function'
                    ) {
                        const newEntry = await Api.addHero({
                            name: incoming.name,
                            artifactName: incoming.artifactName,
                            artifactLevel: incoming.artifactLevel,
                            artifactAttack: incoming.artifactAttack || 0,
                            artifactHealth: incoming.artifactHealth || 0,
                            artifactDefense: incoming.artifactDefense || 0,
                            imprintNumber: incoming.imprintNumber || 'None',
                            eeNumber: incoming.eeNumber || 'None',
                            stars: incoming.stars || 6,
                            rarity: incoming.rarity || 5,
                            attribute: incoming.attribute,
                            role: incoming.role,
                        });
                        if (newEntry && newEntry.id) {
                            heroIdMap.set(incoming.id, newEntry.id);
                            result.heroesImported++;
                        }
                    }
                } catch (e) {
                    console.warn(
                        'GVG: failed to import hero entry',
                        incoming.name,
                        e
                    );
                }
            }
        }

        // 2. 处理 plans
        const seenKeys = new Set(plans.map(module.exports.dedupeKey));
        const incoming = [];

        for (const rawPlan of raw.plans) {
            // 把 member.heroId 从 incoming id 映射为 local id
            const mapped = clone(rawPlan);
            if (mapped.offense && Array.isArray(mapped.offense.members)) {
                for (const member of mapped.offense.members) {
                    if (member.heroId && heroIdMap.has(member.heroId)) {
                        member.heroId = heroIdMap.get(member.heroId);
                    }
                }
            }

            const normalized = module.exports.normalizePlan(mapped);
            if (!normalized) {
                result.invalid++;
                continue;
            }

            const key = module.exports.dedupeKey(normalized);
            if (seenKeys.has(key)) {
                result.duplicates++;
                continue;
            }

            seenKeys.add(key);
            normalized.id = uuidv4();
            normalized.createdAt = nowMillis();
            normalized.lastUsedAt = null;
            incoming.push(normalized);
            result.added++;
        }

        if (incoming.length) {
            plans = plans.concat(incoming);
            module.exports.commit();
        }
        return result;
    },

    parsePackage: (text) => {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            return { error: 'invalidJson' };
        }

        if (!parsed || parsed.schema !== PACKAGE_SCHEMA)
            return { error: 'invalidSchema' };
        if (Number(parsed.schemaVersion) !== SCHEMA_VERSION)
            return { error: 'unsupportedVersion' };
        if (!Array.isArray(parsed.plans)) return { error: 'invalidSchema' };

        return parsed;
    },

    encodeText: (plan) => {
        const payload = JSON.stringify(module.exports.stripUsage(plan));
        return (
            CLIPBOARD_PREFIX +
            zlib.deflateRawSync(Buffer.from(payload, 'utf8')).toString('base64')
        );
    },

    /** 失败时返回 {error: 'invalidPrefix' | 'unsupportedVersion' | 'badPayload'} */
    decodeText: (text) => {
        const trimmed = asString(text).trim();
        if (!trimmed) return { error: 'badPayload' };

        if (!trimmed.startsWith('E7GVG')) return { error: 'invalidPrefix' };
        if (!trimmed.startsWith(CLIPBOARD_PREFIX))
            return { error: 'unsupportedVersion' };

        try {
            const raw = zlib.inflateRawSync(
                Buffer.from(trimmed.slice(CLIPBOARD_PREFIX.length), 'base64')
            );
            return { plans: [JSON.parse(raw.toString('utf8'))] };
        } catch (error) {
            return { error: 'badPayload' };
        }
    },

    /* ---------------- 规范化（唯一的入口校验） ---------------- */

    /** 返回规范化后的作业；无法修复时返回 null */
    normalizePlan: (raw) => {
        try {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                return null;

            const defense = normalizeDefense(raw.defense);
            const members = normalizeMembers(raw.offense);
            if (!defense || !members) return null;

            const id = asString(raw.id).trim() || uuidv4();
            // null/undefined 不能先 Number() 再 isFinite：Number(null) = 0，会被当成 1970 年的时间戳
            const createdValue =
                raw.createdAt != null ? Number(raw.createdAt) : NaN;
            const createdAt = Number.isFinite(createdValue)
                ? createdValue
                : nowMillis();
            const lastUsedValue =
                raw.lastUsedAt != null ? Number(raw.lastUsedAt) : NaN;
            const lastUsedAt = Number.isFinite(lastUsedValue)
                ? lastUsedValue
                : null;

            return {
                schemaVersion: SCHEMA_VERSION,
                id,
                createdAt,
                lastUsedAt,
                defense,
                offense: { members },
                equipOrder: normalizeEquipOrder(raw.equipOrder),
                defenseNote: asString(raw.defenseNote),
                intel: asString(raw.intel),
                strategy: asString(raw.strategy),
            };
        } catch (error) {
            console.warn('GVG: unable to normalize plan', error, raw);
            return null;
        }
    },

    /* ---------------- 副作用出口 ---------------- */

    commit: () => {
        // 合并短时间内的多次存档：置队一次会触发好几处 save，每次都要拉全量
        // heroes + items 再写 3~4MB JSON，是卡顿的主要来源之一
        try {
            if (global.Saves && typeof Saves.autoSaveSoon === 'function') {
                Saves.autoSaveSoon();
            } else if (global.Saves && typeof Saves.autoSave === 'function') {
                Saves.autoSave();
            }
        } catch (error) {
            console.warn('GVG: auto save failed', error);
        }
        try {
            if (global.GvgTab && typeof GvgTab.redraw === 'function')
                GvgTab.redraw();
        } catch (error) {
            console.warn('GVG: redraw failed', error);
        }
    },
};

/* ------------------------------------------------------------------ *
 * 内部规范化
 * ------------------------------------------------------------------ */

function normalizeDefense(rawDefense) {
    const codes = rawDefense && (rawDefense.heroCodes || rawDefense.codes);
    const list = Array.isArray(codes)
        ? codes.map((code) => asString(code).trim())
        : Array.isArray(rawDefense)
        ? rawDefense.map((code) => asString(code).trim())
        : null;

    if (!list || list.length !== 3) return null;
    if (list.some((code) => !code || !module.exports.isKnownHeroCode(code)))
        return null;
    if (new Set(list).size !== 3) return null;

    // 按 code 排序存，确保同一防守阵容不论录入顺序如何都落到同一份记录
    list.sort();
    return { heroCodes: list };
}

function normalizeMembers(rawOffense) {
    const rawMembers = rawOffense && rawOffense.members;
    if (!Array.isArray(rawMembers) || rawMembers.length !== 3) return null;

    const members = [];
    for (const rawMember of rawMembers) {
        if (!rawMember || typeof rawMember !== 'object') return null;

        const heroId = asString(rawMember.heroId).trim();
        if (!heroId) return null;

        const position = asString(rawMember.position).trim();
        if (!POSITIONS.includes(position)) return null;

        const imprintMode = rawMember.imprintMode === 'team' ? 'team' : 'self';
        const ee = normalizeEe(rawMember.ee);
        const artifactLevel = asIntegerOrNull(rawMember.artifactLevel, 0, 30) ?? 0;
        const requirement = normalizeRequirement(rawMember.requirement);

        members.push({
            heroId,
            heroCode: asString(rawMember.heroCode).trim(),
            position,
            imprintMode,
            ee,
            artifactLevel,
            requirement,
        });
    }

    // 同一 heroId 不允许出现在进攻阵容两次
    if (new Set(members.map((member) => member.heroId)).size !== 3)
        return null;
    if (new Set(members.map((member) => member.position)).size !== 3)
        return null;

    members.sort(
        (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)
    );
    return members;
}

/**
 * 专属装备要求（不配数值，只配"有没有 / 哪个变体"）：
 *   - none：不带专属
 *   - any ：带专属即可（只有"光暗 + 5★"是这种，没有 Ⅰ/Ⅱ/Ⅲ 之分）
 *   - 1/2/3：其余角色（三色，以及光暗的 3★ / 4★）的 Ⅰ / Ⅱ / Ⅲ 变体
 */
const EE_VALUES = ['none', 'any', '1', '2', '3'];

function normalizeEe(rawEe) {
    if (rawEe == null || rawEe === '') return 'none';

    // 兼容 { mode, variant } 写法
    if (typeof rawEe === 'object') {
        if (rawEe.mode === 'any' || rawEe.mode === 'has') return 'any';
        if (rawEe.variant != null && EE_VALUES.includes(String(rawEe.variant)))
            return String(rawEe.variant);
        return rawEe.mode === 'none' ? 'none' : 'none';
    }

    const value = asString(rawEe).trim();
    return EE_VALUES.includes(value) ? value : 'none';
}

/** 面板要求：深拷贝 + 剔除运行期字段（design.md 4.3） */
function normalizeRequirement(rawRequirement) {
    if (
        !rawRequirement ||
        typeof rawRequirement !== 'object' ||
        Array.isArray(rawRequirement)
    )
        return null;

    const copy = clone(rawRequirement);
    for (const key of RUNTIME_REQUEST_KEYS) delete copy[key];
    return Object.keys(copy).length ? copy : null;
}

function normalizeEquipOrder(rawOrder) {
    if (!Array.isArray(rawOrder) || rawOrder.length !== 3) return [0, 1, 2];

    const order = rawOrder.map((value) => Math.round(Number(value)));
    if (
        order.some((value) => !Number.isFinite(value) || value < 0 || value > 2)
    )
        return [0, 1, 2];
    if (new Set(order).size !== 3) return [0, 1, 2];
    return order;
}
