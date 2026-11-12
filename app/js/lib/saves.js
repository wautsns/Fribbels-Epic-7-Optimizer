const remote = require('@electron/remote');
const fs = require('fs');
const zlib = require('zlib');
const dialog = remote.dialog;
const currentWindow = remote.getCurrentWindow();

const documentsPath = remote.app.getPath('documents');
const savesFolder = documentsPath + '/FribbelsOptimizerSaves';

// const defaultPath = Files.isMac() ?
//                     (Files.getDataPath() + "/saves/").replace(/\//g, "/") :
//                     (Files.getDataPath() + "/saves/").replace(/\//g, "\\");
const defaultPath = savesFolder;

/* autoSaveSoon 的合并计时器 */
let autoSaveTimer = null;

module.exports = {

    createFolder: () => {
        Files.createFolder(savesFolder);
    },

    autoSave: async () => {
        module.exports.createFolder();
        module.exports.saveData(Settings.getDefaultPath() + '/autosave.json');
    },

    /*
     * 合并短时间内的多次自动存档请求（一次 GVG 置队会触发好几处 save 调用，
     * 每次都要拉全量 heroes + items 再写 ~几 MB 的 JSON，是卡顿的主要来源之一）。
     */
    autoSaveSoon: (delay) => {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);

        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = null;
            module.exports.autoSave();
        }, delay == null ? 250 : delay);
    },

    saveData: async (filename) => {
        try {
            module.exports.createFolder();
            const getAllHeroesResponse = await Api.getAllHeroes();
            const getAllItemsResponse = await Api.getAllItems();

            const data = {
                heroes: getAllHeroesResponse.heroes,
                items: getAllItemsResponse.items,
                // GVG 作业跟存档一起走（docs/gvg/design.md 11.2）：
                // 必须紧贴 stringify 之前读，否则 await 期间改的作业会被写旧值覆盖
                gvgPlans: global.GvgPlans ? GvgPlans.getAll() : []
            }

            const stringified = JSON.stringify(data);
            const compressed = zlib.deflateSync(Buffer.from(stringified, 'utf8'));
            fs.writeFileSync(Files.path(filename), compressed);

            return data;
        } catch (e) {
            Dialog.error("Unable to save file. Please try disabling your antivirus, or add the app as an exception, then restarting the app in admin mode. Check if your saves folder is under OneDrive on the Settings tab, and if so, change it to somewhere else.")
        }
    },

    /** 读存档文件：优先尝试 zlib 解压，失败就当纯文本 JSON（兼容老版本） */
    readSaveFile: (filepath) => {
        const buf = fs.readFileSync(Files.path(filepath));
        try {
            return zlib.inflateSync(buf).toString('utf8');
        } catch (_) {
            return buf.toString('utf8');
        }
    },

    loadAutoSave: async () => {
        const autoSavePath = Settings.getDefaultPath() + '/autosave.json';

        // 正常流程的启动日志用 debug（DevTools 默认不显示），别用 warn 吓人
        console.debug('[saves] loading autosave:', autoSavePath);

        try {
            const data = module.exports.readSaveFile(Files.path(autoSavePath));
            const parsed = JSON.parse(data);
            await module.exports.loadSavedData(parsed);

            const heroCount = Array.isArray(parsed.heroes) ? parsed.heroes.length : 0;
            const itemCount = Array.isArray(parsed.items) ? parsed.items.length : 0;
            console.debug(
                '[saves] autosave loaded:',
                itemCount + ' items,',
                heroCount + ' heroes'
            );
        } catch (e) {
            // Notifier.error("Failed to load autosave - " + e);
            console.warn("Failed to load autosave -", e);
        }
    },

    initialize: async () => {
        module.exports.createFolder();

        document.getElementById('saveDataSubmit').addEventListener("click", async () => {
            const options = {
                title: "Save file",
                defaultPath : Files.path(Settings.getDefaultPath() + "/" + getDateString() + '-export.json.zlib'),
                buttonLabel : "Save file",
                filters :[
                    {name: 'Compressed save (zlib)', extensions: ['json.zlib']},
                    {name: 'JSON', extensions: ['json']},
                ]
            }
            const filename = dialog.showSaveDialogSync(currentWindow, options);
            console.debug('[saves] save to:', filename);

            if (!filename) return;

            const data = await module.exports.saveData(Files.path(filename));
            await module.exports.autoSave();
            console.debug(
                '[saves] saved:',
                data.items.length + ' items,',
                data.heroes.length + ' heroes'
            );
            $('#saveDataSubmitOutputText').text(`Saved ${data.heroes.length} heroes and ${data.items.length} items to ${filename}`)
        });

        document.getElementById('loadDataSubmit').addEventListener("click", async () => {
            const options = {
                title: "Load file",
                defaultPath : Files.path(Settings.getDefaultPath()),
                buttonLabel : "Load file",
                filters :[
                    {name: 'All save files', extensions: ['json', 'json.zlib']},
                    {name: 'JSON', extensions: ['json']},
                    {name: 'Compressed save (zlib)', extensions: ['json.zlib']},
                ]
            }
            const filenames = dialog.showOpenDialogSync(currentWindow, options);
            console.debug('[saves] load from:', filenames);

            if (!filenames || filenames.length < 1) {
                // 取消对话框是正常操作，不算告警
                return console.debug('[saves] load cancelled');
            };

            const data = module.exports.readSaveFile(filenames[0]);
            const parsedData = JSON.parse(data);
            // 加载是严格快照（缺 gvgPlans 键会清空作业），覆盖前先备份当前存档
            module.exports.backupAutoSave();
            await module.exports.loadSavedData(parsedData);
            console.debug('[saves] loaded file:', filenames[0]);

            const planNote = Array.isArray(parsedData.gvgPlans)
                ? `${parsedData.gvgPlans.length} GVG plans`
                : 'no GVG plan data (local GVG plans were cleared)';
            $('#loadDataSubmitOutputText').text(`Loaded ${parsedData.heroes.length} heroes, ${parsedData.items.length} items and ${planNote} from ${filenames[0]}`)
            module.exports.autoSave();

        })
    },

    loadSavedData: async (data) => {
        if (!data || !data.items || !data.heroes) {
            Notifier.error("Invalid save data");
            return console.error("Invalid loaded data", data);
        }

        ItemAugmenter.augment(data.items);

        // 只打数量：整份 items/heroes 打出来有几十万字符，启动时刷一屏没意义
        console.debug(
            '[saves] loaded:',
            data.items.length + ' items,',
            data.heroes.length + ' heroes'
        );

        if (data.heroes && data.heroes.filter(x => x.name == "Euglmomorain").length > 0) {
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

            const status = euglmomorainData.calculatedStatus;
            var euglmomorainBaseStats = {
                lv50FiveStarFullyAwakened: baseToStatObj(status.lv50FiveStarFullyAwakened),
                lv60SixStarFullyAwakened: baseToStatObj(status.lv60SixStarFullyAwakened)
            }

            const baseStatsByName = {};
            Object.keys(HeroData.getAllHeroData())
                    .forEach(x => {
                        const baseStats = HeroData.getBaseStatsByName(x);
                        baseStatsByName[x] = baseStats;
                    });

            baseStatsByName["Euglmomorain"] = euglmomorainBaseStats;
            await Api.setBaseStats(baseStatsByName);
            HeroData.getAllHeroData()["Euglmomorain"] = euglmomorainData
        }

        await Api.setItems(data.items);
        await Api.setHeroes(data.heroes);

        const heroData = HeroData.getAllHeroData();
        const heroNames = Object.keys(heroData);


        // Remove bad overrides
        for (var hero of data.heroes) {
            if (!heroNames.includes(hero.name)) {
                await Api.removeHeroById(hero.id);
            }
        }

        // GVG 作业：缺 gvgPlans 键 = 覆盖为空（严格快照，docs/gvg/design.md 11.2）
        if (global.GvgPlans) {
            const planResult = GvgPlans.setAll(data.gvgPlans);
            if (planResult.skipped) {
                console.warn('GVG: skipped invalid GVG plans', planResult.skipped);
                Notifier.warnRaw(`${i18next.t('Skipped invalid GVG plans')}: ${planResult.skipped}`);
            }
        }

        OptimizerTab.redrawHeroSelector();
        HeroesTab.redraw();
        if (global.GvgTab) GvgTab.redraw();
    },

    /** 把当前 autosave.json 复制成 autosave.bak.json（加载覆盖前的兜底）；
     *  直接按原始字节复制，不关心内部是压缩还是纯文本 */
    backupAutoSave: () => {
        try {
            const autoSavePath = Settings.getDefaultPath() + '/autosave.json';
            if (!fs.existsSync(Files.path(autoSavePath))) return;

            fs.copyFileSync(
                Files.path(autoSavePath),
                Files.path(Settings.getDefaultPath() + '/autosave.bak.json')
            );
        } catch (error) {
            console.warn('Failed to back up autosave', error);
        }
    },
}

function getDateString() {
    const now = new Date();
    const dateString = new Date(now.getTime() - (now.getTimezoneOffset() * 60000 ))
                    .toISOString()
                    .split("T")[0];
    return dateString;
}

global.euglmomorainData = {
    "_id": "euglmomorain",
    "name": "Euglmomorain",
    "moonlight": true,
    "rarity": 3,
    "attribute": "light",
    "role": "manauser",
    "zodiac": "fish",
    "self_devotion": {
      "type": "res",
      "grades": {
        "D": 0.045,
        "C": 0.068,
        "B": 0.09,
        "A": 0.112,
        "S": 0.135,
        "SS": 0.158,
        "SSS": 0.18
      }
    },
    "devotion": {
      "type": "def",
      "grades": {
        "D": 12,
        "C": 18,
        "B": 24,
        "A": 30,
        "S": 36,
        "SS": 42,
        "SSS": 48
      },
      "slots": {
        "1": true,
        "2": true,
        "3": true,
        "4": true
      }
    },
    "assets": {
      "icon": "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/main/data/cachedimages/euglmomorainPortrait.png",
      "image": "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/main/data/cachedimages/question_circle.png",
      "thumbnail": "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/main/data/cachedimages/euglmomorainPanel.png"
    },
    "ex_equip": [],
    "calculatedStatus": {
      "lv50FiveStarNoAwaken": {
        "cp": 9236,
        "atk": 313,
        "hp": 3270,
        "spd": 94,
        "def": 511,
        "chc": 0.15,
        "chd": 1.5,
        "dac": 0.05,
        "eff": 0,
        "efr": 0
      },
      "lv50FiveStarFullyAwakened": {
        "cp": 10755,
        "atk": 433,
        "hp": 3904,
        "spd": 94,
        "def": 556,
        "chc": 0.15,
        "chd": 1.5,
        "dac": 0.05,
        "eff": 0,
        "efr": 0,
        "bonusMaxAtkPercent": 0,
        "bonusMaxDefPercent": 0,
        "bonusMaxHpPercent": 0,
        "overrideAtk": 0,
        "overrideHp": 4231,
        "overrideDef": 0,
        "overrideAdditionalCr": 0,
        "overrideAdditionalCd": 0,
        "overrideAdditionalSpd": 0,
        "overrideAdditionalEff": 0,
        "overrideAdditionalRes": 0.4
      },
      "lv60SixStarNoAwaken": {
        "cp": 11520,
        "atk": 390,
        "hp": 4111,
        "spd": 94,
        "def": 634,
        "chc": 0.15,
        "chd": 1.5,
        "dac": 0.05,
        "eff": 0,
        "efr": 0
      },
      "lv60SixStarFullyAwakened": {
        "cp": 13775,
        "atk": 540,
        "hp": 4900,
        "spd": 94,
        "def": 729,
        "chc": 0.15,
        "chd": 1.5,
        "dac": 0.05,
        "eff": 0,
        "efr": 0,
        "bonusMaxAtkPercent": 0,
        "bonusMaxDefPercent": 0,
        "bonusMaxHpPercent": 0,
        "overrideAtk": 0,
        "overrideHp": 5312,
        "overrideDef": 0,
        "overrideAdditionalCr": 0,
        "overrideAdditionalCd": 0,
        "overrideAdditionalSpd": 0,
        "overrideAdditionalEff": 0,
        "overrideAdditionalRes": -3
      }
    }
  }