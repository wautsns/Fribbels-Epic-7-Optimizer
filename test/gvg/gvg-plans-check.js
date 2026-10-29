/* GVG 数据层自测（不依赖 Electron）：规范化 / 排序 / 置队 / 判重 / 去重 / 编解码 / 导入 */
const path = require('path');

const ROOT = process.argv[2] || process.cwd();

global.i18next = {t: (key) => key, language: 'zh'};

const heroNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
global.HeroData = {
    getAllHeroData: () => Object.fromEntries(heroNames.map((name, index) => [name, {code: 'c' + (index + 1)}])),
    getAllArtifactData: () => ({}),
};

let saveCount = 0;
let redrawCount = 0;
global.Saves = {autoSave: () => saveCount++};
global.GvgTab = {redraw: () => redrawCount++};

const GvgPlans = require(path.join(ROOT, 'app', 'js', 'lib', 'gvg', 'gvgPlans.js'));

let failures = 0;
function check(name, condition, extra) {
    if (condition) {
        console.log('  ok   ' + name);
    } else {
        failures++;
        console.log('  FAIL ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra)));
    }
}

function member(heroCode, position, extra) {
    return Object.assign({heroCode, position}, extra || {});
}

function plan(overrides) {
    return Object.assign({
        defense: {heroCodes: ['c1', 'c2', 'c3']},
        offense: {
            members: [
                member('c4', 'front'),
                member('c5', 'bottom'),
                member('c6', 'top'),
            ],
        },
        tags: ['tag1'],
        defenseNote: '',
        intel: '',
        strategy: '',
    }, overrides || {});
}

console.log('\n[1] 规范化与校验');
const good = GvgPlans.normalizePlan(plan());
check('合法作业通过且生成 id', !!good && !!good.id);
check('members 按站位顺序存', good.offense.members.map((m) => m.position).join(',') === 'front,bottom,top', good.offense.members.map((m) => m.position));
check('默认 created/updated 为时间戳', typeof good.createdAt === 'number' && good.createdAt > 0);
check('lastUsedAt 默认 null', good.lastUsedAt === null);
check('未知英雄 code 被拒', GvgPlans.normalizePlan(plan({defense: {heroCodes: ['c1', 'c2', 'zzz']}})) === null);
check('防守 2 人被拒', GvgPlans.normalizePlan(plan({defense: {heroCodes: ['c1', 'c2']}})) === null);
check('防守重复被拒', GvgPlans.normalizePlan(plan({defense: {heroCodes: ['c1', 'c1', 'c2']}})) === null);
const dupPosition = plan();
dupPosition.offense.members = [member('c4', 'front'), member('c5', 'front'), member('c6', 'top')];
check('站位重复被拒', GvgPlans.normalizePlan(dupPosition) === null);
const dupHero = plan();
dupHero.offense.members = [member('c4', 'front'), member('c4', 'bottom'), member('c6', 'top')];
check('进攻重复英雄被拒', GvgPlans.normalizePlan(dupHero) === null);
const runtimeReq = plan();
runtimeReq.offense.members[0].requirement = {inputSpdMinLimit: 250, excludeFilter: [1], excludedGearIds: ['x'], resultPriority: ['spd']};
const normalized = GvgPlans.normalizePlan(runtimeReq);
check('运行期字段被剔除', normalized.offense.members[0].requirement.excludeFilter === undefined
    && normalized.offense.members[0].requirement.excludedGearIds === undefined
    && normalized.offense.members[0].requirement.inputSpdMinLimit === 250,
normalized.offense.members[0].requirement);

console.log('\n[2] 排序与置队');
GvgPlans.setAll([
    Object.assign(plan(), {id: 'p1', updatedAt: 1000}),
    Object.assign(plan(), {id: 'p2', updatedAt: 3000}),
    Object.assign(plan(), {id: 'p3', updatedAt: 2000}),
]);
check('未使用组按 updatedAt 倒序', GvgPlans.getSorted().map((p) => p.id).join(',') === 'p2,p3,p1', GvgPlans.getSorted().map((p) => p.id));

saveCount = 0;
redrawCount = 0;
GvgPlans.pinFirst('p1');
check('置为一队后排第一', GvgPlans.getSorted()[0].id === 'p1', GvgPlans.getSorted().map((p) => p.id));
check('置队触发自动保存 + 重绘', saveCount === 1 && redrawCount === 1, [saveCount, redrawCount]);
check('置队不改 updatedAt', GvgPlans.getById('p1').updatedAt === 1000);

GvgPlans.pinSecond('p3');
const afterSecond = GvgPlans.getSorted().map((p) => p.id);
check('置为二队后排第二', afterSecond[1] === 'p3', afterSecond);
check('原来的第一条仍在第一位', afterSecond[0] === 'p1', afterSecond);

GvgPlans.pinSecond('p1');
const afterEdge = GvgPlans.getSorted().map((p) => p.id);
check('点第一条的「置为二队」→ 它变第二条', afterEdge[1] === 'p1', afterEdge);

console.log('\n[3] 判重与去重');
const base = GvgPlans.normalizePlan(Object.assign(plan({defense: {heroCodes: ['c1', 'c2', 'c3']}}), {id: 'a', updatedAt: 100}));
const sameDifferentOrder = GvgPlans.normalizePlan(Object.assign(plan({defense: {heroCodes: ['c3', 'c1', 'c2']}}), {id: 'b', updatedAt: 200}));
check('防守顺序无关 → 视为重复', GvgPlans.dedupeKey(base) === GvgPlans.dedupeKey(sameDifferentOrder));

const usedCopy = GvgPlans.normalizePlan(Object.assign(plan(), {id: 'c', updatedAt: 300, lastUsedAt: 999}));
GvgPlans.setAll([Object.assign({}, base), Object.assign({}, sameDifferentOrder), usedCopy]);
const removed = GvgPlans.dedupe();
check('3 条相同 → 移除 2 条', removed === 2, removed);
check('保留 updatedAt 较早者', GvgPlans.getAll().length === 1 && GvgPlans.getAll()[0].id === 'a', GvgPlans.getAll().map((p) => p.id));
check('继承更晚的 lastUsedAt', GvgPlans.getAll()[0].lastUsedAt === 999, GvgPlans.getAll()[0].lastUsedAt);

const tagDiff = GvgPlans.normalizePlan(Object.assign(plan(), {id: 'd', tags: ['tag2']}));
check('标签不同 → 不算重复', GvgPlans.dedupeKey(base) !== GvgPlans.dedupeKey(tagDiff));

console.log('\n[4] 压缩编解码');
const encoded = GvgPlans.encodeText(base);
check('带魔数头', encoded.startsWith('E7GVG1:'));
const decoded = GvgPlans.decodeText(encoded);
check('往返一致', !decoded.error && GvgPlans.dedupeKey(decoded.plans[0]) === GvgPlans.dedupeKey(base));
check('导出不带 lastUsedAt', GvgPlans.stripUsage(GvgPlans.getById('a')).lastUsedAt === undefined);
check('空文本报错', GvgPlans.decodeText('').error === 'badPayload');
check('无魔数头报错', GvgPlans.decodeText('hello').error === 'invalidPrefix');
check('旧版本报错', GvgPlans.decodeText('E7GVG0:abc').error === 'unsupportedVersion');
check('损坏数据报错', GvgPlans.decodeText('E7GVG1:not-base64!!').error === 'badPayload');

console.log('\n[5] 导入 / 导出包');
GvgPlans.setAll([]);
const first = GvgPlans.importPlans([plan()]);
check('导入 1 条', first.added === 1 && first.duplicates === 0, first);
check('导入后 lastUsedAt 为 null', GvgPlans.getAll()[0].lastUsedAt === null);
const second = GvgPlans.importPlans([plan()]);
check('重复导入被识别', second.added === 0 && second.duplicates === 1, second);
check('导入不生成重复数据', GvgPlans.getAll().length === 1);

const pkg = GvgPlans.buildPackage();
check('导出包 schema 正确', pkg.schema === 'e7-gvg-plans' && pkg.schemaVersion === 1);
check('导出包不含 lastUsedAt', pkg.plans.every((p) => p.lastUsedAt === undefined));
check('导出包解析成功', GvgPlans.parsePackage(JSON.stringify(pkg)).plans.length === 1);
check('错误 schema 被拒', GvgPlans.parsePackage(JSON.stringify({schema: 'x', schemaVersion: 1, plans: []})).error === 'invalidSchema');
check('错误版本被拒', GvgPlans.parsePackage(JSON.stringify({schema: 'e7-gvg-plans', schemaVersion: 2, plans: []})).error === 'unsupportedVersion');
check('坏 JSON 被拒', GvgPlans.parsePackage('{oops').error === 'invalidJson');

console.log('\n[6] 派生标签与筛选选项');
const withNote = GvgPlans.normalizePlan(Object.assign(plan(), {id: 'n', defenseNote: '站这', intel: '', tags: ['x']}));
const tags = GvgPlans.displayTags(withNote);
check('依赖站位在最前', tags[0] === 'Depends on defense positions', tags);
check('无情报 → 探路刀', tags[1] === 'Scout blade', tags);
check('用户标签在后', tags[2] === 'x', tags);
const withIntel = GvgPlans.normalizePlan(Object.assign(plan(), {id: 'm', intel: '打不了'}));
check('有情报 → 情报刀', GvgPlans.displayTags(withIntel).includes('Intel blade'), GvgPlans.displayTags(withIntel));

GvgPlans.setAll([
    GvgPlans.normalizePlan(Object.assign(plan({defense: {heroCodes: ['c1', 'c2', 'c3']}}), {id: 'f1'})),
    GvgPlans.normalizePlan(Object.assign(plan({defense: {heroCodes: ['c4', 'c5', 'c6']}}), {id: 'f2'})),
]);
const filterOptions = GvgPlans.getDefenseFilterOptions();
check('筛选选项 = 出现过的防守英雄', filterOptions.length === 6 && filterOptions.every((o) => o.code), filterOptions.map((o) => o.code));

console.log('\n[7] 边界');
GvgPlans.setAll([Object.assign(plan(), {id: 'only', updatedAt: 5})]);
GvgPlans.pinSecond('only');
check('只有 1 条时置为二队不报错', GvgPlans.getAll().length === 1 && GvgPlans.getAll()[0].lastUsedAt !== null);
GvgPlans.setAll([{garbage: true}, null, 'text']);
check('垃圾数据被跳过', GvgPlans.getAll().length === 0);
GvgPlans.setAll('not-an-array');
check('非数组输入被忽略', GvgPlans.getAll().length === 0);

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
