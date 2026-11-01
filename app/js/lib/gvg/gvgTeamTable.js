/**
 * GVG 作业页下方的「进攻阵容角色条目 + builds」—— heroTable 组件的第二个实例。
 *
 * 和英雄页用的是**同一套代码**（`grids/heroTable.js`），区别只有配置：
 *   - 行数据来自 `GvgTeamGrid.getTeamHeroes()`（进攻阵容 1 / 2 命中的 6 条）
 *   - 不显示职业 / 属性筛选（组件本来就只有调用方主动 setFilterFlags 才筛）
 *   - 不允许拖拽排序（阵容顺序由站位决定，跟收藏顺序无关）
 *   - 不渲染底部 6 张装备卡（那是英雄页的 UI）
 * 其余交互（点行看 builds、双击跳配装器、右键菜单、装备/脱下/一键换装/删除）都保留。
 */

const heroTable = require('../grids/heroTable');
const buildActionGuard = require('../buildActionGuard');

let instance = null;

module.exports = {
    initialize: () => {
        if (instance) return;

        instance = heroTable.createHeroTable({
            heroesTableId: 'gvg-team-heroes',
            buildsTableId: 'gvg-team-builds',
            enableRowDrag: false,
            /* 行数据只有 6 条，但"谁穿着什么"要按全量英雄算 → 由 refresh 显式喂 */
            ownershipSource: 'external',
            hooks: {
                getUseReforgedStats: () => HeroesTab.getUseReforgedStats(),

                // 双击：和英雄页一样跳到配装器并加载这个英雄的配置
                onHeroDoubleClick: (hero) => {
                    if (HeroesGrid && HeroesGrid.openInOptimizer) {
                        HeroesGrid.openInOptimizer(hero);
                    }
                },

                onHeroContextMenu: (event, hero) =>
                    HeroesTab.showHeroContextMenu(event, hero),

                // builds 功能列：动作交给英雄页那套实现，做完刷一次本表
                onBuildAction: (action, hero, build) => {
                    const refresh = () => module.exports.refresh();

                    console.info('[GVG][build]', action, hero && hero.name);

                    if (action === 'equip') {
                        // 装备前检查：这 6 件里有没有正被任何英雄穿着（后端会静默抢走）
                        buildActionGuard
                            .confirmEquip(instance, hero, build)
                            .then((ok) => {
                                if (ok) HeroesTab.equipBuild(hero, build, refresh);
                            })
                            .catch((error) =>
                                console.warn('[GVG] equip guard failed', error)
                            );
                    } else if (action === 'unequip') {
                        HeroesTab.unequipBuild(hero, build, refresh);
                    } else if (action === 'oneClick') {
                        if (EmulatorEquip.isBusy && EmulatorEquip.isBusy()) {
                            EmulatorEquip.cancel();
                            return;
                        }
                        Promise.resolve(
                            EmulatorEquip.equipHeroBuild(
                                hero,
                                (build.items || [])
                                    .filter(Boolean)
                                    .map((id) => ({ id }))
                            )
                        )
                            .then(refresh)
                            .catch(() => {});
                    } else if (action === 'remove') {
                        HeroesTab.removeBuild(hero, build, refresh);
                    }
                },
            },
        });

        instance.initialize();
        console.log('[GVG] team hero table initialized');
    },

    /**
     * 进攻阵容 1 / 2 变化、或装备发生变化后重画（heroes 可传快照省一次全量请求）。
     * 同时同步 builds：
     *   - 选中的英雄还在 → 重拉它的 builds，功能列「穿上 / 脱下」图标跟着更新
     *   - 没选中（例如清除阵容）→ 把 builds 表清空
     */
    refresh: async (heroes) => {
        if (!instance) return;

        // 一次拉全量英雄：既当"谁穿着什么"的索引，也用来筛出阵容里的 6 条
        const universe = heroes || (await GvgTeamGrid.fetchHeroes());
        instance.setHeroUniverse(universe);

        const rows = await GvgTeamGrid.getTeamHeroes(universe);
        await instance.refresh(rows);
        await instance.refreshSelectedBuilds();

        /* 排查「装了但图标没变」时把 global.__GVG_DEBUG 打开，会打印刷新后的数据快照 */
        if (global.__GVG_DEBUG) {
            const selected = instance.getSelectedRow();
            console.info('[GVG][refresh]', {
                rows: rows.length,
                selected: selected ? selected.name : null,
                equippedSlots: selected
                    ? Object.keys(selected.equipment || {}).filter(
                          (slot) => selected.equipment[slot]
                      ).length
                    : 0,
                builds: selected && selected.builds ? selected.builds.length : 0,
            });
        }
    },

    /** 组件实例（调试用） */
    getInstance: () => instance,
};
