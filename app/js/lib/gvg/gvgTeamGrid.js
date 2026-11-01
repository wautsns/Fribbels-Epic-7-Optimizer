/**
 * 进攻阵容 1 / 2 对应的「角色条目」计算（不再画自己的表格）。
 *
 * 只认进攻阵容 1、2 的成员所对应的角色条目：
 *   - 条目的「配装器配置」（optimizationRequest）与作业成员的要求一致才算同一个条目
 *   - 神器的 code（等级是下限）、专属的有 / 无也要对得上
 *   - 没有这样的条目时不自动新建：pin 进攻阵容 1 / 2 时由 GvgTab 先提示，
 *     用户确认后再调用 createMissingEntries() 批量新建
 *     （神器 + 等级按作业填、阵型自阵取最高档、选专属时取最高数值、星级默认 6）
 *
 * 算出来的条目 id 交给 HeroesGrid.setTeamFilter()，英雄列表就只显示这几个角色。
 */
/* e7 的属性 key → 英雄信息里的 aei* 字段（和 HeroesTab 的口径一致） */
const E7_STAT_TO_BONUS = {
    att_rate: 'aeiAttackPercent',
    max_hp_rate: 'aeiHealthPercent',
    def_rate: 'aeiDefensePercent',
    att: 'aeiAttack',
    max_hp: 'aeiHealth',
    def: 'aeiDefense',
    speed: 'aeiSpeed',
    res: 'aeiEffectResistance',
    cri: 'aeiCritChance',
    cri_dmg: 'aeiCritDamage',
    acc: 'aeiEffectiveness',
    coop: 'aeiDualAttackChance',
};

const FLAT_STATS = ['max_hp', 'speed', 'att', 'def'];

module.exports = {
    /**
     * 把「进攻阵容成员对应的角色条目」同步成英雄列表的筛选条件。
     * 没有进攻阵容 1 / 2 时清除筛选（英雄列表恢复全量）。
     */
    syncHeroFilter: async () => {
        const rows = await collectTeamRows();
        const ids = rows.map((row) => row.hero.id);

        try {
            HeroesGrid.setTeamFilter(ids.length ? ids : null);
        } catch (error) {
            console.warn('GVG: unable to filter the hero list', error);
        }

        return ids;
    },

    /** 当前进攻阵容 1 / 2 命中的角色条目（调试 / 测试用） */
    getTeamHeroIds: async () => {
        const rows = await collectTeamRows();
        return rows.map((row) => row.hero.id);
    },

    /**
     * 当前进攻阵容 1 / 2 里还缺哪些角色条目（只查不建）。
     * 返回 [{ team, plan, member, heroName }]，同一份作业里重复的只保留一条。
     */
    findMissingEntries: async () => {
        const members = collectTeamMembers();
        if (!members.length) return [];

        const heroes = await loadHeroes();
        if (!heroes) return [];

        const missing = [];
        const seen = new Set();

        for (const entry of members) {
            if (heroes.some((hero) => matchesMember(hero, entry.member)))
                continue;

            const key = `${heroNameOf(
                entry.member
            )}|${GvgPlans.requirementFingerprint(entry.member.requirement)}`;
            if (seen.has(key)) continue;
            seen.add(key);

            missing.push({ ...entry, heroName: heroNameOf(entry.member) });
        }

        return missing;
    },

    /** 用户确认后批量新建缺失的角色条目，然后重新同步英雄列表筛选 */
    createMissingEntries: async (missing) => {
        const created = [];

        for (const entry of missing || []) {
            const hero = await createEntryFor(entry.member);
            if (hero) created.push(hero);
        }

        // 新建的角色条目要进「配装器」的英雄下拉，否则从英雄列表双击打开配装器时
        // 下拉里没有这个 id，选不中 → 配置带不过去（和 heroesTab.addHero 的做法一致）
        if (created.length) {
            try {
                if (
                    typeof HeroesTab !== 'undefined' &&
                    typeof HeroesTab.redrawHeroInputSelector === 'function'
                ) {
                    HeroesTab.redrawHeroInputSelector();
                }
            } catch (error) {
                console.warn('GVG: unable to refresh the hero selector', error);
            }
        }

        await module.exports.syncHeroFilter();

        // 新建的条目也要立刻出现在英雄列表里（否则筛选生效时列表还是旧数据）
        if (created.length) {
            try {
                if (typeof HeroesTab !== 'undefined' && HeroesTab.redraw) {
                    HeroesTab.redraw();
                }
            } catch (error) {
                console.warn('GVG: unable to redraw the hero list', error);
            }
        }

        // 兜底自查：建完还对不上说明字段口径有问题（正常不会出现）
        const still = await module.exports.findMissingEntries();
        if (still.length) {
            console.warn(
                '[GVG] hero entries still unmatched after creation:',
                still.map((entry) => entry.heroName)
            );
        }

        return created;
    },

    /* 导出给测试脚本用 */
    highestImprint,
    highestEe,
};

/* ------------------------------------------------------------------ *
 * 收集成员 → 找条目
 * ------------------------------------------------------------------ */

/** 进攻阵容 1 / 2 的成员摊平成一个列表（同一份作业被两边同时选中时只算一次） */
function collectTeamMembers() {
    const teams = GvgPlans.getTeams();
    const members = [];
    const seenPlans = new Set();

    [
        ['first', teams.first, '1'],
        ['second', teams.second, '2'],
    ].forEach(([slot, planId, teamLabel]) => {
        if (!planId || seenPlans.has(planId)) return;
        const plan = GvgPlans.getById(planId);
        if (!plan) return;
        seenPlans.add(planId);

        plan.offense.members.forEach((member) => {
            if (!member.heroCode) return;
            members.push({ team: teamLabel, plan, member });
        });
    });

    return members;
}

async function loadHeroes() {
    try {
        const response = await Api.getAllHeroes();
        return (response && response.heroes) || [];
    } catch (error) {
        console.warn('GVG: unable to load the hero list', error);
        return null;
    }
}

async function collectTeamRows() {
    const members = collectTeamMembers();
    if (!members.length) return [];

    const heroes = await loadHeroes();
    if (!heroes) return [];

    const rows = [];
    for (const entry of members) {
        const hero = heroes.find((item) => matchesMember(item, entry.member));
        if (!hero) continue;

        rows.push({
            team: entry.team,
            planId: entry.plan.id,
            hero,
            member: entry.member,
        });
    }

    return rows;
}

function heroNameOf(member) {
    return GvgPlans.heroNameForCode(member.heroCode);
}

/** 同名 + 神器 code 一致 + 专属有无一致 + 同一套配装器配置（没指定配置时只要求同名） */
function matchesMember(hero, member) {
    if (!hero || hero.name !== heroNameOf(member)) return false;
    if (!matchesArtifact(hero, member)) return false;
    if (!matchesEe(hero, member)) return false;

    const wanted = GvgPlans.requirementFingerprint(member.requirement);
    if (!wanted) return true;

    return GvgPlans.requirementFingerprint(hero.optimizationRequest) === wanted;
}

/**
 * 神器：作业里存 code（`artifactdata` 里的官方 id），角色条目里只有名字 → 名字解析成 code 再比，
 * 不比神器名字；等级是下限（`minLevel`）。
 */
function matchesArtifact(hero, member) {
    const artifact = member.artifact;
    if (!artifact || !artifact.code) return true;

    const heroName = hero.artifactName;
    if (!heroName || heroName === 'None') return false;

    if (GvgPlans.artifactCodeForName(heroName) !== artifact.code) return false;

    const level = Number(hero.artifactLevel);
    if (!Number.isFinite(level)) return false;

    return level >= (Number(artifact.minLevel) || 0);
}

/**
 * 专属：只比"有没有"，不比数值也不比 Ⅰ / Ⅱ / Ⅲ —— 角色信息里三者没有区别。
 */
function matchesEe(hero, member) {
    const wanted = member.ee || 'none';
    const has = heroHasEe(hero);

    return wanted === 'none' ? !has : has;
}

function heroHasEe(hero) {
    const raw = hero && hero.eeNumber;
    if (raw == null || raw === '' || raw === 'None') return false;

    return Number(raw) > 0;
}

/** 新建角色条目：神器+等级、阵型最高档、专属最高数值、星级 6 */
async function createEntryFor(member) {
    const heroName = heroNameOf(member);
    if (!heroName) return null;

    const base = HeroesTab.getNewHeroByName(heroName);
    if (!base) return null;

    const heroInfo = base.data;
    const hero = {
        ...base,
        rarity: heroInfo.rarity,
        attribute: heroInfo.attribute,
        role: heroInfo.role,
        path: heroName,
        stars: 6,
    };

    try {
        await Api.addHeroes([hero]);
    } catch (error) {
        console.warn('GVG: unable to create the hero entry', error);
        return null;
    }

    const bonusStats = buildBonusStats(member, heroInfo);
    try {
        await Api.setBonusStats(bonusStats, hero.id);
    } catch (error) {
        console.warn('GVG: unable to save the hero bonus stats', error);
    }

    if (member.requirement) {
        try {
            await Api.saveOptimizationRequest({
                ...JSON.parse(JSON.stringify(member.requirement)),
                hero: { id: hero.id },
            });
        } catch (error) {
            console.warn(
                'GVG: unable to save the requirement on the new entry',
                error
            );
        }
    }

    console.info('[GVG] created hero entry for', heroName, 'team', member.position);

    try {
        const response = await Api.getHeroById(hero.id);
        const createdHero = (response && response.hero) || null;

        // 兜底：要求没存进去的话，双击进配装器会看到一片空白，这里先留个日志
        if (createdHero && member.requirement && !createdHero.optimizationRequest) {
            console.warn(
                '[GVG] the new hero entry kept no optimization request',
                heroName,
                hero.id
            );
        }

        return createdHero;
    } catch (error) {
        return null;
    }
}

/** 和英雄信息弹窗同样的 AEI 口径：神器 / 阵型 / 专属 都折算进 aei* */
function buildBonusStats(member, heroInfo) {
    const stats = {
        attack: 0,
        defense: 0,
        health: 0,
        attackPercent: 0,
        defensePercent: 0,
        healthPercent: 0,
        speed: 0,
        critChance: 0,
        critDamage: 0,
        effectiveness: 0,
        effectResistance: 0,
        finalAtkMultiplier: 0,
        finalDefMultiplier: 0,
        finalHpMultiplier: 0,

        aeiAttack: 0,
        aeiDefense: 0,
        aeiHealth: 0,
        aeiAttackPercent: 0,
        aeiDefensePercent: 0,
        aeiHealthPercent: 0,
        aeiSpeed: 0,
        aeiCritChance: 0,
        aeiCritDamage: 0,
        aeiEffectiveness: 0,
        aeiEffectResistance: 0,

        artifactName: 'None',
        artifactLevel: 'None',
        artifactAttack: 0,
        artifactHealth: 0,
        artifactDefense: 0,

        imprintNumber: 'None',
        eeNumber: 'None',
        stars: 6,
        ee: (heroInfo.ex_equip && heroInfo.ex_equip[0]) || null,
        heroInfo,
    };

    // 神器 + 等级（作业里存 code，角色条目只认名字；等级配的是阈值，直接当作等级）
    const artifact = member.artifact;
    const artifactName = artifact
        ? artifact.name || GvgPlans.artifactNameForCode(artifact.code)
        : null;
    if (artifactName) {
        const level = Math.max(0, Math.min(30, Number(artifact.minLevel) || 0));
        stats.artifactName = artifactName;
        stats.artifactLevel = String(level);

        try {
            const artifactStats = Artifact.getStats(artifactName, level);
            stats.aeiHealth += artifactStats.health;
            stats.aeiAttack += artifactStats.attack;
            stats.aeiDefense += artifactStats.defense;
            stats.artifactHealth = artifactStats.health;
            stats.artifactAttack = artifactStats.attack;
            stats.artifactDefense = artifactStats.defense;
        } catch (error) {
            console.warn('GVG: unable to read the artifact stats', error);
        }
    }

    // 阵型：自阵时取最高档数值（群阵不加自阵加成）
    if (member.imprintMode !== 'team') {
        const imprint = highestImprint(heroInfo);
        if (imprint != null) {
            stats.imprintNumber = String(imprint);
            const type = heroInfo.self_devotion && heroInfo.self_devotion.type;
            const key = E7_STAT_TO_BONUS[type];
            if (key && stats[key] != null) stats[key] += imprint;
        }
    }

    // 专属：有要求时取最高数值
    if (member.ee && member.ee !== 'none') {
        const ee = highestEe(heroInfo);
        if (ee) {
            stats.eeNumber = String(ee.value);
            const key = E7_STAT_TO_BONUS[ee.type];
            if (key && stats[key] != null) stats[key] += ee.value;
        }
    }

    return stats;
}

/** self_devotion 的最高档数值（按弹窗的显示口径：非白值 ×100 取一位小数） */
function highestImprint(heroInfo) {
    const devotion = heroInfo && heroInfo.self_devotion;
    if (!devotion || !devotion.grades) return null;

    const isFlat = FLAT_STATS.includes(devotion.type);
    const values = Object.keys(devotion.grades)
        .map((grade) =>
            isFlat
                ? devotion.grades[grade]
                : Utils.round10ths(devotion.grades[grade] * 100)
        )
        .filter((value) => Number.isFinite(value));

    return values.length ? Math.max(...values) : null;
}

/** ex_equip 的最高数值：白值 → 原值，百分比 → ×100；最高 = 基础 × 2 */
function highestEe(heroInfo) {
    const ee = heroInfo && heroInfo.ex_equip && heroInfo.ex_equip[0];
    if (!ee || !ee.stat) return null;

    const isFlat = FLAT_STATS.includes(ee.stat.type);
    const base = isFlat ? ee.stat.value : Math.round(ee.stat.value * 100);

    return { type: ee.stat.type, value: base * 2 };
}
