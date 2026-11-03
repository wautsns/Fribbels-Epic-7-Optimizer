#!/usr/bin/env node
/**
 * 官方战绩站 (e7.qyzlgame.com / 国服) 英雄分析数据抓取
 *
 * 页面: https://e7.qyzlgame.com/next/actv/2024/Epic7_Stats/#/zh-CN/herorecord/<heroCode>
 * 是 hash 路由 SPA, 页面本身没有数据, 数据来自:
 *   POST https://e7stats.qyzlgame.com/gameApi/getSeasonList        (lang)
 *   POST https://e7stats.qyzlgame.com/gameApi/getHeroAnalysis      (lang, hero_code, season_code, grade_code)
 *
 * 返回里最有价值的是 `abillity`: 8 项面板属性的 10 段分布 (在站点前端被渲染成柱状图)。
 * 每段边界 = 站点硬编码的 min/max 线性切分 (见 bundle.js 里的 re / ie 常量)。
 *
 * 产出: data/rtastats/e7stats-<heroCode>.json
 *
 * 用法:
 *   node scripts/e7stats/fetch-official-hero.js --heroes c2185
 *   node scripts/e7stats/fetch-official-hero.js --heroes c2185,c1144 --tier champion
 *   node scripts/e7stats/fetch-official-hero.js --heroes c2185 --all-tiers
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..', '..');
const HERO_DATA_PATH = path.join(ROOT, 'data', 'cache', 'herodata.json');
const ARTIFACT_DATA_PATH = path.join(ROOT, 'data', 'cache', 'artifactdata.json');
const TRANSLATION_PATH = path.join(ROOT, 'data', 'locales', 'zh', 'translation.json');

const API_HOST = 'e7stats.qyzlgame.com';
const SITE = 'https://e7.qyzlgame.com/next/actv/2024/Epic7_Stats/';
const UA = 'Mozilla/5.0 (compatible; FribbelsE7Optimizer meta import)';

// 段位 (低 -> 高)
const TIERS = ['bronze', 'silver', 'gold', 'master', 'challenger', 'champion', 'emperor', 'legend'];
const TIER_ZH = {
    bronze: '青铜', silver: '白银', gold: '黄金', master: '大师', challenger: '挑战者',
    champion: '优胜者', emperor: '王者', legend: '传说',
};

// abillity 的 10 段边界, 来自站点 bundle: re=[...] / ie=[...]
const STAT_META = [
    { key: 'att', stat: 'atk', zh: '攻击', min: 1200, max: 6000 },
    { key: 'def', stat: 'def', zh: '防御', min: 800, max: 3000 },
    { key: 'max_hp', stat: 'hp', zh: '生命', min: 9000, max: 40000 },
    { key: 'speed', stat: 'spd', zh: '速度', min: 110, max: 310 },
    { key: 'cri', stat: 'cr', zh: '暴击率', min: 15, max: 100 },
    { key: 'cri_dmg', stat: 'cd', zh: '暴击伤害', min: 150, max: 350 },
    { key: 'acc', stat: 'eff', zh: '效果命中', min: 0, max: 200 },
    { key: 'res', stat: 'res', zh: '效果抗性', min: 0, max: 300 },
];

// 与配装器一致的套装定义 (来源: app/js/lib/tabs/optimizerTab.js)
const FOUR_PIECE_SETS = [
    'AttackSet', 'SpeedSet', 'DestructionSet', 'LifestealSet', 'ProtectionSet', 'CounterSet',
    'RageSet', 'RevengeSet', 'InjurySet', 'ReversalSet', 'RiposteSet', 'WarfareSet', 'WeakeningSet',
];
const SET_CODE_TO_NAME = {
    set_acc: 'HitSet', set_att: 'AttackSet', set_coop: 'UnitySet', set_counter: 'CounterSet',
    set_cri_dmg: 'DestructionSet', set_cri: 'CriticalSet', set_def: 'DefenseSet', set_immune: 'ImmunitySet',
    set_max_hp: 'HealthSet', set_penetrate: 'PenetrationSet', set_rage: 'RageSet', set_res: 'ResistSet',
    set_revenge: 'RevengeSet', set_scar: 'InjurySet', set_speed: 'SpeedSet', set_vampire: 'LifestealSet',
    set_shield: 'ProtectionSet', set_torrent: 'TorrentSet', set_revenant: 'ReversalSet', set_riposte: 'RiposteSet',
    set_chase: 'PursuitSet', set_opener: 'WarfareSet', set_weak: 'WeakeningSet', set_might: 'FervorSet',
};
const SET_CODE_TO_ZH = {
    set_acc: '命中', set_att: '攻击', set_coop: '团结', set_counter: '反击', set_cri_dmg: '破坏',
    set_cri: '暴击', set_def: '防御', set_immune: '免疫', set_max_hp: '生命', set_penetrate: '穿透',
    set_rage: '愤怒', set_res: '抗性', set_revenge: '复仇', set_scar: '创伤', set_speed: '速度',
    set_vampire: '吸血', set_shield: '保护', set_torrent: '激流', set_revenant: '逆转', set_riposte: '还击',
    set_chase: '追击', set_opener: '先手', set_weak: '削弱', set_might: '威慑',
};

// ---------------------------------------------------------------------------
// 参数 / HTTP
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const args = {
        heroes: null, tier: 'master', allTiers: false, season: null, out: null,
        delay: 1200, cacheDir: path.join(ROOT, 'data', 'rtastats', '.cache', 'e7stats'), noCache: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v == null) throw new Error(`Missing value for ${a}`);
            return v;
        };
        if (a === '--heroes') args.heroes = next().split(',').map(s => s.trim()).filter(Boolean);
        else if (a === '--tier') args.tier = next();
        else if (a === '--all-tiers') args.allTiers = true;
        else if (a === '--season') args.season = next();
        else if (a === '--out') args.out = path.resolve(next());
        else if (a === '--delay') args.delay = Math.max(0, Number(next()));
        else if (a === '--cache-dir') args.cacheDir = path.resolve(next());
        else if (a === '--no-cache') args.noCache = true;
        else if (a === '-h' || a === '--help') {
            console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
            process.exit(0);
        } else throw new Error(`Unknown argument: ${a}`);
    }
    if (!args.heroes) args.heroes = ['c2185'];
    if (!args.out) args.out = path.join(ROOT, 'data', 'rtastats', `e7stats-${args.heroes.join('_')}.json`);
    return args;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cachePath(cacheDir, name) {
    return path.join(cacheDir, name + '.json');
}

function postJson(pathname, params, retries = 2) {
    return new Promise((resolve, reject) => {
        const qs = new URLSearchParams(params).toString();
        const req = https.request({
            hostname: API_HOST,
            path: pathname + (qs ? '?' + qs : ''),
            method: 'POST',
            headers: { 'User-Agent': UA, 'Content-Length': 0, Origin: 'https://e7.qyzlgame.com' },
        }, res => {
            if (res.statusCode === 403 || res.statusCode === 429) {
                res.resume();
                const e = new Error(`HTTP ${res.statusCode}: 被限流/拦截, 请降低频率 (${pathname})`);
                e.fatal = true;
                return reject(e);
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`Bad JSON from ${pathname}: ${body.slice(0, 120)}`));
                }
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('timeout')));
        req.on('error', err => {
            if (retries > 0) setTimeout(() => postJson(pathname, params, retries - 1).then(resolve, reject), 3000);
            else reject(err);
        });
        req.end();
    });
}

/** 带磁盘缓存的 getHeroAnalysis: 重跑不会重复请求 */
async function getHeroAnalysis(args, params) {
    const key = `heroanalysis_${params.season_code}_${params.grade_code}_${params.hero_code}`;
    const file = cachePath(args.cacheDir, key);
    if (!args.noCache && fs.existsSync(file)) {
        return { data: JSON.parse(fs.readFileSync(file, 'utf8')), fromCache: true };
    }
    const data = await postJson('/gameApi/getHeroAnalysis', params);
    fs.mkdirSync(args.cacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return { data, fromCache: false };
}

// ---------------------------------------------------------------------------
// abillity -> 可读分布
// ---------------------------------------------------------------------------
/**
 * 站点把面板属性切成固定 10 段 (min..max 线性), 每段一个计数。
 * 第 1 段同时兜住 < min 的样本, 第 10 段兜住 >= max 的样本。
 */
function decodeDistribution(rawCounts, meta) {
    const width = (meta.max - meta.min) / 10;
    const total = rawCounts.reduce((a, b) => a + b, 0) || 1;
    const bands = rawCounts.map((count, i) => {
        const from = meta.min + width * i;
        const to = meta.min + width * (i + 1);
        return {
            index: i + 1,
            from: round(from, 1),
            to: round(to, 1),
            count,
            pct: round(count / total * 100, 2),
            // 第 1 段兜住 < min, 第 10 段兜住 >= max
            belowMin: i === 0,
            openEnded: i === 9,
        };
    });

    // 从高往低累加: 第 i 段 = "属性 >= 该段下限" 的占比
    let acc = 0;
    for (let i = bands.length - 1; i >= 0; i--) {
        acc += bands[i].pct;
        bands[i].atOrAbove = round(acc, 2);
    }

    // 累计定位分位点所在段
    const quantileBand = q => {
        let a = 0;
        for (const b of bands) {
            a += b.count;
            if (a / total >= q) return b;
        }
        return bands[bands.length - 1];
    };
    const describe = b => ({
        from: b.from,
        to: b.to,
        // 读作: >= from (顶段) / <= to (底段) / from-to
        label: b.openEnded ? `>= ${b.from}` : (b.belowMin ? `<= ${b.to}` : `${b.from}-${b.to}`),
        openEnded: b.openEnded,
        belowMin: b.belowMin,
    });
    const p25 = describe(quantileBand(0.25));
    const p50 = describe(quantileBand(0.5));
    const p75 = describe(quantileBand(0.75));
    const p90 = describe(quantileBand(0.9));

    return {
        stat: meta.stat,
        zh: meta.zh,
        range: { min: meta.min, max: meta.max, bandWidth: round(width, 2) },
        bands,
        // 粗粒度分位 (只到「段」)
        p25, p50, p75, p90,
        // 顶部段占比 = "堆到范围上限" 的人群
        topBandPct: bands[9].pct,
    };
}

const round = (n, d = 2) => (n == null || !isFinite(n) ? null : Number(n.toFixed(d)));

// ---------------------------------------------------------------------------
// equip_list -> 配装器 inputSets
// ---------------------------------------------------------------------------
function equipToPreset(equipList) {
    const names = equipList.map(c => SET_CODE_TO_NAME[c] || c);
    const zh = equipList.map(c => SET_CODE_TO_ZH[c] || c);
    const fours = names.filter(n => FOUR_PIECE_SETS.includes(n));
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);

    if (names.length === 1) {
        return { names, zh, setFormat: 2, inputSets: [[names[0]], [], []], note: 'single set + 2 free slots' };
    }
    if (names.length >= 3) {
        // 2+2+2: 出现两次的那一个是 4 件套
        if (dupes.length) {
            const four = dupes[0];
            const twos = names.filter((n, i) => !(n === four && names.indexOf(n) === i));
            return { names, zh, setFormat: 1, inputSets: [[four], [twos[0] || four], []], note: '4p+2p (from 2+2+2 list)' };
        }
        return { names, zh, setFormat: 5, inputSets: [[names[0]], [names[1]], [names[2]]], note: '2p+2p+2p' };
    }
    // 两个套装
    if (fours.length === 1) {
        const four = fours[0];
        const two = names.find(n => n !== four);
        return { names, zh, setFormat: 1, inputSets: [[four], [two], []], note: null };
    }
    if (fours.length === 2) {
        return {
            names, zh, setFormat: 1, inputSets: [[names[0]], [names[1]], []],
            note: 'ambiguous: both sets can be 4-piece', ambiguous: true,
        };
    }
    return {
        names, zh, setFormat: 4, inputSets: [[names[0]], [names[1]], []],
        note: 'approximate: two 2-piece sets', approximate: true,
    };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
    const args = parseArgs(process.argv);

    const heroData = JSON.parse(fs.readFileSync(HERO_DATA_PATH, 'utf8'));
    const artifactsRaw = JSON.parse(fs.readFileSync(ARTIFACT_DATA_PATH, 'utf8'));
    const translation = fs.existsSync(TRANSLATION_PATH) ? JSON.parse(fs.readFileSync(TRANSLATION_PATH, 'utf8')) : {};

    const heroesByCode = {};
    for (const name of Object.keys(heroData)) heroesByCode[heroData[name].code] = heroData[name];
    const artifactsByCode = {};
    for (const name of Object.keys(artifactsRaw)) artifactsByCode[artifactsRaw[name].code] = artifactsRaw[name];

    const seasonRes = await postJson('/gameApi/getSeasonList', { lang: 'zh-CN' });
    const seasons = seasonRes.result_body || [];
    const season = args.season
        ? seasons.find(s => s.season_code === args.season)
        : seasons.find(s => s.is_now_season === 1) || seasons[0];
    if (!season) throw new Error('No season available');

    const tiers = args.allTiers ? TIERS : [args.tier];
    const out = {
        source: {
            site: SITE,
            api: `https://${API_HOST}/gameApi/getHeroAnalysis`,
            scope: '国服 (qyzlgame/zlongame) 官方战绩站, RTA 段位分布',
            fetchedAt: new Date().toISOString(),
            note: 'abillity 的 10 段边界取自站点前端常量 re/ie, 由后台按 min..max 线性切分',
        },
        season: { code: season.season_code, name: season.name, start: season.startDate, end: season.endDate },
        seasons: seasons.map(s => ({ code: s.season_code, name: s.name, start: s.startDate, end: s.endDate, isNow: s.is_now_season === 1 })),
        statMeta: STAT_META.map(m => ({ key: m.key, stat: m.stat, zh: m.zh, min: m.min, max: m.max })),
        heroes: {},
        errors: [],
    };

    for (const code of args.heroes) {
        const hero = heroesByCode[code];
        const record = {
            code,
            name: hero ? hero.name : null,
            zh: hero ? (translation[hero.name] || null) : null,
            role: hero ? hero.role : null,
            baseStats: hero ? {
                atk: hero.calculatedStatus.lv60SixStarFullyAwakened.atk,
                hp: hero.calculatedStatus.lv60SixStarFullyAwakened.hp,
                def: hero.calculatedStatus.lv60SixStarFullyAwakened.def,
                spd: hero.calculatedStatus.lv60SixStarFullyAwakened.spd,
                cr: Math.round(hero.calculatedStatus.lv60SixStarFullyAwakened.chc * 100),
                cd: Math.round(hero.calculatedStatus.lv60SixStarFullyAwakened.chd * 100),
            } : null,
            tiers: {},
        };

        for (const tier of tiers) {
            try {
                const cached = await getHeroAnalysis(args, {
                    lang: 'zh-CN', hero_code: code, season_code: season.season_code, grade_code: tier,
                });
                const res = cached.data;
                if (res.return_code !== 0 || !res.result_body) {
                    record.tiers[tier] = { tier, zh: TIER_ZH[tier], available: false, returnCode: res.return_code };
                    continue;
                }
                const b = res.result_body;
                const stats = {};
                const sampleTotal = {};
                for (const meta of STAT_META) {
                    const raw = b.abillity[meta.key];
                    if (!raw) continue;
                    const counts = raw.split(',').map(x => parseInt(x, 10) || 0);
                    stats[meta.stat] = decodeDistribution(counts, meta);
                    sampleTotal[meta.stat] = counts.reduce((a, x) => a + x, 0);
                }

                const equips = (b.equip || []).map(e => {
                    const preset = equipToPreset(e.equip_list);
                    return Object.assign({
                        rank: e.rank,
                        setCodes: e.equip_list,
                        rate: e.rate,
                        winRate: e.win_rate,
                    }, preset);
                });

                record.tiers[tier] = {
                    tier,
                    zh: TIER_ZH[tier],
                    available: true,
                    dataDate: b.regDate,
                    heroCountInTier: b.current_seasontier_tot,
                    winRate: (b.win_rate || []).find(w => w.season_code === season.season_code) || null,
                    winRateHistory: (b.win_rate || []).filter(w => w.win_rate > 0),
                    pick: b.pick || [],
                    ban: b.ban || [],
                    recommendSkill: b.recommend_skill || null,
                    stats,
                    sampleTotal,
                    equips,
                };
            } catch (e) {
                out.errors.push({ code, tier, error: e.message });
                record.tiers[tier] = { tier, available: false, error: e.message };
                if (e.fatal) {
                    console.error(`\n已中止: ${e.message}`);
                    out.heroes[code] = record;
                    fs.mkdirSync(path.dirname(args.out), { recursive: true });
                    fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
                    console.error('部分结果已写入, 请降低频率或稍后重跑(会走缓存)。');
                    process.exit(2);
                }
            }
            await sleep(args.delay + Math.floor(Math.random() * 400));
        }

        // ---- 汇总: 取最有代表性的段位 (默认 master) 生成配装器预设 ----
        const primaryTier = record.tiers[args.tier] && record.tiers[args.tier].available
            ? args.tier
            : TIERS.slice().reverse().find(t => record.tiers[t] && record.tiers[t].available);
        const p = primaryTier ? record.tiers[primaryTier] : null;
        record.preset = p ? {
            basedOnTier: primaryTier,
            equips: p.equips.slice(0, 3).map(e => ({
                setFormat: e.setFormat,
                inputSets: e.inputSets,
                sets: e.names,
                setsZh: e.zh,
                rate: e.rate,
                winRate: e.winRate,
                note: e.note,
            })),
            targetStats: Object.keys(p.stats).reduce((acc, stat) => {
                const s = p.stats[stat];
                acc[stat] = { p50: s.p50.label, p75: s.p75.label, p90: s.p90.label, topBandPct: s.topBandPct };
                return acc;
            }, {}),
        } : null;

        out.heroes[code] = record;
        console.log(`✓ ${code} ${record.name || ''} (${record.zh || ''})  段位: ${Object.keys(record.tiers).filter(t => record.tiers[t].available).join(',')}`);
    }

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, args.out)} (${(fs.statSync(args.out).size / 1024).toFixed(1)} KB)`);
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { decodeDistribution, equipToPreset, STAT_META, TIERS };
