const stringSimilarity = require('string-similarity');

const tippy = require('tippy.js').default;

tippy.setDefaultProps({
    allowHTML: true,
    placement: 'auto',
    maxWidth: 550,
});

function isItemModded(item) {
    return item.substats.filter(x => x.modified).length > 0;
}

function statToText(stat, baseStats, item, checkboxPrefix, showMaxSpeed) {
    if (!stat) {
        return {
            type: '',
            value: ''
        }
    }

    var unpercentedStat = shortenStats(stat.type);
    var value;

    if (Reforge.isReforgeable(item) && stat.modified && (stat.originalType)) {
        value = stat.type.includes('Percent') ? stat.value + "%" : getPercentageEquivalent(stat, baseStats, false);
    } else if (item.alreadyPredictedReforge || !Reforge.isReforgeable(item)) {
        value = stat.type.includes('Percent') ? stat.reforgedValue + "%" : getPercentageEquivalent(stat, baseStats, false);
    } else {
        const unreforgedValue = stat.type.includes('Percent') ? stat.value + "%" : stat.value;
        const reforgedValue = stat.type.includes('Percent') ? stat.reforgedValue + "%" : getPercentageEquivalent(stat, baseStats, true);

        value = unreforgedValue + " ➤ " + reforgedValue
    }

    // Keep the modified text the same for basic case
    var modifiedStat = unpercentedStat;
    var reforge = Reforge.isReforgeable(item) || item.level == 90;
    var rolls = stat.rolls;

    const modifier = ItemsTab.getCurrentModifier();

    // Unless the modified text needs to be displayed
    if (modifier.grade && modifier.stat && stat.rolls) {
        // console.log(stat)
        // console.log(modifiedStat)
        // console.log(modValues['reforged'][modifier.grade])
        // console.log(modValues['reforged'][modifier.grade][modifiedStat])
        // console.log(modValues['reforged'][modifier.grade][modifiedStat][stat.rolls])


        // Make it easier to read
        modifiedStat = shortenStats(modifier.stat);
    }
    // console.log(modifier.grade, modifier.stat, stat.rolls, item, item.level)

    if (stat.type == "Speed" && item.enhance != 15 && showMaxSpeed === true) {
        var speedStats = item.substats.filter(x => x.type == "Speed")
        var roundedEnhance = Math.floor(item.enhance / 3) * 3;
        var maxSpeed = 0;
        if (speedStats.length > 0) {
            var speedStat = speedStats[0];
            var rolls = speedStat.rolls;
            var enhance = item.enhance;
            var rollsLeft = Math.ceil(15 - item.enhance)/3;

            var potentialRolls = Constants.speedByItemTypeAlreadyRolled[item.rank][roundedEnhance];

            var reforgedValue = item.level == 90 ? speedStat.value : speedStat.reforgedValue;

            console.warn(reforgedValue)
            console.warn(Constants.speedRollsToValue[potentialRolls + rolls] - Constants.speedRollsToValue[rolls])
            console.warn("------------------------")
            maxSpeed = reforgedValue + potentialRolls * 4 + (item.level == 85 ? Constants.speedRollsToValue[potentialRolls + rolls] - Constants.speedRollsToValue[rolls] : 0);
        } else {
            var potentialRolls = Constants.speedByItemTypeNotYetRolled[item.rank][roundedEnhance];
            maxSpeed = potentialRolls * 4 + (item.level == 85 ? Constants.speedRollsToValue[potentialRolls] : 0);

            console.warn(potentialRolls)
            console.warn(Constants.speedRollsToValue[potentialRolls])
            console.warn("------------------------")
        }

        unpercentedStat = unpercentedStat + "  (Max: " + maxSpeed + ")";
    }

    return {
        type: unpercentedStat,
        value: value,
        modifiedStat: modifiedStat,
        reforge: reforge,
        rolls: rolls
    }
}

function rateBaseScore(stats, baseStats) {
    const atkScore = (stats.AttackPercent + (stats.Attack / baseStats.atk * 100));
    const hpScore = (stats.HealthPercent  + (stats.Health / baseStats.hp * 100));
    const defScore = (stats.DefensePercent + (stats.Defense / baseStats.def * 100));
    const spdScore = (stats.Speed) * 2;
    const crScore = (stats.CriticalHitChancePercent) * 1.5;
    const cdScore = (stats.CriticalHitDamagePercent) * 1.125;
    const effScore = (stats.EffectivenessPercent);
    const resScore = (stats.EffectResistancePercent);
    const score = atkScore + hpScore + defScore + spdScore + crScore + cdScore + effScore + resScore;

    return score;
}

function hasFlat(item) {
    for (var substat of item.substats) {
        if (substat.type == "Defense" || substat.type == "Attack" || substat.type == "Health") {
            return true;
        }
    }
    return false;
}

function wssToText(item) {
    // console.warn("WSS TO TEXT", item)
    if (item.equippedByName && hasFlat(item)) {
        const baseStats = HeroData.getBaseStatsByName(item.equippedByName).lv60SixStarFullyAwakened;
        baseStats.atk = baseStats.bonusStats.overrideAtk || baseStats.atk;
        baseStats.hp = baseStats.bonusStats.overrideHp || baseStats.hp;
        baseStats.def = baseStats.bonusStats.overrideDef || baseStats.def;

        /*
         * 有白字副属性时，wss 里的白字是按通用系数折算的，和「按这个英雄的基础属性反算」
         * 出来的分数不是一个数。原来两个都显示成 "wss (按基础属性换算)"，容易看混，
         * 现在只显示反算后的那个（统一 2 位小数）。
         */
        const score = rateBaseScore(item.augmentedStats, baseStats).toFixed(2)
        const reforgedScore = rateBaseScore(item.reforgedStats, baseStats).toFixed(2)

        if (Reforge.isReforgeable(item)) {
            if (isItemModded(item) && item.substats.filter(x => x.originalType).length > 0) {
                return reforgedScore;
            } else {
                return `${score} ➤ ${reforgedScore}`;
            }
        } else {
            return score
        }
    } else {
        if (Reforge.isReforgeable(item)) {
            if (isItemModded(item) && item.substats.filter(x => x.originalType).length > 0) {
                return item.reforgedWss;
            } else {
                return item.wss + " ➤ " + item.reforgedWss;
            }
        } else {
            return item.wss
        }
    }
}

function shortenStats(stat) {
    const statType = stat.match(/[A-Z][a-z]+/g).filter(x => x != 'Percent').join(' ');

    if (statType == "Effect Resistance")
        return "Effect Resist"
    if (statType == "Critical Hit Chance")
        return "Crit Chance"
    if (statType == "Critical Hit Damage")
        return "Crit Damage"
    return statType;
}

function getPercentageEquivalent(stat, baseStats, useReforged) {
    const value = useReforged ? stat.reforgedValue : stat.value;

    if (!baseStats) {
        return value;
    }

    if (stat.type == "Health") {
        var num = value/baseStats.hp*100;
        return value + ` (${Math.round(num)}%)`;
    }
    if (stat.type == "Defense") {
        var num = value/baseStats.def*100;
        return value + ` (${Math.round(num)}%)`;
    }
    if (stat.type == "Attack") {
        var num = value/baseStats.atk*100;
        return value + ` (${Math.round(num)}%)`;
    }
    if (stat.type == "Speed") {
        return value;
    }
}

const colorsByRank = {
    'Normal': 'grey',
    'Good': 'green',
    'Rare': 'blue',
    'Heroic': 'mediumorchid',
    'Epic': 'crimson'
}

function buildFilter(name, url, isChecked) {
    const html = `
<div class="pretty p-icon p-toggle">
    <input type="checkbox" id="checkboxImage${name}" ${isChecked ? 'checked' : ''}/>
    <div class="state p-success-o p-on">
        <img class="image onImage" src="${url}">
        <label class="imageLabel"></label>
    </div>
    <div class="state p-info-o p-off">
        <img class="image offImage" src="${url}">
        <label class="imageLabel"></label>
    </div>
</div>
`;
    return html;
}

function getHeroImage(item) {
    const heroName = item.equippedByName;
    if (!heroName)
        return Assets.getBlank(); // blank transparent

    const data = HeroData.getHeroExtraInfo(heroName);
    if (!data || !data.assets) {
        console.log(`getHeroImage: No data for hero ${heroName}`);
        return Assets.getBlank();
    }

    const iconUrl = data.assets.icon;
    if (!iconUrl) {
        console.log(`getHeroImage: No icon URL for hero ${heroName}`);
        return Assets.getBlank();
    }

    // Convert GitHub URL to local path (hero images live in data/cachedimages/heroes)
    // e.g., https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/main/data/cachedimages/c1144_s.png -> data/cachedimages/heroes/c1144_s.png
    // 头像落盘时就是处理好的 64px 图；96px 副本由 getHeroImageSrcSet() 补进 srcset
    if (iconUrl && iconUrl.includes('raw.githubusercontent.com')) {
        const fileName = Path.basename(iconUrl.split('?')[0]);
        return Path.join(Files.getDataPath(), 'cachedimages', 'heroes', fileName);
    }
    return iconUrl;
}

/*
 * 装备卡里的英雄头像：显示尺寸 48px（style.css: .itemDisplayEquippedHero）。
 * 64px 主图 + 96px 高分屏副本，100% 屏取 64（缩 1.33 倍）、200% 屏取 96（正好 1:1）。
 */
function getHeroImageAttributes(item) {
    const basePath = getHeroImage(item);
    const highPath = DataLoader.getHighResImagePath(basePath);

    if (!highPath) {
        return `src="${basePath}"`;
    }

    // srcset 里的路径统一用正斜杠，避免反斜杠在 URL 解析里出意外
    const toUrl = (filePath) => String(filePath).replace(/\\/g, '/');

    return `src="${basePath}" srcset="${toUrl(basePath)} 64w, ${toUrl(highPath)} 96w" sizes="48px"`;
}

module.exports = {
    modify: (location, hover, originalStat, originalValue, reforge, rolls, index) => {
        if (location != 'itemsGrid') {
            return;
        }
        const modifier = ItemsTab.getCurrentModifier();
        var displayStat = originalStat;
        var displayValue = originalValue;

        reforge = reforge ? 'reforged' : 'unreforged'

        const needsChange = hover && rolls && modifier.stat;

        if (needsChange) {
            // console.log(modifier, hover, originalStat, originalValue, reforge, rolls, index)
            const rollIndex = rolls ? rolls - 1 : 0;
            var mod = Constants.modValues[reforge][modifier.grade][modifier.stat][rollIndex];
            var isPercent = modifier.stat.includes('Percent');
            var start = "" + mod[0] + (isPercent ? "%" : "")
            var end = "" + mod[1] + (isPercent ? "%" : "")



            displayStat = hover ? shortenStats(modifier.stat) : originalStat;
            displayValue = "" + start + " - " + end;
        } else {

        }

        $('#itemsGridItemDisplaySubstatType' + index).html(i18next.t(displayStat));
        $('#itemsGridItemDisplaySubstatValue' + index).html(displayValue);

        if (needsChange) {
            $('#itemsGridItemDisplaySubstatType' + index).css({ 'text-decoration': 'underline', 'font-weight': 'bold' });
            $('#itemsGridItemDisplaySubstatValue' + index).css({ 'text-decoration': 'underline', 'font-weight': 'bold' });
        } else {
            $('#itemsGridItemDisplaySubstatType' + index).css({ 'text-decoration': 'none', 'font-weight': 'unset' });
            $('#itemsGridItemDisplaySubstatValue' + index).css({ 'text-decoration': 'none', 'font-weight': 'unset' });
        }
    },

    buildFilterSetsBar: () => {
        const clearUrl = Assets.getX(); // black x
        const html = buildFilter("ClearSets", clearUrl, true);
        document.getElementById('setsFilterBar').innerHTML += html;

        const assetsBySet = Assets.getAssetsBySet();
        for (var set of Object.keys(assetsBySet)) {
            const url = assetsBySet[set];
            const html = buildFilter(set, url, false);

            document.getElementById('setsFilterBar').innerHTML += html;
        }
    },

    buildFilterLevelBar: () => {
        const clearUrl = Assets.getX(); // black x
        const html = buildFilter("ClearLevels", clearUrl, true);
        document.getElementById('levelFilterBar').innerHTML += html;

        const assetsByLevel = Assets.getAssetsByLevel();
        for (var level of Object.keys(assetsByLevel)) {
            const url = assetsByLevel[level];
            const html = buildFilter(level, url, false);

            document.getElementById('levelFilterBar').innerHTML += html;
        }
    },

    buildFilterEnhanceBar: () => {
        const clearUrl = Assets.getX(); // black x
        const html = buildFilter("ClearEnhances", clearUrl, true);
        document.getElementById('enhanceFilterBar').innerHTML += html;

        const assetsByEnhance = Assets.getAssetsByEnhance();
        for (var enhance of Object.keys(assetsByEnhance)) {
            const url = assetsByEnhance[enhance];
            const html = buildFilter(enhance, url, false);

            document.getElementById('enhanceFilterBar').innerHTML += html;
        }
    },

    buildFilterGearBar: () => {
        const clearUrl = Assets.getX(); // black x
        const html = buildFilter("ClearGears", clearUrl, true);
        document.getElementById('gearFilterBar').innerHTML += html;

        const assetsByGear = Assets.getAssetsByGear();
        for (var gear of Object.keys(assetsByGear)) {
            const url = assetsByGear[gear];
            const html = buildFilter(gear, url, false);

            document.getElementById('gearFilterBar').innerHTML += html;
        }
    },


    buildFilterStatBar: () => {
        const clearUrl = Assets.getX(); // black x
        const html = buildFilter("ClearStats", clearUrl, true);
        document.getElementById('statFilterBar').innerHTML += html;

        const assetsByStat = Assets.getAssetsByStat();
        for (var stat of Object.keys(assetsByStat)) {
            const url = assetsByStat[stat];
            const html = buildFilter(stat, url, false);

            document.getElementById('statFilterBar').innerHTML += html;
        }
    },

    // builds 列表「功能列」：未装备的配装显示「穿上」（fa-tshirt），已装备的显示「脱下」（fa-undo-alt），
    // 中间是「一键换装」（走模拟器；运行中变成转圈图标，再点即中断），最后是删除
    //
    // hasAnyEquipped：身上还挂着这条配装的任意一件（哪怕被别的英雄抢走了几件）→ 给「脱下」，
    // 否则那几件就没地方脱了。一键换装仍然要求 6 件齐全（isEquipped）。
    //
    // oneClickState = { busy, stopping, cooldown }（EmulatorEquip.getState()）：
    //   busy     运行中 → 转圈，点它就是中断
    //   stopping 已请求中断 → 转圈但灰掉，点了没反应，别指望再点一次能更快
    //   cooldown 刚跑完的 3 秒 → 机器人灰掉，避免连点中断后一下又启动一轮
    buildBuildActionsCell(isEquipped, hasAnyEquipped, oneClickState) {
        const state = oneClickState || {};
        const equipIcon = hasAnyEquipped
            ? `<i class="fas fa-undo-alt buildGlyph buildUnequipIcon" title="${i18next.t('Unequip Items')}"></i>`
            : `<i class="fas fa-tshirt buildGlyph buildEquipIcon" title="${i18next.t('Equip Build')}"></i>`;

        /*
         * 一键换装只在「这条配装就是英雄身上穿的」时可点：游戏里复刻的就是身上这套，
         * 没装备时点了没意义，做成灰色禁用。
         */
        let oneClickIcon;
        if (!isEquipped) {
            oneClickIcon = `<i class="fas fa-robot buildGlyph buildOneClickEquipIcon buildActionDisabled" title="${i18next.t('Equip this build first')}"></i>`;
        } else if (state.stopping) {
            oneClickIcon = `<i class="fas fa-spinner fa-spin buildGlyph buildOneClickEquipIcon buildActionStopping" title="${i18next.t('Stopping...')}"></i>`;
        } else if (state.busy) {
            oneClickIcon = `<i class="fas fa-spinner fa-spin buildGlyph buildOneClickEquipIcon buildRunningIcon" title="${i18next.t('Cancel operation')}"></i>`;
        } else if (state.cooldown) {
            oneClickIcon = `<i class="fas fa-robot buildGlyph buildOneClickEquipIcon buildActionDisabled" title="${i18next.t('Please wait a moment')}"></i>`;
        } else {
            oneClickIcon = `<i class="fas fa-robot buildGlyph buildOneClickEquipIcon" title="${i18next.t('One-Click Equip')}"></i>`;
        }

        return equipIcon
            + oneClickIcon
            + `<i class="fas fa-trash buildGlyph buildDeleteIcon" title="${i18next.t('Remove Build')}"></i>`;
    },

    buildItemPanel(item, checkboxPrefix, baseStats, mods) {
        if (!item) {
            return `

<div class="itemDisplayHeader">
  <div class="itemDisplayHeaderData">
    <div class="itemDisplayHeaderDataTop">
      <div class="itemDisplayLevel"></div>
    </div>
    <div class="itemDisplayHeaderDataBot">
      <div class="itemDisplayGearRank"></div>
    </div>
  </div>
</div>
<div class="itemDisplaySubstats">
</div>
<div class="itemDisplayFooter">
</div>
            `
        }

        ItemAugmenter.augment([item])

        const main = statToText(item.main, baseStats, item, checkboxPrefix);
        const substat0 = statToText(item.substats[0], baseStats, item, checkboxPrefix);
        const substat1 = statToText(item.substats[1], baseStats, item, checkboxPrefix);
        const substat2 = statToText(item.substats[2], baseStats, item, checkboxPrefix);
        const substat3 = statToText(item.substats[3], baseStats, item, checkboxPrefix);

        const score = wssToText(item);

        const color = colorsByRank[item.rank];
        const gearImage = Assets.getGearAsset(item.gear);
        const setImage = Assets.getSetAsset(item.set);

        const heroImage = getHeroImageAttributes(item);

        const materialImage = getMaterialImage(item);

        var html = `
<div class="itemDisplayHeader">
  <img src="${gearImage}" class="gearTypeImg" ${styleForImage(item.rank)}></img>
  <div class="itemDisplayHeaderData">
    <div class="itemDisplayHeaderDataTop">
      <div class="itemDisplayLevel" ${styleEnhance(item.enhance)}>+${item.enhance}</div>
    </div>
    <div class="itemDisplayHeaderDataTop">
      <div class="itemDisplayLevel" ${styleLevel(item)}>${item.level}</div>
    </div>
  </div>
  <img src="${materialImage}" class="itemDisplayMaterial"></img>
  <img ${heroImage} class="itemDisplayEquippedHero"></img>
</div>
<div class="itemDisplayMainStat">
  <div class="itemDisplayMainType">${i18next.t(main.type)}</div>
  <div class="itemDisplayMainValue">${main.value}</div>
</div>
<div class="itemDisplaySubstats">
  <div class="itemDisplaySubstat" onmouseover="HtmlGenerator.modify('${checkboxPrefix}', true, '${substat0.modifiedStat}', '${substat0.value}', ${substat0.reforge}, ${substat0.rolls}, 0)" onmouseout="HtmlGenerator.modify('${checkboxPrefix}', false, '${substat0.type}', '${substat0.value}', '${substat0.value}', '${substat0.value}', 0)">
    <div class="itemDisplaySubstatValueAndConversion">
        <div class="itemDisplaySubstatType" id="${checkboxPrefix}ItemDisplaySubstatType0">${i18next.t(substat0.type)}</div>
        ${generateSubstatConversionImage(item, 0)}
    </div>
    <div class="itemDisplaySubstatValue" id="${checkboxPrefix}ItemDisplaySubstatValue0">${substat0.value}</div>
  </div>
  <div class="itemDisplaySubstat" onmouseover="HtmlGenerator.modify('${checkboxPrefix}', true, '${substat1.modifiedStat}', '${substat1.value}', ${substat1.reforge}, ${substat1.rolls}, 1)" onmouseout="HtmlGenerator.modify('${checkboxPrefix}', false, '${substat1.type}', '${substat1.value}', '${substat1.value}', '${substat1.value}', 1)">
    <div class="itemDisplaySubstatValueAndConversion">
        <div class="itemDisplaySubstatType" id="${checkboxPrefix}ItemDisplaySubstatType1">${i18next.t(substat1.type)}</div>
        ${generateSubstatConversionImage(item, 1)}
    </div>
    <div class="itemDisplaySubstatValue" id="${checkboxPrefix}ItemDisplaySubstatValue1">${substat1.value}</div>
  </div>
  <div class="itemDisplaySubstat" onmouseover="HtmlGenerator.modify('${checkboxPrefix}', true, '${substat2.modifiedStat}', '${substat2.value}', ${substat2.reforge}, ${substat2.rolls}, 2)" onmouseout="HtmlGenerator.modify('${checkboxPrefix}', false, '${substat2.type}', '${substat2.value}', '${substat2.value}', '${substat2.value}', 2)">
    <div class="itemDisplaySubstatValueAndConversion">
        <div class="itemDisplaySubstatType" id="${checkboxPrefix}ItemDisplaySubstatType2">${i18next.t(substat2.type)}</div>
        ${generateSubstatConversionImage(item, 2)}
    </div>
    <div class="itemDisplaySubstatValue" id="${checkboxPrefix}ItemDisplaySubstatValue2">${substat2.value}</div>
  </div>
  <div class="itemDisplaySubstat" onmouseover="HtmlGenerator.modify('${checkboxPrefix}', true, '${substat3.modifiedStat}', '${substat3.value}', ${substat3.reforge}, ${substat3.rolls}, 3)" onmouseout="HtmlGenerator.modify('${checkboxPrefix}', false, '${substat3.type}', '${substat3.value}', '${substat3.value}', '${substat3.value}', 3)">
    <div class="itemDisplaySubstatValueAndConversion">
        <div class="itemDisplaySubstatType" id="${checkboxPrefix}ItemDisplaySubstatType3">${i18next.t(substat3.type)}</div>
        ${generateSubstatConversionImage(item, 3)}
    </div>
    <div class="itemDisplaySubstatValue" id="${checkboxPrefix}ItemDisplaySubstatValue3">${substat3.value}</div>
  </div>
  <div class="horizontalLine"></div>
  <div class="itemDisplaySubstat">
    <div class="itemDisplaySubstatType">${i18next.t("Score")}</div>
    <div class="itemDisplaySubstatValue">${score}</div>
  </div>
</div>
<div class="itemDisplayFooter">
  <div class="itemDisplayFooterIconContainer">
      ${checkboxPrefix == "itemsGrid" || checkboxPrefix == "heroesGrid" ? "" : `<input type="checkbox" class="itemPreviewCheckbox" id="${checkboxPrefix + item.gear}" checked>`}
      <div class="itemDisplayFooterSet">
        <img src="${setImage}" class="itemDisplaySetImg"></img>
      </div>
  </div>
  <div class="itemDisplayFooterIconContainer">
      ${storageOrLocator(item, checkboxPrefix)}
      ${editItemDisplay(item)}
      ${editLockDisplay(item)}
  </div>
</div>
        `

//         if (checkboxPrefix == "itemsGrid") {
//             html +=
// `
// Possible score range: 10 - 22</br>
// Actual score: 15</br>
// Percentage: 56%</br>
// `
//         }

        return html;
    }
}

function storageOrLocator(item, checkboxPrefix) {
    if (item.storage) {
        return storage(item, checkboxPrefix)
    }
    return locate(item, checkboxPrefix)
}

function getMaterialImage(item) {
    if (!item.material || item.material == "Unknown") {
        return Assets.getBlank();
    }

    if (item.material == "Conversion") {
        return "./assets/reforgeConversion.png";
    }

    if (item.material == "Hunt") {
        return huntImageBySet[item.set]
    }

    return Assets.getBlank();
}

const huntImageBySet = {
    HealthSet: "./assets/reforgeG.png",
    DefenseSet: "./assets/reforgeG.png",
    AttackSet: "./assets/reforgeG.png",
    SpeedSet: "./assets/reforgeW.png",
    CriticalSet: "./assets/reforgeW.png",
    HitSet: "./assets/reforgeW.png",
    DestructionSet: "./assets/reforgeB.png",
    LifestealSet: "./assets/reforgeB.png",
    ProtectionSet: "./assets/reforgeG.png",
    CounterSet: "./assets/reforgeB.png",
    ResistSet: "./assets/reforgeB.png",
    UnitySet: "./assets/reforgeA.png",
    RageSet: "./assets/reforgeA.png",
    ImmunitySet: "./assets/reforgeA.png",
    RevengeSet: "./assets/reforgeC.png",
    InjurySet: "./assets/reforgeC.png",
    PenetrationSet: "./assets/reforgeC.png",
    TorrentSet: "./assets/reforgeC.png",
    ReversalSet: "./assets/reforgeOtherworld.png",
    RiposteSet: "./assets/reforgeOtherworld.png",
    WarfareSet: "./assets/reforgeOtherworld.png",
    PursuitSet: "./assets/reforgeOtherworld.png",
    WeakeningSet: "./assets/reforgeOtherworld.png",
    FervorSet: "./assets/reforgeOtherworld.png",
}


function locate(item, checkboxPrefix) {
    return `<img src="${Assets.getLocate()}" class="itemDisplayEditImg locateTooltip${checkboxPrefix}" data-itemId="${item.ingameId}" onclick='Locator.locate("${item.ingameId}", "locateTooltip${checkboxPrefix}")'></img>`
}

function storage(item, checkboxPrefix) {
    const storage = item.storage;
    if (!storage)
        return ""; // blank transparent

    return `<img src="${Assets.getStorage()}" class="itemDisplayEditImg locateTooltip${checkboxPrefix}" data-itemId="${item.ingameId}" onclick='Locator.locate("${item.ingameId}", "locateTooltip${checkboxPrefix}")'></img>`
}

function editItemDisplay(item) {
    if (Reforge.isReforgeableNow(item)) {
        return `<img src="${Assets.getEdit()}"    class="itemDisplayEditImg" onclick='OptimizerTab.editGearFromIcon("${item.id}", false)'></img>
                <img src="${Assets.getReforge()}" class="itemDisplayEditImg" onclick='OptimizerTab.editGearFromIcon("${item.id}", true)'></img>`
    }
    return `<img src="${Assets.getEdit()}" class="itemDisplayEditImg" onclick='OptimizerTab.editGearFromIcon("${item.id}", false)'></img>`
}

function styleEnhance(enhance) {
    if (enhance != "15") {
        return 'style="color: red;font-weight: bold;"'
    }
}

function editLockDisplay(item) {
    if (!item.locked) {
        return `<img src="${Assets.getLock()}" style="opacity:0.12" class="itemDisplayLockImgTransparent" onclick='OptimizerTab.lockGearFromIcon("${item.id}")'}></img>`
    }
    return `<img src="${Assets.getLock()}" class="itemDisplayLockImg" onclick='OptimizerTab.lockGearFromIcon("${item.id}")'}></img>`
}

function styleLevel(item) {
    if (Reforge.isReforgeable(item)) {
        return 'style="color: #00b306;font-weight: bold;"'
    }
}

function styleForImage(rank) {
    if (rank == "Epic")
        return 'style="border: solid 2px #a20707;background: #ff58588a;"'
    if (rank == "Heroic")
        return 'style="border: solid 2px #ca56ff;background: #eda6ff99;"'
    if (rank == "Rare")
        return 'style="border: solid 2px #1722f9;background: #6db5ffab;"'
    if (rank == "Good")
        return 'style="border: solid 2px #009208;background: #93ffaaab;"'
    if (rank == "Normal")
        return 'style="border: solid 2px #616161;background: #d2d4d2ab;"'
    return "";
}

function generateSubstatConversionImage(item, index) {
    const substat = item.substats[index];
    // if (substat.isConverted) {
    if (substat && substat.modified) {
        if (substat.originalType) {
            return `<img src="${Assets.getAssetByStat(substat.originalType)}" class="substatConvertedImage"></img>`;
        }
        return `<img src="${Assets.getCycle()}" class="substatConvertedImage"></img>`;
    } else {
        // return `<img src="${Assets.getCycle()}" class="substatConvertedImage" style='opacity:0.25'></img> `;
        return ''
    }
}
