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
            Notifier.info(i18next.t("Pull Latest Data") + " " + i18next.t("Complete"));
        });

        // 检查更新
        document.getElementById('checkForUpdatesSubmit').addEventListener("click", async () => {
            Notifier.info(i18next.t("Checking for updates"));
            ipcRenderer.send('check');
        });
    }
};
