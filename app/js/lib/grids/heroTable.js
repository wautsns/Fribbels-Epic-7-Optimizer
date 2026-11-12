const tinygradient = require('tinygradient');
const colorPicker = require('../colorPicker');
const LimitConfiguration = require('../limitConfiguration');
const ResultPriority = require('../resultPriority');

var lightGradient = {gradient:tinygradient([
    {color: '#F5A191', pos: 0}, // red
    {color: '#ffffe5', pos: 0.5},
    {color: '#77e246', pos: 1} // green
])};

var darkGradient = colorPicker.getColors();
// var darkGradient = tinygradient([
//     {color: '#5A1A06', pos: 0}, // red
//     {color: '#343127', pos: 0.5},
//     {color: '#38821F', pos: 1} // green
// ]);

var gradient = lightGradient;

/* 实例注册表：深色模式 / 一键换装 busy 变化时统一刷新 */
const instances = new Set();

/* 神器名字 -> 图标地址（cachedimages 里就是处理好的 64px 图，见 artifactImage.js）
   放在模块级：英雄页 / GVG 两个实例共用一份缓存 */
const artifactIconPaths = {};

function createHeroTable(options) {
    options = options || {};
    const hooks = options.hooks || {};

    /*
     * 行标识：默认用 hero.id。
     * GVG 实例会传 rowIdOf —— 同一个角色条目可能被阵容 1 / 2 同时命中，
     * 两行 hero.id 相同，immutableData 的增量对比会算错行数。
     */
    const rowIdOf =
        typeof options.rowIdOf === 'function'
            ? options.rowIdOf
            : (data) => (data ? data.id : null);

    /* ---- 实例状态（原来都是模块级变量，现在每个实例一份） ---- */
    let heroesGrid = null;
    let buildsGrid = null;
    let heroesRoot = null;
    let currentHeroes = [];
    let selectedBuildNode = null;
    let currentBuildsHero = null;
    let currentAggregate = {};

    /*
     * 「这件装备现在穿在谁身上」索引：
     *   - 英雄页实例：refresh() 拿到的就是全量英雄，自动建索引
     *   - GVG 实例：只有 6 条行数据，需要调用方 setHeroUniverse(全量英雄)
     * itemId -> { heroId, heroName }
     */
    let heroUniverse = [];
    let itemOwnerIndex = null;

    function rebuildItemOwnerIndex() {
        itemOwnerIndex = new Map();

        heroUniverse.forEach((hero) => {
            const equipment = (hero && hero.equipment) || {};
            Object.keys(equipment).forEach((slot) => {
                const item = equipment[slot];
                if (!item || item.id == null) return;

                itemOwnerIndex.set(String(item.id), {
                    heroId: String(hero.id),
                    heroName: hero.name,
                    heroIndex: hero.index,
                    slot,
                });
            });
        });
    }

    /* 筛选状态（职业 / 属性），每个实例一份 */
    let heroFilterState = {
        classFilter: null,
        elementFilter: null,
    };


function matchesHeroFilters(hero) {
    if (!hero) return true;

    const classFilter = heroFilterState.classFilter;
    if (classFilter && !String(hero.role || '').toLowerCase().startsWith(classFilter.toLowerCase())) {
        return false;
    }

    const elementFilter = heroFilterState.elementFilter;
    if (elementFilter && !String(hero.attribute || '').toLowerCase().startsWith(elementFilter.toLowerCase())) {
        return false;
    }

    return true;
}

    const api = {

    /*
     * GVG 作业列表复用的渲染工具（保持头像 / 面板要求与英雄列表完全一致）。
     * 都是已有内部函数的薄包装，不改变英雄列表自身行为。
     */
    heroIconSrc: (name) => heroIconSrc(name),

    iconSrcAttributes: (basePath, sizes) => iconSrcAttributes(basePath, sizes),

    formatPanelRequirementForRequest: (request) => formatPanelRequirement({optimizationRequest: request}),

    toggleDarkMode(enabled) {
        if (enabled) {
            gradient = darkGradient;
        } else {
            gradient = lightGradient;
        }

        try {
            buildsGrid.gridOptions.api.refreshCells()
        } catch (e) {

        }
    },

    initialize: () => {
        // 只保留 en / zh 两种语言
        var localeText = i18next.language == 'zh' ? AG_GRID_LOCALE_ZH : AG_GRID_LOCALE_EN;
        console.log('localeText:'+localeText);

        buildGrid(localeText);
        instances.add(api);
    },

    resetSort: () => {
        heroesGrid.gridOptions.columnApi.resetColumnState()
    },

    refresh: async (heroes, id) => {
        if (!heroes) {
            const response = await Api.getAllHeroes();
            heroes = response.heroes;
        }
        const selectedNode = heroesGrid.gridOptions.api.getSelectedNodes()[0]

        currentHeroes = heroes;

        // 英雄页 / 自托管实例：这里的 heroes 就是全量英雄，直接拿来建"谁穿着什么"索引。
        // GVG 实例只拿到 6 条，需要调用方用 setHeroUniverse() 喂全量。
        if (options.ownershipSource !== 'external') {
            api.setHeroUniverse(heroes);
        }

        heroesGrid.gridOptions.api.setRowData(heroes)
        heroesGrid.gridOptions.api.redrawRows();

        // setRowData 之后外部过滤器（职业 / 属性）不会自动重跑
        if (heroFilterState.classFilter || heroFilterState.elementFilter) {
            heroesGrid.gridOptions.api.onFilterChanged();
        }

        // 神器图标路径是异步取的（本地没有的会下载），取完再刷新这一列
        loadArtifactIcons(heroes).then((changed) => {
            if (changed) {
                heroesGrid.gridOptions.api.refreshCells({ columns: [ARTIFACT_COL_ID], force: true });
            }
        });

        if (!selectedNode && !id) {
            return;
        }

        heroesGrid.gridOptions.api.forEachNode((node) => {
            if (id) {
                if (node.data.id == id) {
                    node.setSelected(true, false);
                    heroesGrid.gridOptions.api.ensureNodeVisible(node);
                }
            } else if (selectedNode && selectedNode.data) {
                if (node.data.id == selectedNode.data.id) {
                    node.setSelected(true, false);
                }
            }
        })
    },

    refreshHeroesGrid: () => {
        const selectedNode = heroesGrid.gridOptions.api.getSelectedNodes()[0]
        heroesGrid.gridOptions.api.refreshCells();

        heroesGrid.gridOptions.api.forEachNode((node) => {
            if (node.data.id == selectedNode.data.id) {
                node.setSelected(true, false);
            }
        })
    },

    refreshBuilds: async (response) => {
        // setRowData 会把 builds 的选中状态清掉，先记下当前选中的是哪一套（按 items 比对）
        const selectedBuildSignature = getSelectedBuildSignature();

        const selectedRow = api.getSelectedRow();

        var hero;
        if (response) {
            hero = response.hero;
        } else if (selectedRow) {
            const useReforgedStats = (hooks.getUseReforgedStats ? hooks.getUseReforgedStats() : true);
            hero = (await Api.getHeroById(selectedRow.id, useReforgedStats)).hero;
        } else if (currentBuildsHero) {
            // 英雄表刚好丢过选中状态时，用上一次的英雄把 builds 重画出来
            const useReforgedStats = (hooks.getUseReforgedStats ? hooks.getUseReforgedStats() : true);
            hero = (await Api.getHeroById(currentBuildsHero.id, useReforgedStats)).hero;
        } else {
            return;
        }

        // 英雄可能已经被删掉（或者后端返回了错误响应），这时 hero 是 undefined，
        // 后面 updateCurrentAggregate / hero.builds 都会炸，直接放弃这次刷新
        if (!hero || hero.id == null) {
            currentBuildsHero = null;
            console.warn('[heroTable] refreshBuilds: hero not found, skip', response);
            return;
        }

        // 功能列判断「已装备/未装备」要用这份最新数据
        currentBuildsHero = hero;

        updateCurrentAggregate(hero);
        console.log("Refresh build selected hero row", hero);
        buildsGrid.gridOptions.api.setRowData(hero.builds == null ? [] : hero.builds)

        // 换上/脱下以后，功能列（穿上 <-> 脱下）必须整列按最新数据重画
        buildsGrid.gridOptions.api.refreshCells({ columns: ['buildActions', 'conflicts'], force: true });

        // 再把刚才选中的那套配装选回来（保留蓝色高亮）
        let newSelectedNode = null;
        if (selectedBuildSignature) {
            buildsGrid.gridOptions.api.forEachNode((node) => {
                if (!newSelectedNode && buildSignature(node.data) === selectedBuildSignature) {
                    newSelectedNode = node;
                }
            });
        }

        if (!newSelectedNode) {
            return;
        }

        newSelectedNode.setSelected(true, false);
        selectedBuildNode = newSelectedNode;
    },

    getSelectedRow: () => {
        const selectedRows = heroesGrid.gridOptions.api.getSelectedRows();
        if (selectedRows.length > 0) {
            const row = selectedRows[0];
            console.log("SELECTED ROW", row)
            return row;
        }
        return null;
    },

    /* 只重画 builds 的功能列 / 数值列（主题、busy 状态变化时用） */
    redrawBuildsRows: () => {
        const buildsApi = buildsGrid && buildsGrid.gridOptions && buildsGrid.gridOptions.api;
        if (!buildsApi) return;
        try {
            buildsApi.redrawRows();
        } catch (error) {
            console.warn('[heroTable] redraw builds failed', error);
        }
    },

    getSelectedBuildRow: () => {
        const selectedRows = buildsGrid.gridOptions.api.getSelectedRows();
        if (selectedRows.length > 0) {
            const row = selectedRows[0];
            console.log("SELECTED ROW", row)
            return row;
        }
        return null;
    },

    /** 清空 builds 表（例如行数据被清空、没有选中的英雄了） */
    clearBuilds: () => {
        selectedBuildNode = null;
        currentBuildsHero = null;

        const buildsApi = buildsGrid && buildsGrid.gridOptions && buildsGrid.gridOptions.api;
        if (!buildsApi) return;

        buildsApi.setRowData([]);
    },

    /**
     * 喂一份「全量英雄」（判断某件装备现在穿在谁身上）。
     * 英雄页实例在 refresh() 里自动喂；GVG 实例需要调用方显式喂。
     */
    setHeroUniverse: (heroes) => {
        heroUniverse = heroes || [];
        global.heroIndexById = new Map();
        heroUniverse.forEach((hero) => {
            global.heroIndexById.set(String(hero.id), hero.index);
        });
        rebuildItemOwnerIndex();

        api.refreshBuildConflicts();
    },

    /**
     * 这条配装的 6 件装备里，当前正被别人穿着的有哪些。
     * 返回 [{ itemId, heroId, heroName, heroIndex }]，排除这条配装所属英雄自己身上的。
     */
    getBuildConflicts: (heroId, build) => {
        if (!build || !Array.isArray(build.items) || !itemOwnerIndex) return [];

        const selfId = heroId == null ? null : String(heroId);
        const conflicts = [];

        build.items.forEach((rawId) => {
            if (rawId == null) return;

            const owner = itemOwnerIndex.get(String(rawId));
            if (!owner || owner.heroId === selfId) return;

            conflicts.push({
                itemId: rawId,
                slot: owner.slot,
                heroId: owner.heroId,
                heroName: owner.heroName,
                heroIndex: owner.heroIndex,
            });
        });

        return conflicts;
    },

    /** builds 表「冲突」列按当前选中的英雄重画（自己的装备不算冲突） */
    refreshBuildConflicts: () => {
        const buildsApi = buildsGrid && buildsGrid.gridOptions && buildsGrid.gridOptions.api;
        if (!buildsApi) return;

        try {
            buildsApi.refreshCells({ columns: ['buildActions', 'conflicts'], force: true });
        } catch (error) {
            console.warn('[heroTable] refresh conflicts failed', error);
        }
    },

    /**
     * 行数据变化后同步 builds：
     *   - 有选中的英雄 → 重拉它的 builds（功能列的「已装备 / 未装备」也跟着重画）
     *   - 没有选中（例如阵容清空）→ 把 builds 表清空，否则会留着上一个英雄的配装
     */
    refreshSelectedBuilds: async () => {
        const hero = api.getSelectedRow();
        if (!hero) {
            api.clearBuilds();
            return;
        }

        await api.refreshBuilds();
    },

    refreshFilters: (filters) => {
        // 职业 / 属性筛选走外部过滤器（图标的列没有文本值，用列过滤器不方便）
        heroFilterState.classFilter = filters.classFilter || null;
        heroFilterState.elementFilter = filters.elementFilter || null;

        const api = heroesGrid && heroesGrid.gridOptions && heroesGrid.gridOptions.api;
        if (api) {
            api.onFilterChanged();
        }
    },

    /*
     * 预览：组件不碰页面 DOM，选中英雄 / 配装后交给调用方注入的 hooks 渲染
     * （英雄页 = 6 张装备卡；GVG 不渲染）。
     */
    redrawPreview: async () => {
        const heroRow = api.getSelectedRow();
        const buildRow = api.getSelectedBuildRow();

        if (buildRow) {
            if (hooks.renderPreview) await hooks.renderPreview(heroRow, buildRow);
            return;
        }

        // 只选了英雄：走完整流程（刷 builds + 通过 hooks 渲染身上装备）
        if (heroRow) redrawPreviewHero(heroRow.id);
    },
}


/*
 * 英雄表行高：要装得下 32px 的头像 / 属性 / 职业 / 神器图标。
 * 单元格上下各 1px 透明边框，所以 36 的行高留 2px 余量，图片不会被压扁。
 * 下面的文本单元格用同样的 line-height 来垂直居中。
 */
const HERO_ROW_HEIGHT = 36;

/* 头像 / 属性 / 职业 / 神器：图标统一 32px（实际尺寸在 style.css 的 .heroGridIcon），列宽也统一 */
const HERO_ICON_SIZE = 32;
/* 32px 图标 + 单元格左右 padding 11px×2 + 边框 2px */
const HERO_ICON_COL_WIDTH = HERO_ICON_SIZE + 24;

/* 其它文本列左对齐 + 省略号（同样用 block 布局，保证超长时显示 ...） */
const TEXT_CELL_STYLE = {
    'height': '100%',
    'display': 'block',
    'line-height': `${HERO_ROW_HEIGHT}px`,
    'text-align': 'left',
    'padding-left': '6px',
    'overflow': 'hidden',
    'white-space': 'nowrap',
    'text-overflow': 'ellipsis',
};

/* 文本列只有在被截断（显示省略号）时才弹 tooltip */

/**
 * 找到当前渲染出来的那个单元格。
 * ag-Grid 的 tooltip 参数里没有 DOM 节点（v26 只给 column / rowIndex），
 * 所以按「行 + 列 id」查一次。
 */
function findRenderedCell(column, rowIndex) {
    if (!column || rowIndex == null) return null;
    const row = heroesRoot && heroesRoot.querySelector(`.ag-center-cols-container .ag-row[row-index="${rowIndex}"]`);
    if (!row) return null;
    return row.querySelector(`.ag-cell[col-id="${column.getColId()}"]`);
}

/**
 * 只有被截断（显示省略号）时才返回文本，让 ag-Grid 弹提示。
 *
 * 注意：ag-Grid 是在单元格渲染时就把 tooltip 文字算好并缓存的，那时布局还没完成
 * （查不到单元格），所以这里取不到单元格时先返回空；布局完成后由
 * scheduleTextTooltipRefresh() 刷新这些单元格，再按真实溢出状态重新计算。
 */
function truncatedTooltipGetter(params) {
    const text = params.value;
    if (!text) return '';

    const cell = findRenderedCell(params.column, params.rowIndex);
    if (!cell) return '';

    return cell.scrollWidth > cell.clientWidth + 1 ? text : '';
}

let textTooltipRefreshTimer = null;

/** 布局变化（flex 列宽、窗口缩放、数据更新）后，让文本列重算一次缓存的 tooltip */
function scheduleTextTooltipRefresh() {
    if (textTooltipRefreshTimer) clearTimeout(textTooltipRefreshTimer);
    textTooltipRefreshTimer = setTimeout(() => {
        textTooltipRefreshTimer = null;
        try {
            const gridOptions = heroesGrid && heroesGrid.gridOptions;
            const api = gridOptions && gridOptions.api;
            const columnApi = gridOptions && (gridOptions.columnApi || gridOptions.api);
            if (!api || !api.refreshCells || !columnApi || !columnApi.getAllGridColumns) return;

            const columns = columnApi.getAllGridColumns()
                .filter((col) => {
                    const def = col.getColDef && col.getColDef();
                    return def && def.tooltipValueGetter === truncatedTooltipGetter;
                })
                .map((col) => col.getColId());
            if (columns.length) {
                api.refreshCells({ columns: columns, force: true });
            }
        } catch (e) {
            console.warn('scheduleTextTooltipRefresh failed', e);
        }
    }, 80);
}

/* 面板需求的输出顺序：速度优先，其余按 攻/防/血/暴率/暴伤/命中/抗性 */
const STAT_REQUIREMENT_ORDER = ['Spd', 'Atk', 'Def', 'Hp', 'Cr', 'Cd', 'Eff', 'Res'];

/* 属性列 → i18n key */
const STAT_LABEL_KEYS = {
    inputAtkMinLimit: 'Atk',
    inputHpMinLimit: 'Hp',
    inputDefMinLimit: 'Def',
    inputSpdMinLimit: 'Spd',
    inputCrMinLimit: 'CRate',
    inputCdMinLimit: 'CDmg',
    inputEffMinLimit: 'Eff',
    inputResMinLimit: 'Res',
};

/**
 * 神器列：当前佩戴的神器 + 等级，如 蓝玫瑰尖刺[+30]
 */
function formatArtifactDisplay(hero) {
    if (!hero || !hero.artifactName) return '';
    const name = i18next.t(hero.artifactName);
    const level = String(hero.artifactLevel == null ? '' : hero.artifactLevel).replace(/[^0-9]/g, '');
    return level ? `${name}[+${level}]` : name;
}

/*
 * 属性、职业、头像、神器各占一列。
 *
 * 神器数据里只有名字，图标要按名字查 artifactdata 的 code，再落到
 * data/cachedimages/artifacts/{code}_ico.png；本地没有的由 DataLoader 顺手下载（异步），
 * 所以路径先缓存起来，下载完成后 refreshCells 刷新一次这一列。
 */
const ARTIFACT_COL_ID = 'artifact';

const PANEL_REQUIREMENT_COL_ID = 'panelRequirement';
const PANEL_REQUIREMENT_MIN_WIDTH = 120;


function artifactIconSrc(hero) {
    if (!hero || !hero.artifactName) return Assets.getBlank();
    return artifactIconPaths[hero.artifactName] || Assets.getBlank();
}

/* 补齐缺失的神器图标路径；返回是否有新增（有的话调用方要刷新这一列） */
async function loadArtifactIcons(heroes) {
    const names = [...new Set(heroes
        .map((hero) => hero && hero.artifactName)
        .filter(Boolean))];
    const pending = names.filter((name) => !artifactIconPaths[name]);
    if (!pending.length) return false;

    await Promise.all(pending.map(async (name) => {
        try {
            const artifactData = HeroData.getArtifactByName(name);
            if (!artifactData) return;

            const iconPath = await DataLoader.getArtifactImagePath(artifactData);
            if (iconPath) artifactIconPaths[name] = iconPath;
        } catch (error) {
            console.warn('artifact icon failed', name, error.message);
        }
    }));

    return true;
}

/** 英雄头像地址（本地 cachedimages/heroes，落盘的就是处理好的 64px 图） */
function heroIconSrc(name) {
    const data = HeroData.getHeroExtraInfo(name);
    const iconUrl = data && data.assets && data.assets.icon;
    if (!iconUrl) return Assets.getBlank();

    // GitHub 图片转成本地路径，例如
    // .../data/cachedimages/c1144_s.png -> <data>/cachedimages/heroes/c1144_s.png
    if (iconUrl.includes('raw.githubusercontent.com')) {
        const fileName = Path.basename(iconUrl.split('?')[0]);
        return Path.join(Files.getDataPath(), 'cachedimages', 'heroes', fileName);
    }
    return iconUrl;
}

/*
 * 图标列的 srcset：主图 64px，高分屏副本 96px（存在才加）。
 * 浏览器按 sizes × 屏幕缩放挑：100% 屏用 64，200%~300% 屏用 96。
 * srcset 里的路径统一用正斜杠，避免反斜杠在 URL 解析里出意外（src 保持原样）。
 */
function iconSrcAttributes(basePath, sizes) {
    const high = DataLoader.getHighResImagePath(basePath);
    if (!high) {
        return `src="${basePath}"`;
    }

    const toUrl = (filePath) => String(filePath).replace(/\\/g, '/');

    return `src="${basePath}" srcset="${toUrl(basePath)} 64w, ${toUrl(high)} 96w" sizes="${sizes}"`;
}

/** 属性列图标 */
function renderElement(element) {
    const file = Assets.getElementAsset(element) || Assets.getBlank();
    return `<img class="heroGridIcon" src="${file}">`;
}

/** 职业列图标 */
function renderClass(role) {
    const file = Assets.getClassAsset(role) || Assets.getBlank();
    return `<img class="heroGridIcon" src="${file}">`;
}

/** 头像列图标（英雄名放在这一列的悬浮提示里） */
function renderIcon(params) {
    return `<img class="heroGridIcon" ${iconSrcAttributes(heroIconSrc(params.data.name), '32px')}>`;
}

/** 神器列：图标（名字 + 等级由 tooltip 负责） */
function renderArtifactIcon(params) {
    return `<img class="heroGridIcon" ${iconSrcAttributes(artifactIconSrc(params.data), '32px')}>`;
}

/**
 * 面板需求列：按配装器里配的属性过滤生成文本
 * - 上下限都没配（或下限为 0 且无上限）→ 不显示该属性
 * - 只有下限 → 生命≥20000
 * - 只有上限 → 速度≤150
 * - 都有 → 130≤速度≤200
 */
/**
 * 面板需求的数值缩写，缩短列宽：1400→1k4，13000→1w3。
 * 规则（保守，仅处理规整数字，避免信息丢失）：
 *   - 4 位数（1000~9999）且能被 100 整除 → `xky`（1400→1k4，1200→1k2，1250 不变）
 *   - 5 位数（10000~99999）且能被 1000 整除 → `xwy`（13000→1w3，14000→1w4，12500 不变）
 *   - 其余原样
 */
function compactStatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);

    if (n >= 1000 && n <= 9999 && n % 100 === 0) {
        const whole = Math.floor(n / 1000);
        const rem = Math.floor((n % 1000) / 100);
        return rem ? `${whole}k${rem}` : `${whole}k`;
    }
    if (n >= 10000 && n <= 99999 && n % 1000 === 0) {
        const whole = Math.floor(n / 10000);
        const rem = Math.floor((n % 10000) / 1000);
        return rem ? `${whole}w${rem}` : `${whole}w`;
    }
    return String(n);
}

function formatStatRequirements(hero) {
    const request = hero && hero.optimizationRequest;
    if (!request) return '';

    // 先算出每个属性的文本，再按固定顺序拼接（速度优先）
    const texts = {};
    for (const definition of LimitConfiguration.definitions) {
        const min = Number(request[definition.minKey]);
        const max = Number(request[definition.maxKey]);
        // 未配置时后端存的是默认值（下限 0 / 上限 2147483647），必须靠 Configured 标记判断
        const minSet = LimitConfiguration.isConfigured(request, definition.minKey, definition.minConfiguredKey, 0);
        const maxSet = LimitConfiguration.isConfigured(request, definition.maxKey, definition.maxConfiguredKey, 2147483647);
        const hasMin = minSet && Number.isFinite(min) && min > 0;
        const hasMax = maxSet && Number.isFinite(max) && max > 0;
        if (!hasMin && !hasMax) continue;

        const statKey = definition.minKey.replace('input', '').replace('MinLimit', '');
        const label = i18next.t(STAT_LABEL_KEYS[definition.minKey]);
        if (hasMin && hasMax) {
            texts[statKey] = `${compactStatNumber(min)}≤${label}≤${compactStatNumber(max)}`;
        } else if (hasMin) {
            texts[statKey] = `${label}≥${compactStatNumber(min)}`;
        } else {
            texts[statKey] = `${label}≤${compactStatNumber(max)}`;
        }
    }

    return STAT_REQUIREMENT_ORDER
        .filter(statKey => texts[statKey])
        .map(statKey => texts[statKey])
        .join(' ');
}

/**
 * 结果优先级：按配装器里「结果优先级」的顺序输出，偏好用 ∧、偏恶用 ∨
 * 例如：速度∧ 生命∨
 */
function formatResultPriority(hero) {
    const request = hero && hero.optimizationRequest;
    if (!request) return '';

    const order = Array.isArray(request.resultPriority) ? request.resultPriority : [];
    const disliked = Array.isArray(request.resultDislike) ? request.resultDislike : [];

    return order
        .filter(field => ResultPriority.FIELD_NAMES[field])
        .map(field => i18next.t(ResultPriority.FIELD_NAMES[field]) + (disliked.includes(field) ? '∨' : '∧'))
        .join(' ');
}

/*
 * 属性加成段：取出「更改英雄信息」里填的
 *   - 其他非装备加成（bonus*）→ 攻击+50 攻击+30% 速度+12 …
 *   - 最终属性加成（final*Multiplier）→ 最终攻击+50% …
 * 顺序按 STAT_REQUIREMENT_ORDER，同一属性的固定值/百分比并排。
 */
const STAT_BONUS_ORDER = [
    { field: 'bonusSpeed', percent: false, label: 'Spd' },
    { field: 'bonusAtk',   percent: false, label: 'Atk' },
    { field: 'bonusAtkPercent', percent: true, label: 'Atk' },
    { field: 'bonusDef',   percent: false, label: 'Def' },
    { field: 'bonusDefPercent', percent: true, label: 'Def' },
    { field: 'bonusHp',    percent: false, label: 'Hp' },
    { field: 'bonusHpPercent', percent: true, label: 'Hp' },
    { field: 'bonusCr',    percent: true,  label: 'CRate' },
    { field: 'bonusCd',    percent: true,  label: 'CDmg' },
    { field: 'bonusEff',   percent: true,  label: 'Eff' },
    { field: 'bonusRes',   percent: true,  label: 'Res' },
];

const FINAL_STAT_ORDER = [
    { field: 'finalAtkMultiplier', label: 'Final Attack' },
    { field: 'finalDefMultiplier', label: 'Final Defense' },
    { field: 'finalHpMultiplier',  label: 'Final Health' },
];

function formatStatBonuses(hero) {
    if (!hero) return '';

    const texts = [];

    for (const def of STAT_BONUS_ORDER) {
        const value = Number(hero[def.field]);
        if (!Number.isFinite(value) || value <= 0) continue;
        const label = i18next.t(def.label);
        texts.push(`${label}+${value}${def.percent ? '%' : ''}`);
    }

    for (const def of FINAL_STAT_ORDER) {
        const value = Number(hero[def.field]);
        if (!Number.isFinite(value) || value <= 0) continue;
        texts.push(`${i18next.t(def.label)}+${value}%`);
    }

    return texts.join(' ');
}

/*
 * 面板需求列：属性要求 + 结果优先级 + 属性加成，各段之间用分隔符隔开。
 * 用 filter(Boolean) 先去掉空段，所以：
 *   - 只有面板需求 → 不出现分隔符
 *   - 只有结果优先级 → 不出现分隔符
 *   - 只有属性加成 → 不出现分隔符
 *   - 任意多段都有 → 用分隔符拼接
 */
const PANEL_REQUIREMENT_SEPARATOR = ' · ';

function formatPanelRequirement(hero) {
    return [formatStatRequirements(hero), formatResultPriority(hero), formatStatBonuses(hero)]
        .filter(Boolean)
        .join(PANEL_REQUIREMENT_SEPARATOR);
}

function buildGrid(localeText) {
    const DIGITS_2 = 40;
    const DIGITS_3 = 40;
    const DIGITS_4 = 44;
    const DIGITS_5 = 48;
    const DIGITS_6 = 55;

    const gridOptions = {
        alwaysShowVerticalScroll: true,
        defaultColDef: {
            width: 47,
            sortable: true,
            sortingOrder: ['desc', 'asc', null],
            cellStyle: {
                'height': '100%',
                'display': 'flex ',
                'justify-content': 'center',
                'align-items': 'center ',
            },
        },

        columnDefs: [
            {headerName: i18next.t('rank'), sortable: false, width: 60, field: 'index', rowDrag: options.enableRowDrag !== false, rowDragText: (params, dragItemCount) => {
                console.log(params)
                return params.rowNode.data.name;
            }},
            // 属性、职业、头像各占一列；头像列的名字放在 tooltip 里
            {colId: 'attribute', headerName: i18next.t('elem'), field: 'attribute', width: HERO_ICON_COL_WIDTH, sortable: false, cellRenderer: (params) => renderElement(params.value)},
            {colId: 'role', headerName: i18next.t('class'), field: 'role', width: HERO_ICON_COL_WIDTH, sortable: false, cellRenderer: (params) => renderClass(params.value)},
            {headerName: i18next.t('icon'), field: 'name', width: HERO_ICON_COL_WIDTH, sortable: false, cellRenderer: (params) => renderIcon(params), tooltipValueGetter: (params) => formatHeroName(params.data)},
            // 神器单独一列，只显示图标，名字 + 等级在 tooltip 里
            {colId: ARTIFACT_COL_ID, headerName: i18next.t('Artifact'), width: HERO_ICON_COL_WIDTH, sortable: false, cellRenderer: (params) => renderArtifactIcon(params), tooltipValueGetter: (params) => formatArtifactDisplay(params.data)},
            // {headerName: i18next.t('Stars'), field: 'rarity', width: 50},
            {headerName: i18next.t('sets'), field: 'equipment', width: 85, sortable: false, cellRenderer: (params) => renderSets(params.value)},
            {headerName: i18next.t('atk'), field: 'atk', width: DIGITS_4},
            {headerName: i18next.t('def'), field: 'def', width: DIGITS_4},
            {headerName: i18next.t('hp'), field: 'hp', width: DIGITS_5},
            {headerName: i18next.t('spd'), field: 'spd', width: DIGITS_3},
            {headerName: i18next.t('cr'), field: 'cr', width: DIGITS_3},
            {headerName: i18next.t('cd'), field: 'cd', width: DIGITS_3},
            {headerName: i18next.t('eff'), field: 'eff', width: DIGITS_3},
            {headerName: i18next.t('res'), field: 'res', width: DIGITS_3},
            // 面板需求列：属性要求 + 结果优先级；flex 吃掉剩下的宽度（最小值兜底，避免被压没）
            {colId: PANEL_REQUIREMENT_COL_ID, headerName: i18next.t('Panel requirement & result priority'), flex: 1, minWidth: PANEL_REQUIREMENT_MIN_WIDTH, sortable: false, valueGetter: (params) => formatPanelRequirement(params.data), tooltipValueGetter: truncatedTooltipGetter, cellStyle: TEXT_CELL_STYLE},
            // 以下衍生属性列继续隐藏
            // {headerName: i18next.t('cp'), field: 'cp', width: DIGITS_6},
            // {headerName: i18next.t('hps'), field: 'hpps', width: DIGITS_4},
            // {headerName: i18next.t('ehp'), field: 'ehp', width: DIGITS_6},
            // {headerName: i18next.t('ehps'), field: 'ehpps', width: DIGITS_5},
            // {headerName: i18next.t('dmg'), field: 'dmg', width: DIGITS_5},
            // {headerName: i18next.t('dmgs'), field: 'dmgps', width: DIGITS_4},
            // {headerName: i18next.t('mcd'), field: 'mcdmg', width: DIGITS_3},
            // {headerName: i18next.t('mcds'), field: 'mcdmgps', width: DIGITS_4},
            // {headerName: i18next.t('dmgh'), field: 'dmgh', width: DIGITS_5},
            // {headerName: i18next.t('dmgd'), field: 'dmgd', width: DIGITS_5},
            // {headerName: i18next.t('gs'), field: 'score', width: DIGITS_3},
            // {headerName: i18next.t('upg'), field: 'upgrades', width: 65, width: DIGITS_2},
        ],
        rowSelection: 'single',
        rowData: [],
        tooltipShowDelay: 300,
        suppressScrollOnNewData: true,
        rowHeight: HERO_ROW_HEIGHT,
        pagination: true,
        paginationPageSize: 100000,
        localeText:localeText,
        // 文本列的 tooltip 依赖布局后的真实宽度，数据/尺寸/列宽变化后重算一次
        onModelUpdated: () => scheduleTextTooltipRefresh(),
        onGridSizeChanged: () => scheduleTextTooltipRefresh(),
        onFirstDataRendered: () => scheduleTextTooltipRefresh(),
        onColumnResized: () => scheduleTextTooltipRefresh(),
        onRowSelected: onHeroRowSelected,
        onRowClicked: onHeroRowClick,
        onRowDragEnter: onRowDragEnter,
        onRowDragEnd: onRowDragEnd,
        onRowDragMove: onRowDragMove,
        onRowDragLeave: onRowDragLeave,
        onSortChanged: onSortChanged,
        onFilterChanged: onFilterChanged,
        // 职业 / 属性 / GVG 进攻阵容筛选：格子里是图片，用外部过滤器按数据字段筛选
        isExternalFilterPresent: () => !!(heroFilterState.classFilter || heroFilterState.elementFilter),
        doesExternalFilterPass: (node) => matchesHeroFilters(node.data),
        suppressMoveWhenRowDragging: true,
        onRowDoubleClicked: onRowDoubleClicked,
        suppressCellSelection: true,
        enableRangeSelection: false,
        // 右键菜单：社区版没有原生菜单，这里自己弹（先选中右键所在行）
        suppressContextMenu: true,
        onCellContextMenu: (params) => {
            if (!params.data || !params.event) return;
            params.event.preventDefault();
            params.node.setSelected(true);
            if (hooks.onHeroContextMenu) hooks.onHeroContextMenu(params.event, params.data);
        },

        animateRows: true,
        immutableData: true,
        suppressDragLeaveHidesColumns: true,
        getRowNodeId: (data) => {
            return rowIdOf(data);
        },
        // suppressMoveWhenRowDragging: true,
        // 键盘上下切换行：把本实例的 Grid 交给 navigator（不能再走全局单例）
        navigateToNextCell: GridRenderer.arrowKeyNavigator(this, 'heroesGrid', undefined, () => heroesGrid),
    };

    // 配置表不允许手动排序：行顺序始终由后端返回的配装结果优先级决定
    const buildsGridOptions = {
        alwaysShowVerticalScroll: true,
        defaultColDef: {
            width: 45,
            sortable: false,
            cellStyle: columnGradient,
            // suppressNavigable: true,
            cellClass: 'no-border'
            // valueFormatter: numberFormatter,
        },
        columnDefs: [
            {headerName: i18next.t('sets'), field: 'sets', width: 100, cellRenderer: (params) => GridRenderer.renderSets(params.value)},
            {headerName: i18next.t('atk'), field: 'atk'},
            {headerName: i18next.t('def'), field: 'def'},
            {headerName: i18next.t('hp'), field: 'hp', width: 55},
            {headerName: i18next.t('spd'), field: 'spd', width: 40},
            {headerName: i18next.t('cr'), field: 'cr', width: 40},
            {headerName: i18next.t('cd'), field: 'cd', width: 40},
            {headerName: i18next.t('eff'), field: 'eff', width: 40},
            {headerName: i18next.t('res'), field: 'res', width: 40},
            // {headerName: i18next.t('dac'), field: 'dac'},
            // {headerName: i18next.t('cp'), field: 'cp', width: 50},
            // {headerName: i18next.t('hps'), field: 'hpps', width: 45},
            {headerName: i18next.t('ehp'), field: 'ehp', width: 55},
            // {headerName: i18next.t('ehps'), field: 'ehpps', width: 45},
            {headerName: i18next.t('dmg'), field: 'dmg', width: 50},
            // {headerName: i18next.t('dmgs'), field: 'dmgps', width: 45},
            {headerName: i18next.t('mcd'), field: 'mcdmg', width: 50},
            // {headerName: i18next.t('mcds'), field: 'mcdmgps', width: 45},
            {headerName: i18next.t('dmgh'), field: 'dmgh', width: 45},
            {headerName: i18next.t('dmgd'), field: 'dmgd', width: 45},
            {headerName: i18next.t('s1'), field: 's1', width: 50},
            {headerName: i18next.t('s2'), field: 's2', width: 50},
            {headerName: i18next.t('s3'), field: 's3', width: 50},
            // 功能列：装备这套配装 / 删除这套配装
            {
                headerName: '',
                colId: 'buildActions',
                width: 114,
                sortable: false,
                resizable: false,
                suppressMovable: true,
                cellRenderer: (params) => HtmlGenerator.buildBuildActionsCell(
                    isBuildEquipped(params.data),
                    hasAnyBuildEquipped(params.data),
                    oneClickEquipState()
                ),
            },
            // 冲突列：放在功能按钮右边，显示这条配装有几件装备正被别的英雄穿着
            {
                headerName: '',
                colId: 'conflicts',
                width: 44,
                sortable: false,
                resizable: false,
                suppressMovable: true,
                cellRenderer: (params) => renderConflictBadge(params.data),
                // 用 ag-grid 自带的 tooltip（原生 title 的延迟是浏览器/系统的，改不了）
                tooltipValueGetter: (params) => buildConflictTitle(params.data),
            },
        ],
        rowHeight: 27,
        rowSelection: 'single',
        // 冲突提示要快：100ms 就弹（默认 500ms 太慢，原生 title 更慢）
        // 注意：ag-grid 26 没有 tooltipHideDelay 这个 grid 选项（v27 才有），别再加
        tooltipShowDelay: 100,
        tooltipMouseTrack: true,
        onRowSelected: onBuildRowSelected,
        onCellClicked: onBuildCellClicked,
        suppressScrollOnNewData: true,
        localeText:localeText,
        rowData: [],
        cacheBlockSize: 1000,
        maxBlocksInCache: 1,
        suppressPaginationPanel: false,
        suppressDragLeaveHidesColumns: true,
        suppressCellSelection: true,
        enableRangeSelection: false,
        // animateRows: true,
        // immutableData: true,
        // getRowNodeId: (data) => {
        //     return data.id;
        // },
        navigateToNextCell: GridRenderer.arrowKeyNavigator(this, 'buildsGrid', undefined, () => buildsGrid),

        // navigateToNextCell: navigateToNextCell.bind(this),
    };

    const gridDiv = document.getElementById(options.heroesTableId);
    heroesRoot = gridDiv;
    const buildsGridDiv = document.getElementById(options.buildsTableId);
    heroesGrid = new Grid(gridDiv, gridOptions);
    buildsGrid = new Grid(buildsGridDiv, buildsGridOptions);

    /*
     * 主实例（英雄页）继续占用全局变量：colorPicker 等老代码用 global.buildsGrid
     * 做主题重绘。GVG 实例不设，避免互相覆盖。
     */
    if (options.isPrimary) {
        global.heroesGrid = heroesGrid;
        global.buildsGrid = buildsGrid;
    }

}


const fourPieceSets = [
    "AttackSet",
    "SpeedSet",
    "DestructionSet",
    "LifestealSet",
    "ProtectionSet",
    "CounterSet",
    "RageSet",
    "RevengeSet",
    "InjurySet",
    "ReversalSet",
    "RiposteSet",
    "WarfareSet",
    "WeakeningSet",
]
function renderSets(equipment) {
    if (!equipment) return;

    const setNames = Object.values(equipment).map(x => x.set);
    const setCounters = [
        Math.floor(setNames.filter(x => x == "HealthSet").length),
        Math.floor(setNames.filter(x => x == "DefenseSet").length),
        Math.floor(setNames.filter(x => x == "AttackSet").length),
        Math.floor(setNames.filter(x => x == "SpeedSet").length),
        Math.floor(setNames.filter(x => x == "CriticalSet").length),
        Math.floor(setNames.filter(x => x == "HitSet").length),
        Math.floor(setNames.filter(x => x == "DestructionSet").length),
        Math.floor(setNames.filter(x => x == "LifestealSet").length),
        Math.floor(setNames.filter(x => x == "CounterSet").length),
        Math.floor(setNames.filter(x => x == "ResistSet").length),
        Math.floor(setNames.filter(x => x == "UnitySet").length),
        Math.floor(setNames.filter(x => x == "RageSet").length),
        Math.floor(setNames.filter(x => x == "ImmunitySet").length),
        Math.floor(setNames.filter(x => x == "PenetrationSet").length),
        Math.floor(setNames.filter(x => x == "RevengeSet").length),
        Math.floor(setNames.filter(x => x == "InjurySet").length),
        Math.floor(setNames.filter(x => x == "ProtectionSet").length),
        Math.floor(setNames.filter(x => x == "TorrentSet").length),
        Math.floor(setNames.filter(x => x == "ReversalSet").length),
        Math.floor(setNames.filter(x => x == "RiposteSet").length),
        Math.floor(setNames.filter(x => x == "WarfareSet").length),
        Math.floor(setNames.filter(x => x == "PursuitSet").length),
        Math.floor(setNames.filter(x => x == "WeakeningSet").length),
        Math.floor(setNames.filter(x => x == "FervorSet").length),
    ]

    const sets = [];
    for (var i = 0; i < setCounters.length; i++) {
        const setsFound = Math.floor(setCounters[i] / Constants.piecesBySetIndex[i]);
        for (var j = 0; j < setsFound; j++) {
            sets.push(Constants.setsByIndex[i]);
        }
    }

    sets.sort((a, b) => {
        if (fourPieceSets.includes(a)) {
            return -1;
        } else if (fourPieceSets.includes(b)) {
            return 1;
        } else {
            return a.localeCompare(b);
        }
    })

    const images = sets.map(x => '<img class="optimizerSetIcon" src=' + Assets.getSetAsset(x) + '></img>');
    // console.log("RenderSets images", images);
    return images.join("");
}
// function columnGradient(params) {
//     const field = params.colDef.field;
//     if (field == "sets" || field == "name") return;

//     const hero = api.getSelectedRow();
//     if (params.value > hero[field]) {
//         return {
//             backgroundColor: "#bbfd91"
//         };
//     } else if (params.value < hero[field]) {
//         return {
//             backgroundColor: "#ffafaf"
//         };
//     } else {
//         // return {
//         //     backgroundColor: "#fffdc4"
//         // };
//     }
// }

function columnGradient(params) {
    try {
        if (!params || params.value == undefined) return;
        var colId = params.column.colId;
        var value = params.value;

        var agg = currentAggregate[colId];

        if (!agg) return;

        // var percent = agg.max == agg.min ? 1 : (value - agg.min) / (agg.max - agg.min);

        var color;
        if (value > agg.avg) {
            var percent = 0.5 * ((value - agg.avg) / (agg.max - agg.avg)) + 0.5
            percent = Math.min(1, Math.max(0, percent))
            color = gradient.gradient.rgbAt(percent);
        }

        if (value == agg.avg) {
            color = gradient.gradient.rgbAt(0.5)
        }

        if (value < agg.avg) {
            var percent = (1 - (agg.avg - value) / (agg.avg - agg.min))*0.5
            percent = Math.min(1, Math.max(0, percent))
            color = gradient.gradient.rgbAt(percent);
        }

        // if (agg.min == 0 && agg.max == 0) {
        //     color = gradient.rgbAt(0.5)
        // }

        return {
            backgroundColor: color.toHexString()
        };
    } catch (e) {console.error(e)}
}

function navigateToNextCell(params) {
  var previousCell = params.previousCellPosition,
    suggestedNextCell = params.nextCellPosition,
    nextRowIndex,
    renderedRowCount;

  switch (params.key) {
    case KEY_DOWN:
      // return the cell below
      nextRowIndex = previousCell.rowIndex + 1;
      renderedRowCount = optimizerGrid.gridOptions.api.getModel().getRowCount();
      if (nextRowIndex >= renderedRowCount) {
        return null;
      } // returning null means don't navigate

      optimizerGrid.gridOptions.api.selectNode(optimizerGrid.gridOptions.api.getRowNode("" + nextRowIndex))
      return {
        rowIndex: nextRowIndex,
        column: previousCell.column,
        floating: previousCell.floating,
      };
    case KEY_UP:
      // return the cell above
      nextRowIndex = previousCell.rowIndex - 1;
      if (nextRowIndex <= -1) {
        return null;
      } // returning null means don't navigate

      optimizerGrid.gridOptions.api.selectNode(optimizerGrid.gridOptions.api.getRowNode("" + nextRowIndex))
      return {
        rowIndex: nextRowIndex,
        column: previousCell.column,
        floating: previousCell.floating,
      };
    case KEY_LEFT:
    case KEY_RIGHT:
      return suggestedNextCell;
    default:
      throw 'this will never happen, navigation is always one of the 4 keys above';
  }
}


/** 英雄显示名（5 星带标记），用于「英雄」概览列的悬浮提示 */
function formatHeroName(hero) {
    if (!hero) return '';
    const name = i18next.t(hero.name);
    return hero.stars == 5 ? name + " - 5 ★" : name;
}

async function onBuildRowSelected(event) {
    if (!event.node.selected) return;

    // 记住选中行，refreshBuilds() 重画 builds 时要按它恢复选中（蓝底高亮）
    selectedBuildNode = event.node;

    const hero = api.getSelectedRow();
    if (hero && hooks.renderPreview) {
        await hooks.renderPreview(hero, event.data);
    }
}

function onHeroRowClick(event) {
    selectedBuildNode = null;
}

function onHeroRowSelected(event) {
    if (event.node.selected) {
        console.log("onHeroRowSelected", event);
        const heroId = event.data.id;

        redrawPreviewHero(heroId);
    }

    // 冲突列排除"自己身上穿的"，所以选中行变化后要重算
    api.refreshBuildConflicts();
}

// builds 列表「功能列」的点击：装备这套配装 / 脱下这套配装 / 一键换装（运行中=中断）/ 删除
function onBuildCellClicked(params) {
    if (!params.colDef || params.colDef.colId !== 'buildActions' || !params.data || !params.event) {
        return;
    }

    const target = params.event.target;
    if (!target || !target.classList) {
        return;
    }

    const hero = api.getSelectedRow();
    if (!hero) {
        return;
    }

    // 点任何一个图标都先把这行配装选中（预览、一键换装都依赖“选中的配装”）
    params.node.setSelected(true);

    if (!hooks.onBuildAction) return;

    if (target.classList.contains('buildEquipIcon')) {
        hooks.onBuildAction('equip', hero, params.data);
    } else if (target.classList.contains('buildUnequipIcon')) {
        hooks.onBuildAction('unequip', hero, params.data);
    } else if (target.classList.contains('buildOneClickEquipIcon')) {
        // 一键换装只在「这条配装就是身上穿的」时可用（图标也是灰的）
        if (!isBuildEquipped(params.data)) return;

        // 冷却中 / 已请求中断（图标是灰的）：一律不响应，
        // 否则连点「中断操作」会顺带把刚变回来的「一键换装」也点掉
        const state = oneClickEquipState();
        if (state.stopping) return;
        if (!state.busy && state.cooldown) return;

        hooks.onBuildAction('oneClick', hero, params.data);
    } else if (target.classList.contains('buildDeleteIcon')) {
        hooks.onBuildAction('remove', hero, params.data);
    }
}

const CONFLICT_SLOT_ORDER = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

/*
 * builds 表的「冲突」列：这条配装有几件装备正被别的英雄穿着。
 * 鼠标悬停显示"被谁穿着"，方便决定让谁来穿（tooltip 由列上的
 * tooltipValueGetter 提供，原生 title 的延迟太高）。
 */
function buildConflictOwners(build) {
    const hero = api.getSelectedRow();
    const conflicts = api.getBuildConflicts(hero && hero.id, build);

    const owners = [];
    conflicts.forEach((conflict) => {
        // 同一个角色可以有多条角色条目（英雄列表里的 index 不同），
        // 所以冲突提示带上「优先度列」的值，便于区分是哪一条（和配装器排除下拉的口径一致）
        const name = i18next.t(conflict.heroName);
        const index = Number(conflict.heroIndex);
        const label = Number.isFinite(index) ? `${name} #${index}` : name;
        if (!owners.includes(label)) owners.push(label);
    });

    return { count: conflicts.length, owners };
}

function buildConflictTitle(build) {
    const { count, owners } = buildConflictOwners(build);
    if (!count) return '';

    const bySlot = new Map();
    const slots = api.getBuildConflicts(api.getSelectedRow() && api.getSelectedRow().id, build);
    slots.forEach((conflict) => {
        const name = i18next.t(conflict.heroName);
        const index = Number(conflict.heroIndex);
        const label = Number.isFinite(index) ? `${name} #${index}` : name;
        if (!bySlot.has(conflict.slot)) bySlot.set(conflict.slot, []);
        if (!bySlot.get(conflict.slot).includes(label)) bySlot.get(conflict.slot).push(label);
    });

    const lines = CONFLICT_SLOT_ORDER
        .filter((slot) => bySlot.has(slot))
        .map((slot) => `${i18next.t(slot)}: ${bySlot.get(slot).join(' / ')}`);

    return `${i18next.t('Gear conflict')}:\n${lines.join('\n')}`;
}

function renderConflictBadge(build) {
    const { count } = buildConflictOwners(build);
    if (!count) return '';

    return `<span class="buildConflictBadge"><i class="fas fa-exclamation-triangle"></i>${count}</span>`;
}

/*
 * 这条配装里，当前英雄身上**实际**穿着的装备 id。
 * 被别人抢走的那件不算 —— 英雄的 equipment 里已经没有它了。
 */
function equippedBuildIds(hero, build) {
    if (!build || !build.items) {
        return [];
    }

    const equipmentMap = (hero && hero.equipment) || {};
    const worn = new Set();
    HERO_EQUIPMENT_SLOTS.forEach((slot) => {
        const item = equipmentMap[slot];
        if (item && item.id != null) {
            worn.add(String(item.id));
        }
    });

    return build.items.filter((id) => id && worn.has(String(id)));
}

/* 这条配装是否就是英雄当前身上穿的（6 件都在身上，与顺序无关） */
function isBuildEquipped(build) {
    if (!build || !build.items) return false;

    // 优先用 refreshBuilds 里刚拉到的那份英雄数据，避免用英雄表里还没刷新的旧 equipment
    const hero = currentBuildsHero || api.getSelectedRow();
    if (!heroHasEquippedGear(hero)) return false;

    const buildIds = build.items.filter(Boolean);

    if (buildIds.length !== HERO_EQUIPMENT_SLOTS.length) {
        return false;
    }

    return equippedBuildIds(hero, build).length === HERO_EQUIPMENT_SLOTS.length;
}

/*
 * 身上还挂着这条配装的任意一件（被别的英雄抢走一两件也算）。
 * 这种情况功能列要给「脱下」，否则这几件装备就没地方脱了。
 */
function hasAnyBuildEquipped(build) {
    const hero = currentBuildsHero || api.getSelectedRow();
    return equippedBuildIds(hero, build).length > 0;
}

/*
 * 一键换装的状态（builds 功能列的机器人图标 + 点击判定都看它）：
 *   busy     运行中 → 转圈，点它 = 中断
 *   stopping 已请求中断 → 灰掉，点了没反应（避免以为没反应而连点）
 *   cooldown 刚跑完的 3 秒 → 灰掉，避免连点中断后一下又启动一轮
 */
function oneClickEquipState() {
    const emulator = global.EmulatorEquip;
    return {
        busy: !!(emulator && emulator.isBusy && emulator.isBusy()),
        stopping: !!(emulator && emulator.isStopping && emulator.isStopping()),
        cooldown: !!(
            emulator &&
            emulator.isCoolingDown &&
            emulator.isCoolingDown()
        ),
    };
}

function redrawPreviewHero(heroId) {
    const useReforgedStats = (hooks.getUseReforgedStats ? hooks.getUseReforgedStats() : true);
    console.log("Use reforge", useReforgedStats)
    Api.getHeroById(heroId, useReforgedStats).then(async (response) => {
        const hero = response.hero;
        console.log("On hero row selected hero row", hero);

        // 英雄刚被删掉时后端拿不到数据，这里直接收工，不要拿 undefined 去重画
        if (!hero) {
            console.warn('[heroTable] redrawPreviewHero: hero not found, skip', heroId);
            return;
        }

        updateCurrentAggregate(hero);
        // 先更新「这一行英雄」，setRowData 渲染功能列时才会判断对“已装备/未装备”
        currentBuildsHero = hero;
        buildsGrid.gridOptions.api.setRowData(hero.builds == null ? [] : hero.builds)
        buildsGrid.gridOptions.api.refreshCells({ columns: ['buildActions', 'conflicts'], force: true });

        api.refreshBuilds(response);

        // 6 张装备卡由调用方注入的 hooks 渲染（英雄页 = heroes-equipped-*，GVG 不渲染）
        if (hooks.renderHeroEquipment) hooks.renderHeroEquipment(response);

        // 英雄身上没有任何装备时，自动选中第一条配装，让下方预览直接显示配装内容。
        // 这里只做“选中”，不会装备（装备仍要用户自己点 Equip Build）。
        if (!heroHasEquippedGear(hero)) {
            selectFirstBuildRow();
        }
    })
}

/* 英雄是否身上已装备了任意一件（6 个部位全空才算“没有配置装备”） */
const HERO_EQUIPMENT_SLOTS = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

function heroHasEquippedGear(hero) {
    const equipmentMap = (hero && hero.equipment) || {};

    return HERO_EQUIPMENT_SLOTS.some(slot => equipmentMap[slot]);
}

/* 一条配装的 6 件装备 id，按 id 排序后当作这行的唯一标识 */
function buildSignature(build) {
    const ids = build && build.items ? build.items.filter(Boolean) : [];
    return ids.length === HERO_EQUIPMENT_SLOTS.length ? ids.slice().sort().join('|') : '';
}

/* 当前选中的那条配装的标识（setRowData 之前取，用来恢复选中） */
function getSelectedBuildSignature() {
    const api = buildsGrid && buildsGrid.gridOptions && buildsGrid.gridOptions.api;
    if (api) {
        const node = api.getSelectedNodes()[0];
        if (node && node.data) {
            return buildSignature(node.data);
        }
    }
    return selectedBuildNode && selectedBuildNode.data ? buildSignature(selectedBuildNode.data) : '';
}

/* 只选中配装表的第一行（触发的是预览，不会写回英雄装备） */
function selectFirstBuildRow() {
    const api = buildsGrid && buildsGrid.gridOptions && buildsGrid.gridOptions.api;
    if (!api) return;

    let firstNode = null;
    api.forEachNode((node) => {
        if (!firstNode) {
            firstNode = node;
        }
    });

    if (firstNode) {
        // setSelected(value, clearSelection)：只留这一行选中
        firstNode.setSelected(true, true);
        // 记下来，之后 refreshBuilds() 会按 items 重新选中同一行（和手动选中时一致）
        selectedBuildNode = firstNode;
    }
}

function getField(heroStats, stat) {
    return heroStats.map(x => x[stat]);
}
function cleanInfinities(num) {
    if (num == -Infinity || num == Infinity) {
        return 0;
    }
    return num;
}


function updateCurrentAggregate(hero) {
    // 英雄被删掉 / 取不到时不要往下算（hero.builds 会报错）
    if (!hero) {
        return;
    }

    const statsToAggregate = [
        "atk",
        "hp",
        "def",
        "spd",
        "cr",
        "cd",
        "eff",
        "res",
        "dac",
        "cp",
        "hpps",
        "ehp",
        "ehpps",
        "dmg",
        "dmgps",
        "mcdmg",
        "mcdmgps",
        "dmgh",
        "dmgd",
        "s1",
        "s2",
        "s3",
        "score",
        "bs"
    ]

    const heroStats = hero.builds || [];
    var count = heroStats.length;

    for (var stat of statsToAggregate) {
        const arrSum = arr => arr.reduce((a,b) => a + b[stat], 0);
        var max = Math.max(...getField(heroStats, stat));
        var min = Math.min(...getField(heroStats, stat));
        var sum = arrSum(heroStats);
        var avg = hero[stat];

        if (stat == 'cr') {
            max = Math.min(100, max);
            min = Math.min(100, min);
        }
        if (stat == 'cd') {
            max = Math.min(350, max);
            min = Math.min(350, min);
        }

        currentAggregate[stat] = {
            max: cleanInfinities(max),
            min: cleanInfinities(min),
            sum: cleanInfinities(sum),
            avg: cleanInfinities(avg)
        }
    }

    console.log("Aggregated", currentAggregate);
}

function onRowDragEnter(e) {
  console.warn('onRowDragEnter', e);
  heroesGrid.gridOptions.api.selectNode(e.node)
}

async function onRowDragEnd(e) {
    if (!hooks.onRowReorder) return;

    await hooks.onRowReorder(e.node.data, e.overIndex);
}

// function onRowDragMove(e) {
//   // console.log('onRowDragMove', e);
// }

function onRowDragLeave(e) {
  // console.log('onRowDragLeave', e);
}

var lastOverNode = undefined;
var toReplace = undefined;

function onRowDragMove(event) {
    var movingNode = event.node;
    var overNode = event.overNode;

    var rowNeedsToMove = overNode.data.id != lastOverNode?.data.id &&
                         overNode.data.id != lastOverNode?.data.id &&
                         overNode.data.id != movingNode.data.id;

    if (rowNeedsToMove) {
        console.log('onRowDragMove', overNode.data.id, lastOverNode?.data.id, movingNode.data.id, rowNeedsToMove);
    }
    lastOverNode = overNode;

    if (rowNeedsToMove) {
        // the list of rows we have is data, not row nodes, so extract the data
        var movingData = movingNode.data;
        var overData = overNode.data;

        var fromIndex = currentHeroes.indexOf(movingData);
        var toIndex = currentHeroes.indexOf(overData);

        var newStore = currentHeroes.slice();
        moveInArray(newStore, fromIndex, toIndex);

        currentHeroes = newStore;
        heroesGrid.gridOptions.api.setRowData(newStore);

        heroesGrid.gridOptions.api.clearFocusedCell();
    }
}

function moveInArray(arr, fromIndex, toIndex) {
    var element = arr[fromIndex];
    arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, element);
}


var filterActive = false;
var sortActive = false;
function onSortChanged() {
  var sortModel = heroesGrid.gridOptions.api.getSortModel();
  sortActive = sortModel && sortModel.length > 0;
  // suppress row drag if either sort or filter is active
  var suppressRowDrag = sortActive || filterActive;
  console.log(
    'sortActive = ' +
      sortActive +
      ', allowRowDrag = ' +
      suppressRowDrag
  );
  heroesGrid.gridOptions.api.setSuppressRowDrag(suppressRowDrag);
}
// listen for changes on filter changed
function onFilterChanged() {
  filterActive = heroesGrid.gridOptions.api.isAnyFilterPresent();
  // suppress row drag if either sort or filter is active
  var suppressRowDrag = sortActive || filterActive;
  console.log(
    'sortActive = ' +
      sortActive +
      ', filterActive = ' +
      filterActive +
      ', allowRowDrag = ' +
      suppressRowDrag
  );
  heroesGrid.gridOptions.api.setSuppressRowDrag(suppressRowDrag);
}

function onRowDoubleClicked(e) {
    if (!e.data || !e.data.id) return;
    if (hooks.onHeroDoubleClick) hooks.onHeroDoubleClick(e.data);
}


    return api;
}

/* ==================================================================== *
 * 模块级：实例注册 + 共享刷新（深色模式 / 一键换装 busy）
 * ==================================================================== */

module.exports = {
    createHeroTable,

    /** 已初始化的实例（调试 / 遍历用） */
    getInstances: () => Array.from(instances),

    /** 主题 / busy 状态变化：把所有实例的 builds 重画一遍 */
    redrawBuildsRows: () => {
        instances.forEach((instance) => {
            try {
                instance.redrawBuildsRows();
            } catch (error) {
                console.warn('[heroTable] redraw builds failed', error);
            }
        });
    },
};

/* 一键换装开始 / 结束：刷新所有实例 builds 功能列（机器人图标 <-> 转圈图标） */
if (global.EmulatorEquip && EmulatorEquip.onBusyChange) {
    EmulatorEquip.onBusyChange(() => {
        module.exports.redrawBuildsRows();
    });
}
