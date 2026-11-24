/**
 * GVG 作业页 —— 面板接线：3 个防守筛选框 + 1 个进攻筛选框 + 底部 7 个按钮 + 行内操作（docs/gvg/design.md 6.1 / 6.6）
 *
 * 页面结构在 app/app.html 的 #gvg-section；表格在 GvgGrid；数据在 GvgPlans。
 */
const remote = require('@electron/remote');
const zlib = require('zlib');
const fs = require('fs');

const { dialog } = remote;
const currentWindow = remote.getCurrentWindow();
const { clipboard } = require('electron');
const Swal = require('sweetalert2');

const FILTER_COUNT = 3;        // 防守筛选数量（gvg-filter-0 / 1 / 2）
const FILTER_ATTACK_INDEX = 3; // 进攻筛选在 filterCodes 里的下标（gvg-filter-attack → index 3）

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

        // 进攻英雄筛选（单独的 select id，在 filterCodes 里下标 3）
        const attackSelect = document.getElementById('gvg-filter-attack');
        if (attackSelect) {
            bindFilterChange(attackSelect, () => {
                GvgGrid.setFilter(FILTER_ATTACK_INDEX, attackSelect.value);
            });
        }

        upgradeFilterSelects();

        bindClick('gvg-add', () => module.exports.addPlan());
        bindClick('gvg-paste', () => module.exports.pastePlan());
        bindClick('gvg-export', () => module.exports.exportPlans());
        bindClick('gvg-import', () => module.exports.importPlans());
        bindClick('gvg-equip-team', () => module.exports.equipTeam());
        bindClick('gvg-mark-used', () => module.exports.markUsed());
        bindClick('gvg-cleanup-heroes', () => module.exports.cleanupUnusedHeroes());
        bindClick('gvg-clear', () => module.exports.clearPlans());
        bindClick('gvg-clear-teams', () => module.exports.clearTeams());
        bindClick('clearGvgFilter', () => module.exports.clearFilters());
    },

    /** 数据变了：重画筛选选项 + 作业表 + 进攻阵容角色条目 / builds */
    redraw: (heroes) => {
        const cacheWarm = GvgPlans.hasHeroEntries();

        module.exports.redrawFilterOptions();
        GvgGrid.refresh();

        if (typeof GvgTeamTable !== 'undefined') {
            Promise.resolve(GvgTeamTable.refresh(heroes))
                .then(() => {
                    // 缓存已经是热的：头像早就渲染正确，不必再整表重画一次
                    if (cacheWarm) return;
                    module.exports.redrawFilterOptions();
                    GvgGrid.refresh();
                })
                .catch(() => {});
        }
    },

    /** 筛选框只列「作业里出现过的英雄」（design.md 6.3），选中值尽量保留 */
    redrawFilterOptions: () => {
        const defenseOptions = GvgPlans.getDefenseFilterOptions();

        for (let index = 0; index < FILTER_COUNT; index++) {
            const select = document.getElementById(`gvg-filter-${index}`);
            if (!select) continue;

            fillFilterSelect(select, defenseOptions, index);
        }

        // 进攻筛选单独处理：选项来自进攻阵容成员
        const attackSelect = document.getElementById('gvg-filter-attack');
        if (attackSelect) {
            const attackOptions = GvgPlans.getAttackFilterOptions();
            fillFilterSelect(attackSelect, attackOptions, FILTER_ATTACK_INDEX);
        }
    },

    /* ---------------- 筛选 ---------------- */

    /** 清空 3 个防守 + 1 个进攻筛选：下拉是单选、列表里没有「任意」项，所以需要这个复位动作 */
    clearFilters: () => {
        for (let index = 0; index < FILTER_COUNT; index++) {
            clearOneFilter(index, document.getElementById(`gvg-filter-${index}`));
        }
        clearOneFilter(FILTER_ATTACK_INDEX, document.getElementById('gvg-filter-attack'));
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

    /* ---------------- 右键菜单 ---------------- */

    showPlanContextMenu,
    closePlanContextMenu,

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

        const outcome = await GvgPlans.importPlans(decoded);
        GvgPlans.invalidateHeroEntriesCache();
        reportImportOutcome(outcome);
    },

    exportPlans: async () => {
        if (!GvgPlans.getAll().length) {
            Notifier.warn('There are no GVG plans to export');
            return;
        }

        const filename = dialog.showSaveDialogSync(currentWindow, {
            title: 'Export GVG plans',
            defaultPath: Files.path(
                `${Settings.getDefaultPath()}/` +
                    `gvg-plans-${dateString()}.zjson`
            ),
            buttonLabel: 'Save file',
            filters: [
                { name: 'Compressed GVG plans (zlib)', extensions: ['zjson'] },
                { name: 'JSON', extensions: ['json'] },
            ],
        });

        if (!filename) return;

        try {
            const pkg = await GvgPlans.buildPackage();
            const json = JSON.stringify(pkg);
            const compressed = zlib.deflateSync(Buffer.from(json, 'utf8'));
            fs.writeFileSync(Files.path(filename), compressed);
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

    importPlans: async () => {
        const filenames = dialog.showOpenDialogSync(currentWindow, {
            title: 'Import GVG plans',
            defaultPath: Files.path(Settings.getDefaultPath()),
            buttonLabel: 'Load file',
            filters: [
                { name: 'All GVG plan files', extensions: ['json', 'zjson'] },
                { name: 'JSON', extensions: ['json'] },
                { name: 'Compressed GVG plans (zlib)', extensions: ['zjson'] },
            ],
            properties: ['openFile'],
        });

        if (!filenames || !filenames.length) return;

        let text;
        try {
            const buf = fs.readFileSync(Files.path(filenames[0]));
            try {
                text = zlib.inflateSync(buf).toString('utf8');
            } catch (_) {
                text = buf.toString('utf8');
            }
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

        const outcome = await GvgPlans.importPlans(parsed);
        GvgPlans.invalidateHeroEntriesCache();
        reportImportOutcome(outcome);
    },

    clearPlans: async () => {
        if (!GvgPlans.getAll().length) return;

        if (!(await confirmClearAllPlans())) return;

        GvgPlans.clear();
    },

    /**
     * 手动标记进攻阵容 1 / 2 已使用：更新它们的 lastUsedAt 为当前时间。
     * 置队本身不再自动刷新使用时间，用户点这个按钮来表示"这俩阵容我刚用过"。
     */
    markUsed: () => {
        const teams = GvgPlans.getTeams();
        if (!teams.first && !teams.second) {
            Notifier.warnRaw(i18next.t('No team markers to mark'));
            return;
        }

        const result = GvgPlans.markUsed();
        if (result.marked > 0) {
            Notifier.successRaw(
                `${i18next.t('Marked GVG plans as used')} (${result.marked})`
            );
        }
    },

    /**
     * 清理无用英雄：列出没有被任何 GVG 作业进攻阵容引用的角色条目，
     * 确认后批量删除。展示格式与编辑作业里的进攻成员一致：头像 + 名字#排名 + 神器 / 面板要求。
     */
    cleanupUnusedHeroes: async () => {
        const response = await Api.getAllHeroes();
        const heroes = (response && response.heroes) || [];

        const referenced = new Set();
        GvgPlans.getAll().forEach((plan) =>
            plan.offense.members.forEach((member) => {
                if (member.heroId) referenced.add(member.heroId);
            })
        );

        const unused = heroes
            .filter((hero) => !referenced.has(hero.id))
            .sort((a, b) => {
                const indexA = Number.isFinite(Number(a.index))
                    ? Number(a.index)
                    : Number.MAX_SAFE_INTEGER;
                const indexB = Number.isFinite(Number(b.index))
                    ? Number(b.index)
                    : Number.MAX_SAFE_INTEGER;
                return (
                    indexA - indexB ||
                    i18next.t(a.name).localeCompare(i18next.t(b.name))
                );
            });

        const doCleanup = unused.length > 0;

        if (!doCleanup) {
            Notifier.infoRaw(i18next.t('No unused heroes'));
            return;
        }

        const listHtml = unused
            .map((hero, position) => {
                const rank = Number.isFinite(Number(hero.index))
                    ? Number(hero.index)
                    : position + 1;
                const artifactText =
                    hero.artifactName && hero.artifactName !== 'None'
                        ? i18next.t(hero.artifactName)
                        : '';
                const requirementText =
                    hero.optimizationRequest && HeroesGrid.formatPanelRequirementForRequest
                        ? HeroesGrid.formatPanelRequirementForRequest(
                              hero.optimizationRequest
                          ) || ''
                        : '';
                const meta = [artifactText, requirementText]
                    .filter(Boolean)
                    .join(' · ');
                const avatar = HeroesGrid.heroIconSrc(hero.name);

                return `<div class="gvgUnusedHeroRow">
                    <img class="gvgUnusedHeroAvatar" src="${avatar}">
                    <div class="gvgUnusedHeroInfo">
                        <div class="gvgUnusedHeroName">${escapeHtml(
                            `${i18next.t(hero.name)} #${rank}`
                        )}</div>
                        <div class="gvgUnusedHeroMeta">${escapeHtml(
                            meta || '-'
                        )}</div>
                    </div>
                </div>`;
            })
            .join('');

        const confirmed = await Dialog.htmlConfirmation(
            `<div class="gvgUnusedHeroList">${listHtml}</div>`,
            i18next.t('Unused heroes ({{count}})', { count: unused.length })
        );
        if (!confirmed) return;

        let removed = 0;
        for (const hero of unused) {
            try {
                await Api.removeHeroById(hero.id);
                removed++;
            } catch (error) {
                console.warn('[GVG] remove unused hero failed', hero.id, error);
            }
        }

        Saves.autoSave();
        HeroesTab.redrawHeroInputSelector();
        await HeroesTab.redraw();
        HeroesGrid.redrawPreview();
        if (typeof GvgTeamTable !== 'undefined') {
            await GvgTeamTable.refresh();
        }

        Notifier.successRaw(
            i18next.t('Removed {{count}} unused hero(es)', { count: removed })
        );
    },

    /**
     * 一键装备：给进攻阵容 1 / 2 的角色条目按 builds 顺序挑第一套「互不抢装备」的配装。
     * 6 个角色之间共用一份已占用装备集合；某角色所有 builds 都冲突时跳过该角色。
     * 先给可选 builds 少的角色挑（可选越少越容易没得选），避免被可选多的角色抢光装备。
     */
    equipTeam: async () => {
        const teams = GvgPlans.getTeams();
        if (!teams.first && !teams.second) {
            Notifier.warnRaw(i18next.t('No team markers to equip'));
            return;
        }

        const heroes = await GvgTeamGrid.fetchHeroes();
        const rows = await GvgTeamGrid.getTeamHeroes(heroes);

        // 同一个角色条目可能同时出现在阵容 1 / 2，按 id 去重
        const uniqueHeroes = [];
        const seenHeroIds = new Set();
        for (const hero of rows) {
            if (seenHeroIds.has(hero.id)) continue;
            seenHeroIds.add(hero.id);
            uniqueHeroes.push(hero);
        }

        /** 一套 build 是否可用：6 件齐全且没有空槽 */
        const isUsableBuild = (build) => {
            const items = (build && build.items) || [];
            return items.length === 6 && !items.some((id) => id == null);
        };

        // 先给可选 builds 最少的角色挑：可选越少越容易没得选，避免被可选多的角色抢光装备
        const orderedHeroes = uniqueHeroes
            .map((hero) => ({
                hero,
                usableBuilds: (Array.isArray(hero.builds) ? hero.builds : [])
                    .filter(isUsableBuild),
            }))
            .sort((a, b) => a.usableBuilds.length - b.usableBuilds.length);

        const usedItemIds = new Set();
        const targets = [];
        let skipped = 0;

        for (const { hero, usableBuilds } of orderedHeroes) {
            const build = usableBuilds.find((candidate) =>
                candidate.items.every((id) => !usedItemIds.has(String(id)))
            );

            if (!build) {
                skipped++;
                continue;
            }

            build.items.forEach((id) => usedItemIds.add(String(id)));
            targets.push({ hero, items: build.items });
        }

        let equipped = 0;
        for (const target of targets) {
            try {
                await Api.equipItemsOnHero(target.hero.id, target.items);
                equipped++;
            } catch (error) {
                console.warn(
                    '[GVG] equip failed',
                    target.hero && target.hero.name,
                    error
                );
                skipped++;
            }
        }

        if (equipped > 0) Saves.autoSave();
        await GvgTeamTable.refresh();

        const message = i18next.t(
            'Equipped {{equipped}} heroes, {{skipped}} skipped',
            { equipped, skipped }
        );
        if (equipped > 0) {
            Notifier.successRaw(message);
        } else {
            Notifier.warnRaw(message);
        }
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

/** 清空全部作业时要求照抄的确认文字（会按当前语言显示，输入必须与它一致） */
const CLEAR_ALL_PLANS_CONFIRM_TEXT = 'I confirm clearing all GVG plans';

/**
 * 「清空」按钮的确认弹窗：比普通二次确认更重 —— 必须先照着输入确认文字，
 * 「清空」按钮才会从禁用变成可点；输入不对时按钮一直是灰的，点了也清不掉。
 */
async function confirmClearAllPlans() {
    const phrase = i18next.t(CLEAR_ALL_PLANS_CONFIRM_TEXT);
    let typed = '';

    const result = await Swal.fire({
        title: i18next.t('Delete all GVG plans?'),
        html: `
            <div class="gvgDangerConfirm">
                <div>${escapeHtml(
                    i18next.t('Please type this text to confirm')
                )}</div>
                <div id="gvgClearConfirmPhrase" class="gvgDangerConfirmPhrase">${escapeHtml(
                    phrase
                )}</div>
            </div>`,
        input: 'text',
        inputValue: '',
        inputAttributes: {
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
        },
        showCancelButton: true,
        focusConfirm: false,
        confirmButtonText: i18next.t('Clear'),
        cancelButtonText: i18next.t('Cancel'),
        didOpen: () => {
            const input = Swal.getInput();
            const confirmButton = Swal.getConfirmButton();

            // 输入和确认文字完全一致（忽略首尾空格）才放开按钮
            const syncConfirmButton = () => {
                typed = input ? input.value : '';
                if (confirmButton) {
                    confirmButton.disabled = typed.trim() !== phrase;
                }
            };

            syncConfirmButton();

            if (input) {
                input.addEventListener('input', syncConfirmButton);
                input.focus();
            }
        },
    });

    // 双重保险：按钮虽然被禁用了，这里再比一次输入内容
    return result.isConfirmed === true && typed.trim() === phrase;
}

/**
 * 3 个防守筛选下拉：与「新增作业 → 从英雄列表带入」用同一个 multiple-select 组件
 * （单选 + 搜索框）。选项重建之后要把插件视图一起刷新，所以这里封了一组小工具。
 */
function upgradeFilterSelects() {
    if (typeof $ === 'undefined' || !$.fn || !$.fn.multipleSelect) return;

    for (let index = 0; index < FILTER_COUNT; index++) {
        upgradeOneFilterSelect(document.getElementById(`gvg-filter-${index}`), index);
    }
    // 进攻筛选
    upgradeOneFilterSelect(document.getElementById('gvg-filter-attack'), FILTER_ATTACK_INDEX);
}

function upgradeOneFilterSelect(element, index) {
    if (!element) return;

    // 已经升级过的不要再套一次（插件会把原生 select 标成 ms-offscreen）
    if (element.classList && element.classList.contains('ms-offscreen')) {
        return;
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

/** 填充一个筛选下拉的选项，并尽量保留当前选中值（选中值不在新 options 里就清空） */
function fillFilterSelect(select, options, index) {
    if (!select) return;

    const selected = select.value;
    select.innerHTML = '';

    options.forEach((option) => {
        const element = document.createElement('option');
        const value = option.code != null ? option.code : option.id;
        element.value = value;
        element.innerText = i18next.t(option.name);
        select.add(element);
    });

    const keep =
        selected &&
        options.some(
            (option) =>
                (option.code != null ? option.code : option.id) === selected
        )
            ? selected
            : '';

    select.value = keep;
    refreshFilterSelect(select, keep);
    GvgGrid.setFilter(index, keep);
}

/** 清空一个筛选下拉 */
function clearOneFilter(index, select) {
    if (!select) return;

    select.value = '';
    refreshFilterSelect(select, '');
    GvgGrid.setFilter(index, '');
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

    // 群阵的条目要求和同名的自阵条目不一样（不吃自阵加成），标出来免得用户以为已经建过
    const names = missing.map((entry) =>
        entry.member.imprintMode === 'team'
            ? `${i18next.t(entry.heroName)} (${i18next.t('Team imprint')})`
            : i18next.t(entry.heroName)
    );
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

/* ---------------- GVG 作业右键菜单 ---------------- */

let planContextMenuElement = null;
let planContextMenuMouseDown = null;
let planContextMenuKeyDown = null;

function closePlanContextMenu() {
    if (planContextMenuMouseDown) {
        document.removeEventListener('mousedown', planContextMenuMouseDown, true);
        planContextMenuMouseDown = null;
    }
    if (planContextMenuKeyDown) {
        document.removeEventListener('keydown', planContextMenuKeyDown, true);
        planContextMenuKeyDown = null;
    }
    window.removeEventListener('scroll', closePlanContextMenu, true);
    window.removeEventListener('blur', closePlanContextMenu);

    if (planContextMenuElement) {
        planContextMenuElement.remove();
        planContextMenuElement = null;
    }
}

function showPlanContextMenu(event, planId) {
    if (!event || !planId) return;

    closePlanContextMenu();

    const items = [
        {label: i18next.t('Details'), action: () => module.exports.showDetails(planId)},
        {label: i18next.t('Edit'), action: () => module.exports.editPlan(planId)},
        {label: i18next.t('Copy'), action: () => module.exports.copyPlan(planId)},
        {label: i18next.t('Delete'), action: () => module.exports.deletePlan(planId), danger: true},
    ];

    const menu = document.createElement('div');
    menu.className = 'heroContextMenu';   // 复用英雄右键菜单的样式

    items.forEach((item) => {
        const entry = document.createElement('div');
        entry.className = 'heroContextMenuItem' + (item.danger ? ' heroContextMenuDanger' : '');
        entry.textContent = item.label;
        entry.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();
            closePlanContextMenu();
            item.action();
        });
        menu.appendChild(entry);
    });

    document.body.appendChild(menu);
    planContextMenuElement = menu;

    // 贴着鼠标弹出，超出窗口时向内侧收
    const rect = menu.getBoundingClientRect();
    const left = Math.max(4, Math.min(event.clientX, window.innerWidth - rect.width - 4));
    const top = Math.max(4, Math.min(event.clientY, window.innerHeight - rect.height - 4));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    planContextMenuMouseDown = (mouseEvent) => {
        if (planContextMenuElement && planContextMenuElement.contains(mouseEvent.target)) return;
        closePlanContextMenu();
    };
    planContextMenuKeyDown = (keyEvent) => {
        if (keyEvent.key === 'Escape') closePlanContextMenu();
    };

    // 延后挂载，避免当前这次右键事件立刻把菜单关掉
    setTimeout(() => {
        if (!planContextMenuElement) return;
        document.addEventListener('mousedown', planContextMenuMouseDown, true);
        document.addEventListener('keydown', planContextMenuKeyDown, true);
        window.addEventListener('scroll', closePlanContextMenu, true);
        window.addEventListener('blur', closePlanContextMenu);
    }, 0);
}
