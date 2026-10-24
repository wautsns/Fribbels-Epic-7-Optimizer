// Derives the attribute-priority sliders from the stat filters.
//
// The stat filters describe the stats the player wants to reach, so the sliders are
// filled with "how much of each stat still has to come from gear" instead of asking the
// player to guess a weight. Requirement scores are expressed in the same points scale as
// the filters (percent points for the percent based stats, flat points for speed), with
// set bonuses subtracted because those are already granted by the pieces themselves.
//
// The final value is a proportion: the stat with the biggest requirement gets 8 and the
// rest are scaled against it, which keeps the ratios intact no matter how large the
// requirements are.

const BASE_PER_ROLL = {
    atk: 8,
    hp: 8,
    def: 8,
    spd: 4,
    cr: 5,
    cd: 7,
    eff: 8,
    res: 8,
};

const STAT_KEYS = ['atk', 'hp', 'def', 'spd', 'cr', 'cd', 'eff', 'res'];

const SET_KEYS = {
    atk: 'AttackSet',
    def: 'DefenseSet',
    hp: 'HealthSet',
    spd: 'SpeedSet',
    cr: 'CriticalSet',
    cd: 'DestructionSet',
    eff: 'HitSet',
    res: 'ResistSet',
};

// Only the stats that matter for the scaling, the rest of the sets are not used here.
const SPECIAL_SETS = ['WarfareSet', 'WeakeningSet'];

function limitValue(params, key, kind) {
    return Number(params['input' + key + kind + 'Limit'] || 0);
}

function isConfigured(params, key, kind) {
    const flag = params['input' + key + kind + 'Configured'];
    if (flag !== undefined && flag !== null) {
        return !!flag;
    }

    return false;
}

// A stat is only part of the calculation when a reachable target exists:
// - no bound configured at all -> 0, the player does not care about this stat
// - only the lower bound configured and it is 0 -> 0, it is just an empty field
// - max configured -> the max is the target (the lower bound is a floor, not a target)
// - only min configured -> the min is the target
function resolveTarget(params, key) {
    const configuredMin = isConfigured(params, key, 'Min');
    const configuredMax = isConfigured(params, key, 'Max');

    if (!configuredMin && !configuredMax) {
        return null;
    }

    if (configuredMax) {
        return limitValue(params, key, 'Max');
    }

    if (configuredMin) {
        const min = limitValue(params, key, 'Min');
        return min > 0 ? min : null;
    }

    return null;
}

function countSets(params) {
    const counts = {};
    const slots = Array.isArray(params.inputSets) ? params.inputSets : [];

    for (const slot of slots) {
        if (!Array.isArray(slot)) continue;
        for (const set of slot) {
            if (!set) continue;
            counts[set] = (counts[set] || 0) + 1;
        }
    }

    return counts;
}

function requirementScores(params, hero, baseStats) {
    const sets = countSets(params);
    const artifactAtk = Number((hero && hero.artifactAttack) || 0);
    const artifactHp = Number((hero && hero.artifactHealth) || 0);
    const artifactDef = Number((hero && hero.artifactDefense) || 0);

    const target = {};
    for (const key of STAT_KEYS) {
        target[key] = resolveTarget(params, key.charAt(0).toUpperCase() + key.slice(1));
    }

    const scores = {
        atk: 0,
        hp: 0,
        def: 0,
        spd: 0,
        cr: 0,
        cd: 0,
        eff: 0,
        res: 0,
    };

    if (target.atk != null) {
        const percent = (target.atk - baseStats.atk - artifactAtk) / baseStats.atk * 100;
        const setBonus = (sets[SET_KEYS.atk] || 0) > 0 ? 45 : 0;
        scores.atk = (percent - setBonus) * (8 / BASE_PER_ROLL.atk);
    }

    if (target.hp != null) {
        const percent = (target.hp - baseStats.hp - artifactHp) / baseStats.hp * 100;
        const setBonus = (sets[SET_KEYS.hp] || 0) * 20 + ((sets.WarfareSet || 0) > 0 ? 20 : 0);
        scores.hp = (percent - setBonus) * (8 / BASE_PER_ROLL.hp);
    }

    if (target.def != null) {
        const percent = (target.def - baseStats.def - artifactDef) / baseStats.def * 100;
        const setBonus = (sets[SET_KEYS.def] || 0) * 20;
        scores.def = (percent - setBonus) * (8 / BASE_PER_ROLL.def);
    }

    if (target.spd != null) {
        const setBonus = (sets.SpeedSet || 0) > 0 ? 25 : ((sets.WeakeningSet || 0) > 0 ? 15 : 0);
        scores.spd = (target.spd - baseStats.spd - setBonus) * (8 / BASE_PER_ROLL.spd);
    }

    if (target.cr != null) {
        const setBonus = (sets[SET_KEYS.cr] || 0) * 12;
        scores.cr = (target.cr - baseStats.cr - setBonus) * (8 / BASE_PER_ROLL.cr);
    }

    if (target.cd != null) {
        const setBonus = (sets[SET_KEYS.cd] || 0) > 0 ? 60 : 0;
        scores.cd = (target.cd - baseStats.cd - setBonus) * (8 / BASE_PER_ROLL.cd);
    }

    if (target.eff != null) {
        const setBonus = (sets[SET_KEYS.eff] || 0) * 20;
        scores.eff = (target.eff - baseStats.eff - setBonus) * (8 / BASE_PER_ROLL.eff);
    }

    if (target.res != null) {
        const setBonus = (sets[SET_KEYS.res] || 0) * 20;
        scores.res = (target.res - baseStats.res - setBonus) * (8 / BASE_PER_ROLL.res);
    }

    for (const key of STAT_KEYS) {
        scores[key] = Math.max(0, scores[key] || 0);
    }

    return scores;
}

// proportion against the biggest requirement: 8 for the strongest one, scaled for the rest
function toPriorities(scores) {
    const priorities = {};
    let max = 0;

    for (const key of STAT_KEYS) {
        max = Math.max(max, scores[key] || 0);
    }

    for (const key of STAT_KEYS) {
        const score = scores[key] || 0;
        if (max <= 0 || score <= 0) {
            priorities[key] = 0;
        } else {
            priorities[key] = Math.min(8, Math.max(1, Math.round(8 * score / max)));
        }
    }

    return priorities;
}

module.exports = {
    STAT_KEYS,
    SPECIAL_SETS,
    requirementScores,
    resolveTarget,
    compute: (params, hero, baseStats) => toPriorities(requirementScores(params, hero, baseStats)),
    computeDetailed: (params, hero, baseStats) => {
        const scores = requirementScores(params, hero, baseStats);
        return { scores, priorities: toPriorities(scores) };
    },
};
