#!/usr/bin/env node
/**
 * 分析 getBuilds 响应（样例：docs/rtastats/example.json），找出"最典型的面板"
 *
 * 流程：
 *   1. 套装组合占比最高
 *   2. 该套装下神器占比最高
 *   3. 该套装+神器下，gs 落在 [gs-min, gs-max] 的平均/中位面板（对照用）
 *   4. 找"6 维整体"出现最密集的区间：
 *      a) 精确分桶（会因维度爆炸而稀疏，只作反例）
 *      b) 密度法：每个属性按 IQR 归一化后，找邻域内样本最多的点，取该邻域的中心和 p25~p75
 *      c) k-means 聚类（交叉验证）
 *
 * 用法：
 *   node scripts/rtastats/analyze-panels.js
 *   node scripts/rtastats/analyze-panels.js --gs-min 420 --gs-max 444 --radius 1.0
 *   node scripts/rtastats/analyze-panels.js --file some-hero.json --top 3
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_FILE = path.join(ROOT, 'docs', 'rtastats', 'example.json');
const ARTIFACT_DATA = path.join(ROOT, 'data', 'cache', 'artifactdata.json');

const STATS = [
    { key: 'atk', zh: '攻击', step: 100 },
    { key: 'hp', zh: '生命', step: 1000 },
    { key: 'def', zh: '防御', step: 100 },
    { key: 'spd', zh: '速度', step: 5 },
    { key: 'chc', zh: '暴击率', step: 5 },
    { key: 'chd', zh: '爆伤', step: 10 },
];

const SET_ZH = {
    set_acc: '命中', set_att: '攻击', set_coop: '团结', set_counter: '反击', set_cri_dmg: '破坏',
    set_cri: '暴击', set_def: '防御', set_immune: '免疫', set_max_hp: '生命', set_penetrate: '穿透',
    set_rage: '愤怒', set_res: '抗性', set_revenge: '复仇', set_scar: '创伤', set_speed: '速度',
    set_vampire: '吸血', set_shield: '保护', set_torrent: '激流', set_revenant: '逆转', set_riposte: '还击',
    set_chase: '追击', set_opener: '先手', set_weak: '削弱', set_might: '威慑',
};

function parseArgs(argv) {
    const args = {
        file: DEFAULT_FILE,
        gsMin: 420,
        gsMax: 444,
        top: 5,
        radius: 1.0,
        kmeans: 5,
    };
    for (let i = 2; i < argv.length; i += 1) {
        const a = argv[i];
        const next = () => argv[++i];
        if (a === '--file') args.file = path.resolve(next());
        else if (a === '--gs-min') args.gsMin = Number(next());
        else if (a === '--gs-max') args.gsMax = Number(next());
        else if (a === '--top') args.top = Number(next());
        else if (a === '--radius') args.radius = Number(next());
        else if (a === '--kmeans') args.kmeans = Number(next());
        else if (a === '-h' || a === '--help') {
            console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
            process.exit(0);
        } else throw new Error(`Unknown argument: ${a}`);
    }
    return args;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function artifactNameMap() {
    if (!fs.existsSync(ARTIFACT_DATA)) return {};
    const byCode = {};
    Object.values(readJson(ARTIFACT_DATA)).forEach((artifact) => {
        if (artifact && artifact.code) byCode[artifact.code] = artifact.name;
    });
    return byCode;
}

function setComboKey(sets) {
    return Object.entries(sets || {})
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([code, count]) => `${code}:${count}`)
        .join('+');
}

function comboZh(key) {
    return key.split('+').map((part) => {
        const [code, count] = part.split(':');
        return `${SET_ZH[code] || code}${count}`;
    }).join(' + ');
}

const values = (rows, key) => rows.map((row) => Number(row[key]) || 0);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

function quantile(arr, p) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * p)];
}

function describe(rows) {
    return STATS.map((stat) => {
        const v = values(rows, stat.key);
        return `${stat.zh} ${Math.round(mean(v))} [${Math.round(quantile(v, 0.25))}~${Math.round(quantile(v, 0.75))}]`;
    }).join('  ');
}

/* ---------- 方法 a：精确分桶（反例） ---------- */
function exactBucketTop(rows, limit = 3) {
    const counts = new Map();
    rows.forEach((row) => {
        const key = STATS.map((stat) => Math.floor((Number(row[stat.key]) || 0) / stat.step) * stat.step).join('|');
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/* ---------- 方法 b：IQR 归一化 + 邻域密度 ---------- */
function iqrScale(rows) {
    const scale = {};
    STATS.forEach((stat) => {
        const v = values(rows, stat.key);
        const iqr = quantile(v, 0.75) - quantile(v, 0.25);
        scale[stat.key] = iqr > 0 ? iqr : 1;
    });
    return scale;
}

function toPoints(rows, scale) {
    return rows.map((row) => STATS.map((stat) => (Number(row[stat.key]) || 0) / scale[stat.key]));
}

function distance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

function densestRegion(rows, radius) {
    if (rows.length < 3) return null;
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
    const members = rows.filter((row, i) => distance(points[i], center) <= radius);
    return { center: rows[bestIndex], members, count: members.length, share: members.length / rows.length, scale };
}

/* ---------- 方法 c：k-means ---------- */
function kmeans(rows, k, iterations = 40) {
    if (rows.length < k) return [];
    const scale = iqrScale(rows);
    const points = toPoints(rows, scale);
    let centroids = [];
    for (let i = 0; i < k; i += 1) centroids.push(points[Math.floor((i * points.length) / k)].slice());

    const assignment = new Array(points.length).fill(0);
    for (let it = 0; it < iterations; it += 1) {
        for (let i = 0; i < points.length; i += 1) {
            let best = Infinity;
            let bestC = 0;
            for (let c = 0; c < k; c += 1) {
                const d = distance(points[i], centroids[c]);
                if (d < best) {
                    best = d;
                    bestC = c;
                }
            }
            assignment[i] = bestC;
        }
        for (let c = 0; c < k; c += 1) {
            const members = points.filter((_, i) => assignment[i] === c);
            if (members.length) {
                centroids[c] = STATS.map((_, d) => mean(members.map((p) => p[d])));
            }
        }
    }

    const groups = Array.from({ length: k }, () => []);
    assignment.forEach((c, i) => groups[c].push(rows[i]));
    return groups
        .filter((group) => group.length)
        .map((group) => ({ count: group.length, rows: group }))
        .sort((a, b) => b.count - a.count);
}

function main() {
    const args = parseArgs(process.argv);
    const payload = readJson(args.file);
    const rows = Array.isArray(payload) ? payload : payload.data || payload.builds || [];
    if (!rows.length) throw new Error('没有找到数据数组（data / builds）');

    const artifactNames = artifactNameMap();
    const total = rows.length;
    const hero = rows[0].unitName || rows[0].unitCode || '?';

    console.log(`文件: ${path.relative(ROOT, args.file)}`);
    console.log(`记录: ${total} | 英雄: ${hero} | gs ${Math.min(...values(rows, 'gs'))}~${Math.max(...values(rows, 'gs'))}`);

    // 1) 套装组合
    const combos = new Map();
    rows.forEach((row) => {
        const key = setComboKey(row.sets);
        combos.set(key, (combos.get(key) || 0) + 1);
    });
    const comboRows = [...combos.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n=== 1. 套装组合 top ${args.top} ===`);
    comboRows.slice(0, args.top).forEach(([key, count], i) => {
        console.log(`${String(i + 1).padStart(2)}. ${comboZh(key).padEnd(20)} ${String(count).padStart(5)} 条 (${(count / total * 100).toFixed(1)}%)`);
    });

    const topCombo = comboRows[0][0];
    const comboSubset = rows.filter((row) => setComboKey(row.sets) === topCombo);

    // 2) 神器
    const artifacts = new Map();
    comboSubset.forEach((row) => {
        const code = row.artifactCode || '?';
        artifacts.set(code, (artifacts.get(code) || 0) + 1);
    });
    const artifactRows = [...artifacts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n=== 2. ${comboZh(topCombo)} 下神器 top ${args.top} ===`);
    artifactRows.slice(0, args.top).forEach(([code, count], i) => {
        console.log(`${String(i + 1).padStart(2)}. ${(artifactNames[code] || code).padEnd(22)} ${String(count).padStart(4)} 条 (${(count / comboSubset.length * 100).toFixed(1)}%)  [${code}]`);
    });

    const topArtifact = artifactRows[0][0];
    const subset = comboSubset.filter((row) => row.artifactCode === topArtifact);
    const gsSubset = subset.filter((row) => row.gs >= args.gsMin && row.gs <= args.gsMax);

    // 3) 平均值对照
    console.log(`\n=== 3. 对照：${comboZh(topCombo)} + ${artifactNames[topArtifact] || topArtifact} ===`);
    console.log(`子集 ${subset.length} 条；gs ${args.gsMin}~${args.gsMax} 内 ${gsSubset.length} 条`);
    if (gsSubset.length) {
        const avg = STATS.map((stat) => `${stat.zh} ${Math.round(mean(values(gsSubset, stat.key)))}`).join('  ');
        console.log(`gs 区间平均: ${avg}`);
    }

    // 4a) 精确分桶（反例）
    console.log('\n=== 4a. 精确分桶（6 维）===');
    const buckets = exactBucketTop(subset, 3);
    buckets.forEach(([key, count], i) => {
        console.log(`  ${i + 1}. ${String(count).padStart(3)} 条 (${(count / subset.length * 100).toFixed(1)}%)  ${key.replace(/\|/g, ' / ')}`);
    });
    console.log(`  桶数 ${new Set(subset.map((row) => STATS.map((s) => Math.floor((Number(row[s.key]) || 0) / s.step) * s.step).join('|'))).size}，样本 ${subset.length} 条 → 精确命中太稀疏`);

    // 4b) 密度法
    console.log(`\n=== 4b. 密度法（IQR 归一化，半径 ${args.radius}）===`);
    [
        { label: `套装+神器 ${subset.length} 条`, rows: subset },
        { label: `套装+神器 + gs ${args.gsMin}~${args.gsMax} ${gsSubset.length} 条`, rows: gsSubset },
    ].forEach((variant) => {
        const region = densestRegion(variant.rows, args.radius);
        if (!region) return;
        console.log(`  --- ${variant.label}`);
        console.log(`  最密邻域 ${region.count} 条 (${(region.share * 100).toFixed(1)}%)`);
        console.log(`  中心 : ${STATS.map((stat) => `${stat.zh} ${Math.round(Number(region.center[stat.key]) || 0)}`).join('  ')}`);
        console.log(`  区间 : ${describe(region.members)}`);
    });

    // 4c) k-means
    console.log(`\n=== 4c. k-means k=${args.kmeans}（交叉验证）===`);
    kmeans(subset, args.kmeans).forEach((cluster) => {
        console.log(`  ${String(cluster.count).padStart(4)} 条 (${(cluster.count / subset.length * 100).toFixed(1)}%)  ${describe(cluster.rows)}`);
    });
}

if (require.main === module) main();

module.exports = { densestRegion, kmeans, exactBucketTop, iqrScale, STATS };
