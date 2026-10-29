/* GVG 编辑弹窗表单逻辑：didOpen 校验 + 条目带入 + preConfirm 读值 */
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
    getAllArtifactData: () => ({'Draco Plate': {code: 'ef1', name: 'Draco Plate'}}),
};

/* 可变 DOM：id -> {value, options, listeners, ...} */
const elements = {};
function makeElement(id) {
    return {
        id, value: '', innerHTML: '', innerText: '', options: [], listeners: {}, disabled: false,
        addEventListener(type, handler) { this.listeners[type] = handler; },
        dispatch(type) { if (this.listeners[type]) return this.listeners[type]({target: this}); },
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

const stubs = {'sweetalert2': swalStub};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
};

global.Api = {
    getAllHeroes: async () => ({
        // 故意乱序 + index 与数组顺序相反，用来验证「按英雄列表顺序」排序
        heroes: [
            {id: 'h2', name: 'Bravo', index: 2, stars: 5, optimizationRequest: null},
            {id: 'h1', name: 'Alpha', index: 1, stars: 6, artifactName: 'Draco Plate', artifactLevel: 24, optimizationRequest: {inputSpdMinLimit: 250, excludeFilter: [1], resultPriority: ['spd']}},
        ],
    }),
};
global.HeroesGrid = {
    // 模仿英雄列表那一列：属性要求 + 结果优先级，用 ' · ' 分隔
    formatPanelRequirementForRequest: (req) => {
        if (!req) return '';
        const parts = [];
        if (req.inputSpdMinLimit) parts.push('Spd≥' + req.inputSpdMinLimit);
        if (Array.isArray(req.resultPriority)) parts.push(...req.resultPriority.map((field) => field.toUpperCase() + '∧'));
        return parts.join(' · ');
    },
    heroIconSrc: () => '',
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
    for (const id of Object.keys(values)) {
        const element = global.document.getElementById(id);
        element.value = values[id];
    }
}

function seedPlan() {
    GvgPlans.setAll([{
        defense: {heroCodes: ['c1', 'c2', 'c3']},
        offense: {
            members: [
                {heroCode: 'c4', position: 'front', artifact: {name: 'Draco Plate', minLevel: 15}},
                {heroCode: 'c5', position: 'bottom'},
                {heroCode: 'c6', position: 'top'},
            ],
        },
        tags: ['a', 'b'], defenseNote: '', intel: '', strategy: 'long text',
    }]);
    return GvgPlans.getAll()[0].id;
}

(async () => {
    console.log('\n[1] 新增：空表单被拦下');
    await GvgDialog.editPlan(null);
    check('弹窗已捕获', !!captured && !!captured.html);
    captured.didOpen();
    check('空表单时确认按钮被禁用', elements['__confirm'].disabled === true, elements['__confirm'].disabled);
    check('显示校验提示', elements['gvgValidationMessage'].innerText === 'Defense team needs 3 different heroes',
        elements['gvgValidationMessage'].innerText);

    console.log('\n[2] 逐步填完 → 解锁');
    setValues({gvgDefense0: 'c1', gvgDefense1: 'c2', gvgDefense2: 'c3'});
    elements['gvgDefense0'].dispatch('change');
    check('只填防守仍被拦（进攻为空）', elements['__confirm'].disabled === true);
    check('提示切到进攻', elements['gvgValidationMessage'].innerText === 'Offense team needs 3 different heroes',
        elements['gvgValidationMessage'].innerText);

    setValues({
        gvgOffense0Hero: 'c4', gvgOffense0Position: 'front',
        gvgOffense1Hero: 'c5', gvgOffense1Position: 'bottom',
        gvgOffense2Hero: 'c6', gvgOffense2Position: 'top',
    });
    elements['gvgOffense2Hero'].dispatch('change');
    check('三英雄三站位齐全 → 可保存', elements['__confirm'].disabled === false, elements['gvgValidationMessage'].innerText);

    setValues({gvgOffense1Position: 'front'});
    elements['gvgOffense1Position'].dispatch('change');
    check('站位重复 → 再次拦下', elements['__confirm'].disabled === true);
    check('提示站位冲突', elements['gvgValidationMessage'].innerText === 'Positions must be different',
        elements['gvgValidationMessage'].innerText);
    setValues({gvgOffense1Position: 'bottom'});
    elements['gvgOffense1Position'].dispatch('change');

    setValues({gvgOffense0Artifact: 'Draco Plate', gvgOffense0ArtifactLevel: '31'});
    elements['gvgOffense0ArtifactLevel'].dispatch('change');
    check('神器等级 31 → 拦下', elements['__confirm'].disabled === true);
    check('提示等级范围', elements['gvgValidationMessage'].innerText === 'Artifact level must be between 0 and 30',
        elements['gvgValidationMessage'].innerText);
    setValues({gvgOffense0ArtifactLevel: '24'});
    elements['gvgOffense0ArtifactLevel'].dispatch('change');
    check('改回 24 → 解锁', elements['__confirm'].disabled === false);

    console.log('\n[3] 从英雄列表带入');
    setValues({gvgImport0: 'h1'});
    elements['gvgImport0'].dispatch('change');
    check('神器名带入', elements['gvgOffense0Artifact'].value === 'Draco Plate');
    check('神器等级带入', elements['gvgOffense0ArtifactLevel'].value === 24, elements['gvgOffense0ArtifactLevel'].value);
    check('星级已移除（不再有星数下拉）', !elements['gvgOffense0Stars'] || elements['gvgOffense0Stars'].value === '');
    check('阵型模式重置为自阵', elements['gvgOffense0Imprint'].value === 'self');
    check('英雄下拉也一起带入', elements['gvgOffense0Hero'].value === 'c1', elements['gvgOffense0Hero'].value);

    // 带入下拉的选项顺序 = 英雄列表顺序（index 升序），不是数组顺序也不是名字排序
    const entrySelectHtml = captured.html.split('id="gvgImport0"')[1].split('</select>')[0];
    check('每个条目都带英雄列表排名（不只重名时才加）',
        entrySelectHtml.includes('Alpha #1') && entrySelectHtml.includes('Bravo #2'), entrySelectHtml.slice(0, 300));
    check('带入下拉按英雄列表顺序排列',
        entrySelectHtml.indexOf('Alpha') < entrySelectHtml.indexOf('Bravo'), entrySelectHtml.slice(0, 200));

    check('面板要求预览显示带进来的内容',
        elements['gvgRequirementPreview0'].innerHTML === 'Spd≥250 · SPD∧',
        elements['gvgRequirementPreview0'].innerHTML);

    // 选择「不带入」→ 自动带入的东西全部退回默认值
    setValues({gvgImport0: ''});
    elements['gvgImport0'].dispatch('change');
    check('不带入 → 面板要求清空', elements['gvgRequirementPreview0'].innerHTML === 'No requirement',
        elements['gvgRequirementPreview0'].innerHTML);
    check('不带入 → 英雄清空', elements['gvgOffense0Hero'].value === '', elements['gvgOffense0Hero'].value);
    check('不带入 → 神器清空', elements['gvgOffense0Artifact'].value === '', elements['gvgOffense0Artifact'].value);
    check('不带入 → 神器等级归零', elements['gvgOffense0ArtifactLevel'].value === '0', elements['gvgOffense0ArtifactLevel'].value);

    check('不带入 → 阵型回自阵', elements['gvgOffense0Imprint'].value === 'self');

    // 再带入一次，后面的用例继续用它（桩里 select.options 是空的，神器值手工补上）
    setValues({gvgImport0: 'h1'});
    elements['gvgImport0'].dispatch('change');
    setValues({
        gvgOffense0Hero: 'c4', gvgOffense0Position: 'front',
        gvgOffense0Artifact: 'Draco Plate', gvgOffense0ArtifactLevel: '24',
        gvgOffense1Hero: 'c5', gvgOffense1Position: 'bottom',
        gvgOffense2Hero: 'c6', gvgOffense2Position: 'top',
    });
    check('重新带入后预览恢复', elements['gvgRequirementPreview0'].innerHTML === 'Spd≥250 · SPD∧',
        elements['gvgRequirementPreview0'].innerHTML);

    console.log('\n[4] preConfirm 读值 + 保存');
    setValues({gvgTags: '快攻, 无反手 ， 快攻', gvgDefenseNote: '站这', gvgIntel: '打不了高命中', gvgStrategy: 'first do X'});
    const draft = captured.preConfirm();
    check('防守 3 人', draft.defense.heroCodes.join(',') === 'c1,c2,c3');
    check('标签去重并去空格', draft.tags.join('|') === '快攻|无反手', draft.tags);
    check('三段文本读取', draft.defenseNote === '站这' && draft.intel === '打不了高命中' && draft.strategy === 'first do X');
    check('神器带入', draft.offense.members[0].artifact.name === 'Draco Plate' && draft.offense.members[0].artifact.minLevel === 24,
        draft.offense.members[0].artifact);
    check('面板要求被带入', draft.offense.members[0].requirement.inputSpdMinLimit === 250, draft.offense.members[0].requirement);

    captured = null;
    swalStub.fire = async (options) => { captured = options; return {value: draft}; };
    await GvgDialog.editPlan(null);
    check('保存成功并生成新作业', GvgPlans.getAll().length === 1, GvgPlans.getAll().length);
    const saved = GvgPlans.getAll().find((p) => p.tags.includes('快攻'));
    check('保存的作业带带入的需求（且已剔除运行期字段）',
        !!saved && saved.offense.members[0].requirement.inputSpdMinLimit === 250
        && saved.offense.members[0].requirement.excludeFilter === undefined,
        saved && saved.offense.members[0].requirement);
    check('保存后无 entryId', !!saved && saved.entryId === undefined);

    console.log('\n[5] 编辑已有作业');
    const planId = seedPlan();
    captured = null;
    swalStub.fire = async (options) => { captured = options; return {value: null}; };
    await GvgDialog.editPlan(planId);
    check('编辑弹窗预填防守', captured.html.includes('value="c1"'));

    // 模拟 HTML 预填：桩 DOM 不会解析 captured.html，这里手动塞入作业现值
    setValues({
        gvgDefense0: 'c1', gvgDefense1: 'c2', gvgDefense2: 'c3',
        gvgOffense0Hero: 'c4', gvgOffense0Position: 'front', gvgOffense0Artifact: 'Draco Plate', gvgOffense0ArtifactLevel: '15',
        gvgOffense1Hero: 'c5', gvgOffense1Position: 'bottom', gvgOffense1Artifact: '', gvgOffense1ArtifactLevel: '0',
        gvgOffense2Hero: 'c6', gvgOffense2Position: 'top', gvgOffense2Artifact: '', gvgOffense2ArtifactLevel: '0',
        gvgOffense0Imprint: 'self', gvgOffense1Imprint: 'self', gvgOffense2Imprint: 'self',
        gvgImport0: '', gvgImport1: '', gvgImport2: '',
    });

    captured.didOpen();
    check('已有作业表单合法 → 直接可保存', elements['__confirm'].disabled === false);
    const edited = captured.preConfirm();
    check('preConfirm 保留原 id/需求',
        edited.id === planId && edited.offense.members[0].artifact.name === 'Draco Plate');

    // 老作业：带入之后再选「不带入」→ 还原成作业原来的值（不是清空）
    setValues({gvgImport0: 'h1'});
    elements['gvgImport0'].dispatch('change');
    check('老作业带入后英雄变成条目的英雄', elements['gvgOffense0Hero'].value === 'c1', elements['gvgOffense0Hero'].value);
    check('老作业带入后预览显示新要求',
        elements['gvgRequirementPreview0'].innerHTML === 'Spd≥250 · SPD∧', elements['gvgRequirementPreview0'].innerHTML);

    setValues({gvgImport0: ''});
    elements['gvgImport0'].dispatch('change');
    check('不带入 → 还原原来的英雄', elements['gvgOffense0Hero'].value === 'c4', elements['gvgOffense0Hero'].value);
    check('不带入 → 还原原来的神器', elements['gvgOffense0Artifact'].value === 'Draco Plate', elements['gvgOffense0Artifact'].value);
    check('不带入 → 还原原来的神器等级', elements['gvgOffense0ArtifactLevel'].value === '15', elements['gvgOffense0ArtifactLevel'].value);
    check('不带入 → 还原原来没有面板要求的预览',
        elements['gvgRequirementPreview0'].innerHTML === 'No requirement', elements['gvgRequirementPreview0'].innerHTML);

    console.log('\n[6] 详情弹窗');
    captured = null;
    swalStub.fire = async (options) => { captured = options; return {value: null}; };
    await GvgDialog.showDetails(planId);
    check('详情包含三段文本', captured.html.includes('long text') || captured.html.includes('None'));
    check('详情包含最后修改', captured.html.includes('Last modified'));

    console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
})();
