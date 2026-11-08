/**
 * 「装备这套配装」前的冲突检查。
 *
 * 后端 `ItemDb.equipItemOnHero()` 会把装备从原主人身上**静默卸掉**（不报错、不提示），
 * 所以两套配装抢同一件装备时，前一晚穿好的角色会被悄悄扒光。
 *
 * 这里在装备前查一次：这条配装的 6 件里有没有正被**任何英雄**穿着的，
 * 有就列出「部位 — 穿着者」，让用户决定要不要继续（可能是有意让后面的人穿）。
 */

function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 装备前检查冲突。
 * @param instance heroTable 实例（提供 getBuildConflicts）
 * @param hero     配装所属英雄
 * @param build    要装备的配装
 * @returns {Promise<boolean>} true = 可以继续装备
 */
async function confirmEquip(instance, hero, build) {
    if (!instance || !hero || !build) return true;
    if (typeof instance.getBuildConflicts !== 'function') return true;

    const conflicts = instance.getBuildConflicts(hero.id, build);
    if (!conflicts.length) return true;

    // 只显示部位（武器 / 头盔 / …）+ 穿着者，不显示具体装备名。
    // 同名英雄可有多条条目：带上「优先度列」的值（和 builds 冲突提示口径一致）。
    const rows = conflicts
        .map((conflict) => {
            const heroIndex = Number(conflict.heroIndex);
            const ownerName = escapeHtml(i18next.t(conflict.heroName))
                + (Number.isFinite(heroIndex) ? ` #${heroIndex}` : '');
            return `<li>${escapeHtml(i18next.t(conflict.slot || 'Gear'))} — ${ownerName}</li>`;
        })
        .join('');

    const html = `
        <div style="text-align:left;font-size:14px">
            <div>${i18next.t(
                'These items are already equipped by other heroes'
            )}:</div>
            <ul style="margin:8px 0 0 18px;padding:0">${rows}</ul>
            <div style="margin-top:10px;color:#c0392b">${i18next.t(
                'Continuing will unequip them from those heroes'
            )}</div>
        </div>`;

    const confirmed = await Dialog.htmlConfirmation(
        html,
        i18next.t('Equip this build')
    );

    return !!confirmed;
}

module.exports = { confirmEquip };
