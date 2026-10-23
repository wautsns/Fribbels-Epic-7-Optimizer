
const tippy = require('tippy.js').default;

var readableSubstatByName = {
    "Attack": "Flat atk",
    "AttackPercent": "Attack %",
    "Defense": "Flat def",
    "DefensePercent": "Defense %",
    "Health": "Flat hp",
    "HealthPercent": "Health %",
    "Speed": "Speed",
    "CriticalHitChancePercent": "Crit Chance",
    "CriticalHitDamagePercent": "Crit Dmg",
    "EffectivenessPercent": "Eff",
    "EffectResistancePercent": "Eff Res",
}

// A single substat can still leave the item far down the list. Once it lands past
// this row, a second substat is added so the item gets sorted closer to the top.
const SECOND_SUBSTAT_ROW_THRESHOLD = 6;

module.exports = {
    locate: async (ingameId, selectorClass) => {
        const getAllItemsResponse = await Api.getAllItems();
        const items = getAllItemsResponse.items;
        const width = parseInt(Settings.parseNumberValue('settingLocatorWidth') || 5);

        var elements = document.querySelectorAll("." + selectorClass);

        for (var element of elements) {
            var result = locateSingleItem(element.dataset.itemid, items, width);
            console.log('locate', element, element.dataset.itemid, result);

            if (result) {
                var content = "";

                if (result.unscannedItem) {
                    content = i18next.t("Rescan items to locate")
                } else if (result.storage) {
                    content = i18next.t("Item in storage")
                } else {
                    const substats = result.substats
                        .map(x => i18next.t(readableSubstatByName[x] || x))
                        .join(", ")

                    content = `<div class="locatorTip">${i18next.t("Substat")}: ${substats}</br>
                    ${i18next.t("Row")}: ${Math.floor(result.index / width) + 1} ${i18next.t("Column")}: ${result.index % width + 1}</br>
                    ${i18next.t("Sort")}: ${i18next.t("Acquisition (Ascending)")}</br>
                    ${i18next.t("Width setting")}: ${width}</div>`
                }

                var tippyInstance;
                if (element._tippy) {
                    tippyInstance = element._tippy
                } else {
                    tippyInstance = tippy(element, {
                        allowHTML: true,
                        trigger: 'focus',
                        placement: 'right',
                        content: content,
                        arrow: false,

                        onHidden(instance) {
                            instance.destroy()
                            return true;
                        },
                    })
                }

                tippyInstance.show();
            }
        }
    },
}

function locateSingleItem(itemId, items, width) {
    if (!itemId) {
        console.log("No item matching id " + itemId)
        return {
            unscannedItem: true
        };
    }

    var item = items.find(x => x.ingameId == itemId)

    if (!item) {
        console.log("No item matching ingame id " + itemId)
        return {
            unscannedItem: true
        };
    }

    // The in-game page lists one gear slot at a time, storage items live in their own page
    var candidates = items.filter(x => x.gear == item.gear && !x.storage)
    // items = items.filter(x => x.set == item.set && x.gear == item.gear)

    // Raw substat values give a more precise ordering than the rounded display values
    const useOp = !!item.op
    const substatTypes = item.substats.map(x => x.type)

    var best = null

    for (var substatType of substatTypes) {
        const index = rankOf(item, candidates, [substatType], useOp)
        if (!best || index < best.index) {
            best = { index: index, substats: [substatType] }
        }
    }

    if (best && Math.floor(best.index / width) + 1 > SECOND_SUBSTAT_ROW_THRESHOLD) {
        for (var first of substatTypes) {
            for (var second of substatTypes) {
                if (first == second) {
                    continue
                }

                const index = rankOf(item, candidates, [first, second], useOp)
                if (index < best.index) {
                    best = { index: index, substats: [first, second] }
                }
            }
        }
    }

    return {
        substats: best ? best.substats : [],
        index: best ? best.index : 0,
        storage: item.storage || false
    }
}

// Selecting a substat on the in-game page also hides items that do not have it,
// so only items carrying every selected substat are part of the list
function rankOf(item, items, substatTypes, useOp) {
    const filtered = items.filter(x => substatTypes.every(t => hasSubstat(x, t)))
    const sorted = filtered.slice().sort((x, y) => compareItems(x, y, substatTypes, useOp))
    return sorted.findIndex(x => x.ingameId == item.ingameId)
}

function hasSubstat(item, substatType) {
    return (item.substats || []).some(x => x.type == substatType)
}

// Higher substats come first, items without raw substat data are pushed to the end.
// Ties fall back to acquisition order, oldest first, matching the in-game page.
// Newest first would shift existing rows whenever a new item rolls the same value.
function compareItems(x, y, substatTypes, useOp) {
    for (var substatType of substatTypes) {
        const xValue = substatValue(x, substatType, useOp)
        const yValue = substatValue(y, substatType, useOp)

        if (xValue == null || yValue == null) {
            if (xValue == null && yValue == null) {
                continue
            }
            return xValue == null ? 1 : -1
        }

        const difference = yValue - xValue
        if (difference != 0) {
            return difference
        }
    }

    return x.ingameId - y.ingameId
}

function substatValue(item, substatType, useOp) {
    if (!useOp) {
        return item.augmentedStats[substatType] || 0
    }

    if (!item.op) {
        return null
    }

    return item.op.slice(1)
        .filter(x => opStatToSubstat[x[0]] == substatType)
        .map(x => parseFloat(x[1]))
        .reduce((a, b) => a + b, 0)
}

var opStatToSubstat = {
    "att_rate": "AttackPercent",
    "max_hp_rate": "HealthPercent",
    "def_rate": "DefensePercent",
    "att": "Attack",
    "max_hp": "Health",
    "def": "Defense",
    "speed": "Speed",
    "res": "EffectResistancePercent",
    "cri": "CriticalHitChancePercent",
    "cri_dmg": "CriticalHitDamagePercent",
    "acc": "EffectivenessPercent",
    "coop": "DualAttackChancePercent"
}
