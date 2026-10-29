/**
 * GVG 作业页 —— 面板接线：3 个防守筛选框 + 底部 6 个按钮 + 行内操作（docs/gvg/design.md 6.1 / 6.6）
 *
 * 页面结构在 app/app.html 的 #gvg-section；表格在 GvgGrid；数据在 GvgPlans。
 */
const remote = require('@electron/remote');

const { dialog } = remote;
const currentWindow = remote.getCurrentWindow();
const { clipboard } = require('electron');
const Swal = require('sweetalert2');

const FILTER_COUNT = 3;

module.exports = {
    initialize: () => {
        module.exports.redrawFilterOptions();

        // 面板初始是 display:none，ag-grid 在隐藏状态下量不到宽度：切到这个标签页时重画一次
        const tabRadio = document.getElementById('tab9');
        if (tabRadio) {
            tabRadio.addEventListener('change', () => {
                if (tabRadio.checked) GvgGrid.refresh();
            });
        }

        for (let index = 0; index < FILTER_COUNT; index++) {
            const select = document.getElementById(`gvg-filter-${index}`);
            if (!select) continue;

            select.addEventListener('change', () => {
                GvgGrid.setFilter(index, select.value);
            });
        }

        bindClick('gvg-add', () => module.exports.addPlan());
        bindClick('gvg-paste', () => module.exports.pastePlan());
        bindClick('gvg-export', () => module.exports.exportPlans());
        bindClick('gvg-import', () => module.exports.importPlans());
        bindClick('gvg-dedupe', () => module.exports.dedupePlans());
        bindClick('gvg-clear', () => module.exports.clearPlans());
    },

    /** 数据变了：重画筛选选项 + 表格 */
    redraw: () => {
        module.exports.redrawFilterOptions();
        GvgGrid.refresh();
    },

    /** 筛选框只列「作业里出现过的防守英雄」（design.md 6.3），选中值尽量保留 */
    redrawFilterOptions: () => {
        const options = GvgPlans.getDefenseFilterOptions();

        for (let index = 0; index < FILTER_COUNT; index++) {
            const select = document.getElementById(`gvg-filter-${index}`);
            if (!select) continue;

            const selected = select.value;
            select.innerHTML = '';

            const blank = document.createElement('option');
            blank.value = '';
            blank.innerText = i18next.t('Any');
            select.add(blank);

            options.forEach((option) => {
                const element = document.createElement('option');
                element.value = option.code;
                element.innerText = i18next.t(option.name);
                select.add(element);
            });

            if (
                selected &&
                options.some((option) => option.code === selected)
            ) {
                select.value = selected;
                GvgGrid.setFilter(index, selected);
            } else {
                select.value = '';
                GvgGrid.setFilter(index, '');
            }
        }
    },

    /* ---------------- 行内操作 ---------------- */

    showDetails: (id) => GvgDialog.showDetails(id),

    editPlan: (id) => GvgDialog.editPlan(id),

    copyPlan: (id) => {
        const plan = GvgPlans.getById(id);
        if (!plan) return;

        try {
            clipboard.writeText(GvgPlans.encodeText(plan));
            Notifier.successRaw(i18next.t('GVG plan copied to clipboard'));
        } catch (error) {
            console.error('GVG: copy failed', error);
            Notifier.errorRaw(i18next.t('Failed to copy GVG plan'));
        }
    },

    deletePlan: async (id) => {
        const confirmed = await Dialog.confirmation(
            i18next.t('Delete this GVG plan?'),
            i18next.t('Confirm')
        );
        if (!confirmed) return;

        GvgPlans.remove(id);
    },

    pinFirst: (id) => GvgPlans.pinFirst(id),

    pinSecond: (id) => GvgPlans.pinSecond(id),

    /* ---------------- 底部按钮 ---------------- */

    addPlan: () => GvgDialog.editPlan(null),

    pastePlan: async () => {
        const result = await Swal.fire({
            title: i18next.t('Paste GVG plan'),
            input: 'textarea',
            inputAttributes: {
                style: 'font-family: monospace; font-size: 12px; word-break: break-all;',
                rows: 8,
                placeholder: `${GvgPlans.CLIPBOARD_PREFIX}...`,
            },
            showCancelButton: true,
            confirmButtonText: i18next.t('OK'),
            cancelButtonText: i18next.t('Cancel'),
        });

        if (!result.value) return;

        const decoded = GvgPlans.decodeText(result.value);
        if (decoded.error === 'invalidPrefix') {
            Notifier.errorRaw(i18next.t('This is not a GVG plan text'));
            return;
        }
        if (decoded.error === 'unsupportedVersion') {
            Notifier.errorRaw(
                i18next.t(
                    'This GVG plan text was created by an unsupported version'
                )
            );
            return;
        }
        if (decoded.error) {
            Notifier.errorRaw(
                i18next.t(
                    'Unable to read this GVG plan text, it may be corrupted'
                )
            );
            return;
        }

        const outcome = GvgPlans.importPlans(decoded.plans);
        reportImportOutcome(outcome);
    },

    exportPlans: () => {
        if (!GvgPlans.getAll().length) {
            Notifier.warn('There are no GVG plans to export');
            return;
        }

        const filename = dialog.showSaveDialogSync(currentWindow, {
            title: 'Export GVG plans',
            defaultPath: Files.path(
                `${Settings.getDefaultPath()}/` +
                    `gvg-plans-${dateString()}.json`
            ),
            buttonLabel: 'Save file',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });

        if (!filename) return;

        try {
            Files.saveFile(
                Files.path(filename),
                JSON.stringify(GvgPlans.buildPackage(), null, 2)
            );
            Notifier.successRaw(
                `${i18next.t('Exported GVG plans')} (${
                    GvgPlans.getAll().length
                })`
            );
        } catch (error) {
            console.error('GVG: export failed', error);
            Notifier.errorRaw(i18next.t('Failed to export GVG plans'));
        }
    },

    importPlans: () => {
        const filenames = dialog.showOpenDialogSync(currentWindow, {
            title: 'Import GVG plans',
            defaultPath: Files.path(Settings.getDefaultPath()),
            buttonLabel: 'Load file',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile'],
        });

        if (!filenames || !filenames.length) return;

        let text;
        try {
            text = Files.readFileSync(Files.path(filenames[0]));
        } catch (error) {
            console.error('GVG: unable to read file', error);
            Notifier.errorRaw(i18next.t('Unable to read the selected file'));
            return;
        }

        const parsed = GvgPlans.parsePackage(text);
        if (parsed.error === 'invalidSchema') {
            Notifier.errorRaw(i18next.t('This file is not a GVG plans export'));
            return;
        }
        if (parsed.error === 'unsupportedVersion') {
            Notifier.errorRaw(
                i18next.t('This file was exported by an unsupported version')
            );
            return;
        }
        if (parsed.error) {
            Notifier.errorRaw(i18next.t('Unable to read the selected file'));
            return;
        }

        reportImportOutcome(GvgPlans.importPlans(parsed.plans));
    },

    dedupePlans: async () => {
        if (!GvgPlans.getAll().length) {
            Notifier.warn('There are no GVG plans to dedupe');
            return;
        }

        const confirmed = await Dialog.confirmation(
            i18next.t(
                'Remove duplicated GVG plans? The oldest copy of each duplicate is kept.'
            ),
            i18next.t('Confirm')
        );
        if (!confirmed) return;

        const removed = GvgPlans.dedupe();
        if (removed > 0) {
            Notifier.successRaw(
                `${i18next.t('Removed duplicated GVG plans')} (${removed})`
            );
        } else {
            Notifier.infoRaw(i18next.t('No duplicated GVG plans found'));
        }
    },

    clearPlans: async () => {
        if (!GvgPlans.getAll().length) return;

        const confirmed = await Dialog.confirmation(
            i18next.t('Delete all GVG plans?'),
            i18next.t('Confirm')
        );
        if (!confirmed) return;

        GvgPlans.clear();
    },
};

/* ------------------------------------------------------------------ *
 * 内部
 * ------------------------------------------------------------------ */

function bindClick(id, handler) {
    const element = document.getElementById(id);
    if (element) element.addEventListener('click', handler);
}

function reportImportOutcome(outcome) {
    if (outcome.added && outcome.duplicates) {
        Notifier.successRaw(
            `${i18next.t('Imported GVG plans')}: ${outcome.added} · ${i18next.t(
                'Already exists'
            )}: ${outcome.duplicates}`
        );
        return;
    }
    if (outcome.added) {
        Notifier.successRaw(
            `${i18next.t('Imported GVG plans')}: ${outcome.added}`
        );
        return;
    }
    if (outcome.duplicates) {
        Notifier.warnRaw(i18next.t('This GVG plan already exists'));
        return;
    }
    Notifier.errorRaw(i18next.t('No valid GVG plan found'));
}

function dateString() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .split('T')[0];
}
