/* global Files, HeroesTab, Api, OptimizerTab, Saves, Artifact, HeroData, Utils */
const fs = require('fs');
const path = require('path');
const Swal = require('sweetalert2');

// 随包发布的预设数据（scripts/rtastats/build-app-presets.js 生成）
const bundledData = require('../data/rtaStats.json');

// 本地缓存 / 配置放在 userData 目录下（和 herodata.json 一个地方）
const CACHE_FILE = 'cache/rtastats.json';
const CONFIG_FILE = 'rtaStatsConfig.json';

// 属性 -> 中文 / 优化器输入框 id / 保存到英雄优化器请求时的字段名
const STAT_META = {
    spd: {
        zh: '速度',
        inputId: 'inputMinSpdLimit',
        requestKey: 'inputSpdMinLimit',
    },
    cr: {
        zh: '暴击率',
        inputId: 'inputMinCrLimit',
        requestKey: 'inputCrMinLimit',
    },
    cd: {
        zh: '暴击伤害',
        inputId: 'inputMinCdLimit',
        requestKey: 'inputCdMinLimit',
    },
    atk: {
        zh: '攻击',
        inputId: 'inputMinAtkLimit',
        requestKey: 'inputAtkMinLimit',
    },
    hp: {
        zh: '生命',
        inputId: 'inputMinHpLimit',
        requestKey: 'inputHpMinLimit',
    },
    def: {
        zh: '防御',
        inputId: 'inputMinDefLimit',
        requestKey: 'inputDefMinLimit',
    },
    eff: {
        zh: '效果命中',
        inputId: 'inputMinEffLimit',
        requestKey: 'inputEffMinLimit',
    },
    res: {
        zh: '效果抗性',
        inputId: 'inputMinResLimit',
        requestKey: 'inputResMinLimit',
    },
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
            const minimum =
                preset.statMinimums && preset.statMinimums[stat] != null
                    ? preset.statMinimums[stat]
                    : '—';
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
                    <td style="padding: 2px 8px; color: ${color}; font-weight: 600;">${escapeHtml(
                minimum
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

            <div style="font-weight: 600; margin: 12px 0 2px;">目标属性（主流 / 偏上 / 目标下限）</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="${muted}; font-size: 12px;">
                        <th style="text-align: left; padding: 0 8px; font-weight: 400;">属性</th>
                        <th style="text-align: left; padding: 0 8px; font-weight: 400;">P50</th>
                        <th style="text-align: left; padding: 0 8px; font-weight: 400;">P75</th>
                        <th style="text-align: left; padding: 0 8px; font-weight: 400;">目标</th>
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

/**
 * 把一个英雄的 RTAStats 预设转成优化器请求。
 * 这个请求会存到英雄上，选中英雄时 loadPreviousHeroFilters 会自动还原。
 */
function buildOptimizationRequest(heroId, preset) {
    const candidate = (preset.sets || [])[0] || null;
    const inputSets =
        candidate && candidate.inputSets ? candidate.inputSets : [[], [], []];

    const request = {
        hero: { id: heroId },
        setFormat: candidate ? candidate.setFormat : 0,
        inputSets,
        inputSetsOne: inputSets[0] || [],
        inputSetsTwo: inputSets[1] || [],
        inputSetsThree: inputSets[2] || [],
        inputExcludeSet: [],
        inputNecklaceStat: [],
        inputRingStat: [],
        inputBootsStat: [],
    };

    const minimums = preset.statMinimums || {};
    Object.keys(STAT_META).forEach((stat) => {
        const key = STAT_META[stat].requestKey;
        const value = minimums[stat];
        request[key] = value == null ? null : value;
    });

    return request;
}

/**
 * 英雄加成配置：神器固定 +30、阵型满级、专属装备拉满。
 * 返回的对象结构和 Dialog.editHeroDialog -> Api.setBonusStats 一致。
 */
const FLAT_IMPRINT_TYPES = ['max_hp', 'speed', 'att', 'def'];

const BONUS_STAT_KEY = {
    att_rate: 'aeiAttackPercent',
    max_hp_rate: 'aeiHealthPercent',
    def_rate: 'aeiDefensePercent',
    att: 'aeiAttack',
    max_hp: 'aeiHealth',
    def: 'aeiDefense',
    speed: 'aeiSpeed',
    res: 'aeiEffectResistance',
    cri: 'aeiCritChance',
    cri_dmg: 'aeiCritDamage',
    acc: 'aeiEffectiveness',
};

function buildBonusStats(heroName, preset) {
    const bonus = {
        attack: 0,
        defense: 0,
        health: 0,
        attackPercent: 0,
        defensePercent: 0,
        healthPercent: 0,
        speed: 0,
        critChance: 0,
        critDamage: 0,
        effectiveness: 0,
        effectResistance: 0,
        finalAtkMultiplier: 1,
        finalDefMultiplier: 1,
        finalHpMultiplier: 1,
        aeiAttack: 0,
        aeiDefense: 0,
        aeiHealth: 0,
        aeiAttackPercent: 0,
        aeiDefensePercent: 0,
        aeiHealthPercent: 0,
        aeiSpeed: 0,
        aeiCritChance: 0,
        aeiCritDamage: 0,
        aeiEffectiveness: 0,
        aeiEffectResistance: 0,
        artifactName: 'None',
        artifactLevel: 'None',
        imprintNumber: 'None',
        eeNumber: 'None',
        stars: 6,
    };

    // 神器：选推荐的，直接 +30
    if (preset.artifact && preset.artifact.name) {
        const level = 30;
        try {
            const stats = Artifact.getStats(preset.artifact.name, level);
            bonus.artifactName = preset.artifact.name;
            bonus.artifactLevel = String(level);
            bonus.artifactHealth = stats.health;
            bonus.artifactAttack = stats.attack;
            bonus.artifactDefense = stats.defense;
            bonus.aeiHealth += stats.health;
            bonus.aeiAttack += stats.attack;
            bonus.aeiDefense += stats.defense;
        } catch (e) {
            console.warn(
                'RTAStats: 神器数据缺失',
                preset.artifact.name,
                e && e.message
            );
        }
    }

    const heroInfo = HeroData.getAllHeroData()[heroName];
    if (!heroInfo) return bonus;

    // 阵型：取最高档
    const devotion = heroInfo.self_devotion;
    if (devotion && devotion.grades && devotion.type) {
        const values = Object.values(devotion.grades)
            .map(Number)
            .filter((value) => Number.isFinite(value));
        if (values.length) {
            const maxValue = Math.max(...values);
            const imprint = FLAT_IMPRINT_TYPES.includes(devotion.type)
                ? maxValue
                : Utils.round10ths(maxValue * 100);
            bonus.imprintNumber = String(imprint);
            const key = BONUS_STAT_KEY[devotion.type];
            if (key) bonus[key] += imprint;
        }
    }

    // 专属装备：有就拉满（基础值 x2）
    const ee = Array.isArray(heroInfo.ex_equip) ? heroInfo.ex_equip[0] : null;
    if (ee && ee.stat && ee.stat.type) {
        const isFlat = FLAT_IMPRINT_TYPES.includes(ee.stat.type);
        const baseValue = isFlat
            ? Number(ee.stat.value)
            : Math.round(Number(ee.stat.value) * 100);
        if (Number.isFinite(baseValue)) {
            const maxValue = baseValue * 2;
            bonus.eeNumber = String(maxValue);
            const key = BONUS_STAT_KEY[ee.stat.type];
            if (key) bonus[key] += maxValue;
        }
    }

    return bonus;
}

/**
 * 把数据集里的英雄一次性加进英雄列表，并把各自的套装/属性下限写进优化器配置。
 * 只应在英雄列表为空时调用（按钮那边负责校验）。
 */
async function importHeroes(onProgress) {
    const presets = Object.values((data && data.heroes) || {});
    const created = [];

    presets.forEach((preset) => {
        const newHero = HeroesTab.getNewHeroByName(preset.name);
        if (!newHero) return;
        newHero.rarity = newHero.data.rarity;
        newHero.attribute = newHero.data.attribute;
        newHero.role = newHero.data.role;
        newHero.path = preset.name;
        newHero.stars = 6;
        created.push({ hero: newHero, preset });
    });

    if (!created.length) return { total: 0, imported: 0, failed: [] };

    await Api.addHeroes(created.map((entry) => entry.hero));

    // 逐个写配置：故意串行，避免一次打 98 个请求给后端
    /* eslint-disable no-await-in-loop */
    const failed = [];
    let imported = 0;
    for (let i = 0; i < created.length; i += 1) {
        const { hero, preset } = created[i];
        try {
            // 神器 +30 / 阵型满级 / 专属拉满
            await Api.setBonusStats(
                buildBonusStats(preset.name, preset),
                hero.id
            );
            // 套装 + 属性目标
            await Api.saveOptimizationRequest(
                buildOptimizationRequest(hero.id, preset)
            );
            imported += 1;
        } catch (e) {
            failed.push(preset.name);
        }
        if (typeof onProgress === 'function') onProgress(i + 1, created.length);
    }
    /* eslint-enable no-await-in-loop */

    // 配置已经写进英雄了，自动套用就没必要再覆盖用户后来的调整
    module.exports.setAutoApply(false);

    try {
        await HeroesTab.redraw();
        OptimizerTab.redrawHeroSelector();
        Saves.autoSave();
    } catch (e) {
        console.warn('RTAStats: 导入后刷新英雄列表失败', e && e.message);
    }

    return { total: created.length, imported, failed };
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

    /** 数据加载区按钮用：重新读盘并返回概况 */
    reload,

    /** 导入全部英雄 + 各自的配装配置（调用前请确认英雄列表为空） */
    importHeroes,

    buildOptimizationRequest,

    buildBonusStats,

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
