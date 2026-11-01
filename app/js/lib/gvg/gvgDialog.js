/**
 * GVG 作业的新增 / 编辑弹窗 与 只读详情弹窗 —— docs/gvg/design.md 第 7 节。
 *
 * 编辑弹窗的两条硬性要求：
 *   1. 面板要求只能「从角色条目一键带入」，不提供逐项手改控件（design.md 7.3）
 *   2. 带入之后作业与条目再无关系：不存 entryId（design.md 第 3 节）
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
            didOpen: () => wireEditDialog(entries, requirements),
            preConfirm: () => readPlanFromDialog(draft, requirements),
        });

        if (!result.value) return null;

        const saved = GvgPlans.upsert(result.value);
        if (!saved) {
            Notifier.error('Unable to save GVG plan');
            return null;
        }
        return saved;
    },

    /** 只读详情：面板要求全文 + 三段文本 + 标签 + 最后修改时间 */
    showDetails: async (planId) => {
        const plan = GvgPlans.getById(planId);
        if (!plan) return;

        const members = plan.offense.members
            .map((member, index) => {
                const artifact = member.artifact
                    ? `${escapeHtml(
                          i18next.t(
                              member.artifact.name ||
                                  GvgPlans.artifactNameForCode(
                                      member.artifact.code
                                  ) ||
                                  member.artifact.code
                          )
                      )}${
                          member.artifact.minLevel
                              ? ` +${member.artifact.minLevel}`
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

                return `
                <div class="gvgDetailMember">
                    <div class="gvgDetailMemberHeader">
                        <img class="gvgHeroIcon" style="width:32px;height:32px" src="${HeroesGrid.heroIconSrc(
                            member.name
                        )}">
                        <span class="gvgDetailPosition">${escapeHtml(
                            positionLabel
                        )}</span>
                        <span>${escapeHtml(i18next.t(member.name))}</span>
                        <span class="gvgDetailMuted">${artifact}</span>
                        <span class="gvgDetailMuted">${escapeHtml(
                            i18next.t(
                                member.imprintMode === 'team'
                                    ? 'Team imprint'
                                    : 'Self imprint'
                            )
                        )}</span>
                        <span class="gvgDetailMuted">${escapeHtml(
                            eeLabel(member.ee, member.heroCode)
                        )}</span>
                    </div>
                    <div class="gvgDetailRequirement">${requirement}</div>
                </div>
                <div class="horizontalLineWithMoreSpace"></div>`;
            })
            .join('');

        const texts = [
            [i18next.t('Defense positioning'), plan.defenseNote],
            [i18next.t('Intel requirement'), plan.intel],
            [i18next.t('Offense strategy'), plan.strategy],
        ]
            .map(
                ([label, value]) => `
            <div class="gvgDetailTextBlock">
                <div class="gvgDetailLabel">${escapeHtml(label)}</div>
                <div class="gvgDetailText">${
                    value
                        ? escapeHtml(value)
                        : `<span class="gvgDetailMuted">${i18next.t(
                              'None'
                          )}</span>`
                }</div>
            </div>`
            )
            .join('');

        const tags = GvgPlans.displayTags(plan)
            .map((tag) => `<span class="gvgTag">${escapeHtml(tag)}</span>`)
            .join('');

        const defense = plan.defense.heroCodes
            .map((code) => {
                const name = GvgPlans.heroNameForCode(code) || code;
                return `<span class="gvgDetailDefenseHero">
                        <img class="gvgHeroIcon" style="width:32px;height:32px" src="${HeroesGrid.heroIconSrc(
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
                    <div class="gvgDetailLabel">${i18next.t(
                        'Defense team'
                    )}</div>
                    <div class="gvgDetailDefenseRow">${defense}</div>
                    <div class="horizontalLineWithMoreSpace"></div>
                    <div class="gvgDetailLabel">${i18next.t(
                        'Offense team'
                    )}</div>
                    ${members}
                    <div class="gvgDetailLabel">${i18next.t('Tags')}</div>
                    <div class="gvgTagRow gvgDetailTags">${tags}</div>
                    <div class="horizontalLineWithMoreSpace"></div>
                    ${texts}
                    <div class="gvgDetailMuted gvgDetailFooter">
                        ${i18next.t('Last modified')}: ${escapeHtml(
                new Date(plan.updatedAt).toLocaleString()
            )}
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
    return {
        defense: { heroCodes: [] },
        offense: {
            members: POSITIONS.slice(0, 3).map((position) => ({
                heroCode: '',
                name: '',
                position,
                artifact: null,
                imprintMode: 'self',
                requirement: null,
            })),
        },
        tags: [],
        defenseNote: '',
        intel: '',
        strategy: '',
    };
}

function buildEditHtml(draft, entries) {
    const heroOptions = GvgPlans.getAllHeroOptions();
    const artifactOptions = getArtifactOptions();

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

    const memberBlocks = draft.offense.members
        .map((member, index) => {
            const artifactName = member.artifact
                ? member.artifact.name ||
                  GvgPlans.artifactNameForCode(member.artifact.code) ||
                  ''
                : '';
            const artifactLevel = member.artifact
                ? member.artifact.minLevel
                : 0;

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
                    ${buildHeroOptionHtml(heroOptions, member.heroCode || '')}
                </select>
                <span class="gvgFormLabel" data-t>${i18next.t('Imprint')}</span>
                <select id="gvgOffense${index}Imprint" class="gvgNativeSelect gvgShortSelect">
                    <option value="self" ${
                        member.imprintMode !== 'team' ? 'selected' : ''
                    }>${i18next.t('Self imprint')}</option>
                    <option value="team" ${
                        member.imprintMode === 'team' ? 'selected' : ''
                    }>${i18next.t('Team imprint')}</option>
                </select>
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Exclusive equipment'
                )}</span>
                <select id="gvgOffense${index}Ee" class="gvgNativeSelect gvgShortSelect">
                    ${buildEeOptionHtml(member.heroCode, member.ee)}
                </select>
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Artifact'
                )}</span>
                <select id="gvgOffense${index}Artifact" class="editGearStatSelect gvgArtifactSelect">
                    <option value="" ${
                        artifactName ? '' : 'selected'
                    }>${i18next.t('None')}</option>
                    ${artifactOptions
                        .map(
                            (option) =>
                                `<option value="${escapeHtml(option.name)}" ${
                                    artifactName === option.name
                                        ? 'selected'
                                        : ''
                                }>${escapeHtml(
                                    i18next.t(option.name)
                                )}</option>`
                        )
                        .join('')}
                </select>
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Artifact level'
                )}</span>
                <input type="text" maxlength="2" inputmode="numeric" id="gvgOffense${index}ArtifactLevel"
                       class="gvgShortInput" value="${artifactLevel}">
            </div>
            <div class="gvgFormRow">
                <span class="gvgFormLabel" data-t>${i18next.t(
                    'Import from hero list'
                )}</span>
                <select id="gvgImport${index}" class="editGearStatSelect gvgImportSelect">
                    ${buildEntryOptionHtml(entries)}
                </select>
                <span id="gvgRequirementPreview${index}" class="gvgRequirementText">${formatRequirementPreview(
                member.requirement
            )}</span>
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
                <span class="gvgFormLabel" data-t>${i18next.t('Tags')}</span>
                <input type="text" id="gvgTags" class="gvgTextInput"
                       value="${escapeHtml(draft.tags.join(', '))}"
                       placeholder="${escapeHtml(
                           i18next.t('Separate tags with commas')
                       )}">
            </div>
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
                <textarea id="gvgStrategy" class="gvgTextArea" rows="1">${escapeHtml(
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

function buildEntryOptionHtml(entries) {
    const blank = `<option value="" selected>${i18next.t(
        'Do not import'
    )}</option>`;
    return (
        blank +
        entries
            .map(
                (entry) =>
                    // 列表里靠 textTemplate 拼上「面板需求」，选中后只显示英雄名（见 gvgEntryReq 的 CSS）
                    `<option value="${entry.id}" data-req="${escapeHtml(
                        entry.requirementText || ''
                    )}">${escapeHtml(entry.name)}</option>`
            )
            .join('')
    );
}

/** 带入下拉的显示模板：英雄名（+ 需求摘要，选中后由 CSS 隐藏需求那一段） */
function entryTextTemplate($option) {
    const element = $option[0];
    const name = element.innerHTML.trim();
    const requirement = (element.getAttribute('data-req') || '').trim();

    return requirement
        ? `${name}<span class="gvgEntryReq"> — ${escapeHtml(
              requirement
          )}</span>`
        : name;
}

/** 神器下拉的选项：作业里存 code（+ 名字消歧），这里给出 [{ code, name }]（按显示名排序） */
function getArtifactOptions() {
    const options = GvgPlans.getArtifactOptions();

    return options.sort((a, b) =>
        i18next.t(a.name).localeCompare(i18next.t(b.name))
    );
}

/* ------------------------------------------------------------------ *
 * 专属装备（exclusive equipment）
 *
 * 只配"有没有 / 哪个变体"，不配数值：
 *   - 光暗属性且 **5★** 的角色（attribute = light / dark 且 rarity = 5）→ 有 / 无
 *   - 其余角色（三色，以及光暗的 3★ / 4★）→ 任意 / Ⅰ / Ⅱ / Ⅲ / 无
 * 选项与默认值都来自 herodata 的 ex_equip：有数据才认为这个角色有专属。
 * ------------------------------------------------------------------ */

const LIGHT_DARK_ATTRIBUTES = ['light', 'dark'];
const EE_SYMBOLS = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };

function heroInfoForCode(code) {
    const name = GvgPlans.heroNameForCode(code);
    if (!name) return null;

    try {
        const info = HeroData.getHeroExtraInfo(name);
        return info ? { name, info } : null;
    } catch (error) {
        console.warn(
            'GVG: herodata unavailable while reading the exclusive equipment',
            error
        );
        return null;
    }
}

function heroHasExclusive(code) {
    const entry = heroInfoForCode(code);
    return !!(
        entry &&
        Array.isArray(entry.info.ex_equip) &&
        entry.info.ex_equip.length > 0
    );
}

/** 只有"光暗 + 5★"是 有 / 无；其余（三色，以及光暗的 3★ / 4★）都是 任意 / Ⅰ / Ⅱ / Ⅲ */
function usesEeVariants(code) {
    const entry = heroInfoForCode(code);
    if (!entry) return true;

    const isLightDark5Star =
        LIGHT_DARK_ATTRIBUTES.includes(entry.info.attribute) &&
        Number(entry.info.rarity) === 5;

    return !isLightDark5Star;
}

/** 该角色可选的专属值：光暗 5★ 只有"有/无"，其余多一个"任意"（Ⅰ/Ⅱ/Ⅲ 都行） */
function eeOptionKeys(code) {
    return usesEeVariants(code)
        ? ['none', 'any', '1', '2', '3']
        : ['none', 'any'];
}

/** 默认值：确实有专属 → 有变体的选"Ⅰ"、光暗 5★ 选"有"；没有专属 → "无" */
function defaultEeKey(code) {
    if (!heroHasExclusive(code)) return 'none';
    return usesEeVariants(code) ? '1' : 'any';
}

/** 'any' 在两种分支下含义不同：光暗 5★ 是"有"，其余是"任意（哪个变体都行）" */
function eeLabel(value, code) {
    if (value === 'any') {
        if (code != null && usesEeVariants(code)) return i18next.t('Any');
        return i18next.t('Has');
    }
    if (EE_SYMBOLS[value]) return EE_SYMBOLS[value];
    return i18next.t('None');
}

function buildEeOptionHtml(code, currentValue) {
    const options = eeOptionKeys(code);
    const value = options.includes(currentValue)
        ? currentValue
        : defaultEeKey(code);

    return options
        .map(
            (key) =>
                `<option value="${key}" ${
                    value === key ? 'selected' : ''
                }>${escapeHtml(eeLabel(key, code))}</option>`
        )
        .join('');
}

/** 换英雄 / 带入条目 / 还原时重建专属下拉（选项集合随角色变化） */
function refreshEeSelect(index, code, value) {
    const select = document.getElementById(`gvgOffense${index}Ee`);
    if (!select) return;

    const options = eeOptionKeys(code);
    const wanted = options.includes(value) ? value : defaultEeKey(code);
    select.innerHTML = buildEeOptionHtml(code, wanted);
}

/**
 * 面板要求的可读摘要 —— 和英雄列表「Panel requirement & result priority」列完全同源：
 * 属性要求 + 结果优先级，`·` 分隔；没有要求时显示「无要求」。
 */
function requirementPreviewText(requirement) {
    if (!requirement) return i18next.t('No requirement');

    return (
        HeroesGrid.formatPanelRequirementForRequest(requirement) ||
        i18next.t('No requirement')
    );
}

function formatRequirementPreview(requirement) {
    return escapeHtml(requirementPreviewText(requirement));
}

function updateRequirementPreview(index, requirement) {
    const preview = document.getElementById(`gvgRequirementPreview${index}`);
    if (!preview) return;

    const text = requirementPreviewText(requirement);
    preview.innerHTML = escapeHtml(text);
    // 太长时省略号 + hover 看全文（和列表列的行为一致）
    preview.title = text;
}

/** 「不带入」时把该成员还原成打开弹窗时的样子（新作业 = 默认值，老作业 = 原值） */
function restoreMemberFromSnapshot(index, snapshot, requirements) {
    setSelectValue(`gvgOffense${index}Hero`, snapshot.heroCode);
    setSelectValue(`gvgOffense${index}Artifact`, snapshot.artifact);

    const levelInput = document.getElementById(
        `gvgOffense${index}ArtifactLevel`
    );
    if (levelInput) levelInput.value = snapshot.artifactLevel || '0';

    const imprintSelect = document.getElementById(`gvgOffense${index}Imprint`);
    if (imprintSelect) imprintSelect.value = snapshot.imprint || 'self';

    refreshEeSelect(index, snapshot.heroCode, snapshot.ee);

    requirements[index] = snapshot.requirement;
    updateRequirementPreview(index, requirements[index]);
}

/** 记录成员当前值，供「不带入」还原 */
function captureMemberSnapshot(index, requirements) {
    return {
        heroCode: valueOf(`gvgOffense${index}Hero`),
        artifact: valueOf(`gvgOffense${index}Artifact`),
        artifactLevel: valueOf(`gvgOffense${index}ArtifactLevel`),
        imprint: valueOf(`gvgOffense${index}Imprint`),
        ee: valueOf(`gvgOffense${index}Ee`),
        requirement: requirements[index],
    };
}

/* ------------------------------------------------------------------ *
 * 交互接线
 * ------------------------------------------------------------------ */

function wireEditDialog(entries, requirements) {
    const confirmButton = Swal.getConfirmButton();

    const validate = () => {
        const draft = readPlanFromDialog(null, requirements);
        const error = validateDraft(draft);

        const message = document.getElementById('gvgValidationMessage');
        if (message) message.innerText = error ? i18next.t(error) : '';
        if (confirmButton) confirmButton.disabled = !!error;
    };

    // 英雄下拉都是 391 项，和英雄列表一样做成可输入筛选的 multiple-select（单选）
    upgradeSearchableSelects(validate);

    // 打开弹窗时的成员状态，「不带入」时用它还原
    const snapshots = [0, 1, 2].map((index) =>
        captureMemberSnapshot(index, requirements)
    );

    [0, 1, 2].forEach((index) => {
        const importSelect = document.getElementById(`gvgImport${index}`);
        if (importSelect) {
            // 注意：必须用 bindChange，multiple-select 改值走的是 jQuery trigger('change')
            bindChange(importSelect, () => {
                const entryId = importSelect.value;

                // 选「不带入」= 把自动带入的东西撤回到默认值 / 原值
                if (!entryId) {
                    restoreMemberFromSnapshot(
                        index,
                        snapshots[index],
                        requirements
                    );
                    validate();
                    return;
                }

                const entry = entries.find((item) => item.id === entryId);
                if (entry) applyHeroEntry(index, entry, requirements);
                validate();
            });
        }

        // 换了英雄，之前带入的需求就不再对应了 → 清空，等重新带入；
        // 专属下拉的选项集合和默认值也跟着新角色走
        const heroSelect = document.getElementById(`gvgOffense${index}Hero`);
        if (heroSelect) {
            bindChange(heroSelect, () => {
                requirements[index] = null;
                updateRequirementPreview(index, null);
                refreshEeSelect(index, heroSelect.value);
                validate();
            });
        }

        const defense = document.getElementById(`gvgDefense${index}`);
        if (defense) bindChange(defense, validate);
    });

    ['gvgTags', 'gvgDefenseNote', 'gvgIntel', 'gvgStrategy'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('input', validate);
    });

    [0, 1, 2].forEach((index) => {
        [
            'Hero',
            'Position',
            'Imprint',
            'Ee',
            'Artifact',
            'ArtifactLevel',
        ].forEach((suffix) => {
            const element = document.getElementById(
                `gvgOffense${index}${suffix}`
            );
            // 英雄下拉有自己的监听（换英雄要清需求），这里跳过避免重复校验
            if (element && suffix !== 'Hero') bindChange(element, validate);
        });
    });

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
const SEARCHABLE_SELECTS = [
    {
        pattern: 'gvgDefense%d',
        placeholder: 'Hero',
        options: { width: 140, dropWidth: 230 },
    },
    {
        pattern: 'gvgOffense%dHero',
        placeholder: 'Hero',
        options: { width: 140, dropWidth: 230 },
    },
    {
        pattern: 'gvgImport%d',
        placeholder: 'Hero entry',
        // 收起时只显示英雄名（需求那段由 CSS 隐藏），展开的列表要够宽才放得下需求摘要。
        // width 必须显式给：插件 initView() 会把「下拉列表最宽的那条 + 20」写成 .ms-parent 的内联宽度。
        options: {
            width: 140,
            textTemplate: entryTextTemplate,
            dropWidth: 460,
            displayTitle: false,
        },
    },
    {
        pattern: 'gvgOffense%dArtifact',
        placeholder: 'Artifact',
        // 神器名最长 33 个字符（如 Unleashed Axe of Heavenly Mandate），列表要 260 才放得下
        options: { width: 140, dropWidth: 260 },
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
 * 展开列表的期望高度上限：再用视口剩余空间裁剪（见 fitDropdownToViewport）。
 * 360 会把弹窗顶出屏幕，第 3 个进攻成员那几行尤其明显，所以统一收到 280。
 */
const DROPDOWN_LIST_HEIGHT = 280;
/** 列表最小高度：再挤也留这么多，否则只剩一两行反而难选 */
const DROPDOWN_LIST_MIN_HEIGHT = 140;
/** 列表和视口边缘之间留的余量 */
const DROPDOWN_VIEWPORT_GAP = 16;

/**
 * 列表一律 280 高且只会向下展开的话，编辑弹窗里第 3 个进攻成员已经靠近弹窗底部，
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

/** 把角色条目的「英雄 + 神器 + 星级 + 阵型模式 + 面板要求」带进第 index 位 */
function applyHeroEntry(index, entry, requirements) {
    const { hero } = entry;

    const heroCode = GvgPlans.heroCodeForName(hero.name);
    if (heroCode) {
        setSelectValue(`gvgOffense${index}Hero`, heroCode);
    }

    const artifactSelect = document.getElementById(
        `gvgOffense${index}Artifact`
    );
    if (artifactSelect && hero.artifactName && hero.artifactName !== 'None') {
        const exists = [...artifactSelect.options].some(
            (option) => option.value === hero.artifactName
        );
        if (exists)
            setSelectValue(`gvgOffense${index}Artifact`, hero.artifactName);
    }

    const levelInput = document.getElementById(
        `gvgOffense${index}ArtifactLevel`
    );
    if (
        levelInput &&
        hero.artifactLevel != null &&
        hero.artifactLevel !== 'None'
    ) {
        levelInput.value = Math.max(
            0,
            Math.min(30, Math.round(Number(hero.artifactLevel)))
        );
    }

    const imprintSelect = document.getElementById(`gvgOffense${index}Imprint`);
    if (imprintSelect) imprintSelect.value = 'self';

    // 专属按"这个角色应该有的默认值"重置（带入条目只带英雄/神器/需求）
    refreshEeSelect(index, heroCode);

    requirements[index] = hero.optimizationRequest
        ? JSON.parse(JSON.stringify(hero.optimizationRequest))
        : null;

    updateRequirementPreview(index, requirements[index]);
}

/* ------------------------------------------------------------------ *
 * 读值 / 校验
 * ------------------------------------------------------------------ */

function readPlanFromDialog(draft, requirements) {
    const heroCodes = [0, 1, 2].map((index) => valueOf(`gvgDefense${index}`));

    const members = [0, 1, 2].map((index) => {
        const artifactName = valueOf(`gvgOffense${index}Artifact`);
        // 神器等级是普通文本框：空 = 0；非数字保留 NaN，交给 validateDraft 拦下来
        const levelText = valueOf(`gvgOffense${index}ArtifactLevel`);
        const level = levelText === '' ? 0 : Number(levelText);

        return {
            heroCode: valueOf(`gvgOffense${index}Hero`),
            position: valueOf(`gvgOffense${index}Position`),
            artifact: artifactName
                ? {
                      // 主键存 code；名字留着消歧（同一 code 可能对应两个神器）
                      code:
                          GvgPlans.artifactCodeForName(artifactName) ||
                          artifactName,
                      name: artifactName,
                      minLevel: level,
                  }
                : null,
            imprintMode:
                valueOf(`gvgOffense${index}Imprint`) === 'team'
                    ? 'team'
                    : 'self',
            ee: valueOf(`gvgOffense${index}Ee`) || 'none',
            requirement: requirements[index] || null,
        };
    });

    const tags = [];
    valueOf('gvgTags')
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => {
            if (!tags.includes(tag)) tags.push(tag);
        });

    return {
        id: draft ? draft.id : undefined,
        createdAt: draft ? draft.createdAt : undefined,
        defense: { heroCodes },
        offense: { members },
        equipOrder: draft && draft.equipOrder ? draft.equipOrder : [0, 1, 2],
        tags,
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
    const heroCodes = members.map((member) => member.heroCode).filter(Boolean);
    if (heroCodes.length !== 3 || new Set(heroCodes).size !== 3)
        return 'Offense team needs 3 different heroes';

    const positions = members.map((member) => member.position).filter(Boolean);
    if (positions.length !== 3 || new Set(positions).size !== 3)
        return 'Positions must be different';

    for (const member of members) {
        if (member.artifact) {
            const level = member.artifact.minLevel;
            if (!Number.isInteger(level) || level < 0 || level > 30)
                return 'Artifact level must be between 0 and 30';
        }
    }

    return null;
}

/* ------------------------------------------------------------------ *
 * 角色条目（本机英雄列表的一行 = 一个条目）
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
                const requirementText = hero.optimizationRequest
                    ? HeroesGrid.formatPanelRequirementForRequest(
                          hero.optimizationRequest
                      ) || ''
                    : '';
                // 同名条目可以有多个，所以每条都带英雄列表里的排名，便于区分（不只在重名时才加）
                const rank = Number.isFinite(Number(hero.index))
                    ? Number(hero.index)
                    : position + 1;

                return {
                    id: hero.id,
                    name: `${i18next.t(hero.name)} #${rank}`,
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

function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

