var echarts = require('echarts');

barsCharts = [undefined, undefined, undefined, undefined];
scoreRadar = undefined;

/*
 * 评分雷达图：12 轴（一速/速度/输出/必爆输出/半肉/白字半肉/血防半肉/抗性坦/命中坦/纯肉坦/双效/未来可期）
 * 轴上限固定（见 gearScoreTable.js 的 RADAR_AXES），所以不同装备之间可以直接比
 */
function drawScoreRadar(item) {
    if (!item || !global.GearScoreTable || !scoreRadar) return;

    const profile = GearScoreTable.scoreItem(item);
    const axes = GearScoreTable.RADAR_AXES;
    const textColor = DarkMode.isDark() ? '#e2e2e2' : '#363636';
    const lineColor = DarkMode.isDark() ? '#7cc4ff' : '#1e90ff';
    const gridColor = DarkMode.isDark() ? '#3a3f45' : '#e0e0e0';

    /*
     * 外圈 = 装等 70 分（毕业线），超过的分数要画到圈外：
     * 直接按比例画会远远飞出画布（有的类别能到 5~6 倍），所以超出部分用开立方压缩，
     * 保证形状明显突出外圈又不会跑到画布外面；点上的标签始终显示真实分值。
     */
    const values = axes.map((axis) => {
        const score = profile[axis.key] || 0;
        const max = axis.max || 10;
        if (score <= max) return score;
        return max * Math.cbrt(score / max);
    });

    scoreRadar.setOption({
        tooltip: {
            trigger: 'item',
            // 悬浮提示里也统一 1 位小数
            formatter: () => axes
                .map((axis) => `${axis.label}: ${Number(profile[axis.key] || 0).toFixed(2)}`)
                .join('<br/>'),
        },
        radar: {
            indicator: axes.map((axis) => ({ name: axis.label, max: axis.max || 10 })),
            // 外圈只占一半左右，给「超出毕业线」的部分留出画布空间
            radius: '46%',
            center: ['50%', '50%'],
            axisName: { color: textColor, fontSize: 12 },
            axisLabel: { show: false },
            splitNumber: 4,
            splitLine: { lineStyle: { color: gridColor } },
            axisLine: { lineStyle: { color: gridColor } },
            splitArea: { show: false },
        },
        series: [{
            type: 'radar',
            symbolSize: 5,
            data: [{
                value: values,
                name: i18next.t('Gear scores'),
                areaStyle: { opacity: 0.3 },
                lineStyle: { color: lineColor, width: 2 },
                itemStyle: { color: lineColor },
                label: {
                    show: true,
                    fontSize: 11,
                    color: textColor,
                    // 显示真实分值（不受超圈压缩影响），统一保留 2 位小数
                    formatter: (params) => {
                        const axis = axes[params.dimIndex];
                        const real = Number(axis ? profile[axis.key] : params.value) || 0;
                        return real > 0 ? real.toFixed(2) : '';
                    },
                },
            }],
        }],
    }, true);
}

const maxes = {
    "Attack": 346 * 1.5,
    "AttackPercent": 56,
    "Defense": 264 * 1.5,
    "DefensePercent": 56,
    "Health": 1551 * 1.5,
    "HealthPercent": 56,
    "Speed": 28,
    "CriticalHitChancePercent": 36,
    "CriticalHitDamagePercent": 49,
    "EffectivenessPercent": 56,
    "EffectResistancePercent": 56,
}

const substatWeights = {
    "AttackPercent": 1,
    "DefensePercent": 1,
    "HealthPercent": 1,
    "EffectivenessPercent": 1,
    "EffectResistancePercent": 1,
    "Attack": (3.46 / 39),
    "Health": (3.09 / 174),
    "Defense": (4.99 / 31),
    "CriticalHitDamagePercent": (8/7),
    "CriticalHitChancePercent": (8/5),
    "Speed": (8/4),
}

const statToReadableText = {
    "Attack": "Attack",
    "AttackPercent": "Attack %",
    "Defense": "Defense",
    "DefensePercent": "Defense %",
    "Health": "Health",
    "HealthPercent": "Health %",
    "Speed": "Speed",
    "CriticalHitChancePercent": "Crit Chance",
    "CriticalHitDamagePercent": "Crit Dmg",
    "EffectivenessPercent": "Eff",
    "EffectResistancePercent": "Eff Res"
}

function calculateScoreTotals(item) {
    var totalMin = 0;
    var totalRolled = 0;
    var totalMissing = 0;

    for (substat of item.substats) {
        var stat = substat;

        var min = Math.floor(stat.reforgedMin);
        var rolled = (item.level == 85 ? stat.reforgedValue : stat.value) - Math.floor(stat.reforgedMin);
        var missing = Math.floor(stat.reforgedMax) - (item.level == 85 ? stat.reforgedValue : stat.value);

        totalMin += min * substatWeights[substat.type];
        totalRolled += rolled * substatWeights[substat.type];
        totalMissing += missing * substatWeights[substat.type];
    }

    return {
        totalMin: totalMin,
        totalRolled: totalRolled,
        totalMissing: totalMissing
    };
}

function setTheme() {
    (function (root, factory) {
        if (typeof define === 'function' && define.amd) {
            // AMD. Register as an anonymous module.
            define(['exports', 'echarts'], factory);
        } else if (typeof exports === 'object' && typeof exports.nodeName !== 'string') {
            // CommonJS
            factory(exports, require('echarts'));
        } else {
            // Browser globals
            factory({}, root.echarts);
        }
    }(this, function (exports, echarts) {
        var log = function (msg) {
            if (typeof console !== 'undefined') {
                console && console.error && console.error(msg);
            }
        };
        if (!echarts) {
            log('ECharts is not Loaded');
            return;
        }
        var contrastColor = '#eee';
        var axisCommon = function () {
            return {
                axisLine: {
                    lineStyle: {
                        color: contrastColor
                    }
                },
                axisTick: {
                    lineStyle: {
                        color: contrastColor
                    }
                },
                axisLabel: {
                    textStyle: {
                        color: contrastColor
                    }
                },
                splitLine: {
                    lineStyle: {
                        type: 'dashed',
                        color: '#aaa'
                    }
                },
                splitArea: {
                    areaStyle: {
                        color: contrastColor
                    }
                }
            };
        };

        var colorPalette = ['#dd6b66','#759aa0','#e69d87','#8dc1a9','#ea7e53','#eedd78','#73a373','#73b9bc','#7289ab', '#91ca8c','#f49f42'];
        var theme = {
            color: colorPalette,
            backgroundColor: '#00000000',
            // backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-color').replace(" ", ""),
            tooltip: {
                axisPointer: {
                    lineStyle: {
                        color: contrastColor
                    },
                    crossStyle: {
                        color: contrastColor
                    }
                }
            },
            legend: {
                textStyle: {
                    color: contrastColor
                }
            },
            textStyle: {
                color: contrastColor
            },
            title: {
                textStyle: {
                    color: contrastColor
                }
            },
            toolbox: {
                iconStyle: {
                    normal: {
                        borderColor: contrastColor
                    }
                }
            },
            dataZoom: {
                textStyle: {
                    color: contrastColor
                }
            },
            timeline: {
                lineStyle: {
                    color: contrastColor
                },
                itemStyle: {
                    normal: {
                        color: colorPalette[1]
                    }
                },
                label: {
                    normal: {
                        textStyle: {
                            color: contrastColor
                        }
                    }
                },
                controlStyle: {
                    normal: {
                        color: contrastColor,
                        borderColor: contrastColor
                    }
                }
            },
            timeAxis: axisCommon(),
            logAxis: axisCommon(),
            valueAxis: axisCommon(),
            categoryAxis: axisCommon(),

            line: {
                symbol: 'circle'
            },
            graph: {
                color: colorPalette
            },
            gauge: {
                title: {
                    textStyle: {
                        color: contrastColor
                    }
                }
            },
            candlestick: {
                itemStyle: {
                    normal: {
                        color: '#FD1050',
                        color0: '#0CF49B',
                        borderColor: '#FD1050',
                        borderColor0: '#0CF49B'
                    }
                }
            }
        };
        theme.categoryAxis.splitLine.show = false;
        echarts.registerTheme('dark', theme);
    }));
}

module.exports = {
    initialize: async () => {
        setTheme()
        function initializeBars() {
            barsIds = ['stat1bars', 'stat2bars', 'stat3bars', 'stat4bars']
            for (var i = 0; i < 4; i++) {
                var id = barsIds[i];
                console.log(id)
                var chartDom = document.getElementById(id);
                var barsChart = echarts.init(chartDom, DarkMode.isDark() ? 'dark' : undefined);
                barsCharts[i] = barsChart;
            }
        }

        const scoreRadarDom = document.getElementById('scoreRadar1');
        if (scoreRadarDom) {
            scoreRadar = echarts.init(scoreRadarDom, DarkMode.isDark() ? 'dark' : undefined);
        }

        initializeBars()
        // const getAllItemsResponse = await Api.getAllItems();
        // const items = getAllItemsResponse.items;
        // console.warn(items)
        // const item = items[900];

        // ItemAugmenter.augment([item])

        // document.getElementById('removeBuildSubmit').addEventListener("click", async () => {
        //     console.log("removeBuildSubmit");
        // });

        // // document.getElementById('tab2label').addEventListener("click", () => {
        // //     module.exports.redrawEnhanceGuide(item);
        // // });

        // module.exports.redrawEnhanceGuide(item);
    },

    // setItem: async (item) => {
    //     const html = HtmlGenerator.buildItemPanel(item, "enhanceTab", null, "Speed")
    //     document.getElementById("enhanceTabPreview").innerHTML = html;
    // },

    redrawEnhanceGuideFromRemoteId: async(itemId) => {
        Api.getItemById(itemId).then(x => {
            module.exports.redrawEnhanceGuide(x.item);
            $('#tab5').trigger('click');
        })
    },

    redrawEnhanceGuide: async (item) => {
        setTheme();
        Reforge.calculateMaxes(item);
        console.log("redraw", item);

        const baseStats = null;
        const html = HtmlGenerator.buildItemPanel(item, "enhanceTab", baseStats, true)
        document.getElementById("enhanceTabPreview").innerHTML = html;

        // Stats

        var text = "";
        var leftText = "";
        var rightText = "";

        // Speed
        // var speedStats = item.substats.filter(x => x.type == "Speed")
        // var roundedEnhance = Math.floor(item.enhance / 3) * 3;
        // var maxSpeed = 0;
        // if (speedStats.length > 0) {
        //     var speedStat = speedStats[0];
        //     var rolls = speedStat.rolls;
        //     var enhance = item.enhance;
        //     var rollsLeft = Math.ceil(15 - item.enhance)/3;

        //     var potentialRolls = Constants.speedByItemTypeAlreadyRolled[item.rank][roundedEnhance];

        //     var reforgedValue = item.level == 90 ? speedStat.value : speedStat.reforgedValue;

        //     console.warn(reforgedValue)
        //     console.warn(Constants.speedRollsToValue[potentialRolls + rolls] - Constants.speedRollsToValue[rolls])
        //     console.warn("------------------------")
        //     maxSpeed = reforgedValue + potentialRolls * 4 + (item.level == 85 ? Constants.speedRollsToValue[potentialRolls + rolls] - Constants.speedRollsToValue[rolls] : 0);
        // } else {
        //     var potentialRolls = Constants.speedByItemTypeNotYetRolled[item.rank][roundedEnhance];
        //     maxSpeed = potentialRolls * 4 + (item.level == 85 ? Constants.speedRollsToValue[potentialRolls] : 0);

        //     console.warn(potentialRolls)
        //     console.warn(Constants.speedRollsToValue[potentialRolls])
        //     console.warn("------------------------")
        // }

        // leftText += "Max speed: <br>";
        // rightText += maxSpeed + "<br>";


        // Score

        // var scores = calculateScoreTotals(item)

        // leftText += "Score: <br>";
        // rightText += item.reforgedWss + "<br>";

        // leftText += "Dps score: <br>";
        // rightText += item.dpsWss + "<br>";

        // leftText += "Support score: <br>";
        // rightText += item.supportWss + "<br>";

        // leftText += "Combat score: <br>";
        // rightText += item.combatWss + "<br>";

        //

        // $('#statsLeft').html(leftText)
        // $('#statsRight').html(rightText)

        // 评分雷达图
        drawScoreRadar(item);

        // Bars

        function buildBars(id, showAxis, item, index) {
            var stat = item.substats[index]
            if (!stat)
                return;

            var option;

            // var min = Utils.round100ths(stat.reforgedMin / stat.reforgedMax);
            // var rolled = Utils.round100ths(((item.min == 85 ? stat.reforgedValue : stat.value) - stat.reforgedMin) / (stat.reforgedMax));
            // var missing = Utils.round100ths(1 - min - rolled);

            var min = Utils.round10ths(Math.floor(stat.reforgedMin));
            var rolled = Utils.round10ths((item.level == 85 ? stat.reforgedValue : stat.value) - Math.floor(stat.reforgedMin));
            var missing = Utils.round10ths(Math.floor(stat.reforgedMax) - (item.level == 85 ? stat.reforgedValue : stat.value));

            var barLabel = `    ${min + rolled} / ${min + rolled + missing}   (${Utils.round100ths(((min + rolled) / (min + rolled + missing)) * 100)} %)`;

            option = {
                tooltip: {
                    trigger: 'axis',
                    axisPointer: {            // Use axis to trigger tooltip
                        type: 'shadow'        // 'shadow' as default; can also be 'line' or 'shadow'
                    }
                },
                grid: {
                    // 左边留给副属性名字（containLabel 自动量），右边留给 “当前 / 最大 (百分比)” 那串文字
                    left: 4,
                    right: 130,
                    top: 0,
                    bottom: 0,
                    containLabel: true,
                },
                xAxis: {
                    show: false,
                    minInterval: 10000,
                    type: 'value',
                    max: maxes[stat.type],
                    min: 0,
                    axisLabel: {
                      formatter: (x) => {return parseFloat(x)}
                    }
                },
                yAxis: {
                    type: 'category',
                    data: [i18next.t(statToReadableText[stat.type])]
                },
                series: [
                    {
                        type: 'bar',
                        stack: 'total',
                        name: i18next.t('Minimum possible stats'),
                        label: {
                            show: min < 1 ? false : true,
                            position: 'inside',
                            fontSize: 10,
                            overflow: 'truncate',

                        },
                        itemStyle: {
                            color: '#f2f2f2'
                        },
                        data: [
                            min
                        ]
                    },
                    {
                        type: 'bar',
                        stack: 'total',
                        name: i18next.t('Rolled stats'),
                        label: {
                            show: rolled < 1 ? false : true,
                            position: 'inside',
                            // position: stat.type == "Health" && rolled > 50 ? 'left' : 'inside',
                            fontSize: 10,
                            overflow: 'truncate',
                        },
                        itemStyle: {
                            color: '#8bde87'
                        },
                        data: [
                            rolled
                        ]
                    },
                    {
                        type: 'bar',
                        name: i18next.t('Missing potential stats'),
                        stack: 'total',
                        label: {
                            show: missing < 1 ? false : true,
                            position: 'inside',
                            // position: stat.type == "Health" && missing > 50 ? 'right' : 'inside',
                            fontSize: 10,
                            overflow: 'truncate',
                        },
                        itemStyle: {
                            color: '#f5bea9'
                        },
                        data: [
                            missing
                        ]
                    },
                    {
                        type: 'bar',
                        stack: 'total',
                        tooltip: {
                           show: false
                        },
                        label: {
                            show: true,
                            position: 'right',
                            // position: stat.type == "Health" && missing > 50 ? 'right' : 'inside',
                            fontSize: 10,
                            color: DarkMode.isDark() ? '#f0f0f0' : '#363636',
                            formatter: function x() {
                                return barLabel
                            }
                        },
                        itemStyle: {
                            color: '#f5bea9'
                        },
                        data: [
                            0
                        ]
                    },
                ]
            };

            option && barsCharts[index].setOption(option);
        }

        for (var x of barsCharts) {
            if (x) {
                x.clear()
            }
        }

        buildBars('stat1bars', false, item, 0)
        buildBars('stat2bars', false, item, 1)
        buildBars('stat3bars', false, item, 2)
        buildBars('stat4bars', true, item, 3)
    },
}