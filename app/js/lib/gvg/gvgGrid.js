/**
 * GVG 作业列表（ag-grid）—— docs/gvg/design.md 第 6 节。
 *
 * 列：防守阵容 / 进攻阵容（前下上后，只显示头像）/ 进攻策略（flex:1，左对齐）/ 操作（6 个按钮）
 * 行高 36px，同屏 6 行；排序、筛选、置队全部由 GvgPlans + 本地筛选状态决定。
 */
const GVG_ROW_HEIGHT = 36;
const GVG_HERO_ICON_SIZE = 32;

const OFFENSE_COL_ID = 'offense';

/** 毫秒时间戳 → yyyy-MM-dd（本地时区） */
function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/* 4 个筛选框的当前值：index 0~2 = 防守英雄（plan.defense.heroCodes），index 3 = 进攻英雄（plan.offense.members[i].heroId）；空串 = 不筛 */
const filterCodes = ['', '', '', ''];

let gvgGrid = null;
let selectedRowId = null;

module.exports = {
    initialize: () => {
        const localeText =
            i18next.language == 'zh' ? AG_GRID_LOCALE_ZH : AG_GRID_LOCALE_EN;

        const gridOptions = {
            alwaysShowVerticalScroll: true,
            defaultColDef: {
                sortable: false,
                // 4 列宽度是固定的，不允许拖动改宽，避免总宽和视口算不平导致出现幽灵横向滚动条
                resizable: false,
                suppressMovable: true,
                cellStyle: {
                    height: '100%',
                    display: 'flex',
                    'align-items': 'center',
                },
            },
            columnDefs: [
                {
                    colId: 'defense',
                    headerName: i18next.t('Defense team'),
                    width: 132,
                    minWidth: 132,
                    maxWidth: 132,
                    cellRenderer: renderDefenseTeam,
                },
                {
                    colId: OFFENSE_COL_ID,
                    headerName: i18next.t('Offense team'),
                    width: 124,
                    minWidth: 124,
                    maxWidth: 124,
                    cellRenderer: renderOffenseTeam,
                },
                {
                    colId: 'lastUsed',
                    headerName: i18next.t('Last used'),
                    width: 110,
                    minWidth: 110,
                    maxWidth: 110,
                    valueGetter: (params) =>
                        (params.data && params.data.lastUsedAt) || 0,
                    valueFormatter: (params) =>
                        params.value ? formatDate(params.value) : i18next.t('Never used'),
                },
                {
                    colId: 'strategy',
                    headerName: i18next.t('Details'),
                    // 只有这一列伸缩：宽度 = 视口宽 - 其它三列，所以总宽恒等于视口，不会出现横向滚动
                    flex: 1,
                    minWidth: 120,
                    cellRenderer: renderStrategy,
                    tooltipValueGetter: strategyTooltip,
                    // 表头居中（ag-grid 默认），单元格内容左对齐
                    cellStyle: {
                        height: '100%',
                        display: 'flex',
                        'justify-content': 'flex-start',
                        'align-items': 'center',
                        'text-align': 'left',
                        overflow: 'hidden',
                    },
                },
                {
                    colId: 'actions',
                    headerName: i18next.t('Actions'),
                    width: 88,
                    minWidth: 88,
                    maxWidth: 88,
                    cellRenderer: renderActions,
                },
            ],
            rowData: [],
            rowHeight: GVG_ROW_HEIGHT,
            headerHeight: 32,
            rowSelection: 'single',
            suppressCellSelection: true,
            enableRangeSelection: false,
            suppressScrollOnNewData: true,
            suppressMovableColumns: true,
            // 4 列宽度总是正好铺满视口（只有 strategy 列 flex），关掉横向滚动条，
            // 避免 flex 算出小数宽度后被四舍五入出 1px 溢出、出现"永远有个右滚条"
            suppressHorizontalScroll: true,
            tooltipShowDelay: 0,
            enableBrowserTooltips: true,
            getRowNodeId: (data) => data.id,
            isExternalFilterPresent: () => filterCodes.some((code) => !!code),
            doesExternalFilterPass: (node) => matchesDefenseFilters(node.data),
            onSelectionChanged: () => {
                const selected = gvgGrid.gridOptions.api.getSelectedRows();
                selectedRowId = selected && selected.length ? selected[0].id : null;
            },
            onRowDoubleClicked: (params) => {
                if (params && params.data && GvgTab && GvgTab.editPlan) {
                    GvgTab.editPlan(params.data.id);
                }
            },
            // 右键菜单：社区版没有原生菜单，自己弹（先选中右键所在行）
            suppressContextMenu: true,
            onCellContextMenu: (params) => {
                if (!params.data || !params.event) return;
                params.event.preventDefault();
                params.node.setSelected(true);
                selectedRowId = params.data.id;
                if (GvgTab && GvgTab.showPlanContextMenu) {
                    GvgTab.showPlanContextMenu(params.event, params.data.id);
                }
            },
        };

        const gridDiv = document.getElementById('gvg-plans-table');
        gvgGrid = new Grid(gridDiv, gridOptions);

        module.exports.refresh();
    },

    /** 数据或筛选变化后重画；数据来自 GvgPlans（已排序），选中行尽量保留 */
    refresh: () => {
        if (!gvgGrid || !gvgGrid.gridOptions.api) return;

        const api = gvgGrid.gridOptions.api;
        const sorted = GvgPlans.getSorted();

        // 进攻阵容 1 / 2 冻结在顶部：放进 pinnedTopRowData（不参与滚动/筛选），
        // 并从普通行数据里剔除，避免同一作业出现两次
        const teams = GvgPlans.getTeams();
        const pinnedIds = [teams.first, teams.second].filter(Boolean);
        const pinnedPlans = pinnedIds
            .map((id) => sorted.find((plan) => plan.id === id))
            .filter(Boolean);
        const pinnedIdSet = new Set(pinnedPlans.map((plan) => plan.id));

        api.setPinnedTopRowData(pinnedPlans.map((plan) => Object.assign({}, plan)));
        api.setRowData(sorted.filter((plan) => !pinnedIdSet.has(plan.id)));

        // 重画后选中行会丢 —— 用 getRowNodeId 匹配刚才的 id 重新选中
        if (selectedRowId) {
            const node = api.getRowNode(selectedRowId);
            if (node) node.setSelected(true, false);
        }
    },

    /** 按钮点击时调用：高亮这一行（同时记录 selectedRowId） */
    selectRow: (id) => {
        if (!gvgGrid || !gvgGrid.gridOptions.api) return;
        selectedRowId = id;
        const node = gvgGrid.gridOptions.api.getRowNode(id);
        if (node) node.setSelected(true, false);
    },

    setFilter: (index, code) => {
        filterCodes[index] = code || '';
        if (gvgGrid && gvgGrid.gridOptions.api) {
            gvgGrid.gridOptions.api.onFilterChanged();
        }
    },

    getFilterCodes: () => filterCodes.slice(),

    /** 当前筛选结果里第一条的 id（导出/测试用，一期未接 UI） */
    getFirstVisibleId: () => {
        const plan = GvgPlans.getSorted().filter(matchesDefenseFilters)[0];
        return plan ? plan.id : null;
    },
};

/* ------------------------------------------------------------------ *
 * 筛选（design.md 6.3）
 * ------------------------------------------------------------------ */

function matchesDefenseFilters(plan) {
    if (!plan) return false;

    // 防守 3 个筛选（index 0~2）—— plan.defense.heroCodes 必须包含所有非空的防守筛选值
    const defenseCodes = filterCodes.slice(0, 3);
    const defenseOk = defenseCodes.every(
        (code) => !code || plan.defense.heroCodes.includes(code)
    );
    if (!defenseOk) return false;

    // 进攻 1 个筛选（index 3）—— plan.offense.members 里必须有人 heroCode 匹配
    const attackCode = filterCodes[3];
    if (attackCode) {
        const hasAttack = plan.offense.members.some(
            (member) => GvgPlans.heroCodeOfMember(member) === attackCode
        );
        if (!hasAttack) return false;
    }

    return true;
}

/* ------------------------------------------------------------------ *
 * 单元格渲染
 * ------------------------------------------------------------------ */

function heroImage(name, size) {
    if (!name) return '';
    const src = HeroesGrid.heroIconSrc(name);
    return `<img class="gvgHeroIcon" style="width:${size}px;height:${size}px" ${HeroesGrid.iconSrcAttributes(
        src,
        `${size}px`
    )}>`;
}

function heroNameForCode(code) {
    return GvgPlans.heroNameForCode(code) || code;
}

function renderDefenseTeam(params) {
    return (params.data.defense.heroCodes || [])
        .map((code) => heroImage(heroNameForCode(code), GVG_HERO_ICON_SIZE))
        .join('');
}

function renderOffenseTeam(params) {
    // 只显示 3 个头像（按站位顺序）；神器/等级放 tooltip 里，列表里不占位置
    return params.data.offense.members
        .map((member) => {
            const entry = GvgPlans.resolveHeroEntry(member.heroId);
            // 条目被删时用缓存的 heroCode 兜底，头像仍然能显示
            const name = entry
                ? entry.name
                : heroNameForCode(member.heroCode || '');
            return heroImage(name, GVG_HERO_ICON_SIZE);
        })
        .join('');
}

/** "详细说明" 列：情报/探路刀标签 + 防守站位标签 + 进攻策略描述文本。最多显示两行，超出省略号 + tooltip */
function renderStrategy(params) {
    const data = params.data || {};
    const intel = (data.intel || '').trim();
    const defenseNote = (data.defenseNote || '').trim();
    const strategy = (data.strategy || '').trim();

    const tags = [];
    // 情报刀（浅红）/ 探路刀（浅绿）
    if (intel) {
        tags.push(`<span class="gvgTag gvgTagIntel" title="${escapeHtml(intel)}">${escapeHtml(i18next.t('Intel blade'))}</span>`);
    } else {
        tags.push(`<span class="gvgTag gvgTagScout" title="${escapeHtml(i18next.t('No intel requirement'))}">${escapeHtml(i18next.t('Scout blade'))}</span>`);
    }
    // 防守站位（浅红，仅当有内容时显示）
    if (defenseNote) {
        tags.push(`<span class="gvgTag gvgTagDefense" title="${escapeHtml(defenseNote)}">${escapeHtml(i18next.t('Defense positioning'))}</span>`);
    }

    const textStyle = 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:100%';
    const text = `<span class="gvgStrategyText" style="${textStyle}">${escapeHtml(strategy || '-')}</span>`;

    return `<span class="gvgStrategyCell">${tags.join('')}${text}</span>`;
}

/** strategy 列的 tooltip：情报 + 防守站位 + 策略 合并全文 */
function strategyTooltip(params) {
    const data = params.data || {};
    const intel = (data.intel || '').trim();
    const defenseNote = (data.defenseNote || '').trim();
    const strategy = (data.strategy || '').trim();
    const lines = [];
    if (intel) lines.push(intel);
    if (defenseNote) lines.push(defenseNote);
    if (strategy) lines.push(strategy);
    return lines.join('\n');
}

function renderActions(params) {
    const { id } = params.data;
    const container = document.createElement('div');
    container.className = 'gvgRowActions';

    // 进攻阵容 1 / 2：本机字段（localStorage），当前被置为该进攻阵容的那个用强调色
    const teams = GvgPlans.getTeams();
    container.appendChild(
        pinButton(id, '1', 'Set as first team', teams.first === id, () =>
            GvgTab.pinFirst(id)
        )
    );
    container.appendChild(
        pinButton(id, '2', 'Set as second team', teams.second === id, () =>
            GvgTab.pinSecond(id)
        )
    );

    return container;
}

/** 置队按钮：1 = 进攻阵容 1，2 = 进攻阵容 2；当前被置为该进攻阵容时显示强调色 */
function pinButton(rowId, label, titleKey, active, onClick) {
    const button = document.createElement('button');
    button.className =
        'gvgRowButton gvgPinButton' + (active ? ' gvgPinButtonActive' : '');
    button.title = i18next.t(titleKey);
    button.innerText = label;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (rowId) module.exports.selectRow(rowId);
        onClick();
    });
    return button;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
