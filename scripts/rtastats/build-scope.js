#!/usr/bin/env node
/**
 * 生成 RTAStats 的导入范围：
 *   国服大师出场量 >= 阈值的英雄  ∪  docs/rtastats/skill_priority.json 名单
 *
 * 需要先跑：
 *   node scripts/e7stats/fetch-official-hero.js --heroes <全部 code> --tier master \
 *     --out data/rtastats/e7stats-all-master.json
 *
 * 用法：
 *   node scripts/rtastats/build-scope.js
 *   node scripts/rtastats/build-scope.js --min-usage 300
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HERO_DATA = path.join(ROOT, 'data', 'cache', 'herodata.json');
const TRANSLATION = path.join(ROOT, 'data', 'locales', 'zh', 'translation.json');
const SKILL = path.join(ROOT, 'docs', 'rtastats', 'skill_priority.json');
const OFFICIAL = path.join(ROOT, 'data', 'rtastats', 'e7stats-all-master.json');
const TOOL_POOL = path.join(ROOT, 'data', 'rtastats', 'tool-hero-pool.json');
const OUT = path.join(ROOT, 'data', 'rtastats', 'scope.json');

function parseArgs(argv) {
    const args = {
        minUsage: 0,          // 0 = 不按出场量筛
        includeSkill: false,  // 是否额外并入 skill_priority 名单
        toolPool: TOOL_POOL,  // e7Rta 模型的英雄池
        out: OUT,
    };
    for (let i = 2; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--min-usage') args.minUsage = Number(argv[++i]);
        else if (a === '--include-skill') args.includeSkill = true;
        else if (a === '--no-tool-pool') args.toolPool = null;
        else if (a === '--tool-pool') args.toolPool = path.resolve(argv[++i]);
        else if (a === '--out') args.out = path.resolve(argv[++i]);
        else if (a === '-h' || a === '--help') {
            console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
            process.exit(0);
        } else throw new Error(`Unknown argument: ${a}`);
    }
    return args;
}

function readJson(file) {
    if (!fs.existsSync(file)) throw new Error(`缺少文件: ${path.relative(ROOT, file)}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
    const args = parseArgs(process.argv);

    const heroData = readJson(HERO_DATA);
    const translation = readJson(TRANSLATION);
    const skill = fs.existsSync(SKILL) ? readJson(SKILL) : {};
    const official = readJson(OFFICIAL);

    // 工具池（没有就退回"出场量 ∪ 技能名单"的老逻辑）
    const toolPool = args.toolPool && fs.existsSync(args.toolPool) ? readJson(args.toolPool) : null;
    const inToolPool = new Set(toolPool && Array.isArray(toolPool.hero_list) ? toolPool.hero_list : []);

    // 中文名 -> 英文名（skill_priority 用的是中文名）
    const zhToEn = {};
    Object.entries(translation).forEach(([en, zh]) => {
        if (typeof zh === 'string' && !zhToEn[zh]) zhToEn[zh] = en;
    });

    const ALIASES = { '海洋猎手芙兰': 'Pirate Captain Flan' };

    const inSkillList = new Set();
    Object.keys(skill).forEach((zhName) => {
        const en = ALIASES[zhName] || zhToEn[zhName];
        const hero = en ? heroData[en] : null;
        if (hero) inSkillList.add(hero.code);
    });

    const rows = [];
    Object.keys(heroData).forEach((name) => {
        const hero = heroData[name];
        const code = hero.code;
        if (!/^c\d+$/.test(code)) return;

        const officialHero = official.heroes && official.heroes[code];
        const tier = officialHero && officialHero.tiers ? officialHero.tiers.master : null;
        const usage = tier && tier.available && tier.sampleTotal ? tier.sampleTotal.spd : 0;
        const winRate = tier && tier.available && tier.winRate ? tier.winRate.win_rate : null;
        const firstPickRate = tier && tier.available && tier.pick && tier.pick[0] ? tier.pick[0].rate : null;
        const hasData = Boolean(tier && tier.available);

        const reasons = [];
        if (inToolPool.has(code)) reasons.push('tool');
        if (args.minUsage > 0 && hasData && usage >= args.minUsage) reasons.push('usage');
        if (args.includeSkill && inSkillList.has(code)) reasons.push('skill');

        rows.push({
            code,
            name,
            zh: translation[name] || null,
            usage,
            firstPickRate,
            winRate,
            hasData,
            reasons,
        });
    });

    const selected = rows
        .filter((row) => row.reasons.length)
        .sort((a, b) => b.usage - a.usage || String(a.zh || a.name).localeCompare(String(b.zh || b.name), 'zh-Hans-CN'));

    const out = {
        generatedAt: new Date().toISOString(),
        basis: {
            toolPool: toolPool ? toolPool.count : 0,
            minUsage: args.minUsage,
            includeSkill: args.includeSkill,
        },
        total: selected.length,
        byReason: {
            tool: selected.filter((row) => row.reasons.includes('tool')).length,
            usage: selected.filter((row) => row.reasons.includes('usage')).length,
            skill: selected.filter((row) => row.reasons.includes('skill')).length,
        },
        heroes: selected,
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(out, null, 1));

    console.log(`官方有数据: ${rows.filter((row) => row.hasData).length} / ${rows.length}`);
    console.log(`工具模型池: ${out.byReason.tool} 个`);
    if (args.minUsage > 0) console.log(`出场量 >= ${args.minUsage}: ${out.byReason.usage} 个`);
    if (args.includeSkill) console.log(`技能名单: ${out.byReason.skill} 个`);
    console.log(`合计导入: ${selected.length} 个`);
    console.log('\n前 15（按出场量）:');
    selected.slice(0, 15).forEach((row, i) => {
        console.log(
            String(i + 1).padStart(2),
            (row.zh || row.name).padEnd(14),
            'usage', String(row.usage).padStart(6),
            '| 首抢', String(row.firstPickRate).padStart(5) + '%',
            '|', row.reasons.join('+')
        );
    });
    console.log(`\nWrote ${path.relative(ROOT, args.out)}`);
}

if (require.main === module) main();

module.exports = {};
