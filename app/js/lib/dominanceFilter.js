const COMPARISON_EPSILON = 0.000001;

const STAT_DEFINITIONS = [
    {
        key: 'Attack',
        minKey: 'inputAtkMinLimit',
        maxKey: 'inputAtkMaxLimit',
        minConfiguredKey: 'inputAtkMinConfigured',
        maxConfiguredKey: 'inputAtkMaxConfigured',
        percentKey: 'AttackPercent',
        baseKey: 'atk',
    },
    {
        key: 'Health',
        minKey: 'inputHpMinLimit',
        maxKey: 'inputHpMaxLimit',
        minConfiguredKey: 'inputHpMinConfigured',
        maxConfiguredKey: 'inputHpMaxConfigured',
        percentKey: 'HealthPercent',
        baseKey: 'hp',
    },
    {
        key: 'Defense',
        minKey: 'inputDefMinLimit',
        maxKey: 'inputDefMaxLimit',
        minConfiguredKey: 'inputDefMinConfigured',
        maxConfiguredKey: 'inputDefMaxConfigured',
        percentKey: 'DefensePercent',
        baseKey: 'def',
    },
    {
        key: 'Speed',
        minKey: 'inputSpdMinLimit',
        maxKey: 'inputSpdMaxLimit',
        minConfiguredKey: 'inputSpdMinConfigured',
        maxConfiguredKey: 'inputSpdMaxConfigured',
    },
    {
        key: 'CriticalHitChancePercent',
        minKey: 'inputCrMinLimit',
        maxKey: 'inputCrMaxLimit',
        minConfiguredKey: 'inputCrMinConfigured',
        maxConfiguredKey: 'inputCrMaxConfigured',
    },
    {
        key: 'CriticalHitDamagePercent',
        minKey: 'inputCdMinLimit',
        maxKey: 'inputCdMaxLimit',
        minConfiguredKey: 'inputCdMinConfigured',
        maxConfiguredKey: 'inputCdMaxConfigured',
    },
    {
        key: 'EffectivenessPercent',
        minKey: 'inputEffMinLimit',
        maxKey: 'inputEffMaxLimit',
        minConfiguredKey: 'inputEffMinConfigured',
        maxConfiguredKey: 'inputEffMaxConfigured',
    },
    {
        key: 'EffectResistancePercent',
        minKey: 'inputResMinLimit',
        maxKey: 'inputResMaxLimit',
        minConfiguredKey: 'inputResMinConfigured',
        maxConfiguredKey: 'inputResMaxConfigured',
    },
];

module.exports = {
    applyDominanceFilters: (params, items, baseStats, reforge) => {
        if (!items || items.length < 2 || params.inputFilterPriority == 100) {
            return items;
        }

        const groups = groupByGearAndSet(items);
        const passed = [];

        for (const group of Object.values(groups)) {
            const undominated = group.filter((candidate, candidateIndex) => {
                return !group.some((other, otherIndex) => {
                    return otherIndex != candidateIndex
                        && dominates(other, candidate, params, baseStats, reforge);
                });
            });

            for (const candidate of undominated) {
                const equivalentIndex = passed.findIndex(item => {
                    return item.gear == candidate.gear
                        && item.set == candidate.set
                        && equivalent(item, candidate, params, baseStats, reforge);
                });

                if (equivalentIndex == -1) {
                    passed.push(candidate);
                } else if (compareTieBreakers(candidate, passed[equivalentIndex], baseStats, reforge) > 0) {
                    passed[equivalentIndex] = candidate;
                }
            }
        }

        return passed;
    },

    getComparableStats: (item, baseStats, reforge) => {
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
    },
};

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

function dominates(first, second, params, baseStats, reforge) {
    const firstStats = module.exports.getComparableStats(first, baseStats, reforge);
    const secondStats = module.exports.getComparableStats(second, baseStats, reforge);
    if (!firstStats || !secondStats) {
        return false;
    }

    let strictlyBetter = false;
    for (const definition of STAT_DEFINITIONS) {
        const mode = getComparisonMode(params, definition);
        const comparison = compareValues(
            firstStats[definition.key],
            secondStats[definition.key],
            mode,
        );

        if (comparison < 0) {
            return false;
        }
        if (comparison > 0) {
            strictlyBetter = true;
        }
    }

    return strictlyBetter;
}

function equivalent(first, second, params, baseStats, reforge) {
    const firstStats = module.exports.getComparableStats(first, baseStats, reforge);
    const secondStats = module.exports.getComparableStats(second, baseStats, reforge);
    if (!firstStats || !secondStats) {
        return false;
    }

    return STAT_DEFINITIONS.every(definition => {
        const mode = getComparisonMode(params, definition);
        return compareValues(firstStats[definition.key], secondStats[definition.key], mode) == 0;
    });
}

function compareTieBreakers(first, second, baseStats, reforge) {
    const firstPriority = getFiniteNumber(first.score);
    const secondPriority = getFiniteNumber(second.score);
    if (firstPriority != secondPriority) {
        return firstPriority > secondPriority ? 1 : -1;
    }

    const firstRolls = getUnweightedScore(first, baseStats, reforge);
    const secondRolls = getUnweightedScore(second, baseStats, reforge);
    if (firstRolls != secondRolls) {
        return firstRolls > secondRolls ? 1 : -1;
    }

    return compareIds(first.id, second.id);
}

function getUnweightedScore(item, baseStats, reforge) {
    const stats = module.exports.getComparableStats(item, baseStats, reforge);
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

function getComparisonMode(params, definition) {
    const maxValue = params[definition.maxKey];
    const minValue = params[definition.minKey];
    const maxConfigured = getConfiguredValue(
        params,
        definition.maxConfiguredKey,
        maxValue,
        2147483647,
    );
    const minConfigured = getConfiguredValue(
        params,
        definition.minConfiguredKey,
        minValue,
        0,
    );

    if (!maxConfigured) {
        return minConfigured && minValue === 0 ? 'ignored' : 'higher';
    }

    return minConfigured && minValue === 0 ? 'lower' : 'equal';
}

function getConfiguredValue(params, configuredKey, value, defaultValue) {
    if (params[configuredKey] != null) {
        return params[configuredKey];
    }
    return value != null && value != defaultValue;
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
