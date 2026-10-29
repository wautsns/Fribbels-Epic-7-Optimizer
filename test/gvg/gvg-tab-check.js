/* GVG 页（gvgTab）冒烟测试：桩掉 electron/remote/sweetalert2/files/settings，验证按钮接线与导出导入流程 */
const path = require('path');
const Module = require('module');

const ROOT = process.argv[2] || process.cwd();
let failures = 0;
function check(name, condition, extra) {
    if (condition) console.log('  ok   ' + name);
    else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); }
}

global.i18next = {t: (key) => key, language: 'zh'};

const heroNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
global.HeroData = {
    getAllHeroData: () => Object.fromEntries(heroNames.map((n, i) => [n, {code: 'c' + (i + 1)}])),
    getAllArtifactData: () => ({}),
};
global.Assets = {getBlank: () => ''};

/* ---------- DOM 桩 ---------- */
const elements = {};
function makeElement(id) {
    return {
        id,
        value: '',
        innerHTML: '',
        innerText: '',
        options: [],
        listeners: {},
        add(option) { this.options.push(option); },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        dispatch(type, arg) { if (this.listeners[type]) return this.listeners[type](arg); },
    };
}
global.document = {
    getElementById: (id) => {
        if (!elements[id]) elements[id] = makeElement(id);
        return elements[id];
    },
    createElement: (tag) => makeElement('created-' + tag),
};

/* ---------- 模块桩 ---------- */
const clipboard = {written: null, writeText(text) { this.written = text; }};
let savedPath = null;
let savedText = null;
let savedDialogOptions = null;
let openFiles = [];
let confirmAnswer = true;
let swalValue = null;

const stubs = {
    electron: {clipboard},
    '@electron/remote': {
        dialog: {
            showSaveDialogSync: (win, options) => { savedDialogOptions = options; return 'C:/tmp/gvg.json'; },
            showOpenDialogSync: () => openFiles,
        },
        getCurrentWindow: () => ({}),
    },
    sweetalert2: {
        fire: async () => ({value: swalValue}),
        getConfirmButton: () => ({disabled: false}),
    },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
};

global.Files = {
    path: (p) => p,
    readFileSync: () => savedText,
    saveFile: (p, text) => { savedPath = p; savedText = text; },
    getDataPath: () => ROOT + '/data',
};
global.Settings = {getDefaultPath: () => 'C:/saves'};
global.Dialog = {confirmation: async () => confirmAnswer};
const notifications = [];
global.Notifier = {
    error: (t) => notifications.push(['error', t]),
    errorRaw: (t) => notifications.push(['error', t]),
    success: (t) => notifications.push(['success', t]),
    successRaw: (t) => notifications.push(['success', t]),
    info: (t) => notifications.push(['info', t]),
    infoRaw: (t) => notifications.push(['info', t]),
    warn: (t) => notifications.push(['warn', t]),
    warnRaw: (t) => notifications.push(['warn', t]),
};
global.Saves = {autoSave() {}};

const GvgPlans = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgPlans.js'));
global.GvgPlans = GvgPlans;

const gridCalls = [];
global.GvgGrid = {
    refresh: () => gridCalls.push('refresh'),
    setFilter: (index, code) => gridCalls.push('filter:' + index + '=' + code),
    initialize: () => {},
};
const dialogCalls = [];
global.GvgDialog = {
    editPlan: async (id) => dialogCalls.push('edit:' + id),
    showDetails: async (id) => dialogCalls.push('details:' + id),
};
const GvgTab = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgTab.js'));
global.GvgTab = GvgTab;

/* ---------- 数据 ---------- */
function seed() {
    const plan = (defense, offense, extra) => Object.assign({
        defense: {heroCodes: defense},
        offense: {members: offense},
        tags: ['t'], defenseNote: '', intel: '', strategy: '',
    }, extra || {});

    GvgPlans.setAll([
        plan(['c1', 'c2', 'c3'], [{heroCode: 'c4', position: 'front'}, {heroCode: 'c5', position: 'bottom'}, {heroCode: 'c6', position: 'top'}], {id: 'g1', updatedAt: 1000}),
        plan(['c4', 'c5', 'c6'], [{heroCode: 'c1', position: 'front'}, {heroCode: 'c2', position: 'bottom'}, {heroCode: 'c3', position: 'back'}], {id: 'g2', updatedAt: 2000}),
    ]);
}

(async () => {
    console.log('\n[1] 初始化接线');
    seed();
    GvgTab.initialize();
    ['gvg-add', 'gvg-paste', 'gvg-export', 'gvg-import', 'gvg-dedupe', 'gvg-clear'].forEach((id) => {
        check(id + ' 已绑定点击事件', !!elements[id] && !!elements[id].listeners['click'], Object.keys(elements[id] || {}));
    });
    check('筛选框注入选项（空选项 + 出现过的防守英雄）', elements['gvg-filter-0'].options.length === 1 + 6,
        elements['gvg-filter-0'].options.length);
    check('筛选框第一个选项是"任意"', elements['gvg-filter-0'].options[0].value === '');

    console.log('\n[2] 新增 / 详情 / 删除');
    dialogCalls.length = 0;
    await GvgTab.addPlan();
    check('新增按钮打开空编辑弹窗', dialogCalls.includes('edit:null'), dialogCalls);

    await GvgTab.showDetails('g1');
    check('详情转发到弹窗', dialogCalls.includes('details:g1'), dialogCalls);

    confirmAnswer = true;
    await GvgTab.deletePlan('g1');
    check('删除后只剩一条', GvgPlans.getAll().length === 1 && GvgPlans.getAll()[0].id === 'g2', GvgPlans.getAll().map((p) => p.id));

    console.log('\n[3] 复制 / 粘贴');
    seed();
    clipboard.written = null;
    notifications.length = 0;
    GvgTab.copyPlan('g1');
    check('写入剪贴板且带魔数头', !!clipboard.written && clipboard.written.startsWith('E7GVG1:'));
    check('复制成功提示', notifications.some((n) => n[0] === 'success'));

    const encoded = clipboard.written;
    GvgPlans.remove('g1');
    swalValue = encoded;
    await GvgTab.pastePlan();
    check('粘贴后恢复为 2 条', GvgPlans.getAll().length === 2, GvgPlans.getAll().length);
    check('粘贴进来的副本 id 是新的', !GvgPlans.getAll().some((p) => p.id === 'g1'));

    notifications.length = 0;
    await GvgTab.pastePlan();
    check('重复粘贴提示"已存在"', notifications.some((n) => n[0] === 'warn' && n[1] === 'This GVG plan already exists'), notifications);

    swalValue = 'not-a-plan';
    notifications.length = 0;
    await GvgTab.pastePlan();
    check('非法文本给出明确提示', notifications.some((n) => n[1] === 'This is not a GVG plan text'), notifications);

    swalValue = 'E7GVG0:xx';
    notifications.length = 0;
    await GvgTab.pastePlan();
    check('旧版本给出明确提示', notifications.some((n) => n[1] === 'This GVG plan text was created by an unsupported version'), notifications);

    console.log('\n[4] 导出 / 导入');
    seed();
    notifications.length = 0;
    GvgTab.exportPlans();
    check('导出写入了文件', !!savedPath, savedPath);
    check('默认文件名带日期', !!savedDialogOptions && /gvg-plans-\d{4}-\d{2}-\d{2}\.json$/.test(savedDialogOptions.defaultPath), savedDialogOptions && savedDialogOptions.defaultPath);
    const pkg = JSON.parse(savedText);
    check('导出包 schema/version 正确', pkg.schema === 'e7-gvg-plans' && pkg.schemaVersion === 1, pkg.schema);
    check('导出 2 条且不含 lastUsedAt', pkg.plans.length === 2 && pkg.plans.every((p) => p.lastUsedAt === undefined));

    const exportedText = savedText;
    GvgPlans.setAll([]);
    openFiles = ['C:/tmp/gvg.json'];
    savedText = exportedText;
    notifications.length = 0;
    GvgTab.importPlans();
    check('导入后 2 条', GvgPlans.getAll().length === 2, GvgPlans.getAll().length);
    check('导入成功提示', notifications.some((n) => n[0] === 'success'));

    notifications.length = 0;
    GvgTab.importPlans();
    check('再导入一次提示已存在', notifications.some((n) => n[1] === 'This GVG plan already exists'), notifications);

    savedText = JSON.stringify({schema: 'other', schemaVersion: 1, plans: []});
    notifications.length = 0;
    GvgTab.importPlans();
    check('错误 schema 被拒', notifications.some((n) => n[1] === 'This file is not a GVG plans export'), notifications);

    savedText = JSON.stringify({schema: 'e7-gvg-plans', schemaVersion: 9, plans: []});
    notifications.length = 0;
    GvgTab.importPlans();
    check('错误版本被拒', notifications.some((n) => n[1] === 'This file was exported by an unsupported version'), notifications);

    console.log('\n[5] 去重 / 清空 / 置队');
    const base = GvgPlans.getAll()[0];
    GvgPlans.setAll([Object.assign({}, base, {id: 'x1', updatedAt: 100}), Object.assign({}, base, {id: 'x2', updatedAt: 200})]);
    const before = GvgPlans.getAll().length;
    notifications.length = 0;
    await GvgTab.dedupePlans();
    check('去重移除 1 条并提示', GvgPlans.getAll().length === before - 1
        && notifications.some((n) => n[0] === 'success' && n[1].startsWith('Removed duplicated GVG plans')),
    [GvgPlans.getAll().length, notifications]);

    notifications.length = 0;
    await GvgTab.dedupePlans();
    check('无重复时提示未发现重复', notifications.some((n) => n[1] === 'No duplicated GVG plans found'), notifications);

    confirmAnswer = false;
    await GvgTab.clearPlans();
    check('取消二次确认 → 不清空', GvgPlans.getAll().length > 0);

    confirmAnswer = true;
    await GvgTab.clearPlans();
    check('确认后清空', GvgPlans.getAll().length === 0);

    seed();
    GvgTab.pinFirst('g1');
    check('置为一队生效', GvgPlans.getSorted()[0].id === 'g1', GvgPlans.getSorted().map((p) => p.id));
    GvgTab.pinSecond('g2');
    check('置为二队生效', GvgPlans.getSorted()[1].id === 'g2', GvgPlans.getSorted().map((p) => p.id));

    console.log('\n[6] 重绘');
    gridCalls.length = 0;
    GvgTab.redraw();
    check('redraw 触发筛选重建与表格刷新', gridCalls.includes('refresh') && gridCalls.some((c) => c.startsWith('filter:')), gridCalls);

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
})();
