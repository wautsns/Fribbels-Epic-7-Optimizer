#!/usr/bin/env node
/**
 * 合并两个数据源, 生成配装器可直接用的英雄预设
 *
 *   官方战绩站(国服, 按段位)  -> 套装组合(有序) / 面板属性分布 / 胜率排名
 *   epic7rtastats(全球, Champion+) -> 神器 / 队友 / 对阵
 *   docs/rtastats/skill_priority.json -> 技能加点优先级(手动维护)
 *
 * 用法:
 *   node scripts/rtastats/build-hero-presets.js \
 *     --official data/rtastats/e7stats-all-master.json \
 *     --rta data/rtastats/e7rta-scope.json \
 *     --scope data/rtastats/scope.json \
 *     --out data/rtastats/hero-presets.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
    const args = {
        official: path.join(ROOT, 'data', 'rtastats', 'e7stats-all-master.json'),
        rta: path.join(ROOT, 'data', 'rtastats', 'e7rta-scope.json'),
        skill: path.join(ROOT, 'docs', 'rtastats', 'skill_priority.json'),
        scope: path.join(ROOT, 'data', 'rtastats', 'scope.json'),
        out: path.join(ROOT, 'data', 'rtastats', 'hero-presets.json'),
        csv: path.join(ROOT, 'data', 'rtastats', 'hero-presets.csv'),
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--official') args.official = path.resolve(next());
        else if (a === '--rta') args.rta = path.resolve(next());
        else if (a === '--skill') args.skill = path.resolve(next());
        else if (a === '--scope') args.scope = path.resolve(next());
        else if (a === '--out') args.out = path.resolve(next());
        else if (a === '--csv') args.csv = path.resolve(next());
        else if (a === '-h' || a === '--help') {
            console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
            process.exit(0);
        } else throw new Error(`Unknown argument: ${a}`);
    }
    return args;
}

function readJson(file) {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
    const args = parseArgs(process.argv);

    const official = readJson(args.official);
    const rta = readJson(args.rta);
    const skill = readJson(args.skill) || {};
    const translation = readJson(path.join(ROOT, 'data', 'locales', 'zh', 'translation.json')) || {};
    const heroData = readJson(path.join(ROOT, 'data', 'cache', 'herodata.json')) || {};

    const heroesByCode = {};
    for (const name of Object.keys(heroData)) heroesByCode[heroData[name].code] = { name, hero: heroData[name] };

    // 中文名 -> code (以 skill_priority.json 的键为准)
    const zhToEn = {};
    for (const [en, zh] of Object.entries(translation)) {
        if (typeof zh === 'string' && !zhToEn[zh]) zhToEn[zh] = en;
    }

    // skill_priority.json 里偶尔用别的译名, 这里补别名 (值是 herodata 里的英文名)
    const SKILL_NAME_ALIASES = {
        // 海洋猎手芙兰 是 translation.json 里的正式译名，这里给她另一个叫法也指同一个英雄
        '海盗船长芙兰': 'Pirate Captain Flan',
    };

    const skillPlans = {};
    const unresolved = [];
    const duplicates = [];
    // 先处理规范译名(能直接查到的), 别名最后兜底, 避免别名覆盖正式条目
    const skillNames = Object.keys(skill).sort((a, b) => {
        const aAlias = SKILL_NAME_ALIASES[a] ? 1 : 0;
        const bAlias = SKILL_NAME_ALIASES[b] ? 1 : 0;
        return aAlias - bAlias;
    });
    for (const zhName of skillNames) {
        const aliasEn = SKILL_NAME_ALIASES[zhName];
        const en = aliasEn || zhToEn[zhName];
        const hero = en ? heroData[en] : null;
        if (!hero) {
            unresolved.push({ zh: zhName, en: en || null, reason: 'herodata 里找不到对应英雄' });
            continue;
        }
        if (skillPlans[hero.code]) {
            // 同一个英雄出现两次(别名), 两个技能方案不同时记下来, 保留先出现的
            if (JSON.stringify(skillPlans[hero.code].plan) !== JSON.stringify(skill[zhName])) {
                duplicates.push({ code: hero.code, zh: zhName, kept: skillPlans[hero.code].zh });
            }
            continue;
        }
        skillPlans[hero.code] = { zh: zhName, plan: skill[zhName] };
    }

    // 导入范围：优先用 scope.json（国服大师出场量 >= 阈值 ∪ 技能名单）
    const scope = readJson(args.scope);
    let codes;
    if (scope && Array.isArray(scope.heroes) && scope.heroes.length) {
        codes = new Set(scope.heroes.map(hero => hero.code));
    } else {
        codes = new Set([
            ...Object.keys(skillPlans),
            ...Object.keys((official && official.heroes) || {}),
            ...Object.keys((rta && rta.heroes) || {}),
        ]);
    }

    const out = {
        generatedAt: new Date().toISOString(),
        sources: {
            official: official ? { season: official.season, scope: official.source.scope, fetchedAt: official.source.fetchedAt, tier: args.official.includes('master') ? 'master' : undefined } : null,
            rta: rta ? { season: rta.season, scope: 'RTA Champion+ (global)', fetchedAt: rta.source.fetchedAt } : null,
            skillPriority: 'docs/rtastats/skill_priority.json',
            scope: scope ? { file: 'data/rtastats/scope.json', minUsage: scope.minUsage, total: scope.total } : null,
        },
        unresolvedSkillHeroes: unresolved,
        duplicateSkillHeroes: duplicates,
        heroes: {},
    };

    const rows = [];
    const toPct = v => (v == null || !isFinite(v) ? null : Number((v * 100).toFixed(2)));

    // e7rta 的比例都是 0~1, 官方站是 0~100, 这里统一成百分比
    const normalizeRta = r => {
        if (!r) return null;
        const fix = x => Object.assign({}, x, {
            share: toPct(x.share),
            winRate: toPct(x.winRate),
            winRateLift: x.winRateLift == null ? null : toPct(x.winRateLift),
        });
        return {
            season: r.season,
            sampleGames: r.sampleGames,
            winRate: toPct(r.winRate),
            globalWinRate: toPct(r.globalWinRate),
            artifacts: (r.artifacts || []).map(fix),
            setAgg: (r.setAgg || []).map(fix),
            sets: (r.sets || []).map(fix),
            pairing: (r.pairing || []).map(fix),
            counters: (r.counters || []).map(fix),
        };
    };

    for (const code of [...codes].sort()) {
        const o = (official && official.heroes && official.heroes[code]) || null;
        const r = normalizeRta((rta && rta.heroes && rta.heroes[code]) || null);
        const local = heroesByCode[code] || null;
        const skillInfo = skillPlans[code] || null;

        // 官方数据里优先取 master, 没有就取任意可用段位
        const tierCode = o && o.tiers
            ? (o.tiers.master && o.tiers.master.available ? 'master'
                : Object.keys(o.tiers).find(t => o.tiers[t] && o.tiers[t].available))
            : null;
        const tier = tierCode ? o.tiers[tierCode] : null;

        const setCandidates = [];
        if (tier && tier.equips) {
            for (const e of tier.equips.slice(0, 3)) {
                setCandidates.push({
                    source: `official:${tierCode}`,
                    setFormat: e.setFormat,
                    inputSets: e.inputSets,
                    sets: e.names,
                    setsZh: e.zh,
                    share: e.rate,
                    winRate: e.winRate,
                    note: e.note,
                });
            }
        }
        if (!setCandidates.length && r && r.setAgg) {
            for (const e of r.setAgg.slice(0, 3)) {
                setCandidates.push({
                    source: 'e7rta',
                    setFormat: e.setFormat,
                    inputSets: e.inputSets,
                    sets: e.sets,
                    setsZh: e.setsZh,
                    share: e.share,
                    winRate: e.winRate,
                    note: e.note,
                });
            }
        }

        const artifact = r && r.artifacts && r.artifacts[0] ? {
            code: r.artifacts[0].code,
            name: r.artifacts[0].name,
            zh: r.artifacts[0].zh,
            share: r.artifacts[0].share,
            winRate: r.artifacts[0].winRate,
        } : null;

        const targetStats = tier && tier.stats ? Object.keys(tier.stats).reduce((acc, stat) => {
            const s = tier.stats[stat];
            acc[stat] = {
                zh: s.zh,
                range: s.range,
                p50: s.p50.label,
                p75: s.p75.label,
                p90: s.p90.label,
                topBandPct: s.topBandPct,
                bands: s.bands,
            };
            return acc;
        }, {}) : null;

        // 样本量只是站点自己的加权计数(含义未公开), 用相对大小做置信度提示
        const sampleCount = tier && tier.sampleTotal ? tier.sampleTotal.spd : 0;
        const confidence = sampleCount >= 2000 ? 'high' : (sampleCount >= 300 ? 'medium' : 'low');

        const record = {
            code,
            name: local ? local.name : (o && o.name) || null,
            zh: (local && translation[local.name]) || (o && o.zh) || (skillInfo && skillInfo.zh) || null,
            role: local ? local.hero.role : (o && o.role) || null,
            baseStats: o && o.baseStats ? o.baseStats : null,
            official: tier ? {
                tier: tierCode,
                tierZh: tier.zh,
                dataDate: tier.dataDate,
                winRate: tier.winRate ? { value: tier.winRate.win_rate, rank: tier.winRate.rank } : null,
                heroCountInTier: tier.heroCountInTier,
                pick: tier.pick,
                ban: tier.ban,
                equips: tier.equips,
                sampleTotal: tier.sampleTotal,
            } : null,
            rta: r ? {
                season: r.season,
                sampleGames: r.sampleGames,
                winRate: r.winRate,
                globalWinRate: r.globalWinRate,
                artifacts: r.artifacts,
                setAgg: r.setAgg,
                sets: r.sets,
                pairing: r.pairing,
                counters: r.counters,
            } : null,
            skillPlan: skillInfo ? skillInfo.plan : null,
            preset: {
                setCandidates,
                primary: setCandidates[0] || null,
                artifact,
                artifactAlternatives: r && r.artifacts ? r.artifacts.slice(1, 3).map(a => ({
                    code: a.code, name: a.name, zh: a.zh, share: a.share, winRate: a.winRate,
                })) : [],
                targetStats,
                sampleCount,
                confidence,
                skillPriority: skillInfo ? skillInfo.plan.priority : null,
            },
        };

        out.heroes[code] = record;

        const spd = targetStats && targetStats.spd;
        const cr = targetStats && targetStats.cr;
        const cd = targetStats && targetStats.cd;
        rows.push({
            code,
            zh: record.zh || '',
            name: record.name || '',
            role: record.role || '',
            set: setCandidates[0] ? setCandidates[0].setsZh.join('+') : '',
            setFormat: setCandidates[0] ? setCandidates[0].setFormat : '',
            inputSets: setCandidates[0] ? JSON.stringify(setCandidates[0].inputSets) : '',
            artifact: artifact ? (artifact.zh || artifact.name) : '',
            spd: spd ? spd.p50 : '',
            cr: cr ? cr.p50 : '',
            cd: cd ? cd.p50 : '',
            hp: targetStats && targetStats.hp ? targetStats.hp.p50 : '',
            def: targetStats && targetStats.def ? targetStats.def.p50 : '',
            winRate: (o && tier && tier.winRate && tier.winRate.win_rate) || (r && r.winRate) || '',
            games: (r && r.sampleGames) || '',
            sample: sampleCount,
            confidence,
            skill: record.preset.skillPriority ? record.preset.skillPriority.join('>') : '',
        });
    }

    rows.sort((a, b) => (Number(b.games) || 0) - (Number(a.games) || 0));

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(out, null, 2));

    const header = ['code', 'zh', 'name', 'role', 'set', 'setFormat', 'inputSets', 'artifact', 'spd', 'cr', 'cd', 'hp', 'def', 'winRate', 'games', 'sample', 'confidence', 'skill'];
    const csv = [header.join(',')].concat(rows.map(row => header.map(h => {
        const v = row[h] == null ? '' : String(row[h]);
        return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','))).join('\n');
    fs.writeFileSync(args.csv, '\ufeff' + csv);

    console.log(`heroes: ${Object.keys(out.heroes).length}`);
    console.log(`  官方有数据: ${Object.values(out.heroes).filter(h => h.official).length}`);
    console.log(`  RTA 有数据: ${Object.values(out.heroes).filter(h => h.rta).length}`);
    console.log(`  有套装预设: ${Object.values(out.heroes).filter(h => h.preset.primary).length}`);
    console.log(`  有神器: ${Object.values(out.heroes).filter(h => h.preset.artifact).length}`);
    console.log(`  有目标属性: ${Object.values(out.heroes).filter(h => h.preset.targetStats).length}`);
    const byConfidence = { high: 0, medium: 0, low: 0 };
    Object.values(out.heroes).forEach(h => { byConfidence[h.preset.confidence] = (byConfidence[h.preset.confidence] || 0) + 1; });
    console.log(`  置信度: high ${byConfidence.high} / medium ${byConfidence.medium} / low ${byConfidence.low}`);
    if (unresolved.length) console.log(`  未能解析的技能表英雄: ${unresolved.map(u => u.zh).join(', ')}`);
    console.log(`\nWrote ${path.relative(ROOT, args.out)}`);
    console.log(`Wrote ${path.relative(ROOT, args.csv)}`);
}

if (require.main === module) {
    main();
}

module.exports = {};
