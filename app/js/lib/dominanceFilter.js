const COMPARISON_EPSILON = 0.000001;

const STAT_DEFINITIONS = [
    {
        key: 'Attack',
        minKey: 'inputAtkMinLimit',
        minConfiguredKey: 'inputAtkMinConfigured',
        maxConfiguredKey: 'inputAtkMaxConfigured',
        percentKey: 'AttackPercent',
        baseKey: 'atk',
        priorityField: 'atk',
    },
    {
        key: 'Health',
        minKey: 'inputHpMinLimit',
        minConfiguredKey: 'inputHpMinConfigured',
        maxConfiguredKey: 'inputHpMaxConfigured',
        percentKey: 'HealthPercent',
        baseKey: 'hp',
        priorityField: 'hp',
    },
    {
        key: 'Defense',
        minKey: 'inputDefMinLimit',
        minConfiguredKey: 'inputDefMinConfigured',
        maxConfiguredKey: 'inputDefMaxConfigured',
        percentKey: 'DefensePercent',
        baseKey: 'def',
        priorityField: 'def',
    },
    {
        key: 'Speed',
        minKey: 'inputSpdMinLimit',
        minConfiguredKey: 'inputSpdMinConfigured',
        maxConfiguredKey: 'inputSpdMaxConfigured',
        priorityField: 'spd',
    },
    {
        key: 'CriticalHitChancePercent',
        minKey: 'inputCrMinLimit',
        minConfiguredKey: 'inputCrMinConfigured',
        maxConfiguredKey: 'inputCrMaxConfigured',
        priorityField: 'cr',
    },
    {
        key: 'CriticalHitDamagePercent',
        minKey: 'inputCdMinLimit',
        minConfiguredKey: 'inputCdMinConfigured',
        maxConfiguredKey: 'inputCdMaxConfigured',
        priorityField: 'cd',
    },
    {
        key: 'EffectivenessPercent',
        minKey: 'inputEffMinLimit',
        minConfiguredKey: 'inputEffMinConfigured',
        maxConfiguredKey: 'inputEffMaxConfigured',
        priorityField: 'eff',
    },
    {
        key: 'EffectResistancePercent',
        minKey: 'inputResMinLimit',
        minConfiguredKey: 'inputResMinConfigured',
        maxConfiguredKey: 'inputResMaxConfigured',
        priorityField: 'res',
    },
];

module.exports = {
    applyDominanceFilters: (params, items, baseStats, reforge) => {
        if (!items || items.length < 2 || params.inputFilterPriority == 100) {
            return items;
        }

        const groups = groupByGearAndSet(items);
        const modes = getComparisonModes(params);
        const passed = [];
        // Comparable stats only depend on the item plus the chosen hero's base stats, so they are
        // converted once per item instead of once per compared pair.
        const statsCache = new Map();
        const getStats = item => {
            if (!statsCache.has(item)) {
                statsCache.set(item, getComparableStats(item, baseStats, reforge));
            }
            return statsCache.get(item);
        };

        for (const group of Object.values(groups)) {
            const undominated = group.filter((candidate, candidateIndex) => {
                return !group.some((other, otherIndex) => {
                    return otherIndex != candidateIndex
                        && dominates(other, candidate, modes, getStats);
                });
            });

            for (const candidate of undominated) {
                const equivalentIndex = passed.findIndex(item => {
                    return item.gear == candidate.gear
                        && item.set == candidate.set
                        && equivalent(item, candidate, modes, getStats);
                });

                if (equivalentIndex == -1) {
                    passed.push(candidate);
                } else if (compareTieBreakers(candidate, passed[equivalentIndex], getStats) > 0) {
                    passed[equivalentIndex] = candidate;
                }
            }
        }

        return passed;
    },

    getComparableStats: getComparableStats,
};

function getComparableStats(item, baseStats, reforge) {
    const stats = reforge ? item.reforgedStats : item.augmentedStats;
    if (!stats) {
        return null;
    }

    const comparableStats = {};
    for (const definition of STAT_DEFINITIONS) {
        const statValue = getComparableStatValue(stats, definition, baseStats);
        if (statValue == null) {
            return null;
        }
        comparableStats[definition.key] = statValue;
    }

    return comparableStats;
}

function groupByGearAndSet(items) {
    return items.reduce((groups, item) => {
        const key = `${item.gear}\u0000${item.set}`;
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(item);
        return groups;
    }, {});
}

function dominates(first, second, modes, getStats) {
    const firstStats = getStats(first);
    const secondStats = getStats(second);
    if (!firstStats || !secondStats) {
        return false;
    }

    let strictlyBetter = false;
    for (let i = 0; i < STAT_DEFINITIONS.length; i++) {
        const key = STAT_DEFINITIONS[i].key;
        const comparison = compareValues(firstStats[key], secondStats[key], modes[i]);

        if (comparison < 0) {
            return false;
        }
        if (comparison > 0) {
            strictlyBetter = true;
        }
    }

    return strictlyBetter;
}

function equivalent(first, second, modes, getStats) {
    const firstStats = getStats(first);
    const secondStats = getStats(second);
    if (!firstStats || !secondStats) {
        return false;
    }

    return STAT_DEFINITIONS.every((definition, index) => {
        return compareValues(firstStats[definition.key], secondStats[definition.key], modes[index]) == 0;
    });
}

function compareTieBreakers(first, second, getStats) {
    const firstPriority = getFiniteNumber(first.score);
    const secondPriority = getFiniteNumber(second.score);
    if (firstPriority != secondPriority) {
        return firstPriority > secondPriority ? 1 : -1;
    }

    const firstRolls = getUnweightedScore(getStats(first));
    const secondRolls = getUnweightedScore(getStats(second));
    if (firstRolls != secondRolls) {
        return firstRolls > secondRolls ? 1 : -1;
    }

    return compareIds(first.id, second.id);
}

function getUnweightedScore(stats) {
    if (!stats) {
        return Number.NEGATIVE_INFINITY;
    }

    return stats.Attack / 8
        + stats.Health / 8
        + stats.Defense / 8
        + stats.Speed / 4
        + stats.CriticalHitChancePercent / 5
        + stats.CriticalHitDamagePercent / 7
        + stats.EffectivenessPercent / 8
        + stats.EffectResistancePercent / 8;
}

function compareIds(firstId, secondId) {
    const first = firstId == null ? '' : String(firstId);
    const second = secondId == null ? '' : String(secondId);
    if (first == second) {
        return 0;
    }
    if (!first) {
        return -1;
    }
    if (!second) {
        return 1;
    }

    const firstNumber = Number(first);
    const secondNumber = Number(second);
    if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
        return firstNumber < secondNumber ? 1 : -1;
    }
    return first < second ? 1 : -1;
}

function getFiniteNumber(value) {
    return typeof value == 'number' && Number.isFinite(value)
        ? value
        : Number.NEGATIVE_INFINITY;
}

function getComparisonModes(params) {
    return STAT_DEFINITIONS.map(definition => getComparisonMode(params, definition));
}

function getComparisonMode(params, definition) {
    const hasMax = Boolean(params[definition.maxConfiguredKey]);
    const positiveMin = Boolean(params[definition.minConfiguredKey])
        && getFiniteNumberOrZero(params[definition.minKey]) > 0;
    const zeroMin = Boolean(params[definition.minConfiguredKey]) && !positiveMin;
    const disliked = isDislikedInResultPriority(params, definition);

    // Without a maximum:
    //   minimum empty   -> result priority decides: higher, or lower when the stat is disliked
    //   minimum = 0     -> ignored
    //   minimum > 0     -> higher, or exactly equal when the stat is disliked
    if (!hasMax) {
        if (zeroMin) {
            return 'ignored';
        }
        if (!disliked) {
            return 'higher';
        }
        return positiveMin ? 'equal' : 'lower';
    }

    // With a maximum:
    //   minimum > 0     -> exactly equal
    //   minimum empty/0 -> exactly equal, or lower when the stat is disliked
    return positiveMin || !disliked ? 'equal' : 'lower';
}

function isDislikedInResultPriority(params, definition) {
    return Array.isArray(params.resultDislike)
        && params.resultDislike.includes(definition.priorityField);
}

function getFiniteNumberOrZero(value) {
    return typeof value == 'number' && Number.isFinite(value) ? value : 0;
}

function compareValues(firstValue, secondValue, mode) {
    if (mode == 'ignored') {
        return 0;
    }

    if (Math.abs(firstValue - secondValue) <= COMPARISON_EPSILON) {
        return 0;
    }

    if (mode == 'lower') {
        return firstValue < secondValue ? 1 : -1;
    }
    if (mode == 'equal') {
        return -1;
    }
    return firstValue > secondValue ? 1 : -1;
}

function getComparableStatValue(stats, definition, baseStats) {
    const value = getNumber(stats[definition.key]);
    const mainValue = stats.mainType == definition.key ? getNumber(stats.mainValue) : 0;

    if (value == null || mainValue == null) {
        return null;
    }

    if (!definition.baseKey) {
        return value + mainValue;
    }

    const percentValue = getNumber(stats[definition.percentKey]);
    const mainPercentValue = stats.mainType == definition.percentKey ? getNumber(stats.mainValue) : 0;
    const baseValue = getNumber(baseStats && baseStats[definition.baseKey]);
    if (percentValue == null || mainPercentValue == null || baseValue == null || baseValue <= 0) {
        return null;
    }

    return percentValue + mainPercentValue + (value + mainValue) / baseValue * 100;
}

function getNumber(value) {
    return typeof value == 'number' && Number.isFinite(value) ? value : null;
}
