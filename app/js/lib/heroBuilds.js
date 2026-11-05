/* global Files, Api, Artifact, HeroData, Notifier, OptimizerTab, Saves, $ */
const fs = require('fs');
const Path = require('path');
const https = require('https');
const Swal = require('sweetalert2');

// fribbels hero-library 的配装数据接口
const BUILDS_API =
    'https://krivpfvxi0.execute-api.us-west-2.amazonaws.com/dev/getBuilds';
const CACHE_DIR = 'cache/heroBuilds';
const REQUEST_TIMEOUT = 90000;

// 分析用的面板属性
//   density : 参与 6 维密度计算
//   snap    : 取整粒度（攻击/防御/生命用）
//   picks   : 只允许取这组"常见阈值"里最接近的一个
//   requestKey / configuredKey : 保存到英雄 optimizationRequest 时的字段名
const STATS = [
    {
        key: 'atk',
        zh: '攻击',
        snap: 100,
        inputId: 'inputMinAtkLimit',
        requestKey: 'inputAtkMinLimit',
        configuredKey: 'inputAtkMinConfigured',
        density: true,
    },
    {
        key: 'hp',
        zh: '生命',
        snap: 100,
        inputId: 'inputMinHpLimit',
        requestKey: 'inputHpMinLimit',
        configuredKey: 'inputHpMinConfigured',
        density: true,
    },
    {
        key: 'def',
        zh: '防御',
        snap: 50,
        inputId: 'inputMinDefLimit',
        requestKey: 'inputDefMinLimit',
        configuredKey: 'inputDefMinConfigured',
        density: true,
    },
    {
        key: 'spd',
        zh: '速度',
        snap: 5,
        round: 'up',
        inputId: 'inputMinSpdLimit',
        requestKey: 'inputSpdMinLimit',
        configuredKey: 'inputSpdMinConfigured',
        density: true,
    },
    {
        key: 'chc',
        zh: '暴击率',
        picks: [100, 88, 85, 73, 70, 50],
        zeroBelow: 30,
        inputId: 'inputMinCrLimit',
        requestKey: 'inputCrMinLimit',
        configuredKey: 'inputCrMinConfigured',
        density: true,
    },
    {
        key: 'chd',
        zh: '爆伤',
        snap: 5,
        min: 170,
        inputId: 'inputMinCdLimit',
        requestKey: 'inputCdMinLimit',
        configuredKey: 'inputCdMinConfigured',
        density: true,
    },
    {
        key: 'eff',
        zh: '效果命中',
        picks: [0, 50, 85, 100, 130, 150, 185, 200],
        snapOver: [200, 5],
        inputId: 'inputMinEffLimit',
        requestKey: 'inputEffMinLimit',
        configuredKey: 'inputEffMinConfigured',
        density: false,
    },
    {
        key: 'efr',
        zh: '效果抗性',
        picks: [0, 50, 85, 100, 130, 150, 185, 200],
        snapOver: [200, 5],
        inputId: 'inputMinResLimit',
        requestKey: 'inputResMinLimit',
        configuredKey: 'inputResMinConfigured',
        density: false,
    },
];

const DENSITY_STATS = STATS.filter((stat) => stat.density);

const STAT_LIMIT_IDS = [
    'inputMinAtkLimit',
    'inputMaxAtkLimit',
    'inputMinHpLimit',
    'inputMaxHpLimit',
    'inputMinDefLimit',
    'inputMaxDefLimit',
    'inputMinSpdLimit',
    'inputMaxSpdLimit',
    'inputMinCrLimit',
    'inputMaxCrLimit',
    'inputMinCdLimit',
    'inputMaxCdLimit',
    'inputMinEffLimit',
    'inputMaxEffLimit',
    'inputMinResLimit',
    'inputMaxResLimit',
];

// 接口里的套装 code -> 优化器套装选项值
const SET_OPTION = {
    set_acc: 'Hit',
    set_att: 'Attack',
    set_coop: 'Unity',
    set_counter: 'Counter',
    set_cri_dmg: 'Destruction',
    set_cri: 'Critical',
    set_def: 'Defense',
    set_hit: 'Hit',
    set_immune: 'Immunity',
    set_max_hp: 'Health',
    set_penetrate: 'Penetration',
    set_rage: 'Rage',
    set_res: 'Resist',
    set_revenge: 'Revenge',
    set_scar: 'Injury',
    set_speed: 'Speed',
    set_vampire: 'Lifesteal',
    set_shield: 'Protection',
    set_torrent: 'Torrent',
    set_revenant: 'Reversal',
    set_riposte: 'Riposte',
    set_chase: 'Pursuit',
    set_opener: 'Warfare',
    set_weak: 'Weakening',
    set_might: 'Fervor',
};

const SET_ZH = {
    set_acc: '命中',
    set_att: '攻击',
    set_coop: '团结',
    set_counter: '反击',
    set_cri_dmg: '破坏',
    set_cri: '暴击',
    set_def: '防御',
    set_immune: '免疫',
    set_max_hp: '生命',
    set_penetrate: '穿透',
    set_rage: '愤怒',
    set_res: '抗性',
    set_revenge: '复仇',
    set_scar: '创伤',
    set_speed: '速度',
    set_vampire: '吸血',
    set_shield: '保护',
    set_torrent: '激流',
    set_revenant: '逆转',
    set_riposte: '还击',
    set_chase: '追击',
    set_opener: '先手',
    set_weak: '削弱',
    set_might: '威慑',
};

const FOUR_PIECE_SETS = [
    'AttackSet',
    'SpeedSet',
    'DestructionSet',
    'LifestealSet',
    'ProtectionSet',
    'CounterSet',
    'RageSet',
    'RevengeSet',
    'InjurySet',
    'ReversalSet',
    'RiposteSet',
    'WarfareSet',
    'WeakeningSet',
];

/* ---------------- 缓存 ---------------- */

function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function cachePath(code) {
    return Path.join(Files.getDataPath(), CACHE_DIR, `${code}.json`);
}

function readCache(code) {
    try {
        return JSON.parse(fs.readFileSync(cachePath(code), 'utf8'));
    } catch (e) {
        return null;
    }
}

function writeCache(code, record) {
    const file = cachePath(code);
    fs.mkdirSync(Path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record));
}

/* ---------------- 请求 ---------------- */

function showSlowLoading() {
    Swal.fire({
        title: '正在查询配装数据',
        html: '这个接口比较慢，通常要 5~20 秒，请稍候…',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading(),
    });
}

function hideLoading() {
    Swal.close();
}

/**
 * 走 Node 的 https 直连，避免 file:// 页面的 CORS 限制；这个接口本身很慢，
 * 所以给 90 秒超时。
 */
function requestBuilds(heroName) {
    return new Promise((resolve, reject) => {
        const target = new URL(BUILDS_API);
        const body = String(heroName);
        const req = https.request(
            {
                hostname: target.hostname,
                path: target.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=UTF-8',
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': 'FribbelsE7Optimizer',
                },
            },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const payload = JSON.parse(
                            Buffer.concat(chunks).toString('utf8')
                        );
                        if (!payload || !Array.isArray(payload.data)) {
                            throw new Error('响应格式异常');
                        }
                        resolve(payload);
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );

        req.setTimeout(REQUEST_TIMEOUT, () =>
            req.destroy(new Error('请求超时'))
        );
        req.on('error', reject);
        req.end(body);
    });
}

/**
 * 取某个英雄的配装数据：当天缓存优先，否则请求；请求失败时回退到旧缓存。
 */
async function loadBuilds(heroName, heroCode) {
    const cached = readCache(heroCode);
    if (cached && cached.payload && cached.day === todayKey()) {
        return { payload: cached.payload, day: cached.day, stale: false };
    }

    showSlowLoading();
    try {
        const payload = await requestBuilds(heroName);
        writeCache(heroCode, {
            fetchedAt: new Date().toISOString(),
            day: todayKey(),
            heroName,
            payload,
        });
        return { payload, day: todayKey(), stale: false };
    } catch (e) {
        if (cached && cached.payload) {
            Notifier.warn(`配装数据请求失败，使用 ${cached.day} 获取的缓存`);
            return { payload: cached.payload, day: cached.day, stale: true };
        }
        throw new Error(
            `配装数据请求失败（${e && e.message ? e.message : e}）`
        );
    } finally {
        hideLoading();
    }
}

/* ---------------- 计算 ---------------- */

const valuesOf = (rows, key) => rows.map((row) => Number(row[key]) || 0);

function quantile(arr, p) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * p)];
}

const meanOf = (arr) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

function comboKey(sets) {
    return Object.entries(sets || {})
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([code, count]) => `${code}:${count}`)
        .join('+');
}

function comboZh(key) {
    return key
        .split('+')
        .map((part) => {
            const [code, count] = part.split(':');
            return `${SET_ZH[code] || code}${count}`;
        })
        .join(' + ');
}

/**
 * 套装组合 -> 优化器三行套装过滤
 * 4+2 -> format 1；2+2+2 -> format 5；单 4 件 -> format 2；单 2 件 -> format 3
 */
function comboToInputSets(key) {
    const parts = key.split('+').map((part) => {
        const [code, count] = part.split(':');
        return { code, count: Number(count), option: SET_OPTION[code] || code };
    });
    const four = parts.filter((part) => part.count === 4);
    const two = parts.filter((part) => part.count === 2);

    if (four.length === 1) {
        const rest = parts.filter((part) => part !== four[0]);
        return [[four[0].option], rest.length ? [rest[0].option] : [], []];
    }
    if (two.length >= 3) {
        return [[two[0].option], [two[1].option], [two[2].option]];
    }
    if (two.length === 2) {
        return [[two[0].option], [two[1].option], []];
    }
    if (parts.length === 1) {
        return [[parts[0].option], [], []];
    }
    return [[parts[0].option], [], []];
}

function iqrScale(rows) {
    const scale = {};
    DENSITY_STATS.forEach((stat) => {
        const iqr =
            quantile(valuesOf(rows, stat.key), 0.75) -
            quantile(valuesOf(rows, stat.key), 0.25);
        scale[stat.key] = iqr > 0 ? iqr : 1;
    });
    return scale;
}

function toPoints(rows, scale) {
    return rows.map((row) =>
        DENSITY_STATS.map(
            (stat) => (Number(row[stat.key]) || 0) / scale[stat.key]
        )
    );
}

function distance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

/** 密度法：IQR 归一化后找邻域最密的点，返回 { center, members } */
function densestRegion(rows, radius) {
    const scale = iqrScale(rows);
    const points = toPoints(rows, scale);

    let bestIndex = 0;
    let bestCount = 0;
    for (let i = 0; i < points.length; i += 1) {
        let count = 0;
        for (let j = 0; j < points.length; j += 1) {
            if (distance(points[i], points[j]) <= radius) count += 1;
        }
        if (count > bestCount) {
            bestCount = count;
            bestIndex = i;
        }
    }

    const center = points[bestIndex];
    const members = rows.filter(
        (row, i) => distance(points[i], center) <= radius
    );
    return { center: rows[bestIndex], members };
}

/** 在候选阈值里取最接近的一个 */
function nearestPick(value, picks) {
    let best = picks[0];
    picks.forEach((pick) => {
        if (Math.abs(pick - value) < Math.abs(best - value)) best = pick;
    });
    return best;
}

/**
 * 把密度中心的值归化成"配装器里好用的整数目标"
 *   攻击/生命 -> 整 100，防御 -> 整 50，速度 -> 向上取整 5（末尾 0/5）
 *   暴击率 -> [100, 88, 85, 73, 70, 50] 里最接近的，小于 30 置 0（视为没堆）
 *   爆伤   -> 整 5
 *   命中/抗性 -> [0, 50, 85, 100, 130, 150, 185, 200] 里最接近的，超过 200 取整 5
 */
function normalizeStat(stat, value) {
    if (!Number.isFinite(value)) return null;
    if (stat.zeroBelow != null && value < stat.zeroBelow) return 0;
    if (stat.picks) {
        if (stat.snapOver && value > stat.snapOver[0]) {
            const grid = stat.snapOver[1];
            return Math.round(value / grid) * grid;
        }
        return nearestPick(value, stat.picks);
    }
    if (stat.snap) {
        return stat.round === 'up'
            ? Math.ceil(value / stat.snap) * stat.snap
            : Math.round(value / stat.snap) * stat.snap;
    }
    return Math.round(value);
}

/**
 * 计算目标面板：
 *   1. 套装组合占比最高
 *   2. 神器：指定了就用指定的（英雄当前神器），否则取该套装下占比最高的
 *   3. 子集内按 gs 取 p10~p70
 *   4. >=50 条用密度法取最密点的 6 维数值作为中心，否则取中位数
 *   5. 每个属性都取密度中心再按 normalizeStat 归化成整数值
 *   6. 目标和英雄基础值差不多的属性跳过
 *
 * options.artifactCode：固定用这个神器筛 build
 */
function computePanel(rows, baseStats, options) {
    if (!rows || !rows.length) throw new Error('该英雄没有配装数据');

    const settings = options || {};
    let pool = rows;
    let fixedArtifact = settings.artifactCode || null;

    if (fixedArtifact) {
        pool = pool.filter((row) => row.artifactCode === fixedArtifact);
        if (!pool.length) return null;
    }

    const combos = new Map();
    pool.forEach((row) => {
        const key = comboKey(row.sets);
        combos.set(key, (combos.get(key) || 0) + 1);
    });
    const topCombo = [...combos.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const comboSubset = pool.filter((row) => comboKey(row.sets) === topCombo);

    let artifactSubset = comboSubset;
    if (!fixedArtifact) {
        const artifacts = new Map();
        comboSubset.forEach((row) => {
            artifacts.set(
                row.artifactCode,
                (artifacts.get(row.artifactCode) || 0) + 1
            );
        });
        const [topArtifact] = [...artifacts.entries()].sort(
            (a, b) => b[1] - a[1]
        )[0];
        fixedArtifact = topArtifact;
        artifactSubset = comboSubset.filter(
            (row) => row.artifactCode === fixedArtifact
        );
    }
    if (!artifactSubset.length) return null;

    // gs p10~p70（子集内部裁剪，去掉特别高分的）
    const gsValues = valuesOf(artifactSubset, 'gs');
    const gsLow = quantile(gsValues, 0.1);
    const gsHigh = quantile(gsValues, 0.7);
    const trimmed = artifactSubset.filter(
        (row) => row.gs >= gsLow && row.gs <= gsHigh
    );

    const baseRows = trimmed.length ? trimmed : artifactSubset;
    let method = 'median';
    const anchor = {};

    if (baseRows.length >= 50) {
        const region = densestRegion(baseRows, 1.0);
        method = 'density';
        // 所有属性统一取密度中心（最密那个点）的值，再各自归化
        STATS.forEach((stat) => {
            anchor[stat.key] = Number(region.center[stat.key]) || 0;
        });
    } else {
        STATS.forEach((stat) => {
            anchor[stat.key] = quantile(valuesOf(baseRows, stat.key), 0.5);
        });
    }

    const base = baseStats || {};
    const targets = {};
    const skipped = [];
    STATS.forEach((stat) => {
        const anchorValue = Number(anchor[stat.key]);
        if (!Number.isFinite(anchorValue)) {
            skipped.push(stat.key);
            return;
        }
        // 低于阈值就认为这个属性不需要
        if (stat.min != null && anchorValue < stat.min) {
            skipped.push(stat.key);
            return;
        }

        // 取密度中心后归化到常见整数目标
        const value = normalizeStat(stat, anchorValue);
        // 归化成 0 表示这个属性没堆，直接跳过
        if (!value) {
            skipped.push(stat.key);
            return;
        }
        if (stat.min != null && value < stat.min) {
            skipped.push(stat.key);
            return;
        }

        const baseValue = Number(base[stat.key] || 0);
        const tolerance =
            stat.snap && stat.snap >= 50 ? Math.max(5, baseValue * 0.02) : 5;
        if (value <= baseValue + tolerance) {
            skipped.push(stat.key);
            return;
        }
        targets[stat.key] = value;
    });

    return {
        setKey: topCombo,
        setZh: comboZh(topCombo),
        inputSets: comboToInputSets(topCombo),
        artifactCode: fixedArtifact,
        n: baseRows.length,
        nAll: rows.length,
        gsRange: [Math.round(gsLow), Math.round(gsHigh)],
        method,
        anchor,
        targets,
        skipped,
    };
}

/* ---------------- 填入优化器 ---------------- */

function artifactNameByCode(code) {
    const all = HeroData.getAllArtifactData() || {};
    let found = null;
    Object.keys(all).forEach((name) => {
        if (!found && all[name] && all[name].code === code) found = name;
    });
    return found;
}

function artifactCodeByName(name) {
    const all = HeroData.getAllArtifactData() || {};
    const artifact = all[name];
    return artifact && artifact.code ? artifact.code : null;
}

function applySets(inputSets) {
    for (let slot = 0; slot < 3; slot += 1) {
        const values = inputSets[slot] || [];
        $(`#inputSet${slot + 1}`).multipleSelect('setSelects', values);
    }
}

function applyStatTargets(targets) {
    STAT_LIMIT_IDS.forEach((id) => {
        $(`#${id}`).val('');
    });
    STATS.forEach((stat) => {
        const value = targets[stat.key];
        if (value != null) $(`#${stat.inputId}`).val(value);
    });
}

/** 把英雄当前加成配置还原成 Api.setBonusStats 需要的结构（保持其它字段不变） */
function currentBonusStats(hero) {
    return {
        attack: Number(hero.bonusAtk) || 0,
        defense: Number(hero.bonusDef) || 0,
        health: Number(hero.bonusHp) || 0,
        attackPercent: Number(hero.bonusAtkPercent) || 0,
        defensePercent: Number(hero.bonusDefPercent) || 0,
        healthPercent: Number(hero.bonusHpPercent) || 0,
        speed: Number(hero.bonusSpeed) || 0,
        critChance: Number(hero.bonusCr) || 0,
        critDamage: Number(hero.bonusCd) || 0,
        effectiveness: Number(hero.bonusEff) || 0,
        effectResistance: Number(hero.bonusRes) || 0,
        finalAtkMultiplier: Number(hero.finalAtkMultiplier) || 0,
        finalDefMultiplier: Number(hero.finalDefMultiplier) || 0,
        finalHpMultiplier: Number(hero.finalHpMultiplier) || 0,
        aeiAttack: Number(hero.aeiAtk) || 0,
        aeiDefense: Number(hero.aeiDef) || 0,
        aeiHealth: Number(hero.aeiHp) || 0,
        aeiAttackPercent: Number(hero.aeiAtkPercent) || 0,
        aeiDefensePercent: Number(hero.aeiDefPercent) || 0,
        aeiHealthPercent: Number(hero.aeiHpPercent) || 0,
        aeiSpeed: Number(hero.aeiSpeed) || 0,
        aeiCritChance: Number(hero.aeiCr) || 0,
        aeiCritDamage: Number(hero.aeiCd) || 0,
        aeiEffectiveness: Number(hero.aeiEff) || 0,
        aeiEffectResistance: Number(hero.aeiRes) || 0,
        artifactName: hero.artifactName || 'None',
        artifactLevel: hero.artifactLevel || 'None',
        artifactAttack: Number(hero.artifactAttack) || 0,
        artifactHealth: Number(hero.artifactHealth) || 0,
        artifactDefense: Number(hero.artifactDefense) || 0,
        imprintNumber: hero.imprintNumber || 'None',
        eeNumber: hero.eeNumber || 'None',
        stars: Number(hero.stars) || 6,
    };
}

/** 给英雄换上推荐神器（+30），同时把 aei 里旧神器的加成换成新的 */
async function applyArtifact(hero, artifactCode) {
    const name = artifactNameByCode(artifactCode);
    if (!name) return null;

    const level = 30;
    const next = Artifact.getStats(name, level);
    const bonus = currentBonusStats(hero);

    let previous = { attack: 0, health: 0, defense: 0 };
    if (
        hero.artifactName &&
        hero.artifactName !== 'None' &&
        hero.artifactLevel &&
        hero.artifactLevel !== 'None'
    ) {
        try {
            previous = Artifact.getStats(
                hero.artifactName,
                parseInt(hero.artifactLevel, 10)
            );
        } catch (e) {
            previous = { attack: 0, health: 0, defense: 0 };
        }
    }

    bonus.aeiAttack += next.attack - previous.attack;
    bonus.aeiHealth += next.health - previous.health;
    bonus.aeiDefense += next.defense - previous.defense;
    bonus.artifactName = name;
    bonus.artifactLevel = String(level);
    bonus.artifactAttack = next.attack;
    bonus.artifactHealth = next.health;
    bonus.artifactDefense = next.defense;

    await Api.setBonusStats(bonus, hero.id);
    return name;
}

const FOUR_PIECE_OPTIONS = new Set([
    'Attack',
    'Speed',
    'Destruction',
    'Lifesteal',
    'Protection',
    'Counter',
    'Rage',
    'Revenge',
    'Injury',
    'Reversal',
    'Riposte',
    'Warfare',
    'Weakening',
]);

/** 由三行套装选择推导优化器的 setFormat（和 optimizerTab.getSetFormat 同一套规则） */
function setFormatOf(inputSets) {
    const first = inputSets[0] || [];
    const second = inputSets[1] || [];
    const third = inputSets[2] || [];
    if (!first.length) return 0;
    if (first.some((name) => FOUR_PIECE_OPTIONS.has(name))) {
        return second.length || third.length ? 1 : 2;
    }
    if (second.length) return third.length ? 5 : 4;
    return 3;
}

/** 把面板结果写进 optimizationRequest 的字段里 */
function applyPanelToRequest(request, panel) {
    const { inputSets } = panel;
    request.inputSets = inputSets;
    request.inputSetsOne = inputSets[0] || [];
    request.inputSetsTwo = inputSets[1] || [];
    request.inputSetsThree = inputSets[2] || [];
    request.setFormat = setFormatOf(inputSets);

    STATS.forEach((stat) => {
        const value = panel.targets[stat.key];
        request[stat.requestKey] = value == null ? null : value;
        request[stat.configuredKey] = value != null;
    });
}

/**
 * 把优化器当前的过滤条件存进英雄配置，否则切换英雄回来会还原成旧配置。
 * 和点「开始」时后端保存的 optimizationRequest 是同一份数据。
 */
async function persistFilters(hero, panel) {
    let request = null;
    try {
        request = OptimizerTab.getOptimizationRequestParams();
    } catch (e) {
        console.warn(
            'RTAStats: 读取完整过滤器失败，改为只保存本次填入的项',
            e && e.message
        );
        request = { ...(hero.optimizationRequest || {}) };
    }

    try {
        applyPanelToRequest(request, panel);
        request.hero = { id: hero.id };
        await Api.saveOptimizationRequest(request);
        Saves.autoSave();
        console.log('[HeroBuilds] 过滤器已保存', {
            heroId: hero.id,
            setFormat: request.setFormat,
            inputSets: request.inputSets,
            targets: panel.targets,
        });
    } catch (e) {
        console.warn('RTAStats: 保存过滤器失败', e && e.message);
        Notifier.warn('过滤器保存失败，切换英雄后可能会还原');
    }
}

/**
 * 主流程：查数据 -> 算面板 -> 填套装/属性下限/神器
 * 返回结果给 UI 提示用。
 */
async function fill(hero) {
    if (!hero) throw new Error('没有选中英雄');

    const heroCode = (hero.data && hero.data.code) || hero.code || hero.name;
    const { payload, day, stale } = await loadBuilds(hero.name, heroCode);

    // 英雄已经选了神器：只用这个神器的 build；数据里没有就不填
    const heroArtifactName =
        hero.artifactName && hero.artifactName !== 'None'
            ? hero.artifactName
            : null;
    let fixedArtifactCode = null;
    if (heroArtifactName) {
        fixedArtifactCode = artifactCodeByName(heroArtifactName);
        if (!fixedArtifactCode) {
            Notifier.warn(
                `当前神器「${heroArtifactName}」在配装数据里没有记录，已取消填入`
            );
            return null;
        }
        const hasBuilds = payload.data.some(
            (row) => row.artifactCode === fixedArtifactCode
        );
        if (!hasBuilds) {
            Notifier.warn(
                `当前神器「${heroArtifactName}」没有对应的配装记录，已取消填入`
            );
            return null;
        }
    }

    let baseStats = null;
    try {
        baseStats = HeroData.getBaseStatsByName(
            hero.name
        ).lv60SixStarFullyAwakened;
    } catch (e) {
        baseStats = null;
    }

    const panel = computePanel(payload.data, baseStats, {
        artifactCode: fixedArtifactCode,
    });
    if (!panel) {
        Notifier.warn('这个神器下没有可用的配装数据，已取消填入');
        return null;
    }

    applySets(panel.inputSets);
    applyStatTargets(panel.targets);

    // 只有英雄没选神器时，才把推荐神器写进英雄配置（+30）
    let artifactName = heroArtifactName;
    if (!heroArtifactName) {
        try {
            artifactName = await applyArtifact(hero, panel.artifactCode);
        } catch (e) {
            console.warn('RTAStats: 神器设置失败', e && e.message);
        }
    }

    // 把当前过滤器存到英雄的 optimizationRequest，否则切换英雄回来会还原成旧配置
    await persistFilters(hero, panel);

    if (stale) {
        Notifier.info(`配装数据是 ${day} 获取的缓存`);
    }

    return {
        n: panel.n,
        nAll: panel.nAll,
        method: panel.method,
        setZh: panel.setZh,
        artifactName: artifactName || panel.artifactCode,
        gsRange: panel.gsRange,
        targets: panel.targets,
        skipped: panel.skipped,
        day,
    };
}

module.exports = {
    fill,
    computePanel,
    comboToInputSets,
    densestRegion,
    loadBuilds,
    _internal: { comboKey, todayKey, cachePath },
};
