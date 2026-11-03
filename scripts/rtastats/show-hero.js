#!/usr/bin/env node
/**
 * 在终端查看某个英雄的合并预设
 *
 *   node scripts/rtastats/show-hero.js 里安娜路西艾拉
 *   node scripts/rtastats/show-hero.js c2185
 *   node scripts/rtastats/show-hero.js --low      # 列出低置信度的英雄
 *   node scripts/rtastats/show-hero.js --stats    # 数据集概览
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data', 'rtastats', 'hero-presets.json');

const pad = (s, n) => {
    s = s == null ? '' : String(s);
    let w = 0;
    for (const ch of s) w += /[\u2e80-\uffff]/.test(ch) ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w));
};

function main() {
    const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const heroes = data.heroes;
    const arg = process.argv[2];

    if (!arg || arg === '--help' || arg === '-h') {
        console.log('用法: node scripts/rtastats/show-hero.js <中文名|英文名|code>');
        console.log('      node scripts/rtastats/show-hero.js --low   低置信度(样本小)的英雄');
        console.log('      node scripts/rtastats/show-hero.js --stats 数据集概览');
        return;
    }

    if (arg === '--stats') {
        const all = Object.values(heroes);
        const conf = { high: 0, medium: 0, low: 0 };
        all.forEach(h => conf[h.preset.confidence]++);
        console.log(`英雄数: ${all.length}`);
        console.log(`置信度: high ${conf.high} / medium ${conf.medium} / low ${conf.low}`);
        console.log(`生成时间: ${data.generatedAt}`);
        console.log(`官方赛季: ${data.sources.official.season.name} (${data.sources.official.season.code})`);
        return;
    }

    if (arg === '--low') {
        Object.values(heroes)
            .filter(h => h.preset.confidence === 'low')
            .sort((a, b) => a.preset.sampleCount - b.preset.sampleCount)
            .forEach(h => console.log(`${pad(h.zh, 16)} ${pad(h.code, 8)} sample=${pad(h.preset.sampleCount, 6)} ${h.preset.confidence}`));
        return;
    }

    const hit = Object.values(heroes).find(h =>
        h.code === arg || h.zh === arg || h.name === arg || (h.name && h.name.toLowerCase() === arg.toLowerCase()));

    if (!hit) {
        console.error(`没找到: ${arg}`);
        process.exit(1);
    }

    const p = hit.preset;
    console.log(`\n${hit.zh} (${hit.name})  ${hit.code}  ${hit.role || ''}`);
    console.log(`数据: 官方 ${hit.official ? hit.official.tierZh + ' / ' + hit.official.dataDate : '-'}` +
        `  |  RTA ${hit.rta ? 'Champion+ / ' + hit.rta.sampleGames + ' 场' : '-'}` +
        `  |  置信度 ${p.confidence} (${p.sampleCount})`);

    if (hit.baseStats) {
        console.log(`基础: 攻${hit.baseStats.atk} 生${hit.baseStats.hp} 防${hit.baseStats.def} 速${hit.baseStats.spd} 暴${hit.baseStats.cr} 爆${hit.baseStats.cd}`);
    }

    console.log('\n套装(按使用率):');
    p.setCandidates.forEach((s, i) => {
        console.log(`  ${i + 1}. ${pad(s.setsZh.join(' + '), 14)} 占 ${pad(s.share + '%', 7)} 胜率 ${pad(s.winRate + '%', 7)} 格式${s.setFormat} ${JSON.stringify(s.inputSets)}${s.note ? '  (' + s.note + ')' : ''}`);
    });

    console.log('\n神器:');
    if (p.artifact) console.log(`  ${p.artifact.zh || p.artifact.name}  占 ${p.artifact.share}%  胜率 ${p.artifact.winRate}%`);
    p.artifactAlternatives.forEach(a => console.log(`  (备选) ${a.zh || a.name}  占 ${a.share}%`));

    console.log('\n目标属性(官方分布):');
    const order = ['spd', 'cr', 'cd', 'atk', 'hp', 'def', 'eff', 'res'];
    const t = p.targetStats || {};
    order.filter(k => t[k]).forEach(k => {
        const s = t[k];
        console.log(`  ${pad(s.zh, 8)} P50 ${pad(s.p50, 12)} P75 ${pad(s.p75, 12)} P90 ${pad(s.p90, 12)}`);
    });

    if (p.skillPriority) console.log(`\n技能优先级: ${p.skillPriority.join(' > ')}`);
}

main();
