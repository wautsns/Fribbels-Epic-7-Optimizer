#!/usr/bin/env node
/**
 * 把 data/rtastats/hero-presets.json 压成配装器前端用的精简数据
 *   -> app/js/data/rtaStats.json
 *
 * 只保留 UI 需要的字段: 套装候选 / 神器 / 目标属性摘要 / 建议的属性下限 / 技能优先级。
 * 原始 8 属性 x 10 段的完整分布还在 data/rtastats/hero-presets.json 里, 不塞进前端包。
 *
 * 用法:
 *   node scripts/rtastats/build-app-presets.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const IN = path.join(ROOT, 'data', 'rtastats', 'hero-presets.json');
const OUT = path.join(ROOT, 'app', 'js', 'data', 'rtaStats.json');

const STAT_ORDER = ['spd', 'cr', 'cd', 'atk', 'hp', 'def', 'eff', 'res'];

/**
 * 把分布摘要(">= 290" / "230-250" / "<= 12100") 转成优化器能用的"下限"。
 * 只有存在下界时才给值; "<= X" 这类上界不给, 避免把用户装备卡死。
 */
function lowerBound(label) {
    if (!label) return null;
    const text = String(label).trim();
    let m = /^>=\s*([\d.]+)/.exec(text);
    if (m) return Math.ceil(Number(m[1]));
    m = /^([\d.]+)\s*[~-]\s*([\d.]+)/.exec(text);
    if (m) return Math.ceil(Number(m[1]));
    return null;
}

function main() {
    const source = JSON.parse(fs.readFileSync(IN, 'utf8'));
    const heroes = {};

    let withSets = 0;
    let withStats = 0;

    for (const record of Object.values(source.heroes)) {
        if (!record || !record.name) continue;

        const preset = record.preset || {};
        const sets = (preset.setCandidates || []).slice(0, 3).map(candidate => ({
            inputSets: candidate.inputSets,
            setFormat: candidate.setFormat,
            zh: candidate.setsZh,
            share: candidate.share,
            winRate: candidate.winRate,
            note: candidate.note || null,
        }));

        const targets = preset.targetStats || {};
        const targetSummary = {};
        const statMinimums = {};
        for (const stat of STAT_ORDER) {
            const entry = targets[stat];
            if (!entry) continue;
            targetSummary[stat] = { p50: entry.p50, p75: entry.p75, p90: entry.p90 };
            const min = lowerBound(entry.p50);
            if (min != null) statMinimums[stat] = min;
        }

        if (sets.length) withSets++;
        if (Object.keys(statMinimums).length) withStats++;

        heroes[record.name] = {
            code: record.code,
            name: record.name,
            zh: record.zh,
            role: record.role,
            tier: record.official ? record.official.tier : null,
            tierZh: record.official ? record.official.tierZh : null,
            dataDate: record.official ? record.official.dataDate : null,
            season: source.sources && source.sources.official && source.sources.official.season
                ? source.sources.official.season.code : null,
            confidence: preset.confidence,
            sampleCount: preset.sampleCount,
            winRate: record.official && record.official.winRate ? record.official.winRate.value : null,
            sets,
            artifact: preset.artifact ? {
                name: preset.artifact.name,
                zh: preset.artifact.zh,
                share: preset.artifact.share,
                winRate: preset.artifact.winRate,
            } : null,
            targets: targetSummary,
            statMinimums,
            skillPriority: preset.skillPriority || null,
        };
    }

    const out = {
        generatedAt: source.generatedAt,
        note: '由 scripts/rtastats/build-app-presets.js 生成, 数据来自国服官方战绩站(大师段位) + epic7rtastats(神器)',
        source: source.sources,
        statOrder: STAT_ORDER,
        heroes,
    };

    const text = JSON.stringify(out);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);

    console.log(`英雄: ${Object.keys(heroes).length}`);
    console.log(`  有套装: ${withSets}`);
    console.log(`  有属性下限: ${withStats}`);
    console.log(`Wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

if (require.main === module) main();

module.exports = { lowerBound };
