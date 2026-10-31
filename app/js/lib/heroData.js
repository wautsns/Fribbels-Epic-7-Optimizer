var heroesByName = {};
var artifactsByName = {};
var eesByName = {};

global.DataLoader = require('./dataLoader');

// The raw herodata.json leaves some skill options empty (support skills, new heroes), the
// app relies on every skill having at least one option, so they are filled in here.
function normalizeSkillOptions() {
    Object.keys(heroesByName).forEach(name => {
        const hero = heroesByName[name];
        if (!hero || typeof hero !== 'object') return;

        if (!hero.skills) {
            hero.skills = {
                S1: { hitTypes: ['normal'], options: [] },
                S2: { hitTypes: ['normal'], options: [] },
                S3: { hitTypes: ['normal'], options: [] },
            };
        }

        for (const skill of ['S1', 'S2', 'S3']) {
            let skillData = hero.skills[skill];
            if (!skillData || typeof skillData !== 'object') {
                skillData = hero.skills[skill] = {};
            }

            if (!Array.isArray(skillData.options)) {
                skillData.options = [];
            }

            const hitTypes = Array.isArray(skillData.hitTypes) ? skillData.hitTypes : [];

            for (const hitType of hitTypes) {
                if (!hitType) continue;

                if (!skillData.options.find(option => option && option.name && option.name.includes(hitType))) {
                    skillData.options.push({
                        name: skill + ' ' + hitType,
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

            if (skillData.options.length === 0) {
                skillData.options.push({
                    name: skill + ' n/a',
                    targets: 0,
                    rate: 0,
                    pow: 0,
                });
            }
        }
    });
}

/*
 * 拉取新数据时按 code 合并神器表：
 *   - 同名条目 → 用远端刷新属性/稀有度等（保留本地 code，作业里就是按 code 引用的）
 *   - 本地没有的名字、但 code 已经被别的名字占用 → 视为"同 code 的旧名 / 脏数据"，丢弃
 *   - 其余（新 code）→ 追加
 *
 * 原因：远端生成的 artifactdata.json 会带一批"同 code 的旧名/脏数据"（例如
 * Axe of Heavenly Mandate = Ascending Axe、Blood-Seared Moon 与 Guide to a Decision
 * 共用 ef506，后者游戏内根本不存在）。直接覆盖会把已经清掉的条目又带回来，
 * 所以要挡掉这部分，同时保留远端对老神器的数值修正。
 */
function mergeArtifactData(localData, incomingData) {
    const merged = Object.assign({}, localData || {});

    /* code → 名字（本地），用来判断远端那条是不是"同 code 的另一个名字" */
    const codeOwner = new Map();
    Object.keys(merged).forEach(name => {
        const code = merged[name] && merged[name].code;
        if (code) codeOwner.set(code, name);
    });

    const addedNames = [];
    const updatedNames = [];
    const ignoredNames = [];

    Object.keys(incomingData || {}).forEach(name => {
        const remote = incomingData[name];
        if (!remote || typeof remote !== 'object') return;

        const local = merged[name];

        // 同名：用远端刷新，但 code 以本地为准（没有才从远端补）
        if (local) {
            const updated = Object.assign({}, local);
            let changed = false;

            Object.keys(remote).forEach(key => {
                if (key === 'code') return;
                if (JSON.stringify(updated[key]) !== JSON.stringify(remote[key])) {
                    changed = true;
                    updated[key] = remote[key];
                }
            });

            if (!updated.code && remote.code) {
                updated.code = remote.code;
                changed = true;
            }

            merged[name] = updated;
            if (updated.code) codeOwner.set(updated.code, name);
            if (changed) updatedNames.push(name);
            return;
        }

        // 不同名但 code 已被占用 → 同 code 的旧名 / 脏数据，丢弃
        if (remote.code && codeOwner.has(remote.code)) {
            ignoredNames.push(name);
            return;
        }

        merged[name] = remote;
        if (remote.code) codeOwner.set(remote.code, name);
        addedNames.push(name);
    });

    return { merged, addedNames, updatedNames, ignoredNames };
}

module.exports = {

    initialize: async () => {
        // 尝试从本地读取 herodata.json
        var heroesByNameStr = null;
        try {
            heroesByNameStr = await Files.readFileSync(Files.getDataPath() + '/cache/herodata.json');
            console.log('Loaded herodata.json from local');
        } catch (localError) {
            console.log('Local herodata.json not found, fetching from S3...');
            const s3Data = await DataLoader.fetchAndSaveJson('herodata.json', 'cache/herodata.json');
            if (s3Data) {
                heroesByNameStr = JSON.stringify(s3Data);
            } else {
                console.error('Failed to fetch herodata.json from S3');
                return;
            }
        }
        heroesByName = JSON.parse(heroesByNameStr);
        console.log('HERO DATA INITIALIZED');

        // 尝试从本地读取 artifactdata.json
        var artifactsByNameStr = null;
        try {
            artifactsByNameStr = await Files.readFileSync(Files.getDataPath() + '/cache/artifactdata.json');
            console.log('Loaded artifactdata.json from local');
        } catch (localError) {
            console.log('Local artifactdata.json not found, fetching from S3...');
            const s3Data = await DataLoader.fetchAndSaveJson('artifactdata.json', 'cache/artifactdata.json');
            if (s3Data) {
                artifactsByNameStr = JSON.stringify(s3Data);
            } else {
                console.error('Failed to fetch artifactdata.json from S3');
            }
        }
        if (artifactsByNameStr) {
            artifactsByName = JSON.parse(artifactsByNameStr);
        }

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

    // 手动刷新数据（点击检查更新时调用）
    refreshData: async () => {
        console.log('Refreshing hero data from S3...');
        
        // 重新获取 herodata.json
        const heroData = await DataLoader.fetchAndSaveJson('herodata.json', 'cache/herodata.json');
        if (heroData) {
            heroesByName = heroData;
            // fresh data has empty skill option lists, fill them like initialize() does
            normalizeSkillOptions();
            console.log('herodata.json refreshed');
        }
        
        // 重新获取 artifactdata.json：同名条目用远端刷新，同 code 的旧名/脏数据丢弃，只补新 code
        const artifactData = await DataLoader.fetchAndSaveJson('artifactdata.json', 'cache/artifactdata.json');
        if (artifactData) {
            const { merged, addedNames, updatedNames, ignoredNames } =
                mergeArtifactData(artifactsByName, artifactData);
            artifactsByName = merged;

            // fetchAndSaveJson 已经把远端原始数据写到磁盘上了，这里用合并结果覆盖回去，
            // 否则下次启动读取本地缓存时脏数据又回来了
            await DataLoader.saveJsonToLocal('cache/artifactdata.json', merged);

            console.log(`artifactdata.json refreshed: +${addedNames.length} new, ~${updatedNames.length} updated, ${ignoredNames.length} ignored (same code)`);
            if (addedNames.length) {
                console.log('  new artifacts:', addedNames.join(', '));
            }
            if (updatedNames.length) {
                console.log('  updated artifacts:', updatedNames.join(', '));
            }
            if (ignoredNames.length) {
                console.log('  ignored artifacts:', ignoredNames.join(', '));
            }
        }
        
        // 校验英雄图片是否存在
        console.log('Ensuring all hero images are downloaded...');
        const heroNames = Object.keys(heroesByName);
        for (const name of heroNames) {
            await DataLoader.ensureHeroAssetsDownloaded(heroesByName[name]);
        }
        console.log('All hero images checked/downloaded');
        
        // 校验神器图片是否存在
        console.log('Ensuring all artifact images are downloaded...');
        await DataLoader.ensureArtifactImagesDownloaded(artifactsByName);
        console.log('All artifact images checked/downloaded');
        
        // 拉取最新翻译数据（仅简体中文）
        console.log('Pulling latest translation data...');
        const translationResult = await DataLoader.pullTranslationData('zh');
        if (translationResult.success) {
            console.log(`Translation data updated, added ${translationResult.addedCount} new entries`);
        } else {
            console.error('Failed to update translation data:', translationResult.error);
        }
        
        // 重新设置 baseStats 和 artifacts
        const baseStatsByName = {};
        Object.keys(heroesByName)
                .forEach(x => {
                    const baseStats = module.exports.getBaseStatsByName(x);
                    baseStatsByName[x] = baseStats;
                });
        await Api.setArtifacts(artifactsByName);
        await Api.setBaseStats(baseStatsByName);
        
        console.log('Hero data refresh completed');
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

    /* 拉取新数据时的合并规则（同名刷新 / 同 code 的旧名丢弃 / 只有新 code 才追加），导出给脚本用 */
    mergeArtifactData: mergeArtifactData,

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

