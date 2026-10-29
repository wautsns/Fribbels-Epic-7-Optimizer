/**
 * GVG 作业列表（ag-grid）—— docs/gvg/design.md 第 6 节。
 *
 * 列：防守阵容 / 进攻阵容（前下上后，只显示头像）/ 作业标签（flex:1，左对齐）/ 操作（6 个按钮）
 * 行高 36px，同屏 6 行；排序、筛选、置队全部由 GvgPlans + 本地筛选状态决定。
 */
const GVG_ROW_HEIGHT = 36;
const GVG_HERO_ICON_SIZE = 32;

const OFFENSE_COL_ID = 'offense';

/* 站位展示文案 key（数据里存 front/bottom/top/back） */
const POSITION_LABEL_KEYS = {
    front: 'Front',
    bottom: 'Bottom',
    top: 'Top',
    back: 'Back',
};

/* 3 个防守筛选框的当前值（按 hero code 匹配；空串 = 不筛） */
const filterCodes = ['', '', ''];

let gvgGrid = null;

module.exports = {
    initialize: () => {
        const localeText =
            i18next.language == 'zh' ? AG_GRID_LOCALE_ZH : AG_GRID_LOCALE_EN;

        const gridOptions = {
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
                    tooltipValueGetter: offenseTooltip,
                },
                {
                    colId: 'tags',
                    headerName: i18next.t('Tags'),
                    // 只有这一列伸缩：宽度 = 视口宽 - 其它三列，所以总宽恒等于视口，不会出现横向滚动
                    flex: 1,
                    minWidth: 120,
                    cellRenderer: renderTags,
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
                    width: 176,
                    minWidth: 176,
                    maxWidth: 176,
                    cellRenderer: renderActions,
                },
            ],
            rowData: [],
            rowHeight: GVG_ROW_HEIGHT,
            headerHeight: 32,
            suppressCellSelection: true,
            enableRangeSelection: false,
            suppressScrollOnNewData: true,
            suppressMovableColumns: true,
            // 4 列宽度总是正好铺满视口（只有 tags 列 flex），关掉横向滚动条，
            // 避免 flex 算出小数宽度后被四舍五入出 1px 溢出、出现"永远有个右滚条"
            suppressHorizontalScroll: true,
            tooltipShowDelay: 300,
            getRowNodeId: (data) => data.id,
            isExternalFilterPresent: () => filterCodes.some((code) => !!code),
            doesExternalFilterPass: (node) => matchesDefenseFilters(node.data),
        };

        const gridDiv = document.getElementById('gvg-plans-table');
        gvgGrid = new Grid(gridDiv, gridOptions);

        module.exports.refresh();
    },

    /** 数据或筛选变化后重画；数据来自 GvgPlans（已排序） */
    refresh: () => {
        if (!gvgGrid || !gvgGrid.gridOptions.api) return;

        gvgGrid.gridOptions.api.setRowData(GvgPlans.getSorted());
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
    return filterCodes.every(
        (code) => !code || plan.defense.heroCodes.includes(code)
    );
}

/* ------------------------------------------------------------------ *
 * 单元格渲染
 * ------------------------------------------------------------------ */

function heroImage(name, size) {
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
        .map((member) => heroImage(member.name, GVG_HERO_ICON_SIZE))
        .join('');
}

function offenseTooltip(params) {
    return params.data.offense.members
        .map((member) => {
            const artifact = member.artifact
                ? ` · ${i18next.t(member.artifact.name)}${
                      member.artifact.minLevel
                          ? ` +${member.artifact.minLevel}`
                          : ''
                  }`
                : '';
            return `${i18next.t(
                POSITION_LABEL_KEYS[member.position] || 'Position'
            )} ${i18next.t(member.name)}${artifact}`;
        })
        .join('\n');
}

function renderTags(params) {
    const tags = GvgPlans.displayTags(params.data);
    const chips = tags
        .map((tag) => `<span class="gvgTag">${escapeHtml(tag)}</span>`)
        .join('');
    return `<div class="gvgTagRow">${chips}</div>`;
}

function renderActions(params) {
    const { id } = params.data;
    const container = document.createElement('div');
    container.className = 'gvgRowActions';

    container.appendChild(
        iconButton(Assets.getMagnify(), 'View', () => GvgTab.showDetails(id))
    );
    container.appendChild(
        iconButton(Assets.getEdit(), 'Edit', () => GvgTab.editPlan(id))
    );
    container.appendChild(
        iconButton(Assets.getCopy(), 'Copy', () => GvgTab.copyPlan(id))
    );
    container.appendChild(
        iconButton(Assets.getX(), 'Delete', () => GvgTab.deletePlan(id))
    );
    container.appendChild(
        pinButton('fa-angle-double-up', 'Set as first team', () =>
            GvgTab.pinFirst(id)
        )
    );
    container.appendChild(
        pinButton('fa-angle-up', 'Set as second team', () =>
            GvgTab.pinSecond(id)
        )
    );

    return container;
}

function iconButton(iconSrc, titleKey, onClick) {
    const button = document.createElement('button');
    button.className = 'gvgRowButton';
    button.title = i18next.t(titleKey);
    button.innerHTML = `<img class="gvgRowButtonIcon" src="${iconSrc}">`;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
    });
    return button;
}

/** 置队按钮：两个向上的三角 = 一队，一个 = 二队（FontAwesome） */
function pinButton(faIcon, titleKey, onClick) {
    const button = document.createElement('button');
    button.className = 'gvgRowButton gvgPinButton';
    button.title = i18next.t(titleKey);
    button.innerHTML = `<i class="fas ${faIcon}"></i>`;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
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
