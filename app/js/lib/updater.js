const { ipcRenderer } = require('electron');
global.ipcRenderer = ipcRenderer;
const currentVersion = "2.1.0";

global.TEST = false;
global.HeroData = require('./heroData');
global.DataLoader = require('./dataLoader');

module.exports = {

    getCurrentVersion: () => {
        return currentVersion;
    },
    showNewFeatures: (text) => {
        Dialog.showNewFeatures(

`
<h2>
    New in v2.1.0
</h2>
<ul class="newFeatures">
    <li>Added new Riposte and Reversal Sets</li>
    <li>Added support for defense stat artifacts</li>
    <li>Fixed various bugs</li>
</ul>
`
        );
    },

    checkForUpdates: async () => {
        const version = document.getElementById('version');
        version.innerText = ": v" + currentVersion;

        ipcRenderer.on('update_available', () => {
            Notifier.info(i18next.t("New version available, downloading now"));
        });
        ipcRenderer.on('update_not_available', () => {
        });
        ipcRenderer.on('test', (arg1, arg2) => {
            console.log("test", arg1, arg2)
        });
        ipcRenderer.on('check', (arg1, arg2) => {
            console.log("check", arg1, arg2)
            try {
                if (typeof arg2 === 'string' || arg2 instanceof String) {
                    const response = JSON.parse(arg2);
                    console.log(response);
                    const updateVersion = response.updateInfo.version;

                    if (currentVersion == updateVersion) {
                        Notifier.info(i18next.t("No new updates found"));
                    }
                } else {
                    const response = arg2;
                    console.log(response);
                    const updateVersion = response.updateInfo.version;

                    if (currentVersion == updateVersion) {
                        Notifier.info(i18next.t("No new updates found"));
                    }
                }
            } catch (e) {
                console.warn("Failed to parse IPC response", e)
                Notifier.info(i18next.t("No new updates found"));
            }
        });
        ipcRenderer.on('update_downloaded', async (arg1, arg2) => {
            console.log("update_downloaded", arg1, arg2)
            var response = await Dialog.updatePrompt("Update downloaded. It will be installed on restart. Restart app now?")

            if (response == 'restart') {
                await Subprocess.kill();
                restartApp();
            }
        });

        function restartApp() {
            ipcRenderer.send('restart_app');
        }

        // 拉取最新数据（英雄/神器/翻译）
        document.getElementById('pullLatestDataSubmit').addEventListener("click", async () => {
            Notifier.info(i18next.t("Pull Latest Data") + "...");
            await HeroData.refreshData();
            RtaStats.reload();
            Notifier.info(i18next.t("Pull Latest Data") + " " + i18next.t("Complete"));
        });

        // 导入 RTAStats 数据（国服官方战绩站 -> app/js/data/rtaStats.json）
        // 只在英雄列表为空时允许导入：新增英雄 + 写入各自的套装/属性配置
        document.getElementById('loadRtaStatsSubmit').addEventListener("click", async () => {
            const button = document.getElementById('loadRtaStatsSubmit');
            if (button.disabled) return;

            let summary;
            let existingHeroes;
            try {
                summary = RtaStats.reload();
                const heroesResponse = await Api.getAllHeroes();
                existingHeroes = (heroesResponse && heroesResponse.heroes) || [];
            } catch (e) {
                Dialog.error(`读取英雄列表失败：${e && e.message ? e.message : e}`);
                return;
            }

            if (existingHeroes.length > 0) {
                Dialog.error(`英雄列表里已经有 ${existingHeroes.length} 个英雄，RTAStats 导入只允许在列表为空时使用`);
                return;
            }

            const confirmed = await Dialog.confirmation(
                `将导入 ${summary.count} 个英雄，并写入各自的套装与属性配置。是否继续？`,
                '导入 RTAStats 数据'
            );
            if (!confirmed) return;

            button.disabled = true;
            button.value = '导入中...';
            Notifier.info(`正在导入 ${summary.count} 个英雄...`);

            try {
                const result = await RtaStats.importHeroes((done, total) => {
                    if (done === total || done % 20 === 0) {
                        Notifier.quick(`导入配置 ${done}/${total}`);
                    }
                });

                if (result.failed && result.failed.length) {
                    Dialog.error(`导入完成，但有 ${result.failed.length} 个英雄配置写入失败：${result.failed.slice(0, 5).join('、')}`);
                } else {
                    Notifier.success(`已导入 ${result.total} 个英雄及其 RTAStats 配置`);
                }
            } catch (e) {
                Dialog.error(`导入失败：${e && e.message ? e.message : e}`);
            } finally {
                button.disabled = false;
                button.value = '导入 RTAStats 数据';
            }
        });

        // 检查更新
        document.getElementById('checkForUpdatesSubmit').addEventListener("click", async () => {
            Notifier.info(i18next.t("Checking for updates"));
            ipcRenderer.send('check');
        });
    }
};
