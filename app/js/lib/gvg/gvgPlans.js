/**
 * GVG 作业（plan）数据层 —— 对标 docs/gvg/design.md 第 4 / 6.4 / 10 / 11 节。
 *
 * 职责边界：
 *   - 只做数据：规范化 / 校验 / 排序 / 置队 / 判重 / 去重 / 压缩编解码 / 导出包
 *   - 不碰 DOM：改完数据统一走 commit()，由 commit 触发自动保存和列表重绘
 *   - 作业是自包含的：不引用角色条目、不存本机 hero.id
 */
const { v4: uuidv4 } = require('uuid');
const zlib = require('zlib');

const SCHEMA_VERSION = 1;
const PACKAGE_SCHEMA = 'e7-gvg-plans';
const CLIPBOARD_PREFIX = 'E7GVG1:';

/* 站位展示顺序：前 → 下 → 上 → 后（design.md 6.2） */
const POSITIONS = ['front', 'bottom', 'top', 'back'];

/* 运行期字段：不是「面板要求」的一部分，跨账号/跨设备会算错（design.md 4.3） */
const RUNTIME_REQUEST_KEYS = [
    'excludeFilter',
    'inputAllowEquippedItems',
    'inputPredictReforges',
    'excludedGearIds',
];

let plans = [];
let heroCodeToName = null;

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

function asIntegerOrNull(value, min, max) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const rounded = Math.round(number);
    if (rounded < min || rounded > max) return null;
    return rounded;
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

module.exports = {
    SCHEMA_VERSION,
    PACKAGE_SCHEMA,
    CLIPBOARD_PREFIX,
    POSITIONS,

    /* ---------------- 读取 ---------------- */

    getAll: () => clone(plans),

    getSorted: () => module.exports.sortPlans(clone(plans)),

    getById: (id) => clone(plans.find((plan) => plan.id === id) || null),

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

    /** 列表里的全部英雄（按 i18n 名排序），编辑弹窗的下拉用 */
    getAllHeroOptions: () => {
        const index = heroIndex();
        return Object.keys(index)
            .map((code) => ({
                code,
                name: index[code],
                label: i18next.t(index[code]),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    },

    /** 列表筛选框的选项：只列作业里出现过的防守英雄（design.md 6.3） */
    getDefenseFilterOptions: () => {
        const index = heroIndex();
        const codes = new Set();
        plans.forEach((plan) =>
            plan.defense.heroCodes.forEach((code) => codes.add(code))
        );

        return [...codes]
            .map((code) => ({
                code,
                name: index[code] || code,
                label: i18next.t(index[code] || code),
            }))
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
            normalized.updatedAt = nowMillis();
            normalized.lastUsedAt = plans[existingIndex].lastUsedAt;
            plans[existingIndex] = normalized;
        } else {
            normalized.createdAt = nowMillis();
            normalized.updatedAt = nowMillis();
            normalized.lastUsedAt = null;
            plans.push(normalized);
        }

        module.exports.commit();
        return normalized;
    },

    remove: (id) => {
        const before = plans.length;
        plans = plans.filter((plan) => plan.id !== id);
        if (plans.length !== before) module.exports.commit();
        return before !== plans.length;
    },

    clear: () => {
        plans = [];
        module.exports.commit();
    },

    /* ---------------- 排序 / 一队二队（design.md 6.4） ---------------- */

    sortPlans: (list) => {
        const byIdDesc = (a, b) => (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
        const used = list
            .filter((plan) => plan.lastUsedAt != null)
            .sort((a, b) => b.lastUsedAt - a.lastUsedAt || byIdDesc(a, b));
        const unused = list
            .filter((plan) => plan.lastUsedAt == null)
            .sort((a, b) => b.updatedAt - a.updatedAt || byIdDesc(a, b));

        return used.concat(unused);
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

        plan.lastUsedAt = module.exports.nextUseTimestamp();
        module.exports.commit();
        return true;
    },

    pinSecond: (id) => {
        const plan = plans.find((item) => item.id === id);
        if (!plan) return false;

        const timestamp = module.exports.nextUseTimestamp();
        const sorted = module.exports.sortPlans(plans);
        const first = sorted[0];
        // 先把"该留在第一位的"刷到 timestamp：通常就是当前第一条；
        // 如果点的正是第一条，则把当前第二条顶上去，保证这条一定落到第二位。
        const anchor = first && first.id === plan.id ? sorted[1] : first;
        if (anchor && anchor.id !== plan.id) {
            anchor.lastUsedAt = timestamp;
        }
        plan.lastUsedAt = timestamp - 1;

        module.exports.commit();
        return true;
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
                heroCode: member.heroCode,
                position: member.position,
                artifact: member.artifact
                    ? {
                          name: member.artifact.name,
                          minLevel: member.artifact.minLevel,
                      }
                    : null,
                imprintMode: member.imprintMode,
                requirement: member.requirement || null,
            }));

        return stableStringify({
            defense: plan.defense.heroCodes.slice().sort(),
            members,
            tags: plan.tags,
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

    /** 保留 updatedAt 较早的那条；被删副本的 lastUsedAt 更晚时继承给保留者 */
    dedupe: () => {
        const groups = new Map();
        for (const plan of plans) {
            const key = module.exports.dedupeKey(plan);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(plan);
        }

        const survivors = [];
        for (const group of groups.values()) {
            if (group.length === 1) {
                survivors.push(group[0]);
                continue;
            }

            const ordered = group
                .slice()
                .sort(
                    (a, b) =>
                        a.updatedAt - b.updatedAt ||
                        (a.createdAt || 0) - (b.createdAt || 0) ||
                        (a.id < b.id ? -1 : 1)
                );
            const keeper = ordered[0];
            const latestUse = group.reduce(
                (max, plan) =>
                    plan.lastUsedAt != null &&
                    (max == null || plan.lastUsedAt > max)
                        ? plan.lastUsedAt
                        : max,
                null
            );
            if (latestUse != null) keeper.lastUsedAt = latestUse;
            survivors.push(keeper);
        }

        const removed = plans.length - survivors.length;
        if (removed > 0) {
            plans = survivors;
            module.exports.commit();
        }
        return removed;
    },

    /* ---------------- 导入 / 导出（design.md 8 / 9） ---------------- */

    /** 导出前一概剔除使用痕迹（design.md 4.2-6） */
    stripUsage: (plan) => {
        const copy = clone(plan);
        if (copy) delete copy.lastUsedAt;
        return copy;
    },

    buildPackage: () => ({
        schema: PACKAGE_SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        plans: module.exports.getSorted().map(module.exports.stripUsage),
    }),

    /**
     * 导入/粘贴的统一入口：一律新 id、updatedAt = 现在、lastUsedAt = null；
     * 与现有作业重复（design.md 10 口径）则跳过并计数。
     */
    importPlans: (rawList) => {
        const result = { added: 0, duplicates: 0, invalid: 0 };
        const seenKeys = new Set(plans.map(module.exports.dedupeKey));
        const incoming = [];

        for (const raw of Array.isArray(rawList) ? rawList : []) {
            const normalized = module.exports.normalizePlan(raw);
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
            normalized.updatedAt = nowMillis();
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

        return { plans: parsed.plans };
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
            const createdAt = Number.isFinite(Number(raw.createdAt))
                ? Number(raw.createdAt)
                : nowMillis();
            const updatedAt = Number.isFinite(Number(raw.updatedAt))
                ? Number(raw.updatedAt)
                : createdAt;
            const lastUsedAt = Number.isFinite(Number(raw.lastUsedAt))
                ? Number(raw.lastUsedAt)
                : null;

            return {
                schemaVersion: SCHEMA_VERSION,
                id,
                createdAt,
                updatedAt,
                lastUsedAt,
                defense,
                offense: { members },
                equipOrder: normalizeEquipOrder(raw.equipOrder),
                tags: normalizeTags(raw.tags),
                defenseNote: asString(raw.defenseNote),
                intel: asString(raw.intel),
                strategy: asString(raw.strategy),
            };
        } catch (error) {
            console.warn('GVG: unable to normalize plan', error, raw);
            return null;
        }
    },

    /** 派生标签 + 用户标签，按 design.md 第 5 节的优先级拼好 */
    displayTags: (plan) => {
        const tags = [];
        if (asString(plan.defenseNote).trim())
            tags.push(i18next.t('Depends on defense positions'));
        tags.push(
            i18next.t(
                asString(plan.intel).trim() ? 'Intel blade' : 'Scout blade'
            )
        );
        plan.tags.forEach((tag) => tags.push(tag));
        return tags;
    },

    /* ---------------- 副作用出口 ---------------- */

    commit: () => {
        try {
            if (global.Saves && typeof Saves.autoSave === 'function')
                Saves.autoSave();
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

    return { heroCodes: list };
}

function normalizeMembers(rawOffense) {
    const rawMembers = rawOffense && rawOffense.members;
    if (!Array.isArray(rawMembers) || rawMembers.length !== 3) return null;

    const members = [];
    for (const rawMember of rawMembers) {
        if (!rawMember || typeof rawMember !== 'object') return null;

        const heroCode = asString(rawMember.heroCode || rawMember.code).trim();
        if (!heroCode || !module.exports.isKnownHeroCode(heroCode)) return null;

        const position = asString(rawMember.position).trim();
        if (!POSITIONS.includes(position)) return null;

        members.push({
            heroCode,
            name:
                module.exports.heroNameForCode(heroCode) ||
                asString(rawMember.name),
            position,
            artifact: normalizeArtifact(rawMember.artifact),
            imprintMode: rawMember.imprintMode === 'team' ? 'team' : 'self',
            requirement: normalizeRequirement(rawMember.requirement),
        });
    }

    if (new Set(members.map((member) => member.heroCode)).size !== 3)
        return null;
    if (new Set(members.map((member) => member.position)).size !== 3)
        return null;

    // 列表按站位顺序存，渲染不需要再排（design.md 4.2）
    members.sort(
        (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)
    );
    return members;
}

/** 神器可留空（= 无要求）；等级是阈值，0~30 整数（design.md 4.2） */
function normalizeArtifact(rawArtifact) {
    if (!rawArtifact || typeof rawArtifact !== 'object') return null;

    const name = asString(rawArtifact.name).trim();
    if (!name) return null;

    const minLevel = asIntegerOrNull(rawArtifact.minLevel, 0, 30);
    return { name, minLevel: minLevel == null ? 0 : minLevel };
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

function normalizeTags(rawTags) {
    if (!Array.isArray(rawTags)) return [];

    const tags = [];
    for (const rawTag of rawTags) {
        const tag = asString(rawTag).trim();
        if (tag && !tags.includes(tag)) tags.push(tag);
    }
    return tags;
}
