/* global Files */
const fs = require('fs');
const path = require('path');
const Swal = require('sweetalert2');

// 随包发布的预设数据（scripts/meta/build-app-presets.js 生成）
const bundledData = require('../data/rtaStats.json');

// 本地缓存 / 配置放在 userData 目录下（和 herodata.json 一个地方）
const CACHE_FILE = 'cache/rtastats.json';
const CONFIG_FILE = 'rtaStatsConfig.json';

// 属性 -> 中文 / 优化器输入框 id
const STAT_META = {
    spd: { zh: '速度', inputId: 'inputMinSpdLimit' },
    cr: { zh: '暴击率', inputId: 'inputMinCrLimit' },
    cd: { zh: '暴击伤害', inputId: 'inputMinCdLimit' },
    atk: { zh: '攻击', inputId: 'inputMinAtkLimit' },
    hp: { zh: '生命', inputId: 'inputMinHpLimit' },
    def: { zh: '防御', inputId: 'inputMinDefLimit' },
    eff: { zh: '效果命中', inputId: 'inputMinEffLimit' },
    res: { zh: '效果抗性', inputId: 'inputMinResLimit' },
};

const CONFIDENCE_TEXT = {
    high: '样本充足',
    medium: '样本一般',
    low: '样本偏少',
};

let data = bundledData;
let loadedFrom = 'bundled';
const config = { autoApply: true };
const byName = {};

function normalizeName(name) {
    return String(name == null ? '' : name)
        .trim()
        .toLowerCase();
}

function indexHeroes() {
    Object.keys(byName).forEach((key) => delete byName[key]);
    Object.values((data && data.heroes) || {}).forEach((preset) => {
        if (preset.name) byName[normalizeName(preset.name)] = preset;
        if (preset.zh) byName[normalizeName(preset.zh)] = preset;
    });
}

function dataTimestamp(payload) {
    const time =
        payload && payload.generatedAt ? Date.parse(payload.generatedAt) : NaN;
    return Number.isFinite(time) ? time : 0;
}

function readLocalJson(filePath) {
    try {
        const text = Files.readFileSync(`${Files.getDataPath()}/${filePath}`);
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
}

function readBundledFromDisk() {
    try {
        return JSON.parse(
            fs.readFileSync(
                path.join(__dirname, '..', 'data', 'rtaStats.json'),
                'utf8'
            )
        );
    } catch (e) {
        return null;
    }
}

function loadConfig() {
    const saved = readLocalJson(CONFIG_FILE);
    if (saved && typeof saved.autoApply === 'boolean') {
        config.autoApply = saved.autoApply;
    }
}

function saveConfig() {
    try {
        Files.saveFile(
            `${Files.getDataPath()}/${CONFIG_FILE}`,
            JSON.stringify(config, null, 2)
        );
    } catch (e) {
        console.warn('RTAStats: 保存配置失败', e && e.message);
    }
}

/**
 * 重新加载数据：本地缓存和随包数据取 generatedAt 更新的那份。
 * 返回 { count, generatedAt, source }
 */
function reload() {
    const cached = readLocalJson(CACHE_FILE);
    // require 会把 JSON 缓存在内存里，所以这里再从磁盘读一次，
    // 这样重新生成 app/js/data/rtaStats.json 后点「加载 RTAStats 数据」就能立刻生效
    const fromDisk = readBundledFromDisk();
    const candidates = [
        { payload: bundledData, source: 'bundled' },
        { payload: fromDisk, source: 'file' },
        { payload: cached, source: 'cache' },
    ].filter((entry) => entry.payload && entry.payload.heroes);

    candidates.sort(
        (a, b) => dataTimestamp(b.payload) - dataTimestamp(a.payload)
    );

    const picked = candidates[0];
    if (picked) {
        data = picked.payload;
        loadedFrom = picked.source;
        indexHeroes();
    }

    return module.exports.getSummary();
}

function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getForHero(heroName) {
    return byName[normalizeName(heroName)] || null;
}

function percentText(value) {
    return value == null ? '—' : `${value}%`;
}

function buildContentHtml(preset) {
    const color = 'var(--font-color, #2d3748)';
    const muted = 'opacity: 0.65';

    const setRows = (preset.sets || [])
        .map((candidate, index) => {
            const checked = index === 0 ? 'checked' : '';
            return `
                <label style="display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; color: ${color};">
                    <input type="radio" name="rtaStatsSet" value="${index}" ${checked}>
                    <span style="flex: 1; text-align: left;">${escapeHtml(
                        (candidate.zh || []).join(' + ')
                    )}</span>
                    <span style="${muted}; font-size: 12px;">占 ${percentText(
                candidate.share
            )} · 胜率 ${percentText(candidate.winRate)}</span>
                </label>
            `;
        })
        .join('');

    const statRows = ((data && data.statOrder) || Object.keys(STAT_META))
        .filter((stat) => preset.targets && preset.targets[stat])
        .map((stat) => {
            const meta = STAT_META[stat];
            const target = preset.targets[stat];
            return `<tr>
                    <td style="text-align: left; padding: 2px 8px; color: ${color};">${escapeHtml(
                meta.zh
            )}</td>
                    <td style="padding: 2px 8px; color: ${color};">${escapeHtml(
                target.p50
            )}</td>
                    <td style="padding: 2px 8px; ${muted};">${escapeHtml(
                target.p75
            )}</td>
                </tr>`;
        })
        .join('');

    const artifactBlock = preset.artifact
        ? `
            <div style="margin: 8px 0 2px;">
                <b>神器</b>：${escapeHtml(
                    preset.artifact.zh || preset.artifact.name
                )}
                <span style="${muted}; font-size: 12px;">占 ${percentText(
              preset.artifact.share
          )} · 胜率 ${percentText(preset.artifact.winRate)}</span>
            </div>
            <div style="font-size: 12px; ${muted};">神器属于英雄配置，需要在「英雄」页的加成属性里设置</div>
        `
        : '';

    const skillBlock = preset.skillPriority
        ? `<div style="margin-top: 6px; font-size: 12px; ${muted};">技能优先级：${escapeHtml(
              preset.skillPriority.join(' > ')
          )}</div>`
        : '';

    const confidence =
        CONFIDENCE_TEXT[preset.confidence] || preset.confidence || '';
    const dataDate = (preset.dataDate || '').slice(0, 10);
    const headerParts = [
        `国服 ${preset.tierZh || preset.tier || '大师'}`,
        preset.season || '',
        `数据 ${dataDate}`,
        preset.winRate == null ? '' : `胜率 ${preset.winRate}%`,
    ].filter(Boolean);

    return `
        <div style="text-align: left; color: ${color}; font-size: 13px;">
            <div style="font-size: 12px; ${muted}; margin-bottom: 10px;">
                ${escapeHtml(headerParts.join(' · '))} · ${confidence}${
        preset.sampleCount ? `（${preset.sampleCount}）` : ''
    }
            </div>

            <div style="font-weight: 600; margin-bottom: 2px;">套装</div>
            <div>${setRows || '无'}</div>

            ${artifactBlock}

            <div style="font-weight: 600; margin: 12px 0 2px;">目标属性（主流 / 偏上）</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="${muted}; font-size: 12px;">
                        <th style="text-align: left; padding: 0 8px; font-weight: 400;">属性</th>
                        <th style="text-align: left; padding: 0 8px; font-weight: 400;">P50</th>
                        <th style="text-align: left; padding: 0 8px; font-weight: 400;">P75</th>
                    </tr>
                </thead>
                <tbody>${
                    statRows ||
                    '<tr><td style="padding: 4px 8px;">无数据</td></tr>'
                }</tbody>
            </table>

            <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; cursor: pointer;">
                <input type="checkbox" id="rtaStatsApplyStats" checked>
                <span>同时填入目标属性下限（只填最小值；搜不到结果就取消勾选或调低）</span>
            </label>

            <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px; cursor: pointer;">
                <input type="checkbox" id="rtaStatsAutoApply" ${
                    config.autoApply ? 'checked' : ''
                }>
                <span>切换英雄时自动应用 RTAStats 预设</span>
            </label>

            ${skillBlock}
        </div>
    `;
}

module.exports = {
    /** 启动时调用：读配置 + 选一份最新的数据 */
    initialize: () => {
        loadConfig();
        reload();
        console.log(
            `RTAStats loaded from ${loadedFrom}: ${
                module.exports.getSummary().count
            } heroes`
        );
    },

    /** 数据加载区「加载 RTAStats 数据」按钮用：重新读盘并返回概况 */
    reload,

    getForHero,

    hasPreset: (heroName) => Boolean(getForHero(heroName)),

    isAutoApplyEnabled: () => Boolean(config.autoApply),

    setAutoApply: (enabled) => {
        config.autoApply = Boolean(enabled);
        saveConfig();
    },

    getSummary: () => ({
        count: Object.keys((data && data.heroes) || {}).length,
        generatedAt: data ? data.generatedAt : null,
        source: loadedFrom,
        season:
            data && data.source && data.source.official
                ? data.source.official.season
                : null,
    }),

    /**
     * 弹出当前英雄的 RTAStats 详情。确认后回调 onApply(preset, { setIndex, applyStats })。
     * 返回 Promise<boolean>：是否真的应用了。
     */
    openForHero: async (heroName, onApply) => {
        const preset = getForHero(heroName);

        if (!preset) {
            await Swal.fire({
                icon: 'info',
                text: '这个英雄暂时没有 RTAStats 预设数据',
                confirmButtonText: 'OK',
            });
            return false;
        }

        const result = await Swal.fire({
            title: `${preset.zh || preset.name} · RTAStats`,
            width: 620,
            html: buildContentHtml(preset),
            showCancelButton: true,
            confirmButtonText: '应用到优化器',
            cancelButtonText: '关闭',
            focusConfirm: false,
            preConfirm: () => {
                const checked = document.querySelector(
                    'input[name="rtaStatsSet"]:checked'
                );
                const statsBox = document.getElementById('rtaStatsApplyStats');
                const autoBox = document.getElementById('rtaStatsAutoApply');
                return {
                    setIndex: checked ? Number(checked.value) : 0,
                    applyStats: !statsBox || statsBox.checked,
                    autoApply: autoBox ? autoBox.checked : config.autoApply,
                };
            },
        });

        if (!result.isConfirmed || !result.value) {
            return false;
        }

        if (result.value.autoApply !== config.autoApply) {
            module.exports.setAutoApply(result.value.autoApply);
        }

        if (typeof onApply === 'function') {
            onApply(preset, result.value);
        }
        return true;
    },

    _internal: { normalizeName, escapeHtml, buildContentHtml },
};
