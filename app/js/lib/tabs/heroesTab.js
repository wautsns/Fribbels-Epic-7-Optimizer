const { v4: uuidv4 } = require('uuid');
const tinygradient = require('tinygradient');
var useReforgedStats = true;

module.exports = {
    getSelectedGear,

    // 以下按「行」操作，右键菜单和 builds 功能列都直接传行数据，不依赖当前选中状态
    editHeroInfo,
    editSubstatMods,
    setHeroRank,
    removeHero,
    cleanupUselessBuilds,
    equipBuild,
    unequipBuild,
    removeBuild,
    showHeroContextMenu,
    closeHeroContextMenu,

    initialize: () => {
        setupEventListeners();
        const selector = document.getElementById('addHeroesSelector')
        const allHeroData = HeroData.getAllHeroData();
        console.log("ALLHERODATA", allHeroData)
        const names = Object.keys(allHeroData).sort();

        console.log(names)

        for (var name of names) {
            const hero = allHeroData[name];
            const option = document.createElement('option');
            option.innerHTML = i18next.t(hero.name);
            option.label = hero.name;
            option.value = name;
            selector.add(option);
        }

        document.getElementById('addHeroesSubmit').addEventListener("click", async () => {
            console.log("addHeroesSubmit");
            const id = selector.value;
            addHero(id);
            HeroesGrid.redrawPreview();
        });

        document.getElementById('heroesTabUseReforgedStats').addEventListener("change", async () => {
            useReforgedStats = document.getElementById('heroesTabUseReforgedStats').checked;
            console.log("REFORGE CHANGE TO " + useReforgedStats);
            await redrawGrid();
            clearPreview();
            HeroesGrid.refreshBuilds();
            HeroesGrid.redrawPreview();
        });

        document.getElementById('tab4label').addEventListener("click", () => {
            module.exports.redraw();
            HeroesGrid.refreshBuilds();
        });

        Api.getAllHeroes(useReforgedStats).then(response => {
            console.log("Heroes response", response);

            if (response.heroes.length == 0) {
                // addHero("Maid Chloe")
            } else {
                module.exports.redrawHeroInputSelector();
            }
            HeroesGrid.refresh(response.heroes);
            HeroesGrid.redrawPreview();
        })
    },

    redrawHeroInputSelector: () => {
        OptimizerTab.redrawHeroSelector();
    },

    redraw: async () => {
        await redrawGrid();
    },

    getUseReforgedStats: () => {
        return useReforgedStats;
    },

    getNewHeroByName: (heroName) => {
        const allHeroData = HeroData.getAllHeroData();
        const heroData = allHeroData[heroName];

        if (!heroData) {
            return null;
        }

        const id = uuidv4();
        const data = JSON.parse(JSON.stringify(heroData));

        return {
            id: id,
            name: heroName,
            data: data,
            equipped: new Array(6)
        }
    },

    showBonusStatsWindow: async (row) => {
        showEditHeroInfoPopups(row.name)
        const bonusStats = await Dialog.editHeroDialog(row);

        if (!bonusStats) return;

        const e7StatToBonusStat = {
            "att_rate": "aeiAttackPercent",
            "max_hp_rate": "aeiHealthPercent",
            "def_rate": "aeiDefensePercent",
            "att": "aeiAttack",
            "max_hp": "aeiHealth",
            "def": "aeiDefense",
            "speed": "aeiSpeed",
            "res": "aeiEffectResistance",
            "cri": "aeiCritChance",
            "cri_dmg": "aeiCritDamage",
            "acc": "aeiEffectiveness",
            "coop": "aeiDualAttackChance"
        }

        console.log("Bonus stats", bonusStats, row.id);

        // Imprint
        const imprintIngameType = bonusStats.heroInfo.self_devotion.type;
        const imprintBonusType = e7StatToBonusStat[imprintIngameType];
        const imprintNumberText = bonusStats.imprintNumber;
        if (imprintNumberText != "None") {
            const imprintNumber = parseFloat(imprintNumberText)

            console.log("ADDING AEI IMPRINT", imprintNumber, imprintBonusType)

            bonusStats[imprintBonusType] += imprintNumber;
        }

        // Artifact
        const artifactName = bonusStats.artifactName;
        if (artifactName != "None") {
            const artifactLevelText = bonusStats.artifactLevel;
            if (artifactLevelText != "None") {
                const artifactLevel = parseInt(artifactLevelText);
                const artifactStats = Artifact.getStats(artifactName, artifactLevel);

                console.log("ADDING AEI ARTIFACT", artifactLevel)
                console.log("ADDING AEI ARTIFACT", artifactLevelText)
                console.log("ADDING AEI ARTIFACT", artifactName)

                bonusStats.aeiHealth += artifactStats.health;
                bonusStats.aeiAttack += artifactStats.attack;
                bonusStats.aeiDefense += artifactStats.defense;
                bonusStats.artifactHealth = artifactStats.health;
                bonusStats.artifactAttack = artifactStats.attack;
                bonusStats.artifactDefense = artifactStats.defense;

            }
        }

        // EE
        const eeNumberText = bonusStats.eeNumber;
        if (eeNumberText != "None") {
            const eeNumber = parseInt(eeNumberText);
            const eeIngameType = bonusStats.ee.stat.type;
            const eeBonusType = e7StatToBonusStat[eeIngameType];

            console.log("ADDING AEI EE", eeBonusType, eeNumber)

            bonusStats[eeBonusType] += eeNumber;
        }

        await Api.setBonusStats(bonusStats, row.id).then(module.exports.redraw);
        Notifier.success("Saved bonus stats");
    }
}

function showEditHeroInfoPopups(name) {
    if (name == "Eaton") {
        Notifier.info("Eaton's 20% total Health bonus from S2 is already automatically added.")
    }
    if (name == "Gunther") {
        Notifier.info("Gunther's 75% total Attack bonus from S2 is already automatically added.")
    }
    if (name == "Lena") {
        Notifier.info("Lena's 50% Crit Chance bonus from S2 is already automatically added.")
    }
    if (name == "Apocalypse Ravi") {
        Notifier.info("Apocalypse Ravi's 30% Crit Chance bonus from S2 is already automatically added.")
    }
    if (name == "Senya") {
        Notifier.info("Senya's 30% total Attack bonus from S2 is already automatically added.")
    }
}

function getSelectedGear() {
    const buildRow = HeroesGrid.getSelectedBuildRow()
    if (buildRow) {
        return buildRow.items.map(x => {
            return {
                id: x
            }
        })
    }

    const row = HeroesGrid.getSelectedRow();
    if (!row || !row.equipment) return [];

    // 卡片上的勾选框已经去掉了，英雄页的 6 件装备永远是一起操作
    const gearNames = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];
    return gearNames
        .map((gear) => row.equipment[gear])
        .filter((item) => !!item);
}

function getSelectedGearIds() {
    return getSelectedGear().map(x => x.id);
}

function addHero(heroName, isBuild) {
    const newHero = module.exports.getNewHeroByName(heroName);
    newHero.rarity = newHero.data.rarity;
    newHero.attribute = newHero.data.attribute;
    newHero.role = newHero.data.role;
    newHero.path = heroName;
    newHero.stars = 6;

    Api.addHeroes([newHero]).then(async x => {
        module.exports.redrawHeroInputSelector();
        await redrawGrid(newHero.id);

        Api.getHeroById(newHero.id).then(async y => {
            const createdHero = y.hero;
            await module.exports.showBonusStatsWindow(createdHero);
            Saves.autoSave();
        })
    })
}

async function redrawGrid(id) {
    const response = await Api.getAllHeroes(useReforgedStats)
    HeroesGrid.refresh(response.heroes, id);

    HeroesGrid.refreshFilters(filters);
}

function clearPreview() {
    for (var i = 0; i < 6; i++) {
        const displayId = Constants.gearDisplayIdByIndex[i];
        document.getElementById(displayId).innerHTML = "";
    }
}

/* ---------------- 英雄 / 配装 行操作 ---------------- */

async function editHeroInfo(row) {
    if (!row) return;
    await module.exports.showBonusStatsWindow(row);
    Saves.autoSave();
}

async function editSubstatMods(row) {
    if (!row) return;

    const modStats = await Dialog.editModStatsDialog(row);
    await Api.setModStats(modStats, row.id).then(module.exports.redraw);
    Notifier.success("Saved mod stats");
    Saves.autoSave();
}

async function setHeroRank(row) {
    if (!row) return;

    const rankInfo = await Dialog.editRankDialog(row.index);
    await Api.reorderHeroes(row.id, rankInfo.rank).then(module.exports.redraw);
    Saves.autoSave();
}

async function removeHero(row) {
    if (!row) return;

    const confirmed = await Dialog.confirmation(
        i18next.t("Are you sure you want to remove this hero? This will also remove all of its saved builds."),
        i18next.t("Remove Hero")
    );
    if (!confirmed) return;

    Api.removeHeroById(row.id).then(async () => {
        module.exports.redrawHeroInputSelector();
        await redrawGrid();
        HeroesGrid.redrawPreview();
        Saves.autoSave();
    });
}

/*
 * 清除"无用配置"：
 *   builds 后端已按优先级排序，首条是不考虑他人装备的最好配置。
 *   当首条有装备被其他英雄抢时，你会保存一条"次之"的配置，依此类推。
 *   随着被抢英雄被移除，某些"次优"配置的装备已不再被任何人抢 ——
 *   第一条「6 件装备均未出现在其他英雄的任何 build 中」的配置就是当前的
 *   下限配置，排在它之后的所有配置均为无用配置，可以删掉。
 */
async function cleanupUselessBuilds(row) {
    if (!row || !row.builds || row.builds.length <= 1) return;

    // 1) 拉全量英雄（带完整 builds），避免用列表里的旧数据
    const response = await Api.getAllHeroes();
    const allHeroes = response.heroes || [];

    // 2) 先收集"其他英雄"所有 build 用到的 item id 集合
    const otherHeroItemIds = new Set();
    for (const hero of allHeroes) {
        if (String(hero.id) === String(row.id)) continue;
        for (const build of hero.builds || []) {
            for (const itemId of build.items || []) {
                if (itemId != null) otherHeroItemIds.add(String(itemId));
            }
        }
    }

    // 3) 从前往后找第一条「items 完全不在 otherHeroItemIds 里」的 build
    const ownBuilds = row.builds; // 已按优先级降序
    let lowerBoundIndex = -1;
    for (let i = 0; i < ownBuilds.length; i++) {
        const build = ownBuilds[i];
        const items = (build && build.items ? build.items : []).map(String);
        const allFree = items.length > 0 && items.every((id) => !otherHeroItemIds.has(id));
        if (allFree) {
            lowerBoundIndex = i;
            break;
        }
    }

    if (lowerBoundIndex === -1) {
        // 所有配置的装备都在被抢，没有下限配置可作为保留基准
        Notifier.info(i18next.t("No useless builds to clear — all configurations have gear contested by other heroes."));
        return;
    }

    // 4) lowerBoundIndex 及之前的保留，之后的都是无用配置
    const uselessBuilds = ownBuilds.slice(lowerBoundIndex + 1);
    if (uselessBuilds.length === 0) {
        Notifier.info(i18next.t("No useless builds to clear."));
        return;
    }

    const confirmed = await Dialog.confirmation(
        i18next.t("Delete {{count}} useless build(s)? Keeps the top {{keep}} configuration(s).", {
            count: uselessBuilds.length,
            keep: lowerBoundIndex + 1,
        }),
        i18next.t("Confirm Clear Useless Builds")
    );
    if (!confirmed) return;

    // 5) 逐个删除（build.items 是唯一标识）
    for (const build of uselessBuilds) {
        try {
            await Api.removeBuild(row.id, build);
        } catch (err) {
            console.warn('[heroes] cleanupUselessBuilds failed for build', build, err);
        }
    }

    try {
        await redrawGrid();
        HeroesGrid.refreshBuilds();
        HeroesGrid.redrawPreview();
        Saves.autoSave();
    } catch (err) {
        console.warn('[heroes] refresh after cleanup failed', err);
    }

    Notifier.success(i18next.t("Deleted {{count}} useless build(s).", { count: uselessBuilds.length }));
}

/*
 * builds 的三个动作都支持可选的 onDone 回调：GVG 的表格复用同一套实现，
 * 动作完成后再刷新它自己的表格（原来这些刷新都写死指向 HeroesGrid）。
 */
function runAfter(onDone) {
    if (typeof onDone !== 'function') return;
    try {
        Promise.resolve(onDone()).catch((error) =>
            console.warn('[heroes] onDone callback failed', error)
        );
    } catch (error) {
        console.warn('[heroes] onDone callback failed', error);
    }
}

function equipBuild(hero, build, onDone) {
    if (!hero || !build || !build.items) return;

    // 空槽位的配装不处理，但要留日志，否则点上去像“没反应”
    if (build.items.includes(undefined) || build.items.includes(null)) {
        console.warn('[heroes] build has empty item slots, equip skipped', build);
        return;
    }

    Api.equipItemsOnHero(hero.id, build.items).then(async () => {
        // 先刷新英雄列表（equipment 变了），再重画 builds，
        // 功能列才会把「穿上」图标换成「脱下」图标
        try {
            await redrawGrid();
            clearPreview();
            HeroesGrid.refreshBuilds();
            HeroesGrid.redrawPreview();
            Saves.autoSave();
        } catch (error) {
            console.warn('[heroes] refresh after equip failed', error);
        } finally {
            // 不管英雄页刷新有没有出错，调用方（GVG 表格）都要刷新自己
            runAfter(onDone);
        }
    });
}

/* 英雄身上实际穿着的装备 id（统一按字符串比，避免 number/string 混用） */
function wornItemIds(hero) {
    const equipment = (hero && hero.equipment) || {};

    return Object.keys(equipment)
        .map((slot) => equipment[slot] && equipment[slot].id)
        .filter((id) => id != null)
        .map((id) => String(id));
}

// 脱下这套配装的 6 件装备（效果和原来「脱下装备」按钮一致）
function unequipBuild(hero, build, onDone) {
    const gearIds = (build && build.items ? build.items : []).filter(Boolean);

    /*
     * 只脱这个英雄身上真的穿着的那几件：这条配装可能有 1~2 件已经被别的英雄抢走了，
     * 那几件不能连带从别人身上脱下来。
     */
    const worn = new Set(wornItemIds(hero));
    const ownIds = gearIds.filter((id) => worn.has(String(id)));
    const idsToUnequip = ownIds.length
        ? ownIds
        : gearIds.length
          ? gearIds
          : getSelectedGearIds();

    if (!idsToUnequip || !idsToUnequip.length) return;

    Api.unequipItems(idsToUnequip).then(async () => {
        try {
            await redrawGrid();
            clearPreview();
            // 重新拉一次英雄并重画 builds，功能列才会把「脱下」图标换回「装备」图标
            HeroesGrid.refreshBuilds();
            HeroesGrid.redrawPreview();
            Saves.autoSave();
        } catch (error) {
            console.warn('[heroes] refresh after unequip failed', error);
        } finally {
            runAfter(onDone);
        }
    });
}

async function removeBuild(hero, build, onDone) {
    if (!hero || !build) return;

    const confirmed = await Dialog.confirmation(
        i18next.t("Are you sure you want to remove this build?"),
        i18next.t("Remove Build")
    );
    if (!confirmed) return;

    Api.removeBuild(hero.id, build).then(() => {
        try {
            HeroesGrid.refreshBuilds();
            Saves.autoSave();
        } catch (error) {
            console.warn('[heroes] refresh after remove build failed', error);
        } finally {
            runAfter(onDone);
        }
    });
}

/* ---------------- 英雄列表右键菜单 ---------------- */

let heroContextMenuElement = null;
let heroContextMenuMouseDown = null;
let heroContextMenuKeyDown = null;

function closeHeroContextMenu() {
    if (heroContextMenuMouseDown) {
        document.removeEventListener('mousedown', heroContextMenuMouseDown, true);
        heroContextMenuMouseDown = null;
    }
    if (heroContextMenuKeyDown) {
        document.removeEventListener('keydown', heroContextMenuKeyDown, true);
        heroContextMenuKeyDown = null;
    }
    window.removeEventListener('scroll', closeHeroContextMenu, true);
    window.removeEventListener('blur', closeHeroContextMenu);

    if (heroContextMenuElement) {
        heroContextMenuElement.remove();
        heroContextMenuElement = null;
    }
}

function showHeroContextMenu(event, row) {
    if (!event || !row) return;

    closeHeroContextMenu();

    const items = [
        {label: i18next.t('Add Bonus Stats'), action: () => editHeroInfo(row)},
        {label: i18next.t('Add Substat Mods'), action: () => editSubstatMods(row)},
        {label: i18next.t('Set Hero Rank'), action: () => setHeroRank(row)},
        {label: i18next.t('Clear Useless Builds'), action: () => cleanupUselessBuilds(row)},
        {label: i18next.t('Remove Hero'), action: () => removeHero(row), danger: true},
    ];

    const menu = document.createElement('div');
    menu.className = 'heroContextMenu';

    items.forEach((item) => {
        const entry = document.createElement('div');
        entry.className = 'heroContextMenuItem' + (item.danger ? ' heroContextMenuDanger' : '');
        entry.textContent = item.label;
        entry.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();
            closeHeroContextMenu();
            item.action();
        });
        menu.appendChild(entry);
    });

    document.body.appendChild(menu);
    heroContextMenuElement = menu;

    // 贴着鼠标弹出，超出窗口时向内侧收
    const rect = menu.getBoundingClientRect();
    const left = Math.max(4, Math.min(event.clientX, window.innerWidth - rect.width - 4));
    const top = Math.max(4, Math.min(event.clientY, window.innerHeight - rect.height - 4));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    heroContextMenuMouseDown = (mouseEvent) => {
        if (heroContextMenuElement && heroContextMenuElement.contains(mouseEvent.target)) return;
        closeHeroContextMenu();
    };
    heroContextMenuKeyDown = (keyEvent) => {
        if (keyEvent.key === 'Escape') closeHeroContextMenu();
    };

    // 延后挂载，避免当前这次右键事件立刻把菜单关掉
    setTimeout(() => {
        if (!heroContextMenuElement) return;
        document.addEventListener('mousedown', heroContextMenuMouseDown, true);
        document.addEventListener('keydown', heroContextMenuKeyDown, true);
        window.addEventListener('scroll', closeHeroContextMenu, true);
        window.addEventListener('blur', closeHeroContextMenu);
    }, 0);
}


const filters = {
    classFilter: null,
    elementFilter: null,
}

const elementsByFilter = {
    elementFilter: [
        "fireElementFilter",
        "iceElementFilter",
        "windElementFilter",
        "lightElementFilter",
        "darkElementFilter",
    ],
    classFilter: [
        "knightClassFilter",
        "warriorClassFilter",
        "assassinClassFilter",
        "mageClassFilter",
        "manauserClassFilter",
        "rangerClassFilter",
    ],
}
function setupFilterListener(elementId, filter, filterContent) {
    document.getElementById(elementId).addEventListener('click', () => {
        console.log("test")
        const element = $('#' + elementId);
        element.toggleClass("gearTabButtonSelected");
        elementsByFilter[filter].forEach(x => {
            if (x != elementId) {
                $('#' + x).removeClass("gearTabButtonSelected")
            }
        })
        if (element.hasClass("gearTabButtonSelected")) {
            filters[filter] = filterContent
        } else {
            filters[filter] = null;
        }
        HeroesGrid.refreshFilters(filters);
    })
}

function setupClearListener(elementId, filter) {
    document.getElementById(elementId).addEventListener('click', () => {
        elementsByFilter[filter].forEach(x => {
            $('#' + x).removeClass("gearTabButtonSelected")
        })
        filters[filter] = null;
        HeroesGrid.refreshFilters(filters);
    })
}

function setupEventListeners() {
    // Elements
    setupFilterListener("fireElementFilter", "elementFilter", "fire");
    setupFilterListener("iceElementFilter", "elementFilter", "ice");
    setupFilterListener("windElementFilter", "elementFilter", "wind");
    setupFilterListener("lightElementFilter", "elementFilter", "light");
    setupFilterListener("darkElementFilter", "elementFilter", "dark");

    // Classes
    setupFilterListener("knightClassFilter", "classFilter", "knight");
    setupFilterListener("warriorClassFilter", "classFilter", "warrior");
    setupFilterListener("assassinClassFilter", "classFilter", "assassin");
    setupFilterListener("mageClassFilter", "classFilter", "mage");
    setupFilterListener("manauserClassFilter", "classFilter", "manauser");
    setupFilterListener("rangerClassFilter", "classFilter", "ranger");


    document.getElementById('clearHeroFilter').addEventListener('click', () => {
        const keys = Object.keys(elementsByFilter);
        for (var key of keys) {
            elementsByFilter[key].forEach(x => {
                $('#' + x).removeClass("gearTabButtonSelected")
            })
            filters[key] = null;
        }

        HeroesGrid.resetSort();
        HeroesGrid.refreshFilters(filters);
    })

}

