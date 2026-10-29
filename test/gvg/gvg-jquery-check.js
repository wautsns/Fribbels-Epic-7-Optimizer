/*
 * GVG 编辑弹窗在「有 jQuery + multiple-select」这条真实路径上的接线测试。
 * 这是回归测试：multiple-select 改值走的是 jQuery trigger('change')，
 * 原生 addEventListener 收不到，会导致「从英雄列表带入」选了但数据不回填。
 */
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

/* ---------- jQuery 桩（只实现我们用到的部分，并记录 jQuery 绑定的事件） ---------- */
const jqHandlers = new Map();
/* 记录每个下拉初始化时传给 multiple-select 的选项（宽度等必须显式传） */
const msOptions = new Map();
function jq(target) {
    const element = typeof target === 'string' ? global.document.getElementById(target.replace('#', '')) : target;
    return {
        on(type, handler) {
            const key = element.id + ':' + type;
            if (!jqHandlers.has(key)) jqHandlers.set(key, []);
            jqHandlers.get(key).push(handler);
            return this;
        },
        trigger(type) {
            const key = element.id + ':' + type;
            (jqHandlers.get(key) || []).forEach((handler) => handler());
            return this;
        },
        multipleSelect(command, value) {
            if (command && typeof command === 'object') {
                msOptions.set(element.id, command);
                return this;
            }
            if (command === 'setSelects') {
                element.value = Array.isArray(value) ? value[0] || '' : value || '';
            }
            return this;
        },
        val(value) {
            if (value === undefined) return element.value;
            element.value = Array.isArray(value) ? value[0] || '' : value;
            return this;
        },
    };
}
jq.fn = {multipleSelect: true};
global.$ = jq;

global.HeroData = {
    getAllHeroData: () => Object.fromEntries(heroNames.map((n, i) => [n, {code: 'c' + (i + 1)}])),
    getAllArtifactData: () => ({'Draco Plate': {code: 'ef1', name: 'Draco Plate'}}),
};

global.HeroesGrid = {
    formatPanelRequirementForRequest: (req) => (req && req.inputSpdMinLimit ? 'Spd≥' + req.inputSpdMinLimit : ''),
    heroIconSrc: () => '',
};

const elements = {};
function makeElement(id) {
    return {
        id,
        value: '',
        innerHTML: '',
        innerText: '',
        options: [],
        listeners: {},
        classes: [],
        classList: {
            contains: (name) => elements[id].classes.includes(name),
            add: (name) => elements[id].classes.push(name),
        },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        dispatch(type) { if (this.listeners[type]) this.listeners[type]({target: this}); },
    };
}
global.document = {
    getElementById: (id) => {
        if (!elements[id]) elements[id] = makeElement(id);
        return elements[id];
    },
};

let captured = null;
const swalStub = {
    fire: async (options) => { captured = options; return {value: null}; },
    getConfirmButton: () => elements['__confirm'] || (elements['__confirm'] = makeElement('__confirm')),
};

const stubs = {sweetalert2: swalStub};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
};

global.Api = {
    getAllHeroes: async () => ({
        heroes: [
            {id: 'h1', name: 'Alpha', index: 1, stars: 6, artifactName: 'Draco Plate', artifactLevel: 24, optimizationRequest: {inputSpdMinLimit: 250}},
            {id: 'h2', name: 'Bravo', index: 2, stars: 5, optimizationRequest: null},
        ],
    }),
};
const notifications = [];
global.Notifier = {
    error: (t) => notifications.push(['error', t]),
    errorRaw: (t) => notifications.push(['error', t]),
};
global.Saves = {autoSave() {}};

const GvgPlans = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgPlans.js'));
global.GvgPlans = GvgPlans;
const GvgDialog = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgDialog.js'));

function setValues(values) {
    Object.keys(values).forEach((id) => {
        global.document.getElementById(id).value = values[id];
    });
}

(async () => {
    console.log('\n[1] 打开弹窗：升级过的下拉用 jQuery 绑定 change');
    await GvgDialog.editPlan(null);

    // 模拟真实 DOM：神器下拉里本来就有选项（代码会检查条目神器是否在选项里）
    [0, 1, 2].forEach((index) => {
        global.document.getElementById(`gvgOffense${index}Artifact`).options = [
            {value: ''},
            {value: 'Draco Plate'},
        ];
    });

    captured.didOpen();

    check('带入下拉绑在 jQuery 上（而不是原生监听）',
        (jqHandlers.get('gvgImport0:change') || []).length === 1,
        Array.from(jqHandlers.keys()));
    check('英雄下拉也绑在 jQuery 上', (jqHandlers.get('gvgOffense0Hero:change') || []).length === 1);
    check('神器下拉也绑在 jQuery 上（用于重新校验）', (jqHandlers.get('gvgOffense0Artifact:change') || []).length === 1);
    check('带入下拉没有走原生监听', !elements['gvgImport0'].listeners['change']);

    // 插件 initView() 会用内联宽度覆盖 CSS，所以宽度必须显式传给插件
    const importOptions = msOptions.get('gvgImport0') || {};
    const heroOptions = msOptions.get('gvgOffense0Hero') || {};
    const artifactOptions = msOptions.get('gvgOffense0Artifact') || {};
    check('带入下拉显式传入 width=168（与英雄下拉一致）', importOptions.width === 168, importOptions.width);
    check('英雄下拉显式传入 width=168', heroOptions.width === 168, heroOptions.width);
    check('神器下拉显式传入 width=190', artifactOptions.width === 190, artifactOptions.width);
    check('带入下拉展开列表仍是 460（需求不被裁）', importOptions.dropWidth === 460, importOptions.dropWidth);

    console.log('\n[2] 插件触发 change → 数据必须回填');
    setValues({gvgDefense0: 'c1', gvgDefense1: 'c2', gvgDefense2: 'c3'});
    setValues({gvgOffense0Position: 'front', gvgOffense1Hero: 'c5', gvgOffense1Position: 'bottom', gvgOffense2Hero: 'c6', gvgOffense2Position: 'top'});

    // 模拟用户在选择框里选了 h1（插件会先写好原生 value，再 jQuery trigger change）
    elements['gvgImport0'].value = 'h1';
    jq('#gvgImport0').trigger('change');

    check('英雄回填', elements['gvgOffense0Hero'].value === 'c1', elements['gvgOffense0Hero'].value);
    check('神器回填', elements['gvgOffense0Artifact'].value === 'Draco Plate', elements['gvgOffense0Artifact'].value);
    check('神器等级回填', elements['gvgOffense0ArtifactLevel'].value === 24, elements['gvgOffense0ArtifactLevel'].value);
    check('阵型回填为自阵', elements['gvgOffense0Imprint'].value === 'self');
    check('面板要求预览回填', elements['gvgRequirementPreview0'].innerHTML === 'Spd≥250',
        elements['gvgRequirementPreview0'].innerHTML);

    console.log('\n[3] 表单变合法 → 保存按钮解锁');
    check('确认按钮可用', elements['__confirm'].disabled === false, elements['gvgValidationMessage'].innerText);

    console.log('\n[4] 手动换英雄（插件同样 trigger change）→ 面板要求清空');
    elements['gvgOffense0Hero'].value = 'c4';
    jq('#gvgOffense0Hero').trigger('change');
    check('换英雄后面板要求清空',
        elements['gvgRequirementPreview0'].innerHTML === 'No requirement',
        elements['gvgRequirementPreview0'].innerHTML);

    console.log('\n[5] 选「不带入」→ 还原');
    elements['gvgImport0'].value = '';
    jq('#gvgImport0').trigger('change');
    check('不带入后英雄清空（新作业默认值）', elements['gvgOffense0Hero'].value === '', elements['gvgOffense0Hero'].value);
    check('不带入后神器清空', elements['gvgOffense0Artifact'].value === '', elements['gvgOffense0Artifact'].value);

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
})();
