var heroesByName = {};
var artifactsByName = {};
var eesByName = {};

global.DataLoader = require('./dataLoader');

module.exports = {

    initialize: async () => {
        // 从 GitHub 或本地加载 herodata.json
        var heroesByNameStr = null;
        try {
            heroesByNameStr = await Files.readFileSync(Files.getDataPath() + '/cache/herodata.json');
            console.log('Loaded herodata.json from local');
        } catch (localError) {
            console.log('Local herodata.json not found, fetching from GitHub...');
            const githubData = await DataLoader.fetchAndSaveJson('cache/herodata.json');
            if (githubData) {
                heroesByNameStr = JSON.stringify(githubData);
            } else {
                console.error('Failed to fetch herodata.json from GitHub');
                return;
            }
        }
        heroesByName = JSON.parse(heroesByNameStr);
        console.log('HERO DATA INITIALIZED');

        // 从 GitHub 或本地加载 artifactdata.json
        var artifactsByNameStr = null;
        try {
            artifactsByNameStr = await Files.readFileSync(Files.getDataPath() + '/cache/artifactdata.json');
            console.log('Loaded artifactdata.json from local');
        } catch (localError) {
            console.log('Local artifactdata.json not found, fetching from GitHub...');
            const githubData = await DataLoader.fetchAndSaveJson('cache/artifactdata.json');
            if (githubData) {
                artifactsByNameStr = JSON.stringify(githubData);
            } else {
                console.error('Failed to fetch artifactdata.json from GitHub');
            }
        }
        if (artifactsByNameStr) {
            artifactsByName = JSON.parse(artifactsByNameStr);
        }

        // 确保所有英雄的图片都已下载到本地 cachedimages
        console.log('Ensuring all hero images are downloaded...');
        const heroNames = Object.keys(heroesByName);
        for (const name of heroNames) {
            await DataLoader.ensureAssetsDownloaded(heroesByName[name]);
        }
        console.log('All hero images checked/downloaded');

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

