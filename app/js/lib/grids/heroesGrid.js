/**
 * 英雄页的「英雄列表 + builds」—— 只是 heroTable 组件的一个实例。
 *
 * 表格逻辑（列定义 / 选中联动的 builds / 筛选 / 排序 / 装备动作列）都在
 * `heroTable.js` 的 createHeroTable() 里；这里只负责：
 *   - 传英雄页专属的 DOM id + hooks（6 张装备卡预览、双击跳配装器、右键菜单、
 *     拖拽排序、装备/脱下/一键换装/删除 build）
 *   - 把组件实例的方法原样导出，保持 HeroesGrid.xxx 的调用方（39 处）完全不变
 */

const heroTable = require('./heroTable');
const HtmlGenerator = require('../htmlGenerator');

/* 把 6 件装备画到英雄页底部的装备卡里（原来写在 heroesGrid.js 里的那段） */
function renderEquipmentCards(items, baseStats, mods) {
    for (let i = 0; i < 6; i++) {
        const displayId = Constants.gearDisplayIdByIndex[i];
        const html = HtmlGenerator.buildItemPanel(
            items[i],
            'heroesGrid',
            baseStats,
            mods
        );
        document.getElementById(displayId).innerHTML = html;
    }
}

/* 选中英雄 / 配装后的预览（英雄页专属） */
async function renderPreview(heroRow, buildRow) {
    if (!heroRow || !buildRow) return;

    const useReforgeStats = HeroesTab.getUseReforgedStats();
    const [itemsResponse, heroResponse] = await Promise.all([
        Api.getItemsByIds(buildRow.items),
        Api.getHeroById(heroRow.id, useReforgeStats),
    ]);

    const items = itemsResponse.items || [];
    const mods = buildRow.mods || [];

    /*
     * 「改副属性」的预览：把 mod 直接套到 item 上再渲染（和组件化之前一样，
     * HtmlGenerator.buildItemPanel 本身不处理 mods）。
     */
    for (let i = 0; i < 6; i++) {
        const item = items[i];
        const mod = mods[i];
        if (!item || !mod || !Array.isArray(item.substats)) continue;

        item.substats.forEach((substat, index) => {
            if (index !== mod.index) return;
            substat.type = mod.type;
            substat.value = mod.value;
            substat.originalType = mod.originalType;
            substat.originalValue = mod.originalValue;
            substat.modified = true;
        });
    }

    renderEquipmentCards(items, heroResponse.baseStats, mods);
}

/* 选中英雄后：底部 6 张卡 + 自动选中第一条配装（组件内部逻辑不变） */
async function renderHeroEquipment(response) {
    const hero = response.hero;
    const equipmentMap = hero.equipment || {};
    const equipment = [
        equipmentMap['Weapon'],
        equipmentMap['Helmet'],
        equipmentMap['Armor'],
        equipmentMap['Necklace'],
        equipmentMap['Ring'],
        equipmentMap['Boots'],
    ];

    renderEquipmentCards(equipment, response.baseStats);
}

/*
 * 双击英雄行 → 跳到配装器并加载这个英雄的配置。
 * GVG 的表格也复用这个函数（导出为 openInOptimizer）。
 */
function openInOptimizer(hero) {
    const heroId = hero && hero.id;
    if (!heroId) return;

    console.log('Double clicked hero row', hero);

    const select = document.getElementById('inputHeroAdd');
    if (!select) {
        $('#tab1').trigger('click');
        return;
    }

    // 配装器的英雄下拉是「切到配装器时」才重建的：刚新建的角色条目（比如 GVG 置队时
    // 自动补的）可能还不在选项里，这时 .val(heroId) 设不进去，.change() 只会加载
    // 上一个英雄的配置 → 表现就是“第一次双击没带配装数据，回列表再双击才有”。
    const exists = [...select.options].some(
        (option) => String(option.value) === String(heroId)
    );
    if (exists) {
        $('#inputHeroAdd').val(heroId).change();
        $('#tab1').trigger('click');
        return;
    }

    // 先补一次下拉选项，再选中 + 切页
    Promise.resolve()
        .then(() => OptimizerTab.redrawHeroSelector())
        .catch((error) =>
            console.warn('Failed to refresh the hero selector', error)
        )
        .then(() => {
            $('#inputHeroAdd').val(heroId).change();
            $('#tab1').trigger('click');
        });
}

const instance = heroTable.createHeroTable({
    heroesTableId: 'heroes-table',
    buildsTableId: 'builds-table',
    enableRowDrag: true,
    /* 英雄页是主实例：继续占用 global.heroesGrid / buildsGrid（colorPicker 等老代码在用） */
    isPrimary: true,
    hooks: {
        getUseReforgedStats: () => HeroesTab.getUseReforgedStats(),
        renderPreview,
        renderHeroEquipment,

        onHeroDoubleClick: openInOptimizer,

        onHeroContextMenu: (event, hero) =>
            HeroesTab.showHeroContextMenu(event, hero),

        // builds 功能列：装备 / 脱下 / 一键换装（运行中 = 中断）/ 删除
        onBuildAction: (action, hero, build) => {
            if (action === 'equip') {
                HeroesTab.equipBuild(hero, build);
            } else if (action === 'unequip') {
                HeroesTab.unequipBuild(hero, build);
            } else if (action === 'oneClick') {
                if (EmulatorEquip.isBusy && EmulatorEquip.isBusy()) {
                    EmulatorEquip.cancel();
                    return;
                }
                EmulatorEquip.equipHeroBuild();
            } else if (action === 'remove') {
                HeroesTab.removeBuild(hero, build);
            }
        },

        // 拖拽排序：英雄页的顺序就是收藏顺序，落到后端
        onRowReorder: async (hero, overIndex) => {
            await Api.reorderHeroes(hero.id, overIndex + 1);
            HeroesTab.redraw();
        },
    },
});

/* ------------------------------------------------------------------ *
 * 对外 API —— 组件化之前的 15 个方法都由实例提供，
 * 额外导出 openInOptimizer（GVG 表格的双击复用它）
 * ------------------------------------------------------------------ */

module.exports = instance;
module.exports.openInOptimizer = openInOptimizer;
