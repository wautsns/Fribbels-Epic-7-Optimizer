var heroesByName = {};
var artifactsByName = {};
var eesByName = {};

module.exports = {

    initialize: async () => {
        try {
            var heroesByNameStr = await Files.readFileSync(Files.getDataPath() + '/cache/herodata.json');
            heroesByName = JSON.parse(heroesByNameStr);
            // const heroNameList = Object.keys(heroesByName);
        } catch (e) {
            console.warn("Error loading hero data from file", e)
        }

        try {
            var artifactsByNameStr = await Files.readFileSync(Files.getDataPath() + '/cache/artifactdata.json');
            artifactsByName = JSON.parse(artifactsByNameStr);
            // const artifactNameList = Object.keys(artifactsByName);
        } catch (e) {
            console.warn("Error loading artifact data from file", e)
        }

        console.warn("HERO DATA INITIALIZED")

        const baseStatsByName = {};
        Object.keys(heroesByName)
                .forEach(x => {
                    if (!heroesByName[x].skills) {
                        heroesByName[x].skills = {
      "S1": {
        "hitTypes": ["normal"],
        "targets": 0,
        "rate": 0,
        "pow": 0,
        "options": []
      },
      "S2": {
        "hitTypes": ["normal"],
        "targets": 0,
        "rate": 0,
        "pow": 0,
        "options": []
      },
      "S3": {
        "hitTypes": ["normal"],
        "targets": 0,
        "rate": 0,
        "pow": 0,
        "options": []
      }
    }
                    }


                    var s = heroesByName[x].skills;
                    for (var skill of ["S1", "S2", "S3"]) {
                        var skillData = s[skill];

                        if (skillData) {
                            for (var z of skillData.hitTypes) {
                                if (!skillData.options.find(y => y.name.includes(z))) {
                                    skillData.options.push({
                                        name: skill + " " + z,
                                        rate: skillData.rate,
                                        note: skillData.note,
                                        pow: skillData.pow,
                                        targets: skillData.targets,
                                        selfHpScaling: skillData.selfHpScaling,
                                        selfAtkScaling: skillData.selfAtkScaling,
                                        selfDefScaling: skillData.selfDefScaling,
                                        selfSpdScaling: skillData.selfSpdScaling,
                                        increasedValue: skillData.increasedValue,
                                        extraSelfHpScaling: skillData.extraSelfHpScaling,
                                        extraSelfDefScaling: skillData.extraSelfDefScaling,
                                        extraSelfAtkScaling: skillData.extraSelfAtkScaling,
                                        cdmgIncrease: skillData.cdmgIncrease,
                                        penetration: skillData.penetration,
                                    });
                                }
                            }
                        }

                        if (!skillData) {
                            s[skill] = {}
                        }

                        if (!s[skill].options || s[skill].options.length == 0) {
                            s[skill].options = [];
                            s[skill].options.push({
                                name: skill + " n/a",
                                targets: 0,
                                rate: 0,
                                pow: 0,
                            })
                        }
                    }

                    const baseStats = module.exports.getBaseStatsByName(x);
                    baseStatsByName[x] = baseStats;
                });

        await Api.setArtifacts(artifactsByName);
        await Api.setBaseStats(baseStatsByName);
    },

    getAllHeroData: () => {
        return heroesByName;
    },

    getHeroExtraInfo: (name) => {
        const heroInfo = heroesByName[name];
        return heroInfo;
    },

    getAllArtifactData: () => {
        return artifactsByName;
    },

    getArtifactByName: (name) => {
        return artifactsByName[name]
    },

    getAllEeData: () => {
        return eesByName;
    },

    getEeByName: (name) => {
        return eesByName[name]
    },

    getBaseStatsByName: (name) => {
        function baseToStatObj(stats) {
            return {
                atk: stats.atk,
                hp: stats.hp,
                def: stats.def,
                cr: Math.round(stats.chc * 100),
                cd: Math.round(stats.chd * 100),
                eff: Math.round(stats.eff * 100),
                res: Math.round(stats.efr * 100),
                spd: stats.spd,
                dac: Math.round(stats.dac * 100),
                bonusStats: {
                    bonusMaxAtkPercent: stats.bonusMaxAtkPercent,
                    bonusMaxDefPercent: stats.bonusMaxDefPercent,
                    bonusMaxHpPercent: stats.bonusMaxHpPercent,
                    overrideAtk: stats.overrideAtk,
                    overrideHp: stats.overrideHp,
                    overrideDef: stats.overrideDef,
                    overrideAdditionalCr: Math.round(stats.overrideAdditionalCr * 100),
                    overrideAdditionalCd: Math.round(stats.overrideAdditionalCd * 100),
                    overrideAdditionalSpd: stats.overrideAdditionalSpd,
                    overrideAdditionalEff: Math.round(stats.overrideAdditionalEff * 100),
                    overrideAdditionalRes: Math.round(stats.overrideAdditionalRes * 100),
                }
            }
        }

        const status = heroesByName[name].calculatedStatus;
        return {
            lv50FiveStarFullyAwakened: baseToStatObj(status.lv50FiveStarFullyAwakened),
            lv60SixStarFullyAwakened: baseToStatObj(status.lv60SixStarFullyAwakened),
            skills: {
                S1: heroesByName[name].skills.S1.options,
                S2: heroesByName[name].skills.S2.options,
                S3: heroesByName[name].skills.S3.options
            }
        }
    },

    getBaseStatsByStars: (name, stars) => {
        const baseStats = module.exports.getBaseStatsByName(name);

        if (stars == 5) {
            return baseStats.lv50FiveStarFullyAwakened;
        }
        return baseStats.lv60SixStarFullyAwakened;
    },
}

