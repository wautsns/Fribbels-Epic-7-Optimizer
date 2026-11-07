
const tippyModule = require('tippy.js');
const tippy = tippyModule.default;

const equip = require('./emulator/equip');
const EmulatorEquip = require('./emulator/emulatorEquip');

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

// 悬浮提示共用一个 tippy 实例：锚点是一个隐藏的空元素，位置跟着鼠标下的准星走。
// 不用 tippy 的 delegate()，因为它要求 props.target（而且一个元素只能挂一个实例，
// 会和点击后的详情提示抢位置）。
var hoverTip = null;
var hoverIcon = null;
var hoverListenersAttached = false;

// 点击后弹出来的详情提示：点一个准星会把当前这一排 6 个部位各弹一个，所以用数组管
var detailTips = [];

function hideDetailTips() {
    const tips = detailTips;
    detailTips = [];

    tips.forEach((tip) => {
        try {
            tip.hide();
        } catch (error) {
            console.warn('[locator] hide tooltip failed', error);
        }
    });
}

function locatorWidth() {
    return parseInt(Settings.parseNumberValue('settingLocatorWidth') || 5);
}

function readableSubstat(type) {
    return i18next.t(readableSubstatByName[type] || type);
}

function isPercentStat(type) {
    return /Percent$/.test(type);
}

function formatValue(type, value) {
    const number = Number(value);
    const shown = Number.isFinite(number)
        ? (Number.isInteger(number) ? number : number.toFixed(1))
        : value;

    return isPercentStat(type) ? shown + '%' : String(shown);
}

// 副属性按「一键换装用的 chip 顺序」显示（chip1 = 强化后数值最高那条，其余按类型字母序）
function substatLines(result) {
    return (result.substats || []).map((sub, index) => {
        return i18next.t("Substat") + (index + 1) + '：' + readableSubstat(sub.type) + '（' + formatValue(sub.type, sub.value) + '）';
    });
}

function hoverContent() {
    return '<div class="locatorTip">'
        + i18next.t("Sort") + ': ' + i18next.t("Substat value (Descending)") + ' → ' + i18next.t("Acquisition (Ascending)") + '<br>'
        + i18next.t("Width setting") + ': ' + locatorWidth()
        + '</div>';
}

function detailContent(result) {
    if (result.unscannedItem) {
        return '<div class="locatorTip">' + i18next.t("Rescan items to locate") + '</div>';
    }

    const lines = [];

    if (result.storage) {
        lines.push(i18next.t("Item in storage"));
    } else if (result.found) {
        lines.push(i18next.t("Row") + ': ' + result.row + ' ' + i18next.t("Column") + ': ' + result.column);
    } else {
        lines.push('<b>' + i18next.t("Not in the filtered list") + '</b>');
    }

    if (result.main) {
        lines.push(i18next.t("Main stat") + '：' + readableSubstat(result.main.type) + '（' + formatValue(result.main.type, result.main.value) + '）');
    }

    lines.push.apply(lines, substatLines(result));

    return '<div class="locatorTip">' + lines.join('<br>') + '</div>';
}

function emptyRect() {
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
}

function ensureHoverTip() {
    if (hoverTip) {
        return hoverTip;
    }

    const anchor = document.createElement('span');
    anchor.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;';
    document.body.appendChild(anchor);

    hoverTip = tippy(anchor, {
        allowHTML: true,
        arrow: false,
        trigger: 'manual',
        placement: 'top',
        distance: 6,
        content: () => hoverContent(),
        getReferenceClientRect: () => (hoverIcon ? hoverIcon.getBoundingClientRect() : emptyRect()),
    });

    return hoverTip;
}

function hideHoverTip() {
    hoverIcon = null;
    if (hoverTip) {
        hoverTip.hide();
    }
}

function attachHoverListeners() {
    if (hoverListenersAttached) {
        return;
    }
    hoverListenersAttached = true;

    document.addEventListener('mouseover', (event) => {
        const icon = event.target && event.target.closest
            ? event.target.closest('[class*="locateTooltip"]')
            : null;

        if (!icon || icon === hoverIcon) {
            return;
        }

        hoverIcon = icon;
        ensureHoverTip().show();
    });

    document.addEventListener('mouseout', (event) => {
        const icon = event.target && event.target.closest
            ? event.target.closest('[class*="locateTooltip"]')
            : null;

        if (!icon) {
            return;
        }

        hideHoverTip();
    });
}

module.exports = {
    initialize: () => {
        attachHoverListeners();

        // 点击弹出来的详情提示是手动触发的，需要自己处理「点别处 / 滚动就关掉」，
        // 否则它们会一直挂在卡片上（一次会弹 6 个，所以按数组管理）
        document.addEventListener('mousedown', hideDetailTips, true);
        window.addEventListener('scroll', hideDetailTips, true);
    },

    locate: async (ingameId, selectorClass) => {
        const getAllItemsResponse = await Api.getAllItems();
        const items = getAllItemsResponse.items;
        const width = locatorWidth();

        const elements = document.querySelectorAll("." + selectorClass);

        // 注意用 const：闭包（reference）要捕获「当前这一张卡」的 element，
        // 用 var 的话循环结束后所有提示都会落到最后一张卡上，全部叠在一起
        for (const element of elements) {
            const result = locateSingleItem(element.dataset.itemid, items, width);
            console.log('locate', element, element.dataset.itemid, result);

            if (!result) {
                continue;
            }

            hideHoverTip();

            const content = detailContent(result);

            let tippyInstance = element._tippy;
            if (tippyInstance) {
                tippyInstance.setContent(content);
            } else {
                // 提示框的右下角对齐装备卡的右下角，盖在卡片上：
                // 参考区域收成一个「卡片右下角的点」+ top-end，
                // 提示框从那个点往左上方展开（挡住卡片数据没关系，数据提示里都有）
                const reference = () => {
                    const card = element.closest('.gear-preview-row');
                    const rect = card
                        ? card.getBoundingClientRect()
                        : element.getBoundingClientRect();

                    return {
                        width: 0,
                        height: 0,
                        top: rect.bottom,
                        bottom: rect.bottom,
                        left: rect.right,
                        right: rect.right,
                        x: rect.right,
                        y: rect.bottom,
                    };
                };

                tippyInstance = tippy(element, {
                    allowHTML: true,
                    trigger: 'manual',
                    placement: 'top-end',
                    distance: 0,
                    content: content,
                    arrow: false,
                    getReferenceClientRect: reference,

                    onHidden(instance) {
                        detailTips = detailTips.filter((tip) => tip !== instance);
                        instance.destroy()
                        return true;
                    },
                })
            }

            if (!detailTips.includes(tippyInstance)) {
                detailTips.push(tippyInstance);
            }
            tippyInstance.show();
        }
    },
}

/*
 * 定位逻辑与「一键换装」(equip.computeRank) 完全一致：
 *  - 候选集：同部位 + 不在仓库 + 主属性对得上 + 4 条副属性都存在
 *  - 排序：按 chip 顺序（sub1..sub4）的副属性数值降序，同值按 ingameId 升序
 * 这样一键换装找不到时，看提示里的行/列就能判断是哪一步对不上。
 */
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

    const target = EmulatorEquip.buildTarget(item);
    const filters = equip.wantedFilters(target);
    const info = equip.computeRank(target, items, filters, true, true) || { index: -1, total: 0, rank: -1 };

    const found = info.index >= 0;

    // chip 顺序的副属性（sub1..sub4）+ 主属性，供提示框显示游戏面板上的实际数值
    const substats = ['sub1', 'sub2', 'sub3', 'sub4']
        .map((key) => filters[key])
        .filter(Boolean)
        .map((type) => {
            const substat = (item.substats || []).find((entry) => entry.type === type);
            return { type: type, value: substat ? substat.value : 0 };
        });

    return {
        storage: item.storage || false,
        found: found,
        index: found ? info.index : -1,
        total: info.total,
        row: found ? Math.floor(info.index / width) + 1 : null,
        column: found ? (info.index % width) + 1 : null,
        main: item.main ? { type: item.main.type, value: item.main.value } : null,
        substats: substats,
    }
}
