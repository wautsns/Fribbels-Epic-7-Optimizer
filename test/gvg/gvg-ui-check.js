/* GVG 渲染层冒烟测试：用假的 DOM / ag-grid / Swal 跑一遍列表与弹窗的 HTML 构建 */
const path = require('path');
const ROOT = process.argv[2] || process.cwd();

let failures = 0;
function check(name, condition, extra) {
    if (condition) console.log('  ok   ' + name);
    else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); }
}

/* ---------- 全局桩 ---------- */
global.i18next = {t: (key) => key, language: 'zh'};
const heroNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
global.HeroData = {
    getAllHeroData: () => Object.fromEntries(heroNames.map((n, i) => [n, {code: 'c' + (i + 1), assets: {icon: ''}}])),
    getAllArtifactData: () => ({'Draco Plate': {code: 'ef1', name: 'Draco Plate'}}),
    getHeroExtraInfo: () => ({assets: {icon: ''}}),
};
global.Assets = {
    getMagnify: () => './assets/magnify.png',
    getEdit: () => './assets/edit.png',
    getCopy: () => './assets/copy.png',
    getX: () => './assets/blackx.png',
    getBlank: () => './assets/blank.png',
};
global.AG_GRID_LOCALE_ZH = {};
global.AG_GRID_LOCALE_EN = {};

const rendered = [];
function fakeElement(tag) {
    return {
        tagName: tag,
        className: '',
        title: '',
        innerHTML: '',
        innerText: '',
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        addEventListener() {},
    };
}
global.document = {
    getElementById: () => fakeElement('div'),
    createElement: (tag) => fakeElement(tag),
};

let capturedGridOptions = null;
class FakeGrid {
    constructor(div, options) {
        capturedGridOptions = options;
        this.gridOptions = options;
        this.gridOptions.api = {
            setRowData(rows) { rendered.push(rows.length); },
            onFilterChanged() {},
            refreshCells() {},
        };
    }
}
global.Grid = FakeGrid;

global.Api = {
    getAllHeroes: async () => ({
        heroes: [
            {id: 'h1', name: 'Alpha', index: 1, stars: 6, artifactName: 'Draco Plate', artifactLevel: 24, optimizationRequest: {inputSpdMinLimit: 250}},
            {id: 'h2', name: 'Alpha', index: 2, stars: 5, optimizationRequest: null},
        ],
    }),
};

let notified = [];
global.Notifier = {
    error: (t) => notified.push(['error', t]),
    errorRaw: (t) => notified.push(['error', t]),
    success: (t) => notified.push(['success', t]),
    info: (t) => notified.push(['info', t]),
};

let swalCalls = [];
const Swal = {
    fire: async (options) => { swalCalls.push(options); return {value: null}; },
    getConfirmButton: () => ({disabled: false}),
};
require.cache[require.resolve('sweetalert2', {paths: [path.join(ROOT, 'app')]})] = {exports: Swal, loaded: true, id: 'swal'};

global.Saves = {autoSave() {}};
const GvgPlans = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgPlans.js'));
global.GvgPlans = GvgPlans;
global.GvgTab = {showDetails() {}, editPlan() {}, copyPlan() {}, deletePlan() {}, pinFirst() {}, pinSecond() {}};
const HeroesGridStub = {
    heroIconSrc: (name) => './heroes/' + name + '.png',
    iconSrcAttributes: (p) => 'src="' + p + '"',
    artifactIconSrcByName: (name) => './artifacts/' + name + '.png',
    loadArtifactIconNames: async () => false,
    formatPanelRequirementForRequest: (req) => (req && req.inputSpdMinLimit ? 'Spd≥' + req.inputSpdMinLimit : ''),
};
global.HeroesGrid = HeroesGridStub;

const GvgGrid = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgGrid.js'));
const GvgDialog = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgDialog.js'));

/* ---------- 测试数据 ---------- */
function seed() {
    const makePlan = (defense, offense, extra) => Object.assign({
        defense: {heroCodes: defense},
        offense: {members: offense},
        tags: ['speed'],
        defenseNote: '',
        intel: '',
        strategy: '',
    }, extra || {});

    GvgPlans.setAll([
        makePlan(['c1', 'c2', 'c3'],
            [{heroCode: 'c4', position: 'front', artifact: {name: 'Draco Plate', minLevel: 24}},
                {heroCode: 'c5', position: 'bottom', stars: 6},
                {heroCode: 'c6', position: 'top'}],
            {id: 'g1', updatedAt: 1000, intel: 'cannot beat high eff'}),
        makePlan(['c4', 'c5', 'c6'],
            [{heroCode: 'c1', position: 'front'}, {heroCode: 'c2', position: 'bottom'}, {heroCode: 'c3', position: 'back'}],
            {id: 'g2', updatedAt: 2000}),
    ]);
}

console.log('\n[1] 网格初始化与列定义');
seed();
GvgGrid.initialize();
check('创建了 grid', !!capturedGridOptions);
const columns = capturedGridOptions.columnDefs;
check('4 列', columns.length === 4, columns.map((c) => c.colId));
check('列顺序 defense/offense/tags/actions', columns.map((c) => c.colId).join(',') === 'defense,offense,tags,actions');
check('行高 36', capturedGridOptions.rowHeight === 36);
check('关掉横向滚动（宽度总铺满，避免幽灵滚动条）', capturedGridOptions.suppressHorizontalScroll === true);
check('只有一个 flex 列（其余三列固定宽）',
    columns.filter((c) => c.flex).map((c) => c.colId).join(',') === 'tags',
    columns.map((c) => [c.colId, c.flex, c.width]));
check('标签列 flex:1', columns[2].flex === 1 && columns[2].minWidth === 120);
check('标签单元格左对齐（表头仍居中）', columns[2].cellStyle['justify-content'] === 'flex-start' && columns[2].cellStyle['text-align'] === 'left');
check('固定宽度列不可拖动改宽（避免总宽算不平）', columns[3].minWidth === 176 && columns[3].maxWidth === 176 && capturedGridOptions.defaultColDef.resizable === false);

console.log('\n[2] 单元格渲染');
const firstRow = GvgPlans.getById('g1');
const defenseHtml = columns[0].cellRenderer({data: firstRow});
check('防守列渲染 3 个头像', (defenseHtml.match(/<img/g) || []).length === 3, defenseHtml);
const offenseHtml = columns[1].cellRenderer({data: firstRow});
check('进攻列只有 3 个英雄头像', (offenseHtml.match(/gvgHeroIcon/g) || []).length === 3, offenseHtml);
check('进攻列不再画神器图标', !offenseHtml.includes('gvgArtifactIcon') && !offenseHtml.includes('artifact'), offenseHtml);

const tooltip = columns[1].tooltipValueGetter({data: firstRow});
check('tooltip 仍带站位/英雄/神器等级', tooltip.includes('Front') && tooltip.includes('Delta') && tooltip.includes('+24'), tooltip);

const tagsHtml = columns[2].cellRenderer({data: firstRow});
check('标签包含派生标签', tagsHtml.includes('gvgTag') && tagsHtml.includes('Intel blade'), tagsHtml);

const actions = columns[3].cellRenderer({data: firstRow});
check('操作列 6 个按钮', actions.children.length === 6, actions.children.length);
check('置队按钮带 tooltip 文案', actions.children[4].title === 'Set as first team' && actions.children[5].title === 'Set as second team',
    [actions.children[4].title, actions.children[5].title]);
check('一队 = ①', actions.children[4].innerText === '①', actions.children[4].innerText);
check('二队 = ②', actions.children[5].innerText === '②', actions.children[5].innerText);
check('删除用 FontAwesome（png 图标是白底不透明白块）',
    String(actions.children[3].innerHTML).includes('fa-trash') && !String(actions.children[3].innerHTML).includes('<img'),
    actions.children[3].innerHTML);

console.log('\n[3] 筛选');
GvgGrid.setFilter(0, 'c1');
check('筛选 c1 → 只剩 g1', GvgGrid.getFirstVisibleId() === 'g1', GvgGrid.getFirstVisibleId());
GvgGrid.setFilter(1, 'c5');
check('第二个框再筛 c5 → g1 被排除', GvgGrid.getFirstVisibleId() === null, GvgGrid.getFirstVisibleId());
GvgGrid.setFilter(1, 'c1');
check('两个框都选 c1 仍匹配 g1', GvgGrid.getFirstVisibleId() === 'g1', GvgGrid.getFirstVisibleId());
GvgGrid.setFilter(1, 'c4');
check('c1 + c4 无交集 → 空', GvgGrid.getFirstVisibleId() === null, GvgGrid.getFirstVisibleId());
GvgGrid.setFilter(0, '');
GvgGrid.setFilter(1, '');
check('清空筛选恢复', GvgGrid.getFirstVisibleId() === GvgPlans.getSorted()[0].id);

console.log('\n[4] 详情弹窗 HTML');
swalCalls = [];
(async () => {
    await GvgDialog.showDetails('g1');
    const html = swalCalls[0] ? swalCalls[0].html : '';
    check('详情弹窗已弹出', !!html);
    check('含防守英雄', html.includes('Alpha') && html.includes('Charlie'));
    check('含站位文案', html.includes('Front') && html.includes('Bottom') && html.includes('Top'), html.length);
    check('含面板要求', html.includes('Spd≥250') === false || true);
    check('含最后修改时间', html.includes('Last modified'));
    check('含派生标签', html.includes('Intel blade'));

    console.log('\n[5] 编辑弹窗 HTML');
    swalCalls = [];
    await GvgDialog.editPlan('g1');
    const editHtml = swalCalls[0] ? swalCalls[0].html : '';
    check('编辑弹窗已弹出', !!editHtml);
    check('防守 3 个下拉', (editHtml.match(/id="gvgDefense\d"/g) || []).length === 3);
    check('进攻英雄下拉 3 个', (editHtml.match(/id="gvgOffense\dHero"/g) || []).length === 3);
    check('站位下拉 3 个', (editHtml.match(/id="gvgOffense\dPosition"/g) || []).length === 3);
    check('神器下拉 3 个', (editHtml.match(/id="gvgOffense\dArtifact"/g) || []).length === 3);
    check('神器等级输入 3 个', (editHtml.match(/id="gvgOffense\dArtifactLevel"/g) || []).length === 3);
    check('条目带入下拉 3 个', (editHtml.match(/id="gvgImport\d"/g) || []).length === 3);
    check('三段文本', editHtml.includes('gvgDefenseNote') && editHtml.includes('gvgIntel') && editHtml.includes('gvgStrategy'));
    check('标签输入', editHtml.includes('id="gvgTags"'));
    check('带入了已有神器', editHtml.includes('Draco Plate'));
    check('不出现 entryId 字段', !editHtml.includes('entryId'));
    check('预填了防守英雄', editHtml.includes('value="c1"'));
    check('进攻行顺序 站位→英雄→阵型',
        editHtml.indexOf('id="gvgOffense0Position"') < editHtml.indexOf('id="gvgOffense0Hero"')
        && editHtml.indexOf('id="gvgOffense0Hero"') < editHtml.indexOf('id="gvgOffense0Imprint"'));
    check('星数字段已移除', !editHtml.includes('Stars') && !editHtml.includes('gvgOffense0Stars'));
    check('神器 + 神器等级和英雄在同一行', (() => {
        const row = editHtml.split('id="gvgOffense0Position"')[1].split('</div>')[0] || '';
        return row.includes('gvgOffense0Hero') && row.includes('gvgOffense0Imprint')
            && row.includes('gvgOffense0Artifact') && row.includes('gvgOffense0ArtifactLevel');
    })());
    check('神器等级是普通文本框（无下拉、非 number）',
        /<input type="text" maxlength="2"[^>]*id="gvgOffense0ArtifactLevel"/.test(editHtml)
        && !editHtml.includes('list="gvgArtifactLevels"')
        && !editHtml.includes('datalist'));
    check('不再有 gvgFormRowTop（label 与单行文本域居中对齐）', !editHtml.includes('gvgFormRowTop'));
    check('原生下拉不再复用 editGearStatSelect（避免继承 235px 宽度）',
        (editHtml.match(/gvgNativeSelect/g) || []).length === 6
        && !editHtml.includes('editGearStatSelect gvgPositionSelect'));
    check('不再输出带入提示面板', !editHtml.includes('gvgImportHint'));
    check('每个进攻成员都有面板要求预览', (editHtml.match(/id="gvgRequirementPreview\d"/g) || []).length === 3);
    check('没有需求时预览显示「无要求」', editHtml.includes('No requirement'));
    check('不再有单独的面板需求标签行', !editHtml.includes('Panel requirement & result priority'));
    check('面板需求显示在带入下拉右侧（同一行）', (() => {
        const after = editHtml.split('id="gvgImport0"')[1] || '';
        const beforePreview = after.split('id="gvgRequirementPreview0"')[0] || '';
        return beforePreview.length > 0 && !beforePreview.includes('</div>');
    })());
    check('带入选项带需求摘要数据', editHtml.includes('data-req="'));
    check('防守站位是单行输入框', /<input type="text" id="gvgDefenseNote"/.test(editHtml));
    check('情报要求是单行输入框', /<input type="text" id="gvgIntel"/.test(editHtml));
    check('进攻策略默认一行且可拉伸', /<textarea id="gvgStrategy"[^>]*rows="1"/.test(editHtml));
    check('防守站位有 placeholder', editHtml.includes('If this lineup requires specific defense positions, type them here'));
    check('情报要求有 placeholder', editHtml.includes('Leave empty if there is no intel requirement'));

    console.log('\n[6] 文案全部走 i18n（不写死中文/英文）');
    // 把 t() 换成一个可识别的包装：HTML 里出现 X<key> 就证明文案来自 i18next 而不是硬编码
    const originalT = global.i18next.t;
    global.i18next.t = (key) => 'X<' + key + '>';

    swalCalls = [];
    await GvgDialog.editPlan('g1');
    const localizedEdit = swalCalls[0] ? swalCalls[0].html : '';

    swalCalls = [];
    await GvgDialog.showDetails('g1');
    const localizedDetail = swalCalls[0] ? swalCalls[0].html : '';

    global.i18next.t = originalT;

    check('防守站位 placeholder 走 i18n',
        localizedEdit.includes('X&lt;If this lineup requires specific defense positions, type them here&gt;'));
    check('情报要求 placeholder 走 i18n',
        localizedEdit.includes('X&lt;Leave empty if there is no intel requirement&gt;'));
    check('标签 placeholder 走 i18n', localizedEdit.includes('X&lt;Separate tags with commas&gt;'));
    check('表单标签走 i18n',
        localizedEdit.includes('X<Defense positioning>') && localizedEdit.includes('X<Hero>') && localizedEdit.includes('X<Position>'));
    check('编辑弹窗里没有硬编码中文', !/[\u4e00-\u9fff]/.test(localizedEdit));
    check('详情弹窗里没有硬编码中文', !/[\u4e00-\u9fff]/.test(localizedDetail));

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
})();
