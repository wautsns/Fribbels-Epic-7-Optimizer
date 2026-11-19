/**
 * GVG 作业的新增 / 编辑弹窗 与 只读详情弹窗 —— docs/gvg/design.md 第 7 节。
 *
 * 编辑弹窗的两条硬性要求：
 *   1. 面板要求只能「从角色条目一键带入」，不提供逐项手改控件（design.md 7.3）
 *   2. 进攻成员通过 heroId 引用英雄列表条目，神器名从 entry 读取（只读）
 */
const Swal = require('sweetalert2');

const POSITIONS = ['front', 'bottom', 'top', 'back'];

/* 站位 / 阵型的展示文案 key（数据里存的是 front/bottom/top/back） */
const POSITION_LABEL_KEYS = {
    front: 'Front',
    bottom: 'Bottom',
    top: 'Top',
    back: 'Back',
};

module.exports = {
    /** planId 为空 = 新增。返回保存后的作业，取消则返回 null */
    editPlan: async (planId) => {
        const isNew = !planId;
        const draft = isNew ? buildEmptyDraft() : GvgPlans.getById(planId);
        if (!draft) return null;

        const entries = await loadHeroEntries();
        // 面板要求不在 DOM 里（只能整块带入），用闭包维护唯一副本：
        // 初始 = 作业现值，从条目带入则覆盖，换英雄则清空
        const requirements = draft.offense.members.map(
            (member) => member.requirement || null
        );

        const result = await Swal.fire({
            title: i18next.t(isNew ? 'New GVG plan' : 'Edit GVG plan'),
            width: 980,
            html: buildEditHtml(draft, entries),
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: i18next.t('Save'),
            cancelButtonText: i18next.t('Cancel'),
            // 关闭弹窗动画（原来的 animation: false 已被 SweetAlert2 弃用）。
            // 注意：hideClass 必须保持默认，不能和 showClass 用同一个类，
            // 否则 Swal 关闭时发现 popup 已有该 class 会直接 return，弹出「取消没反应」。
            showClass: { popup: 'swal2-noanimation', backdrop: 'swal2-noanimation', icon: 'swal2-noanimation' },
            grow: false,
            // willOpen：弹窗 DOM 已就绪但还没显示（动画前）。
            // 在这里把原生 <select> 升级成 multiple-select 插件，
            // 用户看到的就是最终高度的表单，不会有"跳一下"。
            willOpen: () => wireEditDialogBeforeShow(),
            didOpen: () => wireEditDialogAfterShow(entries, requirements),
            preConfirm: () => readPlanFromDialog(draft, requirements),
        });

        if (!result.value) return null;

        const saved = GvgPlans.upsert(result.value);
        if (!saved) {
            Notifier.error('Unable to save GVG plan');
            return null;
        }
        Notifier.successRaw(
            isNew
                ? `${i18next.t('GVG plan saved')} (${
                      GvgPlans.getAll().length
                  })`
                : `${i18next.t('GVG plan updated')} (${
                      GvgPlans.getAll().length
                  })`
        );
        return saved;
    },

    /**
     * 只读详情：紧凑版（每名进攻成员一行信息 + 面板要求单独一行完整显示）。
     * 结构：左边一列固定宽度的标签（防守阵容 / 进攻阵容 / 作业标签 / 三段文本），右边是内容。
     */
    showDetails: async (planId) => {
        const plan = GvgPlans.getById(planId);
        if (!plan) return;

        const members = plan.offense.members
            .map((member) => {
                const entry = GvgPlans.resolveHeroEntry(member.heroId);
                const heroName = entry ? entry.name : member.heroId;
                const artifactName = entry ? entry.artifactName : '';
                const artifact = artifactName
                    ? `${escapeHtml(i18next.t(artifactName))}${
                          member.artifactLevel
                              ? ` +${member.artifactLevel}`
                              : ''
                      }`
                    : i18next.t('None');
                const requirement = member.requirement
                    ? escapeHtml(
                          HeroesGrid.formatPanelRequirementForRequest(
                              member.requirement
                          ) || i18next.t('No requirement')
                      )
                    : i18next.t('No requirement');
                const positionLabel = i18next.t(
                    POSITION_LABEL_KEYS[member.position] || 'Position'
                );
                const imprintLabel = i18next.t(
                    member.imprintMode === 'team'
                        ? 'Team imprint'
                        : 'Self imprint'
                );

                return `
                <div class="gvgDetailMember">
                    <div class="gvgDetailMemberLine">
                        <span class="gvgDetailPositionBadge">${escapeHtml(
                            positionLabel
                        )}</span>
                        <img class="gvgDetailHeroIcon" src="${HeroesGrid.heroIconSrc(
                            heroName
                        )}">
                        <span class="gvgDetailName">${escapeHtml(
                            i18next.t(heroName)
                        )}</span>
                        <span class="gvgDetailMemberMeta">${artifact} · ${escapeHtml(
                    imprintLabel
                )} · ${escapeHtml(eeLabel(member.ee, member.heroId))}</span>
                    </div>
                    <div class="gvgDetailMemberRequirement">${requirement}</div>
                </div>`;
            })
            .join('');

        const texts = [
            [i18next.t('Defense positioning'), plan.defenseNote],
            [i18next.t('Intel requirement'), plan.intel],
            [i18next.t('Offense strategy'), plan.strategy],
        ]
            .map(
                ([label, value]) => `
            <div class="gvgDetailRow">
                <span class="gvgDetailRowLabel">${escapeHtml(label)}</span>
                <span class="gvgDetailRowContent gvgDetailText">${
                    value
                        ? escapeHtml(value)
                        : `<span class="gvgDetailMuted">${i18next.t(
                              'None'
                          )}</span>`
                }</span>
            </div>`
            )
            .join('');

        const defense = plan.defense.heroCodes
            .map((code) => {
                const name = GvgPlans.heroNameForCode(code) || code;
                return `<span class="gvgDetailDefenseHero">
                        <img class="gvgDetailHeroIcon" src="${HeroesGrid.heroIconSrc(
                            name
                        )}">
                        <span>${escapeHtml(i18next.t(name))}</span>
                    </span>`;
            })
            .join('');

        await Swal.fire({
            title: i18next.t('GVG plan details'),
            width: 780,
            html: `
                <div class="gvgDetail">
                    <div class="gvgDetailRow">
                        <span class="gvgDetailRowLabel">${i18next.t(
                            'Defense team'
                        )}</span>
                        <span class="gvgDetailRowContent gvgDetailDefenseRow">${defense}</span>
                    </div>
                    <div class="gvgDetailRow">
                        <span class="gvgDetailRowLabel">${i18next.t(
                            'Offense team'
                        )}</span>
                        <div class="gvgDetailRowContent">${members}</div>
                    </div>
                    ${texts}
                    <div class="gvgDetailFooter">
                        ${i18next.t('Created')}: ${escapeHtml(
                new Date(plan.createdAt).toLocaleString()
            )}${plan.lastUsedAt ? ` · ${i18next.t('Last used')}: ${escapeHtml(new Date(plan.lastUsedAt).toLocaleDateString())}` : ''}
                    </div>
                </div>`,
            confirmButtonText: i18next.t('OK'),
        });
    },
};

/* ------------------------------------------------------------------ *
 * 表单构建
 * ------------------------------------------------------------------ */

function buildEmptyDraft() {
    const defaultPositions = ['front', 'top', 'back'];
    return {
        defense: { heroCodes: [] },
        offense: {
            members: defaultPositions.map((position) => ({
                heroId: '',
                position,
                imprintMode: 'self',
                ee: 'none',
                artifactLevel: 0,
                requirement: null,
            })),
        },
        defenseNote: '',
        intel: '',
        strategy: '',
    };
}

function buildEditHtml(draft, entries) {
    // 防守下拉用 heroCode（跨设备稳定），从 HeroData 构建完整选项列表
    const heroOptions = buildDefenseHeroOptions();

    const defenseSelects = [0, 1, 2]
        .map(
            (index) => `
        <select id="gvgDefense${index}" class="editGearStatSelect gvgHeroSelect">
            ${buildHeroOptionHtml(
                heroOptions,
                (draft.defense.heroCodes || [])[index] || ''
            )}
        </select>`
        )
        .join('');

    // lastUsedAt → date input (只选年月日，时分秒 = 保存时的当前时间)
    // 未被置队 → checkbox 未勾选 → lastUsedAt = null
    // 注意不能直接 Number.isFinite(Number(x))：null 会被转成 0，导致未使用作业显示成 1970 年且复选框被勾上
    const lastUsedValue =
        draft.lastUsedAt != null ? Number(draft.lastUsedAt) : NaN;
    const existingLastUsed = Number.isFinite(lastUsedValue)
        ? new Date(lastUsedValue)
        : null;
    const lastUsedEnabled = !!existingLastUsed;
    const lastUsedDateValue = existingLastUsed
        ? `${existingLastUsed.getFullYear()}-${String(
              existingLastUsed.getMonth() + 1
          ).padStart(2, '0')}-${String(existingLastUsed.getDate()).padStart(
              2,
              '0'
          )}`
        : '';

    const memberBlocks = draft.offense.members
        .map((member, index) => {
            // 从 heroId 反查 entry 来显示 artifact
            const heroEntry = GvgPlans.resolveHeroEntry(member.heroId);
            const artifactName = heroEntry
                ? i18next.t(heroEntry.artifactName)
                : '';
            const artifactLevelDisplay = member.artifactLevel || 0;

            return `
        <div class="gvgMemberBlock">
            <div class="gvgMemberHeader" data-t>${i18next.t(
                'Offense member'
            )} ${index + 1}</div>
            <div class="gvgFormRow">
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Position'
                )}</span>
                <select id="gvgOffense${index}Position" class="gvgNativeSelect gvgPositionSelect">
                    ${POSITIONS.map(
                        (position) =>
                            `<option value="${position}" ${
                                member.position === position ? 'selected' : ''
                            }>${i18next.t(
                                POSITION_LABEL_KEYS[position]
                            )}</option>`
                    ).join('')}
                </select>
                <span class="gvgFormLabel" data-t>${i18next.t('Hero')}</span>
                <select id="gvgOffense${index}Hero" class="editGearStatSelect gvgHeroSelect">
                    ${buildEntryOptionHtml(entries, member.heroId || '')}
                </select>
            </div>
            <div class="gvgFormRow">
                <span class="gvgFormLabel" data-t>${i18next.t('Imprint')}</span>
                <span id="gvgOffense${index}Imprint" class="gvgReadOnlyText">${escapeHtml(
                    i18next.t(
                        member.imprintMode === 'team'
                            ? 'Team imprint'
                            : 'Self imprint'
                    )
                )}</span>
                <span class="gvgFormDivider">/</span>
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Exclusive equipment'
                )}</span>
                ${buildEeControlHtml(index, member.heroId, member.ee)}
                <span class="gvgFormDivider">/</span>
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Minimum artifact level'
                )}</span>
                <input type="text" maxlength="2" inputmode="numeric" id="gvgOffense${index}ArtifactLevel"
                       class="gvgShortInput" value="${artifactLevelDisplay}">
            </div>
        </div>`;
        })
        .join('');

    return `
    <div class="gvgForm">
        <div class="gvgFormSection">
            <div class="gvgFormSectionTitle" data-t>${i18next.t(
                'Defense team'
            )}</div>
            <div class="gvgFormRow">
                <span class="gvgFormLabel" data-t>${i18next.t('Hero')}</span>
                ${defenseSelects}
                <span class="gvgLastUsedGap"></span>
                <label class="gvgLastUsedToggle">
                    <input type="checkbox" id="gvgLastUsedEnabled" ${
                        lastUsedEnabled ? 'checked' : ''
                    }>
                    <span data-t>${i18next.t('Last used')}</span>
                </label>
                <input type="date" id="gvgLastUsedDate"
                       class="gvgLastUsedDate"
                       value="${lastUsedDateValue}"
                       ${lastUsedEnabled ? '' : 'disabled'}>
            </div>
        </div>

        <div class="gvgFormSection">
            <div class="gvgFormSectionTitle" data-t>${i18next.t(
                'Offense team'
            )}</div>
            ${memberBlocks}
        </div>

        <div class="gvgFormSection">
            <div class="gvgFormRow">
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Defense positioning'
                )}</span>
                <input type="text" id="gvgDefenseNote" class="gvgTextInput"
                       value="${escapeHtml(draft.defenseNote)}"
                       placeholder="${escapeHtml(
                           i18next.t(
                               'If this lineup requires specific defense positions, type them here'
                           )
                       )}">
            </div>
            <div class="gvgFormRow">
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Intel requirement'
                )}</span>
                <input type="text" id="gvgIntel" class="gvgTextInput"
                       value="${escapeHtml(draft.intel)}"
                       placeholder="${escapeHtml(
                           i18next.t(
                               'Leave empty if there is no intel requirement'
                           )
                       )}">
            </div>
            <div class="gvgFormRow">
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Offense strategy'
                )}</span>
                <textarea id="gvgStrategy" class="gvgTextArea" rows="2">${escapeHtml(
                    draft.strategy
                )}</textarea>
            </div>
        </div>

        <div id="gvgValidationMessage" class="gvgValidationMessage"></div>
    </div>`;
}

function buildHeroOptionHtml(heroOptions, selectedCode) {
    const blank = `<option value="" ${
        selectedCode ? '' : 'selected'
    }>${i18next.t('None')}</option>`;
    return (
        blank +
        heroOptions
            .map(
                (hero) =>
                    `<option value="${hero.code}" ${
                        hero.code === selectedCode ? 'selected' : ''
                    }>${escapeHtml(hero.label)}</option>`
            )
            .join('')
    );
}

/**
 * 防守阵容下拉的完整英雄选项（按翻译名排序）。
 * 防守仍然用 heroCode（跨设备稳定），不从 Api.getHeroes 拉条目。
 */
function buildDefenseHeroOptions() {
    try {
        const allHeroData = HeroData.getAllHeroData() || {};
        return Object.keys(allHeroData)
            .map((name) => {
                const info = allHeroData[name];
                const code = info && info.code;
                if (!code) return null;
                return { code, name, label: i18next.t(name) };
            })
            .filter(Boolean)
            .sort((a, b) => a.label.localeCompare(b.label));
    } catch (error) {
        console.warn('GVG: unable to build defense hero options', error);
        return [];
    }
}

function buildEntryOptionHtml(entries, selectedId) {
    const blank = `<option value="" ${
        selectedId ? '' : 'selected'
    }>${i18next.t('None')}</option>`;
    return (
        blank +
        entries
            .map((entry) => {
                const artifact = escapeHtml(entry.artifactText || '');
                const req = escapeHtml(entry.requirementText || '');
                return `<option value="${entry.id}" data-artifact="${artifact}" data-req="${req}" ${
                    entry.id === selectedId ? 'selected' : ''
                }>${escapeHtml(entry.name)}</option>`;
            })
            .join('')
    );
}

/* ------------------------------------------------------------------ *
 * 专属装备（exclusive equipment）
 *
 * 从 hero entry 读 attribute + rarity + eeNumber：
 *   - 光暗属性且 5★ → 有 / 无（entry.eeNumber !== 'None' → 有）
 *   - 其余角色 → 任意 / Ⅰ / Ⅱ / Ⅲ / 无
 * ------------------------------------------------------------------ */

const LIGHT_DARK_ATTRIBUTES = ['light', 'dark'];
const EE_SYMBOLS = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };

function entryForHeroId(heroId) {
    if (!heroId) return null;
    return GvgPlans.resolveHeroEntry(heroId);
}

function heroHasExclusive(heroId) {
    const entry = entryForHeroId(heroId);
    return !!(entry && entry.eeNumber && entry.eeNumber !== 'None');
}

/** 只有"光暗 + 5★"是 有 / 无；其余（三色，以及光暗的 3★ / 4★）都是 任意 / Ⅰ / Ⅱ / Ⅲ */
function usesEeVariants(heroId) {
    const entry = entryForHeroId(heroId);
    if (!entry) return true;

    const isLightDark5Star =
        LIGHT_DARK_ATTRIBUTES.includes(entry.attribute) &&
        Number(entry.rarity) === 5;

    return !isLightDark5Star;
}

function eeOptionKeys(heroId) {
    return usesEeVariants(heroId)
        ? ['none', 'any', '1', '2', '3']
        : ['none', 'any'];
}

/** 默认值：entry 有专属 → 有变体的选"Ⅰ"、光暗 5★ 选"有"；没有 → "无" */
function defaultEeKey(heroId) {
    if (!heroHasExclusive(heroId)) return 'none';
    return usesEeVariants(heroId) ? '1' : 'any';
}

function eeLabel(value, heroId) {
    if (value === 'any') {
        if (heroId != null && usesEeVariants(heroId)) return i18next.t('Any');
        return i18next.t('Has');
    }
    if (EE_SYMBOLS[value]) return EE_SYMBOLS[value];
    return i18next.t('None');
}

function buildEeOptionHtml(heroId, currentValue) {
    // 三色有专属：Ⅰ / Ⅱ / Ⅲ（不去 any，any 是"带专属即可"，Ⅲ 是最高档）
    const options = usesEeVariants(heroId)
        ? ['any', '1', '2', '3'] // 去掉 'none'
        : ['none', 'any'];
    const value = options.includes(currentValue)
        ? currentValue
        : defaultEeKey(heroId);

    return options
        .map(
            (key) =>
                `<option value="${key}" ${
                    value === key ? 'selected' : ''
                }>${escapeHtml(eeLabel(key, heroId))}</option>`
        )
        .join('');
}

/**
 * 判断 ee 是否应该显示为下拉还是只读 span：
 *   - entry 无专属 → 只读 "无"
 *   - 光暗 5★ 有专属 → 只读 "有"
 *   - 三色有专属 → 下拉（Ⅰ/Ⅱ/Ⅲ）
 */
function eeIsReadOnly(heroId) {
    const entry = entryForHeroId(heroId);
    if (!entry || !entry.eeNumber || entry.eeNumber === 'None') return true;
    if (!usesEeVariants(heroId)) return true; // 光暗 5★
    return false;
}

/** ee 只读 span 显示值 */
function eeReadOnlyValue(heroId) {
    const entry = entryForHeroId(heroId);
    if (!entry || !entry.eeNumber || entry.eeNumber === 'None') return 'none';
    return 'any';
}

/** ee 只读 span 显示文本 */
function eeReadOnlyLabel(heroId) {
    const entry = entryForHeroId(heroId);
    if (!entry || !entry.eeNumber || entry.eeNumber === 'None')
        return i18next.t('None');
    return i18next.t('Has');
}

/**
 * 生成 ee 控件 HTML（可能是 select 也可能是 span）。
 * 给一个容器 span 包住，里面放 select 或只读 span，方便 refresh 时整体替换。
 */
function buildEeControlHtml(index, heroId, currentValue) {
    if (eeIsReadOnly(heroId)) {
        const display = eeReadOnlyLabel(heroId);
        const value = eeReadOnlyValue(heroId);
        return `<span id="gvgOffense${index}Ee" class="gvgNativeSelect gvgReadOnlyText" data-ee-value="${value}">${escapeHtml(display)}</span>`;
    }
    // 三色有专属 → 下拉
    return `<select id="gvgOffense${index}Ee" class="gvgNativeSelect gvgShortSelect">${buildEeOptionHtml(
        heroId,
        currentValue
    )}</select>`;
}

/** 刷新 ee 控件（select ↔ span 切换 + 值更新） */
function refreshEeControl(index, heroId, value) {
    const container = document.getElementById(`gvgOffense${index}Ee`);
    if (!container) return;

    if (eeIsReadOnly(heroId)) {
        // 换成 span
        const display = eeReadOnlyLabel(heroId);
        const v = eeReadOnlyValue(heroId);
        container.outerHTML = `<span id="gvgOffense${index}Ee" class="gvgNativeSelect gvgReadOnlyText" data-ee-value="${v}">${escapeHtml(display)}</span>`;
    } else {
        // 换成 select
        const wanted = ['any', '1', '2', '3'].includes(value) ? value : defaultEeKey(heroId);
        const newHtml = `<select id="gvgOffense${index}Ee" class="gvgNativeSelect gvgShortSelect">${buildEeOptionHtml(
            heroId,
            wanted
        )}</select>`;
        // 如果已经是 select 且 multiple-select 还在，用 innerHTML 替换原生选项后需要 refresh 插件
        if (container.tagName === 'SELECT') {
            container.innerHTML = buildEeOptionHtml(heroId, wanted);
            // multiple-select 插件刷新
            if (typeof $ !== 'undefined' && $.fn && $.fn.multipleSelect) {
                try {
                    $(`#gvgOffense${index}Ee`).multipleSelect('refresh');
                } catch (e) {}
            }
        } else {
            container.outerHTML = newHtml;
        }
    }
}

/** 「不带入」时把该成员还原成打开弹窗时的样子（新作业 = 默认值，老作业 = 原值） */
function restoreMemberFromSnapshot(index, snapshot, requirements) {
    setSelectValue(`gvgOffense${index}Hero`, snapshot.heroId);

    const levelInput = document.getElementById(
        `gvgOffense${index}ArtifactLevel`
    );
    if (levelInput) levelInput.value = snapshot.artifactLevel || '0';

    const imprintSpan = document.getElementById(`gvgOffense${index}Imprint`);
    if (imprintSpan) {
        const isTeam = snapshot.imprint === 'team';
        imprintSpan.textContent = i18next.t(isTeam ? 'Team imprint' : 'Self imprint');
    }

    refreshEeControl(index, snapshot.heroId, snapshot.ee);

    requirements[index] = snapshot.requirement;
}

/** 记录成员当前值，供「不带入」还原 */
function captureMemberSnapshot(index, requirements) {
    // 阵型只读，不从 DOM 读 —— 从 hero entry 拿
    const heroId = valueOf(`gvgOffense${index}Hero`);
    const hero = GvgPlans.resolveHeroEntry(heroId);
    const imprint = hero && hero.imprintNumber === 'None' ? 'team' : 'self';

    return {
        heroId,
        artifactLevel: valueOf(`gvgOffense${index}ArtifactLevel`),
        imprint,
        ee: eeValueOf(`gvgOffense${index}Ee`),
        requirement: requirements[index],
    };
}

/* ------------------------------------------------------------------ *
 * 交互接线
 * ------------------------------------------------------------------ */

function wireEditDialogBeforeShow() {
    // --- 焦点跳动修复 ---
    // Swal 会自动 focus 弹窗里「第一个可聚焦元素」。
    // 先把所有原生 input/select/textarea 的 tabindex 临时改成 -1，
    // 让 Swal 找不到可聚焦元素；multiple-select 初始化完后再恢复。
    const form = document.querySelector('.gvgForm');
    const savedTabIndices = [];
    if (form) {
        form.querySelectorAll('input, select, textarea').forEach((el) => {
            savedTabIndices.push({ el, value: el.getAttribute('tabindex') });
            el.setAttribute('tabindex', '-1');
        });
    }

    // multiple-select 插件初始化。传空函数当 placeholder，
    // 真正的 validate 会在 afterShow 里通过 bindChange 绑到 change 事件上。
    upgradeSearchableSelects(() => {});

    // 恢复原生控件的 tabIndex
    if (form) {
        savedTabIndices.forEach(({ el, value }) => {
            if (value === null) {
                el.removeAttribute('tabindex');
            } else {
                el.setAttribute('tabindex', value);
            }
        });
        // multiple-select 创建的 .ms-choice button：插件从原生 select 读 tabindex
        // （临时 -1 被它复制过去了），这里兜底补回 0。
        form.querySelectorAll('.ms-choice').forEach((btn) => {
            if (btn.getAttribute('tabindex') === null) {
                btn.setAttribute('tabindex', '0');
            }
        });
    }
}

/** didOpen 阶段：弹窗已经显示出来了。做事件绑定 + 初始校验。 */
function wireEditDialogAfterShow(entries, requirements) {
    const confirmButton = Swal.getConfirmButton();

    const validate = () => {
        const draft = readPlanFromDialog(null, requirements);
        const error = validateDraft(draft);

        const message = document.getElementById('gvgValidationMessage');
        if (message) message.innerText = error ? i18next.t(error) : '';
        if (confirmButton) confirmButton.disabled = !!error;
    };

    // 打开弹窗时的成员状态，英雄选中"不带入"时用它还原
    const snapshots = [0, 1, 2].map((index) =>
        captureMemberSnapshot(index, requirements)
    );

    [0, 1, 2].forEach((index) => {
        // 英雄下拉：选中即自动带入需求 / artifact / ee / imprint / level
        const heroSelect = document.getElementById(`gvgOffense${index}Hero`);
        if (heroSelect) {
            bindChange(heroSelect, () => {
                const entryId = heroSelect.value;

                // 选空 → 清需求、还原到初始快照
                if (!entryId) {
                    restoreMemberFromSnapshot(
                        index,
                        snapshots[index],
                        requirements
                    );
                    validate();
                    return;
                }

                // entries 是 loadHeroEntries 的包装对象，原始 hero 在 .hero 里
                const wrapper = entries.find((item) => item.id === entryId);
                const hero = wrapper && (wrapper.hero || wrapper);
                if (hero) applyHeroEntry(index, hero, requirements);
                validate();
            });
        }

        const defense = document.getElementById(`gvgDefense${index}`);
        if (defense) bindChange(defense, validate);
    });

    ['gvgDefenseNote', 'gvgIntel', 'gvgStrategy'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('input', validate);
    });

    // lastUsedAt 启用/禁用 checkbox → date input 联动
    const lastUsedEnabled = document.getElementById('gvgLastUsedEnabled');
    const lastUsedDate = document.getElementById('gvgLastUsedDate');
    if (lastUsedEnabled) {
        lastUsedEnabled.addEventListener('change', () => {
            if (lastUsedDate) {
                lastUsedDate.disabled = !lastUsedEnabled.checked;
                if (!lastUsedEnabled.checked) lastUsedDate.value = '';
            }
            validate();
        });
    }
    if (lastUsedDate) lastUsedDate.addEventListener('input', validate);

    [0, 1, 2].forEach((index) => {
        [
            'Hero',
            'Position',
            'Ee',
            'ArtifactLevel',
        ].forEach((suffix) => {
            const element = document.getElementById(
                `gvgOffense${index}${suffix}`
            );
            // 英雄下拉有自己的监听（换英雄要清需求、刷新 artifact），这里跳过避免重复校验
            if (element && suffix !== 'Hero') bindChange(element, validate);
        });
    });

    // 首次校验（禁用保存按钮如果有必填项缺失）
    validate();
}

/**
 * 绑定 change：升级过的下拉改值走的是 jQuery trigger('change')，
 * 原生 addEventListener 收不到这种合成事件，所以有 jQuery 时统一走 jQuery。
 */
function bindChange(element, handler) {
    if (typeof $ !== 'undefined' && $.fn) {
        $(element).on('change', handler);
        return;
    }
    element.addEventListener('change', handler);
}

/**
 * 需要输入筛选的下拉：英雄（6 个 + 防守 3）、从英雄列表带入（3 个）、神器（3 个）。
 * 用的是英雄列表页同一个 multiple-select 插件（单选 + 搜索框），
 * 站位 / 星级 / 阵型保持原生 select（用 CSS 对齐外观）。
 * 收起状态统一 140px（和英雄列表上方 / GVG 筛选行一致）；展开的列表单独给宽度
 * （dropWidth），否则长名字会被截断。神器下拉不做图标，只显示名字。
 */
const HERO_TEXT_TEMPLATE = function ($elm) {
    const opt = $elm[0];
    const label = opt.innerHTML.trim();
    if (!opt.value) return label; // blank option
    const artifact = opt.getAttribute('data-artifact') || '';
    const req = opt.getAttribute('data-req') || '';
    // 单行：名字 — 神器 · 面板要求&结果优先级&加成（后两段由 formatPanelRequirementForRequest 合并输出）
    const parts = [artifact, req].filter(Boolean).join(' · ');
    if (!parts) return label;
    return `${label} — ${parts}`;
};

const SEARCHABLE_SELECTS = [
    {
        pattern: 'gvgDefense%d',
        placeholder: 'Hero',
        options: { width: 140, dropWidth: 230 },
    },
    {
        pattern: 'gvgOffense%dHero',
        placeholder: 'Hero',
        options: { width: 700, dropWidth: 700, textTemplate: HERO_TEXT_TEMPLATE },
    },
];

function searchableSelectIds() {
    const ids = [];
    SEARCHABLE_SELECTS.forEach(({ pattern, placeholder, options }) => {
        for (let index = 0; index < 3; index++) {
            ids.push({
                id: pattern.replace('%d', index),
                placeholder,
                options: options || {},
            });
        }
    });
    return ids;
}

/**
 * 展开列表的期望高度上限：再用剩余空间裁剪（见 fitDropdownToViewport）。
 * 200 够用：选项一般靠输入筛选，列表太高反而把弹窗顶出滚动条。
 */
const DROPDOWN_LIST_HEIGHT = 200;
/** 列表最小高度：再挤也留这么多，否则只剩一两行反而难选 */
const DROPDOWN_LIST_MIN_HEIGHT = 140;
/** 列表和视口边缘之间留的余量 */
const DROPDOWN_VIEWPORT_GAP = 16;

/**
 * 列表一律 200 高且只会向下展开的话，编辑弹窗里第 3 个进攻成员已经靠近弹窗底部，
 * 展开就会撑出弹窗，让弹窗出现纵向滚动条。这里在每次展开时按剩余空间裁剪列表高度，
 * 下面放不下而上面更宽裕时改成向上展开（插件的 .ms-drop.top 就是向上定位）。
 * 注意必须在 onOpen 里做：插件 open() 每次都把 ul 的 max-height 重置成 options.maxHeight。
 */
function fitDropdownToViewport(id) {
    const element = document.getElementById(id);
    const parent = element && element.nextElementSibling;
    const drop = parent && parent.querySelector('.ms-drop');
    if (!drop) return;

    const list = drop.querySelector('ul');
    const rect = parent.getBoundingClientRect();
    // 边界优先取弹窗本身（swal2-popup 自己会 overflow-y: auto），
    // 列表顶出弹窗的话滚动条还是会出现，所以别只按窗口算
    const popup = parent.closest ? parent.closest('.swal2-popup') : null;
    const bounds = popup
        ? popup.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
    const spaceBelow = bounds.bottom - rect.bottom - DROPDOWN_VIEWPORT_GAP;
    const spaceAbove = rect.top - bounds.top - DROPDOWN_VIEWPORT_GAP;
    const openUp = spaceBelow < DROPDOWN_LIST_HEIGHT && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;
    // 搜索框和上下边框也算在展开高度里，用当前渲染高度反推，别让列表把它们挤出去
    const dropRect = drop.getBoundingClientRect();
    const listRect = list ? list.getBoundingClientRect() : null;
    const chrome = listRect
        ? Math.max(0, dropRect.height - listRect.height)
        : 0;
    const height = Math.max(
        DROPDOWN_LIST_MIN_HEIGHT,
        Math.min(DROPDOWN_LIST_HEIGHT, available - chrome)
    );

    drop.classList.toggle('top', openUp);
    drop.classList.toggle('bottom', !openUp);
    if (list) list.style.maxHeight = `${height}px`;
}

function upgradeSearchableSelects(validate) {
    if (typeof $ === 'undefined' || !$.fn || !$.fn.multipleSelect) return;

    searchableSelectIds().forEach(({ id, placeholder, options }) => {
        const element = document.getElementById(id);
        if (!element) return;

        // 已经升级过的不要再套一次
        if (element.classList && element.classList.contains('ms-offscreen'))
            return;

        $(`#${id}`).multipleSelect({
            filter: true,
            filterAcceptOnEnter: true,
            single: true,
            maxHeight: DROPDOWN_LIST_HEIGHT,
            ...options,
            placeholder: i18next.t(placeholder),
            // 展开时按视口剩余空间决定列表高度和展开方向
            onOpen: () => fitDropdownToViewport(id),
            // 插件改的是原生 select 的 value，回调里补一次校验
            onSelect: validate,
            onUnselect: validate,
        });
    });
}

/** 用代码的方式改下拉（会同时更新 multiple-select 的显示） */
function setSelectValue(id, value) {
    const element = document.getElementById(id);
    if (!element) return;

    element.value = value || '';

    if (typeof $ === 'undefined' || !$.fn || !$.fn.multipleSelect) return;

    try {
        $(`#${id}`).multipleSelect('setSelects', value ? [value] : []);
        $(`#${id}`).multipleSelect('refresh');
    } catch (error) {
        console.warn('GVG: unable to update select', id, error);
    }
}

/** 把角色条目的「最低神器等级 + 阵型模式 + 面板要求」带进第 index 位（hero select 值已在 change handler 里设好） */
function applyHeroEntry(index, entry, requirements) {
    // artifactLevel 数字框（entry 等级 ≥ 阈值时取 entry 的）
    const levelInput = document.getElementById(
        `gvgOffense${index}ArtifactLevel`
    );
    if (
        levelInput &&
        entry.artifactLevel != null &&
        entry.artifactLevel !== 'None'
    ) {
        levelInput.value = Math.max(
            0,
            Math.min(30, Math.round(Number(entry.artifactLevel)))
        );
    }

    const imprintSpan = document.getElementById(`gvgOffense${index}Imprint`);
    if (imprintSpan) {
        const isTeam = entry.imprintNumber === 'None';
        imprintSpan.textContent = i18next.t(isTeam ? 'Team imprint' : 'Self imprint');
    }

    // 专属：按 entry 的 eeNumber 决定是只读还是下拉
    refreshEeControl(index, entry.id, null);

    requirements[index] = entry.optimizationRequest
        ? JSON.parse(JSON.stringify(entry.optimizationRequest))
        : null;
}

/* ------------------------------------------------------------------ *
 * 读值 / 校验
 * ------------------------------------------------------------------ */

function readPlanFromDialog(draft, requirements) {
    const heroCodes = [0, 1, 2].map((index) => valueOf(`gvgDefense${index}`));

    const members = [0, 1, 2].map((index) => {
        const levelText = valueOf(`gvgOffense${index}ArtifactLevel`);
        const level = levelText === '' ? 0 : Number(levelText);
        const heroId = valueOf(`gvgOffense${index}Hero`);
        // 阵型只读，从 hero entry 拿（群阵 = imprintNumber === 'None'）
        const hero = GvgPlans.resolveHeroEntry(heroId);
        const imprintMode = hero && hero.imprintNumber === 'None' ? 'team' : 'self';

        return {
            heroId,
            position: valueOf(`gvgOffense${index}Position`),
            imprintMode,
            ee: eeValueOf(`gvgOffense${index}Ee`) || 'none',
            artifactLevel: Number.isFinite(level) ? Math.max(0, Math.min(30, level)) : 0,
            requirement: requirements[index] || null,
        };
    });

    // lastUsedAt：checkbox 未勾选 → null；勾选 → 选中年月日 + 当前时分秒
    let lastUsedAt = null;
    const enabledEl = document.getElementById('gvgLastUsedEnabled');
    const dateEl = document.getElementById('gvgLastUsedDate');
    if (enabledEl && enabledEl.checked && dateEl && dateEl.value) {
        const [y, m, d] = dateEl.value.split('-').map(Number);
        if (y && m && d) {
            const now = new Date();
            const combined = new Date(
                y,
                m - 1,
                d,
                now.getHours(),
                now.getMinutes(),
                now.getSeconds()
            );
            lastUsedAt = combined.getTime();
        }
    }

    return {
        id: draft ? draft.id : undefined,
        createdAt: draft ? draft.createdAt : undefined,
        lastUsedAt,
        defense: { heroCodes },
        offense: { members },
        equipOrder: draft && draft.equipOrder ? draft.equipOrder : [0, 1, 2],
        defenseNote: valueOf('gvgDefenseNote'),
        intel: valueOf('gvgIntel'),
        strategy: valueOf('gvgStrategy'),
    };
}

function validateDraft(draft) {
    const codes = draft.defense.heroCodes.filter(Boolean);
    if (codes.length !== 3 || new Set(codes).size !== 3)
        return 'Defense team needs 3 different heroes';

    const { members } = draft.offense;
    const heroIds = members.map((member) => member.heroId).filter(Boolean);
    if (heroIds.length !== 3 || new Set(heroIds).size !== 3)
        return 'Offense team needs 3 different heroes';

    const positions = members.map((member) => member.position).filter(Boolean);
    if (positions.length !== 3 || new Set(positions).size !== 3)
        return 'Positions must be different';

    for (const member of members) {
        const level = member.artifactLevel;
        if (
            !Number.isFinite(level) ||
            !Number.isInteger(Number(level)) ||
            Number(level) < 0 ||
            Number(level) > 30
        )
            return 'Artifact level must be between 0 and 30';
    }

    return null;
}

/* ------------------------------------------------------------------ *
 * 角色条目加载
 * ------------------------------------------------------------------ */

async function loadHeroEntries() {
    try {
        const response = await Api.getAllHeroes();
        const heroes = response && response.heroes ? response.heroes : [];

        // 顺序跟英雄列表一致：按列表里的 rank（hero.index）升序，没有 index 时再按名字
        return heroes
            .slice()
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
            })
            .map((hero, position) => {
                // formatPanelRequirementForRequest 已经合并输出：属性要求 + 结果优先级 + 最终加成
                const requirementText = hero.optimizationRequest
                    ? HeroesGrid.formatPanelRequirementForRequest(
                          hero.optimizationRequest
                      ) || ''
                    : '';
                // 同名条目可以有多个，所以每条都带英雄列表里的排名，便于区分（不只在重名时才加）
                const rank = Number.isFinite(Number(hero.index))
                    ? Number(hero.index)
                    : position + 1;
                // 当前佩戴的神器名（没戴时为空）
                const artifactText =
                    hero.artifactName && hero.artifactName !== 'None'
                        ? i18next.t(hero.artifactName)
                        : '';

                return {
                    id: hero.id,
                    name: `${i18next.t(hero.name)} #${rank}`,
                    artifactText,
                    requirementText,
                    hero,
                };
            });
    } catch (error) {
        console.warn('GVG: unable to load hero entries', error);
        return [];
    }
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function valueOf(id) {
    const element = document.getElementById(id);
    return element ? String(element.value).trim() : '';
}

/** ee 控件可能是 <select> 也可能是带 data-ee-value 的只读 <span> */
function eeValueOf(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.tagName === 'SELECT') return String(el.value).trim();
    return el.getAttribute('data-ee-value') || '';
}

function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
