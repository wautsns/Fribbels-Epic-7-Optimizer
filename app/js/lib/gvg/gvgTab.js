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

        // 进攻阵容角色条目 / builds：heroTable 组件的第二个实例
        GvgTeamTable.initialize();

        // 面板初始是 display:none，ag-grid 与筛选下拉在隐藏状态下都量不到尺寸：
        // 切到这个标签页时整体重画一次（选项 + 表格）
        const tabRadio = document.getElementById('tab9');
        if (tabRadio) {
            tabRadio.addEventListener('change', () => {
                if (tabRadio.checked) module.exports.redraw();
            });
        }

        for (let index = 0; index < FILTER_COUNT; index++) {
            const select = document.getElementById(`gvg-filter-${index}`);
            if (!select) continue;

            // 升级成 multiple-select 之后，插件改值是 jQuery trigger('change')，
            // 原生 addEventListener 收不到，所以统一走 bindFilterChange
            bindFilterChange(select, () => {
                GvgGrid.setFilter(index, select.value);
            });
        }

        upgradeFilterSelects();

        bindClick('gvg-add', () => module.exports.addPlan());
        bindClick('gvg-paste', () => module.exports.pastePlan());
        bindClick('gvg-export', () => module.exports.exportPlans());
        bindClick('gvg-import', () => module.exports.importPlans());
        bindClick('gvg-dedupe', () => module.exports.dedupePlans());
        bindClick('gvg-clear', () => module.exports.clearPlans());
        bindClick('gvg-clear-teams', () => module.exports.clearTeams());
        bindClick('clearGvgFilter', () => module.exports.clearFilters());
    },

    /** 数据变了：重画筛选选项 + 作业表 + 进攻阵容角色条目 / builds */
    redraw: (heroes) => {
        module.exports.redrawFilterOptions();
        GvgGrid.refresh();

        if (typeof GvgTeamTable !== 'undefined') {
            GvgTeamTable.refresh(heroes);
        }
    },

    /** 筛选框只列「作业里出现过的防守英雄」（design.md 6.3），选中值尽量保留 */
    redrawFilterOptions: () => {
        const options = GvgPlans.getDefenseFilterOptions();

        for (let index = 0; index < FILTER_COUNT; index++) {
            const select = document.getElementById(`gvg-filter-${index}`);
            if (!select) continue;

            const selected = select.value;
            select.innerHTML = '';

            options.forEach((option) => {
                const element = document.createElement('option');
                element.value = option.code;
                element.innerText = i18next.t(option.name);
                select.add(element);
            });

            const keep =
                selected && options.some((option) => option.code === selected)
                    ? selected
                    : '';

            select.value = keep;
            refreshFilterSelect(select, keep);
            GvgGrid.setFilter(index, keep);
        }
    },

    /* ---------------- 筛选 ---------------- */

    /** 清空 3 个防守筛选：下拉是单选、列表里没有「任意」项，所以需要这个复位动作 */
    clearFilters: () => {
        for (let index = 0; index < FILTER_COUNT; index++) {
            const select = document.getElementById(`gvg-filter-${index}`);
            if (!select) continue;

            select.value = '';
            refreshFilterSelect(select, '');
            GvgGrid.setFilter(index, '');
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

    /* ---------------- 置为进攻阵容 1 / 2 ---------------- */

    /*
     * 一次点击只取一次英雄快照，后面「脱旧阵容装备 → 刷新表格 → 查缺失条目」都用它，
     * 避免原来的 8~10 次 /heroes/getAllHeroes 全量请求（卡顿主因）。
     */
    pinFirst: async (id) => {
        const before = GvgPlans.getTeams();
        if (!GvgPlans.pinFirst(id)) return;

        const heroes = await GvgTeamGrid.fetchHeroes();
        await releaseLosingLineups(before, GvgPlans.getTeams(), heroes);
        await GvgTeamTable.refresh(heroes);
        await confirmTeamEntries(heroes);
    },

    pinSecond: async (id) => {
        const before = GvgPlans.getTeams();
        if (!GvgPlans.pinSecond(id)) return;

        const heroes = await GvgTeamGrid.fetchHeroes();
        await releaseLosingLineups(before, GvgPlans.getTeams(), heroes);
        await GvgTeamTable.refresh(heroes);
        await confirmTeamEntries(heroes);
    },

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

    /**
     * 清除进攻阵容标记：清完 commit 会重画列表，蓝底的 1 / 2 徽章自然回到常规色；
     * 原来两个阵容的角色条目装备会被脱掉，下方角色条目表也会跟着刷新。
     */
    clearTeams: async () => {
        const before = GvgPlans.getTeams();
        if (!before.first && !before.second) return;

        GvgPlans.clearTeams();

        const heroes = await GvgTeamGrid.fetchHeroes();
        await releaseLosingLineups(before, GvgPlans.getTeams(), heroes);
        await GvgTeamTable.refresh(heroes);

        Notifier.successRaw(i18next.t('Team markers cleared'));
    },
};

/* ------------------------------------------------------------------ *
 * 内部
 * ------------------------------------------------------------------ */

function bindClick(id, handler) {
    const element = document.getElementById(id);
    if (element) element.addEventListener('click', handler);
}

/**
 * 3 个防守筛选下拉：与「新增作业 → 从英雄列表带入」用同一个 multiple-select 组件
 * （单选 + 搜索框）。选项重建之后要把插件视图一起刷新，所以这里封了一组小工具。
 */
function upgradeFilterSelects() {
    if (typeof $ === 'undefined' || !$.fn || !$.fn.multipleSelect) return;

    for (let index = 0; index < FILTER_COUNT; index++) {
        const element = document.getElementById(`gvg-filter-${index}`);
        if (!element) continue;

        // 已经升级过的不要再套一次（插件会把原生 select 标成 ms-offscreen）
        if (element.classList && element.classList.contains('ms-offscreen')) {
            continue;
        }

        $(element).multipleSelect({
            filter: true,
            filterAcceptOnEnter: true,
            single: true,
            maxHeight: 360,
            // 跟英雄列表上方的英雄下拉（#addHeroesSelector = .gearPreviewButton 的 140px）一样宽
            width: 140,
            placeholder: i18next.t('Hero'),
            // 插件改的是原生 select 的 value，这里补一次筛选
            onSelect: () => GvgGrid.setFilter(index, element.value),
            onUnselect: () => GvgGrid.setFilter(index, element.value),
        });
    }
}

/** 升级过的下拉改值走的是 jQuery trigger('change')，原生监听收不到 */
function bindFilterChange(element, handler) {
    if (typeof $ !== 'undefined' && $.fn) {
        $(element).on('change', handler);
        return;
    }
    element.addEventListener('change', handler);
}

/** 选项重建后同步插件视图，并尽量保留当前选中项 */
function refreshFilterSelect(element, selected) {
    if (typeof $ === 'undefined' || !$.fn || !$.fn.multipleSelect) return;
    // 还没升级过（原生 select 不会是 ms-offscreen），此时直接设 value 就够了
    if (!element.classList || !element.classList.contains('ms-offscreen')) return;

    try {
        $(element).multipleSelect('refresh');
        $(element).multipleSelect('setSelects', selected ? [selected] : []);
    } catch (error) {
        console.warn('GVG: unable to refresh filter select', error);
    }
}

/**
 * 进攻阵容标记变化后：不再属于任何阵容的作业，把它进攻阵容成员对应的
 * 角色条目的装备全部脱掉（用户要求：被顶掉 / 清标记就等于这套阵容不用了）。
 * heroes 是本次 pin 流程共用的英雄快照。
 */
async function releaseLosingLineups(before, after, heroes) {
    if (typeof GvgTeamGrid === 'undefined' || !GvgTeamGrid) return;

    const beforeIds = [before && before.first, before && before.second].filter(
        Boolean
    );
    const afterIds = [after && after.first, after && after.second].filter(
        Boolean
    );
    const losingIds = beforeIds.filter((planId) => !afterIds.includes(planId));

    for (const planId of losingIds) {
        try {
            const released = await GvgTeamGrid.releasePlanEntries(
                planId,
                heroes
            );
            if (released.length) {
                Notifier.infoRaw(
                    `${i18next.t(
                        'Unequipped the old lineup hero entries'
                    )}: ${released.length}`
                );
            }
        } catch (error) {
            console.warn('GVG: unable to release the old lineup entries', error);
        }
    }
}

/**
 * 置为进攻阵容 1 / 2 之后：检查这队的成员是否都还有对应的角色条目。
 * 缺的先列出来问一次，用户确认才新建 —— 不静默往英雄列表里加东西。
 */
async function confirmTeamEntries(heroes) {
    if (typeof GvgTeamGrid === 'undefined' || !GvgTeamGrid) return;

    const missing = await GvgTeamGrid.findMissingEntries(heroes);
    if (!missing.length) return;

    const names = missing.map((entry) => i18next.t(entry.heroName));
    const html = `
        <div style="text-align:left;font-size:14px">
            <div>${i18next.t('These heroes need a new hero entry')}:</div>
            <ul style="margin:8px 0 0 18px;padding:0">
                ${names.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}
            </ul>
        </div>`;

    const confirmed = await Dialog.htmlConfirmation(
        html,
        i18next.t('Create hero entries')
    );
    if (!confirmed) return;

    await GvgTeamGrid.createMissingEntries(missing);

    // 新建完立刻重画角色条目表（新条目要出现在里面）
    await GvgTeamTable.refresh();
}

function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
