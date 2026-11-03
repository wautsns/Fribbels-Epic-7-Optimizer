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
 * 从 10 段分布里取"目标值"：
 *   1. 找人数最多的那一段 (maxCount)
 *   2. 只保留 count >= 0.8 * maxCount 的段
 *   3. 每段取该段的最大值 = 该段的上界
 *      （顶段的上界就是站点给的范围上限，比如速度 290-310 取 310）
 *   4. 这些值里取最大的，向上取整
 */
function targetFromBands(bands) {
    if (!Array.isArray(bands) || !bands.length) return null;

    const counts = bands.map((band) => Number(band.count) || 0);
    const maxCount = Math.max(...counts);
    if (!(maxCount > 0)) return null;

    const threshold = maxCount * 0.8;
    let best = null;

    bands.forEach((band) => {
        if ((Number(band.count) || 0) < threshold) return;
        const edge = Number(band.to);
        if (!Number.isFinite(edge)) return;
        if (best == null || edge > best) best = edge;
    });

    return best == null ? null : Math.ceil(best);
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
            const target = targetFromBands(entry.bands);
            if (target != null) statMinimums[stat] = target;
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
            // 排序/展示用的热度指标（导入时按 usage 降序，也就是"选出率/出场量"）
            usage: record.official && record.official.sampleTotal ? record.official.sampleTotal.spd : null,
            firstPickRate: record.official && record.official.pick && record.official.pick[0]
                ? record.official.pick[0].rate : null,
            banRate: record.official && record.official.ban && record.official.ban[0]
                ? record.official.ban[0].rate : null,
            rtaGames: record.rta ? record.rta.sampleGames : null,
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

module.exports = { targetFromBands };
