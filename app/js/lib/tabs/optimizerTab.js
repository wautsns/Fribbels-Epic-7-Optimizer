const rangesliderJs = require('rangeslider-js');
const ResultPriority = require('../resultPriority');
const DominanceFilter = require('../dominanceFilter');
const LimitConfiguration = require('../limitConfiguration');
const AttributePriority = require('../attributePriority');
var permutations = 0;
var progressTimer;
var currentFilteredItems = [];
const electron = require('electron');
const ipc = electron.ipcRenderer;
const fs = require('fs');

var currentExecutionId;
var resized = false;
var resultPriorityStates = {};
// 「开始」按钮在搜索进行中会变成「取消」，用这个标记记录当前状态
var optimizationRunning = false;
const gearTypes = ["Weapon", "Helmet", "Armor", "Necklace", "Ring", "Boots"];

function countItemsByGear(items) {
    const counts = {};
    for (const gear of gearTypes) {
        counts[gear] = 0;
    }

    for (const item of items) {
        if (counts[item.gear] != undefined) {
            counts[item.gear]++;
        }
    }

    return counts;
}

function formatFilteredGearCount(filteredCount, dominanceRemovedCount, totalCount, percentage) {
    return Number(filteredCount).toLocaleString()
        + "(" + Number(dominanceRemovedCount).toLocaleString() + ")/"
        + Number(totalCount).toLocaleString()
        + " - (" + percentage + "%)";
}

function normalizePriorityIndex(index) {
    return index == null || index == undefined ? '' : index;
}

function getResultPriorityState(index) {
    const key = normalizePriorityIndex(index);
    resultPriorityStates[key] = ResultPriority.normalizeState(resultPriorityStates[key]);
    return resultPriorityStates[key];
}

function setResultPriorityState(index, state) {
    resultPriorityStates[normalizePriorityIndex(index)] = ResultPriority.normalizeState(state);
}

function inputDisplayNumber(value) {
    if (value == 0 || value == 2147483647) {
        return "";
    }
    return value;
}

function inputDisplayNumberNumber(value, base) {
    if (!value || value == 2147483647) {
        if (base) {
            return base;
        }
        return 0;
    }
    return value;
}

function fixSliders(index) {
    if (index == null || index == undefined) {
        index = '';
    }
    // if (!resized) {
    //     console.log("NOT FIXING")
    //     return;
    // }
    console.log("Fixing sliders")
    document.querySelector('#atkSlider' + index)['rangeslider-js'].update()
    document.querySelector('#hpSlider' + index)['rangeslider-js'].update()
    document.querySelector('#defSlider' + index)['rangeslider-js'].update()
    document.querySelector('#spdSlider' + index)['rangeslider-js'].update()
    document.querySelector('#crSlider' + index)['rangeslider-js'].update()
    document.querySelector('#cdSlider' + index)['rangeslider-js'].update()
    document.querySelector('#effSlider' + index)['rangeslider-js'].update()
    document.querySelector('#resSlider' + index)['rangeslider-js'].update()
    document.querySelector('#filterSlider' + index)['rangeslider-js'].update()

    resized = false;
}

function isNullUndefined(x) {
    return x === null || x === undefined;
}

function calculatePlaceholderRatings(index) {
    if (index == null || index == undefined) {
        index = '';
    }

    const minDef = readNumber('inputMinDefLimit' + index)
    const minHp = readNumber('inputMinHpLimit' + index)

    if (minDef == undefined || minHp == undefined || minDef == 0 || minHp == 0) {
        $("#inputMinEhpLimit" + index).attr("placeholder", "");
    } else {
        const ehp = Math.floor(minHp * (minDef / 300 + 1));
        $("#inputMinEhpLimit" + index).attr("placeholder", ehp);
    }
}

module.exports = {

    initialize: () => {
        ipc.on('resized', () => {
            resized = true;
            fixSliders()
        });

        document.getElementById('inputMinDefLimit').addEventListener("change", () => {
            calculatePlaceholderRatings()
        });
        document.getElementById('inputMinHpLimit').addEventListener("change", () => {
            calculatePlaceholderRatings()
        });

        // 「开始」和「取消」是同一个按钮：搜索中变成取消，点取消或者搜索结束再变回开始
        document.getElementById('submitOptimizerRequest').addEventListener("click", () => {
            if (optimizationRunning) {
                cancelOptimizationRequest();
                return;
            }
            submitOptimizationRequest()
        });
        document.getElementById('submitOptimizerFilter').addEventListener("click", () => {
            submitOptimizationFilterRequest()
        });

        // 一键换装：把英雄身上这套装备在模拟器里复刻一遍（和英雄列表的按钮功能一致）
        document.getElementById('optimizerOneClickEquip').addEventListener("click", async () => {
            if (EmulatorEquip.isBusy && EmulatorEquip.isBusy()) {
                EmulatorEquip.cancel();
                return;
            }

            const heroId = document.getElementById('inputHeroAdd').value;
            if (!heroId) {
                Dialog.error(i18next.t('Select a hero first'));
                return;
            }

            const button = document.getElementById('optimizerOneClickEquip');
            button.disabled = true;
            try {
                const heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
                const hero = heroResponse.hero;
                const items = hero && hero.equipment
                    ? Object.values(hero.equipment).filter(Boolean)
                    : [];

                if (items.length !== gearTypes.length) {
                    Dialog.error(
                        i18next.t('This hero is not wearing all 6 pieces, cannot use One-Click Equip')
                    );
                    return;
                }

                await EmulatorEquip.equipHeroBuild(hero, items);
            } catch (e) {
                Dialog.error(
                    i18next.t('One-Click Equip failed: ') + (e && e.message ? e.message : e)
                );
            } finally {
                updateOneClickEquipButton();
            }
        });
        if (EmulatorEquip.onBusyChange) {
            EmulatorEquip.onBusyChange(updateOneClickEquipButton);
        }
        updateOneClickEquipButton();

        // 根据 hero-library 的配装数据（getBuilds 接口）自动填入套装 / 神器 / 属性过滤
        document.getElementById('fillFromBuildsButton').addEventListener("click", async () => {
            const heroId = document.getElementById('inputHeroAdd').value;
            if (!heroId) {
                Dialog.error(i18next.t('Select a hero first'));
                return;
            }

            const button = document.getElementById('fillFromBuildsButton');
            if (button.disabled) return;
            button.disabled = true;

            try {
                const heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
                const result = await HeroBuilds.fill(heroResponse.hero);
                if (result) {
                    recalculateFilters();
                    Notifier.success(
                        i18next.t('Filled from build data: {{set}} + {{artifact}} ({{count}} builds, {{method}})', {
                            set: result.setLabel,
                            artifact: result.artifactName,
                            count: result.n,
                            method: i18next.t(result.method === 'density' ? 'density range' : 'median'),
                            interpolation: { escapeValue: false },
                        })
                    );
                }
            } catch (e) {
                Dialog.error(
                    i18next.t('Fill from build data failed: ') + (e && e.message ? e.message : e)
                );
            } finally {
                button.disabled = false;
            }
        });

        document.getElementById('submitOptimizerReset').addEventListener("click", () => {
            clearStats();
            calculatePlaceholderRatings();
            // clearForce();

            Selectors.clearGearMainAndSets();

            clearSubstatPriority();
            setResultPriorityState('', {});

            clearOptions();

            recalculateFilters();
        });
        document.getElementById('gearPreviewAddBuild').addEventListener("click", () => {
            addBuild()
        });
        document.getElementById('gearPreviewRemoveBuild').addEventListener("click", () => {
            removeBuild()
        });
        document.getElementById('gearPreviewEquip').addEventListener("click", () => {
            equipSelectedGear()
        });
        document.getElementById('gearPreviewUnequip').addEventListener("click", () => {
            unequipSelectedGear()
        });


        $('#inputHeroAdd').change(async () => {
            const heroId = document.getElementById('inputHeroAdd').value;
            const heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));

            recalculateFilters();
            redrawHeroImage();
            module.exports.redrawHeroSelector();
            // 还原英雄上次保存的过滤器（包含「根据配装数据填入」保存下来的那一份）
            await module.exports.loadPreviousHeroFilters(heroResponse, null, true);
            // the pinned row doubles as the "before" panel: use the hero's real (equipped)
            // numbers, and only fall back to the bare base stats when those are all zero.
            // baseStats 里没有 equipment/sets，必须显式带回，否则套装图标和结果表第一列都是空的
            const pinnedHero = Object.assign({}, heroResponse.hero);
            if (!pinnedHero.atk && !pinnedHero.hp && !pinnedHero.def && heroResponse.baseStats) {
                Object.assign(pinnedHero, heroResponse.baseStats);
            }
            pinnedHero.equipment = heroResponse.hero.equipment;
            pinnedHero.sets = heroResponse.hero.sets;
            OptimizerGrid.setPinnedHero(pinnedHero);
            module.exports.drawBaseStats(heroResponse)
            // 底部 6 件装备的卡片也要立刻换成这个英雄的当前装备
            module.exports.drawEquippedGear(pinnedHero)
        });

        // $('#forceNumberSelect').change(recalculateFilters);
        $('.optimizer-number-input').change(recalculateFilters);
        $('.optimizer-checkbox').change(recalculateFilters);
        $('.inputGearFilterSelect').change(recalculateFilters);
        $('.inputSetFilterSelect').change(recalculateFilters);
        $('.icon-close').click(recalculateFilters)
        // $('#filterSliderInput').change(recalculateFilters);

        $('.optionsExcludeGearFrom').change(() => {
            // Doesnt work without explicit function call for some reason
            recalculateFilters();
        })

        document.getElementById('tab1label').addEventListener("click", async () => {
            await module.exports.redrawHeroSelector();
            recalculateFilters();
            fixSliders()

            // the app can start on another tab, let the grid measure itself once visible
            setTimeout(() => OptimizerGrid.layout(), 50);
        });

        document.getElementById('substatPriorityLabel').addEventListener("click", async () => {
            clearSubstatPriority();
            recalculateFilters();
        });
        document.getElementById('statsLabel').addEventListener("click", async () => {
            clearStats();
            recalculateFilters();
        });
        // 技能伤害过滤面板已移除，技能下限不再有输入框
        document.getElementById('optionsLabel').addEventListener("click", async () => {
            clearOptions();
            recalculateFilters();
        });

        document.getElementById('skillOptionsButton').addEventListener("click", async () => {
            var heroId = document.getElementById('inputHeroAdd').value;
            if (!heroId) return;
            console.log("addSkills", heroId);

            var skillOptions = await module.exports.showSkillOptionsWindow(heroId);

            Saves.autoSave();
        });

        document.getElementById('addBonusStatsOptimizerButton').addEventListener("click", async () => {
            var heroId = document.getElementById('inputHeroAdd').value;
            if (!heroId) return;

            const hero = (await Api.getHeroById(heroId)).hero;

            await HeroesTab.showBonusStatsWindow(hero);
            redrawHeroImage()
            Saves.autoSave();
        });

        document.getElementById('addSubstatModsOptimizerButton').addEventListener("click", async () => {
            var heroId = document.getElementById('inputHeroAdd').value;
            if (!heroId) return;

            const hero = (await Api.getHeroById(heroId)).hero;

            const modStats = await Dialog.editModStatsDialog(hero);

            // mods

            await Api.setModStats(modStats, hero.id);
            Notifier.success("Saved mod stats");
            Saves.autoSave();

            // var heroId = document.getElementById('inputHeroAdd').value;
            // if (!heroId) return;
            // console.log("addSkills", heroId);

            // var skillOptions = await module.exports.showSkillOptionsWindow(heroId);

            // Saves.autoSave();
        });
        document.getElementById('resultPriorityButton').addEventListener("click", async () => {
            const heroId = document.getElementById('inputHeroAdd').value;
            if (!heroId) return;

            const result = await Dialog.editResultPriorityDialog(getResultPriorityState());
            if (result) {
                setResultPriorityState('', result);
                recalculateFilters();
            }
        });

        document.getElementById('autoAttributePriorityButton').addEventListener("click", async () => {
            const heroId = document.getElementById('inputHeroAdd').value;
            if (!heroId) return;

            // derive the attribute priority sliders from the stat filters, set bonuses and
            // accessory main stats that are already selected on this screen
            const heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
            const params = module.exports.getOptimizationRequestParams();
            const priorities = AttributePriority.compute(params, heroResponse.hero, heroResponse.baseStats);

            module.exports.applyAttributePriorities(priorities);
            recalculateFilters();
        });

        // document.getElementById('accessorySetsLabel').addEventListener("click", async () => {
        //     Selectors.clearGearMainAndSets();
        //     recalculateFilters();
        // });

        module.exports.buildSlider('#atkSlider', true)
        module.exports.buildSlider('#hpSlider', true)
        module.exports.buildSlider('#defSlider', true)
        module.exports.buildSlider('#spdSlider', true)
        module.exports.buildSlider('#crSlider', true)
        module.exports.buildSlider('#cdSlider', true)
        module.exports.buildSlider('#effSlider', true)
        module.exports.buildSlider('#resSlider', true)
        module.exports.buildSlider('#filterSlider', true)
    },

    applyAttributePriorities: (priorities) => {
        const sliders = [
            ['atk', '#atkSlider'],
            ['hp', '#hpSlider'],
            ['def', '#defSlider'],
            ['spd', '#spdSlider'],
            ['cr', '#crSlider'],
            ['cd', '#cdSlider'],
            ['eff', '#effSlider'],
            ['res', '#resSlider'],
        ];

        for (const [key, selector] of sliders) {
            const value = Math.max(0, Math.min(8, Math.round((priorities && priorities[key]) || 0)));
            const input = document.querySelector(selector + 'Input');
            if (input) {
                input.setAttribute('value', value);
            }

            const slider = document.querySelector(selector);
            if (slider && slider['rangeslider-js']) {
                slider['rangeslider-js'].update({ value: value });
            }
        }
    },

    buildSlider: (slider, recalc) => {
        var sliderEl = document.querySelector(slider);
        var nrInput = document.querySelector(slider + 'Input');
        rangesliderJs.create(sliderEl, {
            onSlideEnd: val => {
                nrInput.setAttribute('value', val)
                if (recalc) {
                    recalculateFilters();
                }
            },
            onSlide: val => {
                nrInput.setAttribute('value', val)
            },
        })
        nrInput.addEventListener('input',  ev => sliderEl['rangeslider-js'].update({value: ev.target.value}))
    },

    buildTopSlider: (slider, recalc) => {
        var sliderEl = document.querySelector(slider);
        var nrInput = document.querySelector(slider + 'Input');
        rangesliderJs.create(sliderEl, {
            onSlideEnd: val => {
                nrInput.setAttribute('value', Math.round(0.01 * Math.pow(val, 2)))
                if (recalc) {
                    recalculateFilters();
                }
            },
            onSlide: val => {
                nrInput.setAttribute('value', Math.round(0.01 * Math.pow(val, 2)))
            },
        })
        nrInput.addEventListener('input',  ev => sliderEl['rangeslider-js'].update({value: ev.target.value}))
    },

    applyItemFilters: async (params, heroResponse, allItemsResponse, submit, allowedHeroIds, overrideGearMainFilters, index) => {
        const gearMainFilters = overrideGearMainFilters || Selectors.getGearMainFilters();
        const getAllItemsResponse = allItemsResponse;
        const hero = heroResponse.hero;
        const baseStats = heroResponse.baseStats;
        const heroId = hero.id;
        var allItems = getAllItemsResponse.items;
        var items = allItems;

        const allHeroesResponse = await Api.getAllHeroes()
        const heroes = allHeroesResponse.heroes;

        if (!params.inputSets) {
            params.inputSets = [params.inputSetsOne, params.inputSetsTwo, params.inputSetsThree]
        }

        console.log("Optimization params", params);

        if (params.enhanceLimit) {
            const limit = params.enhanceLimit.length > 0 ? parseInt(params.enhanceLimit[0]) : 0;
            items = items.filter(x => x.enhance >= limit);
        }

        if (params.inputExcludeSet.length > 0) {
            items = items.filter(x => !params.inputExcludeSet.includes(x.set));
        }

        if (params.excludeFilter.length > 0) {
            items = items.filter(x => !params.excludeFilter.includes(x.equippedById) || x.equippedById == heroId);
        }

        // if (params.inputOnlyMaxedGear) {
        //     items = items.filter(x => x.enhance == 15 && !Reforge.isReforgeable(x));
        // }

        // 4 件套 + 2 件套 / 2+2+2 时套装是有硬约束的：候选先筛到这些套装，
        // 优先级过滤也要按「部位 × 套装」分组，保证每个套装在每个部位都有代表
        const setConstrained = isFourAndTwoPieceSets(params.inputSets) || isTwoAndTwoAndTwoPieceSets(params.inputSets);
        if (setConstrained) {
            const possibleSets = params.inputSets.flat();
            items = items.filter(x => possibleSets.includes(x.set));
        }

        if (!params.inputAllowEquippedItems) {
            items = items.filter(x => !x.equippedById || x.equippedById == heroId);
        }

        if (!params.inputAllowLockedItems) {
            items = items.filter(x => !x.locked || x.equippedById == heroId);
        }

        if (params.inputOrderedHeroPriority) {
            // todo
            console.warn(heroes, hero);
            // var higherPriorityItems = [];
            var higherPriorityHeroes = [];
            for (var i = 0; i < heroes.length; i++) {
                if (heroes[i].id == hero.id) {
                    break;
                }

                higherPriorityHeroes.push(heroes[i].id);

                // higherPriorityItems.push(
                //     heroes[i].equipment.Weapon?.id,
                //     heroes[i].equipment.Helmet?.id,
                //     heroes[i].equipment.Armor?.id,
                //     heroes[i].equipment.Necklace?.id,
                //     heroes[i].equipment.Ring?.id,
                //     heroes[i].equipment.Boots?.id
                // )
            }

            // higherPriorityItems = higherPriorityItems.filter(x => !!x);
            higherPriorityHeroes = higherPriorityHeroes.filter(x => !(allowedHeroIds || []).includes(x))
            items = items.filter(x => !higherPriorityHeroes.includes(x.equippedById))
            console.warn("DEBUG FILTER", higherPriorityHeroes, allowedHeroIds);
        }

        if (params.inputKeepCurrentItems) {
            if (!hero.equipment) {
                items = [];
                hero.equipment = {};
            }

            const equipped = Object.values(hero.equipment);
            for (var i = 0; i < 6; i++) {
                const item = equipped[i];
                if (item) {
                    items = items.filter(x => {
                        const passFilter = item.gear != x.gear || item.equippedById == x.equippedById;
                        // if (!passFilter)
                        //     console.log(x);
                        return passFilter;
                    })
                }
            }
        }

        for (var i = 0; i < gearMainFilters.length; i++) {
            const filter = gearMainFilters[i];
            if (filter.length == 0)
                continue;
            if (i == 0)
                items = items.filter(x => filter.includes(x.main.type) && x.gear == "Necklace" || x.gear != "Necklace")
            if (i == 1)
                items = items.filter(x => filter.includes(x.main.type) && x.gear == "Ring" || x.gear != "Ring")
            if (i == 2)
                items = items.filter(x => filter.includes(x.main.type) && x.gear == "Boots" || x.gear != "Boots")
        }

        if (params.inputPredictReforges) {
            console.log("Predict reforges enabled")
            ItemAugmenter.augment(items);
            items.forEach(x => {
                if (Reforge.isReforgeableNow(x)) {
                    x.substats.forEach(substat => {
                        if (substat.reforgedValue) {
                            substat.value = substat.reforgedValue;
                        }
                    });

                    x.main.value = x.main.reforgedValue;
                }
            })
        }

        items = ModificationFilter.apply(items, params.inputSubstatMods, hero, submit);

        if (params.inputFilterPriority != 100) {
            PriorityFilter.calculatePriorityScores(params, items, baseStats, params.inputPredictReforges);
        }

        const dominanceInputCounts = countItemsByGear(items);
        items = DominanceFilter.applyDominanceFilters(params, items, baseStats, params.inputPredictReforges);
        const dominanceOutputCounts = countItemsByGear(items);
        const dominanceRemovedCounts = {};
        for (const gear of gearTypes) {
            dominanceRemovedCounts[gear] = dominanceInputCounts[gear] - dominanceOutputCounts[gear];
        }

        items = PriorityFilter.applyPriorityFilters(params, items, baseStats, allItems, params.inputPredictReforges, params.inputSubstatMods)

        items = items.sort((a, b) => {
            return a.set-b.set;
        })

        const prioritizedItems = [];
        for (var item of items) {
            if (params.inputSetsOne.includes(item.set)) {
                prioritizedItems.unshift(item);
            } else {
                prioritizedItems.push(item);
            }
        }

        console.log("Filtered items", prioritizedItems.length)
        currentFilteredItems = prioritizedItems;
        return {
            items,
            allItems,
            dominanceRemovedCounts,
        };
    },

    getOptimizationRequestParams: (showError, index) => {
        if (index == null || index == undefined) {
            index = '';
        }
        const request = new OptimizationRequest();

        const setFilters = Selectors.getSetFilters(index);
        const mainFilters = Selectors.getGearMainFilters(index);
        const excludeFilter = Selectors.getExcludeGearFrom(index);
        const enhanceLimit = Selectors.getEnhanceLimit(index);
        const setFormat = getSetFormat(setFilters.sets, showError);
        console.log("SETFORMAT", setFormat);

        request.inputSubstatMods   = readCheckbox('inputSubstatMods' + index);
        request.inputAllowLockedItems   = readCheckbox('inputAllowLockedItems' + index);
        request.inputAllowEquippedItems = readCheckbox('inputAllowEquippedItems' + index);
        request.inputOrderedHeroPriority   = readCheckbox('inputOrderedHeroPriority' + index);
        request.inputKeepCurrentItems   = readCheckbox('inputKeepCurrentItems' + index);
        request.inputOnlyMaxedGear   = readCheckbox('inputOnlyMaxedGear' + index);
        request.inputPredictReforges   = request.inputSubstatMods || readCheckbox('inputPredictReforges' + index);
        // request.inputOver85   = readCheckbox('inputOver85');
        // request.inputOnlyPlus15Gear   = readCheckbox('inputOnlyPlus15Gear');

        request.inputAtkMinLimit = readNumber('inputMinAtkLimit' + index);
        request.inputAtkMaxLimit = readNumber('inputMaxAtkLimit' + index);
        request.inputHpMinLimit  = readNumber('inputMinHpLimit' + index);
        request.inputHpMaxLimit  = readNumber('inputMaxHpLimit' + index);
        request.inputDefMinLimit = readNumber('inputMinDefLimit' + index);
        request.inputDefMaxLimit = readNumber('inputMaxDefLimit' + index);
        request.inputSpdMinLimit = readNumber('inputMinSpdLimit' + index);
        request.inputSpdMaxLimit = readNumber('inputMaxSpdLimit' + index);
        request.inputCrMinLimit  = readNumber('inputMinCrLimit' + index);
        request.inputCrMaxLimit  = readNumber('inputMaxCrLimit' + index);
        request.inputCdMinLimit  = readNumber('inputMinCdLimit' + index);
        request.inputCdMaxLimit  = readNumber('inputMaxCdLimit' + index);
        request.inputEffMinLimit = readNumber('inputMinEffLimit' + index);
        request.inputEffMaxLimit = readNumber('inputMaxEffLimit' + index);
        request.inputResMinLimit = readNumber('inputMinResLimit' + index);
        request.inputResMaxLimit = readNumber('inputMaxResLimit' + index);
        LimitConfiguration.setRequestFlags(request, index, isNumberInputConfigured);

        request.inputMinEhpLimit = readNumber('inputMinEhpLimit' + index);
        request.inputMaxEhpLimit = readNumber('inputMaxEhpLimit' + index);
        request.inputMinUpgradesLimit = readNumber('inputMinUpgradesLimit' + index);
        request.inputMaxUpgradesLimit = readNumber('inputMaxUpgradesLimit' + index);
        // 需更换件数过滤（后端字段名是 Equipped，不是 Eq）
        request.inputMinEquippedLimit = readNumber('inputMinEqLimit' + index);
        request.inputMaxEquippedLimit = readNumber('inputMaxEqLimit' + index);

        request.inputMinS1Limit = readNumber('inputMinS1Limit' + index);
        request.inputMaxS1Limit = readNumber('inputMaxS1Limit' + index);
        request.inputMinS2Limit = readNumber('inputMinS2Limit' + index);
        request.inputMaxS2Limit = readNumber('inputMaxS2Limit' + index);
        request.inputMinS3Limit = readNumber('inputMinS3Limit' + index);
        request.inputMaxS3Limit = readNumber('inputMaxS3Limit' + index);

        // request.inputAtkMinForce = readNumber('inputMinAtkForce');
        // request.inputAtkMaxForce = readNumber('inputMaxAtkForce');
        // request.inputAtkPercentMinForce = readNumber('inputMinAtkPercentForce');
        // request.inputAtkPercentMaxForce = readNumber('inputMaxAtkPercentForce');
        // request.inputSpdMinForce = readNumber('inputMinSpdForce');
        // request.inputSpdMaxForce = readNumber('inputMaxSpdForce');
        // request.inputCrMinForce = readNumber('inputMinCrForce');
        // request.inputCrMaxForce = readNumber('inputMaxCrForce');
        // request.inputCdMinForce = readNumber('inputMinCdForce');
        // request.inputCdMaxForce = readNumber('inputMaxCdForce');
        // request.inputHpMinForce = readNumber('inputMinHpForce');
        // request.inputHpMaxForce = readNumber('inputMaxHpForce');
        // request.inputHpPercentMinForce = readNumber('inputMinHpPercentForce');
        // request.inputHpPercentMaxForce = readNumber('inputMaxHpPercentForce');
        // request.inputDefMinForce = readNumber('inputMinDefForce');
        // request.inputDefMaxForce = readNumber('inputMaxDefForce');
        // request.inputDefPercentMinForce = readNumber('inputMinDefPercentForce');
        // request.inputDefPercentMaxForce = readNumber('inputMaxDefPercentForce');
        // request.inputEffMinForce = readNumber('inputMinEffForce');
        // request.inputEffMaxForce = readNumber('inputMaxEffForce');
        // request.inputResMinForce = readNumber('inputMinResForce');
        // request.inputResMaxForce = readNumber('inputMaxResForce');

        request.inputAtkPriority = readNumber('atkSlider' + index + 'Input');
        request.inputHpPriority = readNumber('hpSlider' + index + 'Input');
        request.inputDefPriority = readNumber('defSlider' + index + 'Input');
        request.inputSpdPriority = readNumber('spdSlider' + index + 'Input');
        request.inputCrPriority = readNumber('crSlider' + index + 'Input');
        request.inputCdPriority = readNumber('cdSlider' + index + 'Input');
        request.inputEffPriority = readNumber('effSlider' + index + 'Input');
        request.inputResPriority = readNumber('resSlider' + index + 'Input');
        request.inputFilterPriority = readNumber('filterSlider' + index + 'Input');

        const resultPriorityState = getResultPriorityState(index);
        request.resultPriority = resultPriorityState.order;
        request.resultDislike = resultPriorityState.disliked;

        // request.inputForceNumberSelect = readNumber('forceNumberSelect')

        request.inputSets = setFilters.sets;

        request.inputSetsOne = setFilters.sets[0];
        request.inputSetsTwo = setFilters.sets[1];
        request.inputSetsThree = setFilters.sets[2];
        request.inputExcludeSet = setFilters.exclude;

        request.inputNecklaceStat = mainFilters[0];
        request.inputRingStat = mainFilters[1];
        request.inputBootsStat = mainFilters[2];

        request.excludeFilter = excludeFilter;
        request.enhanceLimit = enhanceLimit;

        request.setFormat = setFormat;

        return request;
    },

    // The preview shows the hero's current numbers on both sides until a result row is
    // compared. Prefer the hero payload's (equipped) stats; baseStats is the bare fallback
    // for payloads whose stat fields are all zero.
    drawBaseStats: (heroResponse) => {
        const hero = heroResponse && heroResponse.hero;
        const baseStats = heroResponse && heroResponse.baseStats;
        const stats = (hero && (hero.atk || hero.hp || hero.def) ? hero : (baseStats || hero)) || null;
        if (!stats) return;

        const filled = Object.assign({ atk: 0, def: 0, hp: 0, spd: 0, cr: 0, cd: 0, eff: 0, res: 0, score: 0 }, stats);
        // 已装备的套装：before 一侧按装备列表统计（equipment），after 一侧用套装计数数组（sets）。
        // 后端返回的英雄 sets 恒为 null，用装备列表反推一份。
        if (hero && hero.equipment) filled.equipment = hero.equipment;
        if (hero && hero.sets) {
            filled.sets = hero.sets;
        } else if (hero && hero.equipment) {
            filled.sets = GridRenderer.setsCounterFromEquipment(hero.equipment);
        }
        StatPreview.draw(filled, filled);
    },

    loadPreviousHeroFilters: async (heroResponse, index, recalc) => {
        if (index == null || index == undefined) {
            index = '';
        }

        if (!heroResponse) {
            const heroId = document.getElementById('inputHeroAdd').value;
            heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
        }

        const hero = heroResponse.hero;
        const request = hero.optimizationRequest;

        if (index === '') {
            module.exports.drawBaseStats(heroResponse);
        }

        if (request) {
            setResultPriorityState(index, {
                order: request.resultPriority,
                disliked: request.resultDislike,
            });
        }

        if (!hero) return;
        if (!request) {
            setResultPriorityState(index, {});
            const optimizerSettings = Settings.getOptimizerOptions();

            $("#inputPredictReforges" + index).prop('checked', optimizerSettings.settingDefaultUseReforgedStats);
            $("#inputSubstatMods" + index).prop('checked', optimizerSettings.settingDefaultUseSubstatMods);
            $("#inputAllowLockedItems" + index).prop('checked', optimizerSettings.settingDefaultLockedItems);
            $("#inputAllowEquippedItems" + index).prop('checked', optimizerSettings.settingDefaultEquippedItems);
            $("#inputOrderedHeroPriority" + index).prop('checked', optimizerSettings.settingDefaultUseHeroPriority);
            $("#inputKeepCurrentItems" + index).prop('checked', optimizerSettings.settingDefaultKeepCurrent);
            return;
        }

        $("#inputMinAtkLimit" + index).val(LimitConfiguration.displayValue(request, 'inputAtkMinLimit', 'inputAtkMinConfigured', 0));
        $("#inputMaxAtkLimit" + index).val(LimitConfiguration.displayValue(request, 'inputAtkMaxLimit', 'inputAtkMaxConfigured', 2147483647));
        $("#inputMinHpLimit" + index).val(LimitConfiguration.displayValue(request, 'inputHpMinLimit', 'inputHpMinConfigured', 0));
        $("#inputMaxHpLimit" + index).val(LimitConfiguration.displayValue(request, 'inputHpMaxLimit', 'inputHpMaxConfigured', 2147483647));

        $("#inputMinDefLimit" + index).val(LimitConfiguration.displayValue(request, 'inputDefMinLimit', 'inputDefMinConfigured', 0));
        $("#inputMaxDefLimit" + index).val(LimitConfiguration.displayValue(request, 'inputDefMaxLimit', 'inputDefMaxConfigured', 2147483647));
        $("#inputMinSpdLimit" + index).val(LimitConfiguration.displayValue(request, 'inputSpdMinLimit', 'inputSpdMinConfigured', 0));
        $("#inputMaxSpdLimit" + index).val(LimitConfiguration.displayValue(request, 'inputSpdMaxLimit', 'inputSpdMaxConfigured', 2147483647));
        $("#inputMinCrLimit" + index).val(LimitConfiguration.displayValue(request, 'inputCrMinLimit', 'inputCrMinConfigured', 0));
        $("#inputMaxCrLimit" + index).val(LimitConfiguration.displayValue(request, 'inputCrMaxLimit', 'inputCrMaxConfigured', 2147483647));
        $("#inputMinCdLimit" + index).val(LimitConfiguration.displayValue(request, 'inputCdMinLimit', 'inputCdMinConfigured', 0));
        $("#inputMaxCdLimit" + index).val(LimitConfiguration.displayValue(request, 'inputCdMaxLimit', 'inputCdMaxConfigured', 2147483647));
        $("#inputMinEffLimit" + index).val(LimitConfiguration.displayValue(request, 'inputEffMinLimit', 'inputEffMinConfigured', 0));
        $("#inputMaxEffLimit" + index).val(LimitConfiguration.displayValue(request, 'inputEffMaxLimit', 'inputEffMaxConfigured', 2147483647));
        $("#inputMinResLimit" + index).val(LimitConfiguration.displayValue(request, 'inputResMinLimit', 'inputResMinConfigured', 0));
        $("#inputMaxResLimit" + index).val(LimitConfiguration.displayValue(request, 'inputResMaxLimit', 'inputResMaxConfigured', 2147483647));

        $("#inputMinEhpLimit" + index).val(inputDisplayNumber(request.inputMinEhpLimit));
        $("#inputMaxEhpLimit" + index).val(inputDisplayNumber(request.inputMaxEhpLimit));
        $("#inputMinUpgradesLimit" + index).val(inputDisplayNumber(request.inputMinUpgradesLimit));
        $("#inputMaxUpgradesLimit" + index).val(inputDisplayNumber(request.inputMaxUpgradesLimit));
        $("#inputMinEqLimit" + index).val(inputDisplayNumber(request.inputMinEquippedLimit));
        $("#inputMaxEqLimit" + index).val(inputDisplayNumber(request.inputMaxEquippedLimit));

        $("#inputMinS1Limit" + index).val(inputDisplayNumber(request.inputMinS1Limit));
        $("#inputMaxS1Limit" + index).val(inputDisplayNumber(request.inputMaxS1Limit));
        $("#inputMinS2Limit" + index).val(inputDisplayNumber(request.inputMinS2Limit));
        $("#inputMaxS2Limit" + index).val(inputDisplayNumber(request.inputMaxS2Limit));
        $("#inputMinS3Limit" + index).val(inputDisplayNumber(request.inputMinS3Limit));
        $("#inputMaxS3Limit" + index).val(inputDisplayNumber(request.inputMaxS3Limit));

        const optimizerSettings = Settings.getOptimizerOptions();

        $("#inputPredictReforges" + index).prop('checked',     isNullUndefined(request.inputPredictReforges)     ? optimizerSettings.settingDefaultUseReforgedStats : request.inputPredictReforges);
        $("#inputSubstatMods" + index).prop('checked',         isNullUndefined(request.inputSubstatMods)         ? optimizerSettings.settingDefaultUseSubstatMods   : request.inputSubstatMods);
        $("#inputAllowLockedItems" + index).prop('checked',    isNullUndefined(request.inputAllowLockedItems)    ? optimizerSettings.settingDefaultLockedItems      : request.inputAllowLockedItems);
        $("#inputAllowEquippedItems" + index).prop('checked',  isNullUndefined(request.inputAllowEquippedItems)  ? optimizerSettings.settingDefaultEquippedItems    : request.inputAllowEquippedItems);
        $("#inputKeepCurrentItems" + index).prop('checked',    isNullUndefined(request.inputKeepCurrentItems)    ? optimizerSettings.settingDefaultKeepCurrent      : request.inputKeepCurrentItems);
        $("#inputOrderedHeroPriority" + index).prop('checked', isNullUndefined(request.inputOrderedHeroPriority) ? optimizerSettings.settingDefaultUseHeroPriority  : request.inputOrderedHeroPriority);

        document.querySelector('#atkSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputAtkPriority)})
        document.querySelector('#atkSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputAtkPriority))

        document.querySelector('#hpSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputHpPriority)})
        document.querySelector('#hpSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputHpPriority))

        document.querySelector('#defSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputDefPriority)})
        document.querySelector('#defSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputDefPriority))

        document.querySelector('#spdSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputSpdPriority)})
        document.querySelector('#spdSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputSpdPriority))

        document.querySelector('#crSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputCrPriority)})
        document.querySelector('#crSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputCrPriority))

        document.querySelector('#cdSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputCdPriority)})
        document.querySelector('#cdSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputCdPriority))

        document.querySelector('#effSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputEffPriority)})
        document.querySelector('#effSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputEffPriority))

        document.querySelector('#resSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputResPriority)})
        document.querySelector('#resSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputResPriority))

        document.querySelector('#filterSlider' + index)['rangeslider-js'].update({value: inputDisplayNumberNumber(request.inputFilterPriority, 4)})
        document.querySelector('#filterSlider' + index + 'Input').setAttribute('value', inputDisplayNumberNumber(request.inputFilterPriority, 4))

        // $('#forceNumberSelect').val(inputDisplayNumberNumber(request.inputForceNumberSelect))

        Selectors.setGearMainAndSetsFromRequest(request, index);

        if (recalc) {
            recalculateFilters(null, heroResponse);
        }
        fixSliders(index)
        calculatePlaceholderRatings(index)
    },

    // True if blocking error
    warnParams: (params, overridePermutations) => {
        if (!params.resultPriority || params.resultPriority.length === 0) {
            Dialog.error('Please configure result priority before starting the search.');
            return true;
        }

        if (params.inputFilterPriority == 100
        &&  params.inputAtkPriority == 0
        &&  params.inputHpPriority == 0
        &&  params.inputDefPriority == 0
        &&  params.inputSpdPriority == 0
        &&  params.inputCrPriority == 0
        &&  params.inputCdPriority == 0
        &&  params.inputEffPriority == 0
        &&  params.inputResPriority == 0) {
            Notifier.info("No stat priority selected. For best results, use the stat priority filter.")
        } else if (params.inputFilterPriority == 100) {
            Dialog.error("Stat priority was selected but the filter is set to Top 100%. The stat priority filter is only useful when the % is not 100.")
            return true;
        } else if (params.inputFilterPriority != 100
        &&  params.inputAtkPriority == 0
        &&  params.inputHpPriority == 0
        &&  params.inputDefPriority == 0
        &&  params.inputSpdPriority == 0
        &&  params.inputCrPriority == 0
        &&  params.inputCdPriority == 0
        &&  params.inputEffPriority == 0
        &&  params.inputResPriority == 0) {
            Dialog.error("Top % was selected but no stat priorities are assigned. Assign stat priorities otherwise the filter will not work.")
            return true;
        }

        if (params.inputSetsOne && params.inputSetsOne.length == 0) {
            Notifier.info("No sets were selected. For best results, select at least one set.")
        }

        if (params.inputDefMinLimit > 10000) {
            Dialog.error("Your minimum defense filter is over 10,000, did you mean HP?");
            return true;
        }

        if (params.inputNecklaceStat && params.inputNecklaceStat.length == 0
        &&  params.inputRingStat && params.inputRingStat.length == 0
        &&  params.inputBootsStat && params.inputBootsStat.length == 0) {
            Notifier.warn("No accessory main stats were selected. For best results, use the main stat filter to narrow down the search.")
        }

        // if ((overridePermutations ? overridePermutations : permutations) >= 5_000_000_000) {
        //     Notifier.info("Over 5 billion permutations selected. For faster results, try applying stricter filters or using a lower Top N%.")
        // }
        return false;
    },

    drawPreview: (gearIds, mods) => {
        console.log("Draw preview", gearIds, mods)

        const moddedGear = ModificationFilter.getModsByIds(gearIds, mods);
        console.log("Modded gear results", moddedGear)

        Api.getItemsByIds(gearIds).then(async (response) => {
            const selectedGear = response.items;

            const heroId = document.getElementById('inputHeroAdd').value;
            const getHeroByIdResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
            const hero = getHeroByIdResponse.hero;
            const baseStats = getHeroByIdResponse.baseStats;

            if (!hero || !baseStats) return;

            for (var i = 0; i < 6; i++) {
                if (moddedGear[i]) {
                    var equippedById = selectedGear[i].equippedById;
                    var equippedByName = selectedGear[i].equippedByName;

                    selectedGear[i] = moddedGear[i];
                    selectedGear[i].equippedById = equippedById;
                    selectedGear[i].equippedByName = equippedByName;
                    selectedGear[i].substats = moddedGear[i].substats;
                    for (var j = 0; j < selectedGear[i].substats.length; j++) {
                        selectedGear[i].substats[j].modified = moddedGear[i].substats[j].modified;
                        selectedGear[i].substats[j].value = moddedGear[i].substats[j].value;
                        selectedGear[i].substats[j].reforgedValue = moddedGear[i].substats[j].reforgedValue;
                        selectedGear[i].substats[j].reforged = true;
                    }

                }
            }

            document.getElementById('optimizer-heroes-equipped-weapon').innerHTML = HtmlGenerator.buildItemPanel(selectedGear[0], "optimizerGrid", baseStats);
            document.getElementById('optimizer-heroes-equipped-helmet').innerHTML = HtmlGenerator.buildItemPanel(selectedGear[1], "optimizerGrid", baseStats);
            document.getElementById('optimizer-heroes-equipped-armor').innerHTML = HtmlGenerator.buildItemPanel(selectedGear[2], "optimizerGrid", baseStats);
            document.getElementById('optimizer-heroes-equipped-necklace').innerHTML = HtmlGenerator.buildItemPanel(selectedGear[3], "optimizerGrid", baseStats);
            document.getElementById('optimizer-heroes-equipped-ring').innerHTML = HtmlGenerator.buildItemPanel(selectedGear[4], "optimizerGrid", baseStats);
            document.getElementById('optimizer-heroes-equipped-boots').innerHTML = HtmlGenerator.buildItemPanel(selectedGear[5], "optimizerGrid", baseStats);
        })
    },

    // 把英雄当前穿着的 6 件装备画到底部那排卡片上。
    // 切英雄 / 从英雄页双击过来时之前没人调用 drawPreview，卡片会停在上一个英雄，
    // 要等到点结果表第一行才刷新。
    drawEquippedGear: (hero) => {
        const slots = ['weapon', 'helmet', 'armor', 'necklace', 'ring', 'boots'];
        const gearNames = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

        const clearCards = () => {
            slots.forEach((slot) => {
                document.getElementById('optimizer-heroes-equipped-' + slot).innerHTML = '';
            });
        };

        const equipment = hero && hero.equipment;
        if (!equipment) {
            clearCards();
            return;
        }

        const gearIds = gearNames.map((gear) => (equipment[gear] ? equipment[gear].id : undefined));
        if (gearIds.some((id) => !id)) {
            // 有空槽位时 drawPreview 会把 null 一起发给后端，先清空，避免显示上一个英雄的装备
            clearCards();
            return;
        }

        module.exports.drawPreview(gearIds, []);
    },

    editGearFromIcon: (id, reforge) => {
        editGearFromIcon(id, reforge);
    },

    lockGearFromIcon: (id) => {
        lockGearFromIcon(id);
    },

    getCurrentExecutionId: () => {
        return currentExecutionId;
    },

    redrawHeroSelector: async () => {
        const getAllHeroesResponse = await Api.getAllHeroes();
        const selectedId = $( "#inputHeroAdd option:selected" ).val()

        clearHeroOptions("inputHeroAdd");
        clearHeroOptions("optionsExcludeGearFrom");
        const optimizerHeroSelector = document.getElementById('inputHeroAdd')
        const optimizerAllowGearFromSelector = document.getElementById('optionsExcludeGearFrom')
        const heroes = getAllHeroesResponse.heroes;
        // 按角色条目的「优先度」排（index 就是英雄列表 rank 列的值），
        // 配装器的排除下拉框按 #N 找起来更顺手；左侧英雄选择器也跟着这个顺序走。
        // 缺 index 的兜底到最大排最后，避免 undefined 比较出乱序。
        heroes.sort(
            (a, b) =>
                (Number(a.index) || Number.MAX_SAFE_INTEGER) -
                (Number(b.index) || Number.MAX_SAFE_INTEGER)
        );
        console.log("getAllHeroesResponse", getAllHeroesResponse)
        for (var hero of heroes) {
            const option = document.createElement('option');
            const option2 = document.createElement('option');
            // 左侧英雄选择器 / 排除下拉框都显示成「英雄名 #优先度」，
            // 方便按 rank 列的值找到目标条目；option.label 仍存英雄名：
            // redrawHeroImage() 是按 label 取名字的
            option.innerHTML = heroOptionText(hero);
            option.label = hero.name;
            option.value = hero.id;
            // 排除下拉框同样显示「英雄名 #优先度」，两个下拉口径一致；
            // option.label 仍存英雄名：redrawHeroImage() 是按 label 取名字的
            option2.innerHTML = heroOptionText(hero);
            option2.label = hero.name;
            option2.value = hero.id;

            optimizerHeroSelector.add(option);
            optimizerAllowGearFromSelector.add(option2);

            if (selectedId && selectedId == hero.id) {
                optimizerHeroSelector.value = selectedId
                // 列表接口返回的 Hero 已经带好实时数值和 equipment（后端会 addStatsToHero），
                // 直接用即可；缺的 sets 由 setPinnedHero 用 equipment 反推
                OptimizerGrid.setPinnedHero(hero);
                // 底部 6 件装备的卡片跟着当前英雄刷新
                module.exports.drawEquippedGear(hero);
            }
        }
        redrawHeroImage();
        recalculateFilters();
        Selectors.refreshInputHeroAdd();
        Selectors.refreshAllowGearFrom();
    },


    showSkillOptionsWindow: async (heroId) => {
        // showEditHeroInfoPopups(row.name)
        const skillOptions = await Dialog.changeSkillOptionsDialog(heroId);

        if (!skillOptions) {
            return;
        }

        console.warn("skillOptions", skillOptions)

        Api.setSkillOptions(skillOptions, heroId)
        Notifier.success("Saved skill options");
        Saves.autoSave();
    }
}

function clearSubstatPriority() {
    document.querySelector('#atkSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#atkSliderInput').setAttribute('value', 0)

    document.querySelector('#hpSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#hpSliderInput').setAttribute('value', 0)

    document.querySelector('#defSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#defSliderInput').setAttribute('value', 0)

    document.querySelector('#spdSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#spdSliderInput').setAttribute('value', 0)

    document.querySelector('#crSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#crSliderInput').setAttribute('value', 0)

    document.querySelector('#cdSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#cdSliderInput').setAttribute('value', 0)

    document.querySelector('#effSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#effSliderInput').setAttribute('value', 0)

    document.querySelector('#resSlider')['rangeslider-js'].update({value: 0})
    document.querySelector('#resSliderInput').setAttribute('value', 0)

    document.querySelector('#filterSlider')['rangeslider-js'].update({value: 4})
    document.querySelector('#filterSliderInput').setAttribute('value', 4)
}

function clearStats() {
    $(".stat-number-input").val("")
    calculatePlaceholderRatings();
}

function clearOptions() {
    const optimizerSettings = Settings.getOptimizerOptions();

    $("#inputPredictReforges").prop('checked', optimizerSettings.settingDefaultUseReforgedStats);
    $("#inputSubstatMods").prop('checked', optimizerSettings.settingDefaultUseSubstatMods);
    $("#inputAllowLockedItems").prop('checked', optimizerSettings.settingDefaultLockedItems);
    $("#inputAllowEquippedItems").prop('checked', optimizerSettings.settingDefaultEquippedItems);
    $("#inputOrderedHeroPriority").prop('checked', optimizerSettings.settingDefaultUseHeroPriority);
    $("#inputKeepCurrentItems").prop('checked', optimizerSettings.settingDefaultKeepCurrent);
}

async function editGearFromIcon(id, reforge) {
    const result = await Api.getItemById(id);
    console.log("a1", result.item);
    const editedItem = await Dialog.editGearDialog(result.item, true, reforge);

    ItemAugmenter.augment([editedItem])
    await Api.editItems([editedItem]);
    Notifier.quick("Edited item");
    await ItemsGrid.editedItem();

    ItemsTab.redraw(editedItem);
    drawPreview();
    Saves.autoSave();
    HeroesGrid.redrawPreview();
    HeroesGrid.refresh();
}

async function lockGearFromIcon(id) {
    const result = await Api.getItemById(id);
    console.log(result.item);

    if (result.item.locked) {
        await Api.unlockItems([id])
        Notifier.quick("Unlocked item");
    } else {
        await Api.lockItems([id])
        Notifier.quick("Locked item");
    }


    ItemsTab.redraw(result.item);
    drawPreview();
    Saves.autoSave();
    HeroesGrid.redrawPreview();
}

async function redrawHeroImage() {
    const name = $( "#inputHeroAdd option:selected" ).attr("label")
    const id = $( "#inputHeroAdd option:selected" ).attr('value')
    if (!name || name.length == 0) {
        $('#inputHeroImage').attr("src", Assets.getBlank());
        return;
    }


    const data = HeroData.getHeroExtraInfo(name);
    const image = DataLoader.getHeroImagePath(data.assets.thumbnail);
    $('#inputHeroImage').attr("src", image);


    const heroResponse = await Api.getHeroById(id, $('#inputPredictReforges').prop('checked'));
    const hero = heroResponse.hero;
    const artifact = hero.artifactName
    const artifactData = HeroData.getArtifactByName(artifact)

    if (artifactData) {
        // 使用 dataLoader.js 的方法获取神器图片路径
        const artiUrl = await DataLoader.getArtifactImagePath(artifactData);
        const artiHighUrl = DataLoader.getHighResImagePath(artiUrl);
        const artifactImage = $('#inputArtifactImage');

        artifactImage.attr("src", artiUrl);
        // 预览是 64px（style.css: .inputArtifactImage），高分屏用 96px 副本
        if (artiHighUrl) {
            artifactImage.attr("srcset", `${artiUrl} 64w, ${artiHighUrl} 96w`);
            artifactImage.attr("sizes", "64px");
        } else {
            artifactImage.removeAttr("srcset");
            artifactImage.removeAttr("sizes");
        }
    } else {
        $('#inputArtifactImage').attr("src", Assets.getBlank());
    }
    const imprintType = data.self_devotion.type;

    const isFlat = imprintType == "max_hp" || imprintType == "att" || imprintType == "def"

    const imprintNumber = isFlat ? parseInt(hero.imprintNumber) : Utils.round100ths(parseFloat(hero.imprintNumber)/100)
    const imprintMatch = Object.entries(data.self_devotion.grades).filter(x => (isFlat ? parseInt(x[1]) : Utils.round100ths(x[1])) == imprintNumber)
    if (imprintMatch.length > 0) {
        $('#inputImprintImage').attr("src", `./assets/imprint${imprintMatch[0][0]}.png`);
    } else {
        $('#inputImprintImage').attr("src", Assets.getBlank());
    }
}

function clearHeroOptions(id) {
    var select = document.getElementById(id);
    var length = select.options.length;
    for (i = length-1; i >= 0; i--) {
      select.options[i] = null;
    }
}

/**
 * 「排除已穿上的装备」下拉的显示文案：英雄名 + 英雄列表里的排名。
 * 同一个角色可以有多条条目，只显示名字根本分不清是哪一条（下拉里的 value 是 hero.id）。
 */
function heroOptionText(hero) {
    const name = i18next.t(hero.name);
    const rank = Number(hero.index);
    return Number.isFinite(rank) ? `${name} #${rank}` : name;
}

function setSort4Piece(sets, arr) {
    arr.sort((a, b) => {
        if (sets.includes(a.set)) {
            return -1;
        }
        if (sets.includes(b.set)) {
            return 1;
        }
        return 0;
    })
}

async function recalculateFilters(e, heroResponse) {
    // Selects fire twice, we should only calculate once
    if (e && e.target.className.includes("offscreen")) {
        return;
    }

    const heroId = document.getElementById('inputHeroAdd').value;
    if (!heroId || heroId.length == 0) {
        return;
    }

    const params = module.exports.getOptimizationRequestParams();

    if (!heroResponse) {
        heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
    }

    const allItemsResponse = await Api.getAllItems();

    module.exports.applyItemFilters(params, heroResponse, allItemsResponse, false).then(result => {
        var items = result.items;
        var allItems = result.allItems;
        var dominanceRemovedCounts = result.dominanceRemovedCounts;

        const weapons = items.filter(x => x.gear == "Weapon");
        const helmets = items.filter(x => x.gear == "Helmet");
        const armors = items.filter(x => x.gear == "Armor");
        const necklaces = items.filter(x => x.gear == "Necklace");
        const rings = items.filter(x => x.gear == "Ring");
        const boots = items.filter(x => x.gear == "Boots");

        const allWeapons = allItems.filter(x => x.gear == "Weapon");
        const allHelmets = allItems.filter(x => x.gear == "Helmet");
        const allArmors = allItems.filter(x => x.gear == "Armor");
        const allNecklaces = allItems.filter(x => x.gear == "Necklace");
        const allRings = allItems.filter(x => x.gear == "Ring");
        const allBoots = allItems.filter(x => x.gear == "Boots");

        permutations = weapons.length
                * helmets.length
                * armors.length
                * necklaces.length
                * rings.length
                * boots.length;

        const weaponsPercent = Math.round(weapons.length / (allWeapons.length || 1) * 100);
        const helmetsPercent = Math.round(helmets.length / (allHelmets.length || 1) * 100);
        const armorsPercent = Math.round(armors.length / (allArmors.length || 1) * 100);
        const necklacesPercent = Math.round(necklaces.length / (allNecklaces.length || 1) * 100);
        const ringsPercent = Math.round(rings.length / (allRings.length || 1) * 100);
        const bootsPercent = Math.round(boots.length / (allBoots.length || 1) * 100);

        $('#maxPermutationsNum').text(Number(permutations).toLocaleString());
        $('#filteredWeaponsNum').text(formatFilteredGearCount(weapons.length, dominanceRemovedCounts.Weapon, allWeapons.length, weaponsPercent));
        $('#filteredHelmetsNum').text(formatFilteredGearCount(helmets.length, dominanceRemovedCounts.Helmet, allHelmets.length, helmetsPercent));
        $('#filteredArmorsNum').text(formatFilteredGearCount(armors.length, dominanceRemovedCounts.Armor, allArmors.length, armorsPercent));
        $('#filteredNecklacesNum').text(formatFilteredGearCount(necklaces.length, dominanceRemovedCounts.Necklace, allNecklaces.length, necklacesPercent));
        $('#filteredRingsNum').text(formatFilteredGearCount(rings.length, dominanceRemovedCounts.Ring, allRings.length, ringsPercent));
        $('#filteredBootsNum').text(formatFilteredGearCount(boots.length, dominanceRemovedCounts.Boots, allBoots.length, bootsPercent));
    });
}

function getSelectedHeroId() {
    return document.getElementById('inputHeroAdd').value;
}

function filterSelectedGearByCheckbox(selectedGear) {
    // 配装器下面 6 张卡已经没有勾选框：装备 / 脱下 / 存配装等操作作用于全部 6 件
    return selectedGear.filter(x => !!x);
}

async function addBuild() {
    const row = OptimizerGrid.getSelectedRow()
    const node = OptimizerGrid.getSelectedNode()
    const selectedGear = filterSelectedGearByCheckbox(OptimizerGrid.getSelectedGearIds());
    if (!selectedGear.length || selectedGear.includes(undefined) || selectedGear.includes(null)) {
        return;
    }

    const rowId = row.id;
    const heroId = getSelectedHeroId();

    const hero = (await Api.getHeroById(heroId)).hero;

    console.log("ADD BUILD", row)

    if (row.mods.filter(x => x).length > 0) {
        row.name = "MOD: " + (!hero.modGrade ? "" : (hero.modGrade == "greater" ? "Greater" : "Lesser")) + " " + (hero.rollQuality || "0") + "%";
    }

    await Api.addBuild(heroId, row);
    await Api.editResultRows(parseInt(rowId), "star", currentExecutionId);

    row.property = "star";
    node.updateData(row);


    drawPreview()
    Saves.autoSave();
}

async function removeBuild() {
    const row = OptimizerGrid.getSelectedRow()
    const node = OptimizerGrid.getSelectedNode()
    const selectedGear = filterSelectedGearByCheckbox(OptimizerGrid.getSelectedGearIds());
    if (!row) return;
    if (selectedGear.length == 0) return;

    const rowId = row.id;

    const heroId = getSelectedHeroId();

    console.log("REMOVE BUILD", row)

    await Api.removeBuild(heroId, row);
    await Api.editResultRows(parseInt(rowId), "not star", currentExecutionId);

    row.property = "not star";
    node.updateData(row);

    drawPreview()
    Saves.autoSave();
}

async function equipSelectedGear() {
    const selectedGear = filterSelectedGearByCheckbox(OptimizerGrid.getSelectedGearIds());
    if (selectedGear.length == 0) return;
    if (selectedGear.includes(undefined) || selectedGear.includes(null)) {
        return;
    }
    const heroId = getSelectedHeroId();

    const heroResult = await Api.equipItemsOnHero(heroId, selectedGear, $('#inputPredictReforges').prop('checked'));
    const hero = heroResult.hero;

    const row = OptimizerGrid.getSelectedRow()
    const node = OptimizerGrid.getSelectedNode()
    const rowId = row.id;


    if (row.mods.filter(x => x).length > 0) {
        row.name = "MOD: " + (!hero.modGrade ? "" : (hero.modGrade == "greater" ? "Greater" : "Lesser")) + " " + (hero.rollQuality || "0") + "%";
    }

    await Api.addBuild(heroId, row);
    await Api.editResultRows(parseInt(rowId), "star", currentExecutionId);

    row.property = "star";
    node.updateData(row);

    OptimizerGrid.setPinnedHero(hero);
    drawPreview()
    Saves.autoSave();
}

async function unequipSelectedGear() {
    const selectedGear = filterSelectedGearByCheckbox(OptimizerGrid.getSelectedGearIds());
    if (selectedGear.length == 0) return;

    const heroId = getSelectedHeroId();

    await Api.unequipItems(selectedGear);

    const heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
    const hero = heroResponse.hero;

    OptimizerGrid.setPinnedHero(hero);

    drawPreview()
    Saves.autoSave();
}

async function submitOptimizationFilterRequest() {
    const params = module.exports.getOptimizationRequestParams();
    getSetFormat(params.inputSets, true);
    if (module.exports.warnParams(params)) {
        return;
    }

    const heroId = document.getElementById('inputHeroAdd').value;
    const heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
    params.hero = heroResponse.hero;
    params.hero.artifactAttack = 0;
    params.hero.artifactHealth = 0;
    params.hero.artifactDefense = 0;
    if (params.hero.artifactName && params.hero.artifactName != "None") {
        const artifactLevelText = params.hero.artifactLevel;
        if (artifactLevelText != "None") {
            const artifactLevel = parseInt(artifactLevelText);
            const artifactStats = Artifact.getStats(params.hero.artifactName, artifactLevel);

            params.hero.artifactHealth += artifactStats.health;
            params.hero.artifactAttack += artifactStats.attack;
            params.hero.artifactDefense += artifactStats.defense;
        }
    }

    OptimizerGrid.showLoadingOverlay();
    params.executionId = currentExecutionId;

    Api.submitOptimizationFilterRequest(params).then(response => {
        console.warn("Optimization filter response", response);
        OptimizerGrid.reloadData();
    });
}

/* ---------------- 开始 / 取消 合并成一个按钮 ---------------- */

/** 切换「开始 / 取消」按钮的文案和状态 */
function setOptimizationRunning(running) {
    optimizationRunning = running;

    const button = document.getElementById('submitOptimizerRequest');
    if (!button) {
        return;
    }

    // 只改 value 属性（property）：data-t 的翻译读的是 value 特性，不去动它
    button.value = i18next.t(running ? 'Cancel' : 'Start');
}

/** 点「取消」：停进度轮询 + 通知后端取消，按钮立刻变回「开始」 */
function cancelOptimizationRequest() {
    if (progressTimer) {
        clearInterval(progressTimer);
    }

    Api.cancelOptimizationRequest();
    setOptimizationRunning(false);
}

/** 一键换装按钮的文案：空闲=一键换装，运行中=中断操作，请求中断后=正在中断 */
function updateOneClickEquipButton() {
    const button = document.getElementById('optimizerOneClickEquip');
    if (!button) {
        return;
    }

    const state = EmulatorEquip.getState
        ? EmulatorEquip.getState()
        : { busy: false, stopping: false, cooldown: false };

    if (state.stopping) {
        button.value = i18next.t('Stopping...');
        button.disabled = true;
        button.style.opacity = '0.6';
        return;
    }

    button.disabled = !state.busy && state.cooldown;
    button.style.opacity = button.disabled ? '0.6' : '';
    button.value = i18next.t(state.busy ? 'Cancel operation' : 'One-Click Equip');
}

async function submitOptimizationRequest() {
    recalculateFilters();

    const inProgressResponse = await Api.getOptimizationInProgress();
    if (inProgressResponse.inProgress) {
        Notifier.warn("Optimization already in progress. Please cancel before starting a new search.")
        return;
    }

    // console.log(ItemSerializer.serializeToArr(getAllItemsResponse.items));
    const params = module.exports.getOptimizationRequestParams(true);
    if (!params.resultPriority || params.resultPriority.length === 0) {
        Dialog.error('Please configure result priority before starting the search.');
        return;
    }

    const heroId = document.getElementById('inputHeroAdd').value;

    const allItemsResponse = await Api.getAllItems();
    const heroResponse = await Api.getHeroById(heroId, $('#inputPredictReforges').prop('checked'));
    const hero = heroResponse.hero;
    const baseStats = heroResponse.baseStats;


    var filterResult = await module.exports.applyItemFilters(params, heroResponse, allItemsResponse, true);
    var items = filterResult.items;

    console.log("OPTIMIZING HERO", hero);

    OptimizerGrid.setPinnedHero(hero);
    const request = {
        base: baseStats,
        requestType: "OptimizationRequest",
        items: items,
        bonusHp: hero.bonusHp,
        bonusAtk: hero.bonusAtk,
        hero: hero,
        damageMultipliers: DamageCalc.getMultipliers(hero, hero.skillOptions)
    }

    request.hero.artifactAttack = 0;
    request.hero.artifactHealth = 0;
    request.hero.artifactDefense = 0;
    if (request.hero.artifactName && request.hero.artifactName != "None") {
        const artifactLevelText = request.hero.artifactLevel;
        if (artifactLevelText != "None") {
            const artifactLevel = parseInt(artifactLevelText);
            const artifactStats = Artifact.getStats(request.hero.artifactName, artifactLevel);

            request.hero.artifactHealth = artifactStats.health;
            request.hero.artifactAttack = artifactStats.attack;
            request.hero.artifactDefense = artifactStats.defense;
        }
    }

    if (!hero.artifactName || hero.artifactName == "None") {
        Notifier.warn("Your hero does not have an artifact equipped, use the 'Add Bonus Stats' button on the Heroes page to add artifact stats");
    }

    if (module.exports.warnParams(params)) {
        return;
    }

    const mergedRequest = Object.assign(request, params, baseStats);
    const str = JSON.stringify(mergedRequest);

    console.log("Sending request:", mergedRequest)
    OptimizerGrid.showLoadingOverlay();
    // Subprocess.sendString(str)
    if (progressTimer) {
        clearInterval(progressTimer)
    }
    progressTimer = setInterval(updateProgress, 200)

    await Api.deleteExecution(currentExecutionId);
    currentExecutionId = await Api.prepareExecution();
    mergedRequest.executionId = currentExecutionId;

    setOptimizationRunning(true);

    const results = Api.submitOptimizationRequest(mergedRequest).then(result => {
        console.log("RESPONSE RECEIVED", result);
        if (progressTimer) {
            clearInterval(progressTimer)
        }
        // $('#estimatedPermutations').text(Number(permutations).toLocaleString());
        var searchedCount = result.searched;
        var resultsCounter = result.results;
        var retainedCounter = result.retained == undefined ? result.results : result.retained;

        var searchedStr = Number(searchedCount).toLocaleString();
        var resultsStr = Number(resultsCounter).toLocaleString();

        if (result.retained != undefined && resultsCounter > retainedCounter) {
            Dialog.info(i18next.t('Search completed. Retained the best {{retained}} results out of {{total}} matching builds.', {
                retained: Number(retainedCounter).toLocaleString(),
                total: resultsStr,
            }));
        } else {
            $('#maxPermutationsNum').text(searchedStr);
        }

        $('#searchedPermutationsNum').text(searchedStr);
        $('#resultsFoundNum').text(resultsStr);
        OptimizerGrid.reloadData();
        console.log("REFRESHED");
    }).catch((error) => {
        // 取消 / 出错：Api 那边已经弹过提示，这里只负责把按钮恢复
        console.warn('[optimizer] search ended with error', error);
    }).finally(() => {
        // 搜索结束（正常完成 / 取消 / 出错）后，按钮变回「开始」
        setOptimizationRunning(false);
    });

    return results;
}

function updateProgress() {
    Api.getOptimizationProgress().then(result => {
        var searchedCount = result.searched;
        var resultsCounter = result.results;

        var searchedStr = Number(searchedCount).toLocaleString();
        var resultsStr = Number(resultsCounter).toLocaleString();

        $('#searchedPermutationsNum').text(searchedStr);
        $('#resultsFoundNum').text(resultsStr);
    })
}

async function drawPreview() {
    const selectedGear = OptimizerGrid.getSelectedGearIds();
    const selectedMods = OptimizerGrid.getSelectedGearMods();
    module.exports.drawPreview(selectedGear, selectedMods);
}

const fourPieceSets = [
    "AttackSet", "SpeedSet", "DestructionSet", "LifestealSet", "ProtectionSet", "CounterSet",  "RageSet", "RevengeSet", "InjurySet", "ReversalSet", "RiposteSet", "WarfareSet", "WeakeningSet"
]

const twoPieceSets = [
    "HealthSet", "DefenseSet", "CriticalSet", "HitSet", "ResistSet", "UnitySet", "ImmunitySet", "PenetrationSet", "TorrentSet", "PursuitSet", "FervorSet"
]

function isFourAndTwoPieceSets(sets) {
    return hasFourPieceSet(sets[0]) && (hasTwoPieceSet(sets[1]) || hasTwoPieceSet(sets[2]))
}
function isTwoAndTwoAndTwoPieceSets(sets) {
    return hasTwoPieceSet(sets[0]) && hasTwoPieceSet(sets[1]) && hasTwoPieceSet(sets[2]);
}
function hasFourPieceSet(set) {
    return set.filter(x => fourPieceSets.includes(x)).length > 0;
}
function hasTwoPieceSet(set) {
    return set.filter(x => twoPieceSets.includes(x)).length > 0;
}

function readNumber(id) {
    const element = document.getElementById(id);
    // 面板可能已经删掉了对应的输入框（比如技能伤害过滤），返回 undefined 让后端用默认值
    if (!element) {
        return undefined;
    }

    var possibleNaN = parseInt(element.value);

    return isNaN(possibleNaN) ? undefined : possibleNaN;
}

function isNumberInputConfigured(id) {
    const value = document.getElementById(id).value;
    return value != null && value.trim() != '' && !isNaN(parseInt(value));
}

function readCheckbox(id) {
    var boolean = document.getElementById(id).checked;

    return boolean === true ? true : false;
}

function getSetFormat(sets, showError) {
    if (sets[0].length == 0) {
        if (sets[1].length > 0) {
            if (showError) Dialog.error("Invalid sets, fill in the set filters from top to bottom.");
            throw 'Invalid Sets'
        }
        if (sets[2].length > 0) {
            if (showError) Dialog.error("Invalid sets, fill in the set filters from top to bottom.");
            throw 'Invalid Sets'
        }
        return 0;
    }
    if (hasFourPieceSet(sets[0])) {
        if (hasTwoPieceSet(sets[0])) {
            if (showError) Dialog.error("Invalid sets, the first set filter must be either all 4 piece or all 2 piece sets.");
            throw 'Invalid Sets'
        }
        if (hasTwoPieceSet(sets[2])) {
            if (showError) Dialog.error("Invalid sets, fill in the set filters from top to bottom.");
            throw 'Invalid Sets'
        }
        if (sets[1].length > 0) {
            return 1;
        }
        return 2
    }
    if (hasTwoPieceSet(sets[0])) {
        if (sets[1].length > 0) {
            if (sets[2].length > 0) {
                return 5;
            }
            return 4;
        }
        if (sets[2].length > 0) {
            if (showError) Dialog.error("Invalid sets, fill in the set filters from top to bottom.");
            throw 'Invalid Sets'
        }
        return 3;
    }
}
