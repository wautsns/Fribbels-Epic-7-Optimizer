#!/usr/bin/env node
/**
 * Epic7RTAStats -> 配装器元数据 抓取/转换脚本
 *
 * 数据来源: https://www.epic7rtastats.com/heroes/<heroCode>
 * 站点是 Next.js App Router, 页面数据全部内联在 RSC flight payload 里,
 * 用 `?_rsc=<random>` + `RSC: 1` 头可以直接拿到纯文本 payload (无需浏览器/无头渲染)。
 *
 * 产出: data/rtastats/e7rta-hero-meta.json
 *
 * 用法:
 *   node scripts/e7rta/fetch-e7rta-stats.js --heroes c2185,c1144
 *   node scripts/e7rta/fetch-e7rta-stats.js --all
 *   node scripts/e7rta/fetch-e7rta-stats.js --all --min-games 2000 --concurrency 3
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..', '..');
const HERO_DATA_PATH = path.join(ROOT, 'data', 'cache', 'herodata.json');
const ARTIFACT_DATA_PATH = path.join(ROOT, 'data', 'cache', 'artifactdata.json');
const TRANSLATION_PATH = path.join(ROOT, 'data', 'locales', 'zh', 'translation.json');
const DEFAULT_OUT = path.join(ROOT, 'data', 'rtastats', 'e7rta-hero-meta.json');

const BASE_URL = 'https://www.epic7rtastats.com';
const UA = 'Mozilla/5.0 (compatible; FribbelsE7Optimizer meta import; +https://github.com/fribbels/Fribbels-Epic-7-Optimizer)';

// ---------------------------------------------------------------------------
// 与配装器一致的套装定义 (来源: app/js/lib/tabs/optimizerTab.js fourPieceSets/twoPieceSets)
// ---------------------------------------------------------------------------
const FOUR_PIECE_SETS = [
    'AttackSet', 'SpeedSet', 'DestructionSet', 'LifestealSet', 'ProtectionSet', 'CounterSet',
    'RageSet', 'RevengeSet', 'InjurySet', 'ReversalSet', 'RiposteSet', 'WarfareSet', 'WeakeningSet',
];
const TWO_PIECE_SETS = [
    'HealthSet', 'DefenseSet', 'CriticalSet', 'HitSet', 'ResistSet', 'UnitySet', 'ImmunitySet',
    'PenetrationSet', 'TorrentSet', 'PursuitSet', 'FervorSet',
];

// 站点 set_code -> 配装器 Set 名 (来源: app/js/lib/scanner.js setsByIngameSet)
const SET_CODE_TO_NAME = {
    set_acc: 'HitSet',
    set_att: 'AttackSet',
    set_coop: 'UnitySet',
    set_counter: 'CounterSet',
    set_cri_dmg: 'DestructionSet',
    set_cri: 'CriticalSet',
    set_def: 'DefenseSet',
    set_immune: 'ImmunitySet',
    set_max_hp: 'HealthSet',
    set_penetrate: 'PenetrationSet',
    set_rage: 'RageSet',
    set_res: 'ResistSet',
    set_revenge: 'RevengeSet',
    set_scar: 'InjurySet',
    set_speed: 'SpeedSet',
    set_vampire: 'LifestealSet',
    set_shield: 'ProtectionSet',
    set_torrent: 'TorrentSet',
    set_revenant: 'ReversalSet',
    set_riposte: 'RiposteSet',
    set_chase: 'PursuitSet',
    set_opener: 'WarfareSet',
    set_weak: 'WeakeningSet',
    set_might: 'FervorSet',
};

const SET_CODE_TO_ZH = {
    set_acc: '命中', set_att: '攻击', set_coop: '团结', set_counter: '反击',
    set_cri_dmg: '破坏', set_cri: '暴击', set_def: '防御', set_immune: '免疫',
    set_max_hp: '生命', set_penetrate: '穿透', set_rage: '愤怒', set_res: '抗性',
    set_revenge: '复仇', set_scar: '创伤', set_speed: '速度', set_vampire: '吸血',
    set_shield: '保护', set_torrent: '激流', set_revenant: '逆转', set_riposte: '还击',
    set_chase: '追击', set_opener: '先手', set_weak: '削弱', set_might: '威慑',
};

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const args = {
        heroes: null, all: false, out: DEFAULT_OUT,
        minGames: 2000, concurrency: 1, delay: 1200,
        cacheDir: path.join(ROOT, 'data', 'rtastats', '.cache', 'e7rta'),
        noCache: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v == null) throw new Error(`Missing value for ${arg}`);
            return v;
        };
        if (arg === '--heroes') args.heroes = next().split(',').map(s => s.trim()).filter(Boolean);
        else if (arg === '--all') args.all = true;
        else if (arg === '--out') args.out = path.resolve(next());
        else if (arg === '--min-games') args.minGames = Number(next());
        else if (arg === '--concurrency') args.concurrency = Math.max(1, Number(next()));
        else if (arg === '--delay') args.delay = Math.max(0, Number(next()));
        else if (arg === '--cache-dir') args.cacheDir = path.resolve(next());
        else if (arg === '--no-cache') args.noCache = true;
        else if (arg === '--help' || arg === '-h') {
            console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
            process.exit(0);
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    return args;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function httpGet(url, retries = 2) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': UA, RSC: '1', Accept: 'text/x-component' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(httpGet(new URL(res.headers.location, url).toString(), retries));
            }
            if (res.statusCode === 429 || res.statusCode === 403) {
                res.resume();
                const e = new Error(`HTTP ${res.statusCode}: 被限流/拦截, 请降低频率后重试 (${url})`);
                e.fatal = true;
                return reject(e);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.setTimeout(30000, () => req.destroy(new Error(`Timeout for ${url}`)));
        req.on('error', err => {
            if (retries > 0) {
                setTimeout(() => httpGet(url, retries - 1).then(resolve, reject), 3000);
            } else {
                reject(err);
            }
        });
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cachePath(cacheDir, code) {
    return path.join(cacheDir, `${code}.rsc.txt`);
}

function readCache(cacheDir, code) {
    try {
        return fs.readFileSync(cachePath(cacheDir, code), 'utf8');
    } catch (e) {
        return null;
    }
}

function writeCache(cacheDir, code, text) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachePath(cacheDir, code), text);
}

// ---------------------------------------------------------------------------
// RSC flight payload 解析
// ---------------------------------------------------------------------------
/**
 * flight 文本每行形如 `<id>:<JSON>`，其中 JSON 可能是组件树 (含 props) 或字符串。
 * 把每一行的 JSON 解析出来，再深度遍历收集我们关心的对象。
 */
function parseFlight(text) {
    const roots = [];
    for (const line of text.split('\n')) {
        const sep = line.indexOf(':');
        if (sep <= 0) continue;
        const id = line.slice(0, sep);
        if (!/^[0-9a-z]+$/i.test(id)) continue;
        const json = line.slice(sep + 1);
        if (!json || (json[0] !== '[' && json[0] !== '{' && json[0] !== '"')) continue;
        try {
            roots.push(JSON.parse(json));
        } catch (e) {
            /* 跨行/引用行跳过 */
        }
    }
    return roots;
}

function walk(node, visit, depth = 0) {
    if (node == null || depth > 60) return;
    if (Array.isArray(node)) {
        for (const item of node) walk(item, visit, depth + 1);
        return;
    }
    if (typeof node === 'object') {
        visit(node);
        for (const key of Object.keys(node)) walk(node[key], visit, depth + 1);
    }
}

function collect(roots) {
    const found = {};
    for (const root of roots) {
        walk(root, obj => {
            if (Array.isArray(obj.heroTrendStats) && !found.trend) found.trend = obj.heroTrendStats;
            if (Array.isArray(obj.buildStats) && !found.build) found.build = obj;
            if (Array.isArray(obj.heroes) && !found.roster) {
                const sample = obj.heroes.find(h => h && h.code && h.name);
                if (sample && sample.element) found.roster = obj.heroes;
            }
            if (Array.isArray(obj.seasons) && !found.seasons) found.seasons = obj.seasons;
        });
    }
    return found;
}

// ---------------------------------------------------------------------------
// 计算
// ---------------------------------------------------------------------------
const rate = (wins, losses) => (wins + losses > 0 ? wins / (wins + losses) : null);
const round = (n, d = 4) => (n == null || !isFinite(n) ? null : Number(n.toFixed(d)));

function setAggToPreset(setAggCode) {
    const parts = String(setAggCode || '').split('+').filter(Boolean);
    const names = parts.map(p => SET_CODE_TO_NAME[p] || p);
    const zh = parts.map(p => SET_CODE_TO_ZH[p] || p);
    const fours = names.filter(n => FOUR_PIECE_SETS.includes(n));
    const twos = names.filter(n => TWO_PIECE_SETS.includes(n));

    if (parts.length === 1) {
        return {
            names, zh,
            // 单一套装: 按 4 件套处理, 剩下 2 件自由
            setFormat: FOUR_PIECE_SETS.includes(names[0]) ? 2 : 3,
            inputSets: FOUR_PIECE_SETS.includes(names[0])
                ? [[names[0]], [], []]
                : [[names[0]], [], []],
            note: 'single-set build, remaining 2 slots free',
        };
    }
    if (parts.length === 3) {
        return {
            names, zh,
            setFormat: 5,
            inputSets: [[names[0]], [names[1]], [names[2]]],
            note: null,
        };
    }
    // 两件套组合
    if (fours.length === 1) {
        const four = fours[0];
        const two = names.find(n => n !== four) || twos[0];
        return {
            names, zh,
            setFormat: 1,
            inputSets: [[four], [two], []],
            note: null,
        };
    }
    if (fours.length === 2) {
        return {
            names, zh,
            setFormat: 1,
            inputSets: [[fours[0]], [fours[1]], []],
            note: 'ambiguous: both sets can be 4-piece, 4pc side guessed',
            ambiguous: true,
        };
    }
    // 两个都只能 2 件套 -> 实际是 2+2+2(其中一种叠两次), 用 2+2+自由2件 近似
    return {
        names, zh,
        setFormat: 4,
        inputSets: [[names[0]], [names[1]], []],
        note: 'approximate: two 2-piece sets, third slot free',
        approximate: true,
    };
}

function toOptimizerArtifact(artifactCode, artifactName, artifactsByCode, translation) {
    const local = artifactsByCode[artifactCode];
    const zhName = translation[local || artifactName] || null;
    return {
        code: artifactCode,
        name: local || artifactName,
        siteName: artifactName,
        zh: zhName,
        codeMatchedLocally: Boolean(local),
    };
}

// ---------------------------------------------------------------------------
// 单个英雄
// ---------------------------------------------------------------------------
async function fetchHero(code, cacheDir, noCache) {
    let text = noCache ? null : readCache(cacheDir, code);
    const fromCache = Boolean(text);
    if (!text) {
        const url = `${BASE_URL}/heroes/${encodeURIComponent(code)}?_rsc=${Math.random().toString(36).slice(2, 10)}`;
        text = await httpGet(url);
        writeCache(cacheDir, code, text);
    }
    const found = collect(parseFlight(text));
    if (!found.build) throw new Error(`No buildStats found for ${code}`);

    return { block: found.build, trend: found.trend || [], seasons: found.seasons || [], roster: found.roster || [], fromCache };
}

function buildHeroRecord(code, raw, ctx) {
    const b = raw.block;
    const { minGames } = ctx;
    const totalBuildGames = b.totalBuildStatsGames || 0;
    const totalSetGames = b.totalSetStatsGames || 0;
    const globalWinRate = b.globalWinRate;

    const heroName = (b.buildStats[0] && b.buildStats[0].hero_name) || ctx.nameByCode[code] || code;
    const season = (b.buildStats[0] && b.buildStats[0].season_code) || null;

    const fmtRows = (rows, total, extra) => rows
        .filter(r => r.total_games >= minGames)
        .map(r => {
            const wr = rate(r.total_wins, r.total_losses);
            return Object.assign({
                games: r.total_games,
                share: total ? round(r.total_games / total, 5) : null,
                winRate: round(wr, 5),
                winRateLift: round(wr != null && globalWinRate != null ? wr - globalWinRate : null, 5),
                wins: r.total_wins,
                losses: r.total_losses,
            }, extra(r));
        });

    // 神器
    const artifacts = fmtRows(b.artifactStats || [], b.totalArtifactStatsGames || totalBuildGames, r =>
        toOptimizerArtifact(r.artifact_code, r.artifact_name, ctx.artifactsByCode, ctx.translation)
    ).sort((x, y) => y.games - x.games);

    // 套装组合 (4+2 / 2+2+2 / 单套)
    const setAgg = fmtRows(b.setAggStats || [], b.totalSetAggStatsGames || totalBuildGames, r => {
        const preset = setAggToPreset(r.set_agg_code);
        return {
            setAggCode: r.set_agg_code,
            sets: preset.names,
            setsZh: preset.zh,
            setFormat: preset.setFormat,
            inputSets: preset.inputSets,
            note: preset.note,
        };
    }).sort((x, y) => y.games - x.games);

    // 单套装使用率
    const sets = fmtRows(b.setStats || [], b.totalSetStatsGames || totalSetGames, r => ({
        setCode: r.set_code,
        set: SET_CODE_TO_NAME[r.set_code] || r.set_code,
        setZh: SET_CODE_TO_ZH[r.set_code] || r.set_name,
    })).sort((x, y) => y.games - x.games);

    // 神器 + 套装组合
    const builds = fmtRows(b.buildStats || [], totalBuildGames, r => {
        const preset = setAggToPreset(r.set_agg_code);
        return {
            artifact: toOptimizerArtifact(r.artifact_code, r.artifact_name, ctx.artifactsByCode, ctx.translation),
            setAggCode: r.set_agg_code,
            sets: preset.names,
            setsZh: preset.zh,
            setFormat: preset.setFormat,
            inputSets: preset.inputSets,
        };
    }).sort((x, y) => y.games - x.games);

    // 队友 / 对手
    const pairing = fmtRows(b.pairedWithStats || [], b.totalPairedWithStatsGames || 1, r => ({
        code: r.paired_with_hero_code,
        name: r.hero_name,
        zh: ctx.translation[r.hero_name] || null,
    })).sort((x, y) => y.games - x.games).slice(0, 12);

    const counters = fmtRows(b.playedAgainstStats || [], b.totalPlayedAgainstStatsGames || 1, r => ({
        code: r.played_against_hero_code,
        name: r.hero_name,
        zh: ctx.translation[r.hero_name] || null,
    })).sort((x, y) => y.games - x.games).slice(0, 12);

    // 出场顺序
    const pickOrder = (b.pickOrderStats || []).map(r => {
        const wr = rate(r.total_wins, r.total_losses);
        return {
            order: r.pick_order,
            games: r.total_games,
            winRate: round(wr, 5),
            winRateLift: round(wr != null ? wr - globalWinRate : null, 5),
            bans: r.total_bans,
        };
    }).sort((x, y) => y.games - x.games);

    // 趋势: 只留最近 45 天, 控制体积
    const trend = (raw.trend || [])
        .sort((x, y) => String(x.date).localeCompare(String(y.date)))
        .slice(-45)
        .map(r => ({
            date: String(r.date).slice(0, 10),
            games: r.total_games,
            winRate: round(rate(r.total_wins, r.total_losses), 4),
            bans: r.total_bans != null ? r.total_bans : null,
            prebans: r.total_prebans != null ? r.total_prebans : null,
        }));

    // ---- 给配装器的预设 ----
    // 主推组合: 取使用率最高, 若胜率明显低于均值则改用「高胜率且样本足够」的第一名
    const primaryCombo = setAgg[0] || null;
    const bestLiftCombo = setAgg
        .filter(x => x.share != null && x.share >= 0.03 && x.winRateLift != null)
        .sort((x, y) => y.winRateLift - x.winRateLift)[0] || null;
    const primaryArtifact = artifacts[0] || null;
    const bestLiftArtifact = artifacts
        .filter(x => x.share != null && x.share >= 0.03 && x.winRateLift != null)
        .sort((x, y) => y.winRateLift - x.winRateLift)[0] || null;

    return {
        name: heroName,
        zh: ctx.translation[heroName] || null,
        codeMatchedLocally: Boolean(ctx.heroesByCode[code]),
        season,
        sampleGames: totalBuildGames,
        globalWinRate: round(globalWinRate, 5),
        winRate: round(rate(
            b.buildStats.reduce((a, r) => a + r.total_wins, 0),
            b.buildStats.reduce((a, r) => a + r.total_losses, 0)
        ), 5),
        pickOrder,
        artifacts,
        setAgg,
        sets,
        builds,
        pairing,
        counters,
        trend,
        preset: {
            artifact: primaryArtifact ? { code: primaryArtifact.code, name: primaryArtifact.name, zh: primaryArtifact.zh, share: primaryArtifact.share } : null,
            setFormat: primaryCombo ? primaryCombo.setFormat : 0,
            inputSets: primaryCombo ? primaryCombo.inputSets : [[], [], []],
            inputSetsOne: primaryCombo ? primaryCombo.inputSets[0] : [],
            inputSetsTwo: primaryCombo ? primaryCombo.inputSets[1] : [],
            inputSetsThree: primaryCombo ? primaryCombo.inputSets[2] : [],
            alternative: bestLiftCombo ? {
                setFormat: bestLiftCombo.setFormat,
                inputSets: bestLiftCombo.inputSets,
                share: bestLiftCombo.share,
                winRateLift: bestLiftCombo.winRateLift,
            } : null,
            artifactAlternative: bestLiftArtifact ? {
                code: bestLiftArtifact.code,
                name: bestLiftArtifact.name,
                share: bestLiftArtifact.share,
                winRateLift: bestLiftArtifact.winRateLift,
            } : null,
        },
    };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
    const args = parseArgs(process.argv);

    const heroData = JSON.parse(fs.readFileSync(HERO_DATA_PATH, 'utf8'));
    const artifactData = JSON.parse(fs.readFileSync(ARTIFACT_DATA_PATH, 'utf8'));
    const translation = fs.existsSync(TRANSLATION_PATH)
        ? JSON.parse(fs.readFileSync(TRANSLATION_PATH, 'utf8'))
        : {};

    const heroesByCode = {};
    for (const name of Object.keys(heroData)) heroesByCode[heroData[name].code] = name;
    const artifactsByCode = {};
    for (const name of Object.keys(artifactData)) artifactsByCode[artifactData[name].code] = name;

    const ctx = { heroesByCode, artifactsByCode, translation, minGames: args.minGames, nameByCode: heroesByCode };

    let codes;
    if (args.heroes) codes = args.heroes;
    else if (args.all) codes = Object.keys(heroesByCode).filter(c => /^c\d+$/.test(c));
    else codes = ['c2185'];

    console.log(`Fetching ${codes.length} hero page(s) from epic7rtastats.com ...`);

    const out = {
        source: {
            site: BASE_URL,
            page: '/heroes/{heroCode}',
            method: 'RSC flight payload (?_rsc= + RSC: 1)',
            scope: 'RTA Champion+ , current season',
            fetchedAt: new Date().toISOString(),
        },
        season: null,
        seasons: [],
        heroRoster: [],
        heroes: {},
        errors: [],
    };

    let done = 0;
    let cached = 0;
    let fatalError = null;
    const queue = codes.slice();
    const workers = new Array(args.concurrency).fill(0).map(async () => {
        while (queue.length && !fatalError) {
            const code = queue.shift();
            try {
                const raw = await fetchHero(code, args.cacheDir, args.noCache);
                if (raw.fromCache) cached++;
                if (!out.season && raw.block.buildStats.length) out.season = raw.block.buildStats[0].season_code;
                if (!out.seasons.length && raw.seasons.length) out.seasons = raw.seasons;
                if (!out.heroRoster.length && raw.roster.length) {
                    out.heroRoster = raw.roster.map(r => ({ code: r.code, name: r.name, element: r.element, class: r.class }));
                }
                out.heroes[code] = buildHeroRecord(code, raw, ctx);
            } catch (e) {
                out.errors.push({ code, error: e.message });
                console.error(`  ✗ ${code}: ${e.message}`);
                if (e.fatal) fatalError = e;
            }
            done++;
            if (done % 10 === 0 || done === codes.length) console.log(`  ${done}/${codes.length} (cache ${cached})`);
            if (!fatalError) await sleep(args.delay + Math.floor(Math.random() * 300));
        }
    });
    await Promise.all(workers);
    if (fatalError) {
        console.error(`\n已中止: ${fatalError.message}`);
        console.error('已完成的部分仍会写入, 但请降低频率或等待一段时间后重跑(会走缓存)。');
    }

    // 站点英雄名单 vs 本地 herodata 的 code 对齐情况
    const rosterCodes = new Set(out.heroRoster.map(r => r.code));
    out.coverage = {
        siteHeroes: rosterCodes.size,
        localHeroes: Object.keys(heroesByCode).length,
        fetched: Object.keys(out.heroes).length,
        siteOnly: [...rosterCodes].filter(c => !heroesByCode[c]),
        localOnly: Object.keys(heroesByCode).filter(c => /^c\d+$/.test(c) && !rosterCodes.has(c)),
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, args.out)}  (heroes: ${Object.keys(out.heroes).length}, errors: ${out.errors.length})`);
    if (out.coverage.siteOnly.length || out.coverage.localOnly.length) {
        console.log('coverage:', JSON.stringify(out.coverage));
    }
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { parseFlight, collect, setAggToPreset, SET_CODE_TO_NAME, FOUR_PIECE_SETS, TWO_PIECE_SETS };
