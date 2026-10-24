// Entry point for the emulator automation from the heroes tab:
// swaps all 6 equipped items (or the 6 items of the selected build).

const equip = require('./equip');

const SLOT_ORDER = ['Weapon', 'Helmet', 'Armor', 'Necklace', 'Ring', 'Boots'];

let busy = false;
let stopping = false;

function buildTarget(item) {
    // chip 1 = the highest value (the list sorts by chip 1 first, so the target stays near
    // the first page); the other three keep a stable alphabetical order so consecutive
    // slots of similar items can reuse the filters already set
    const sorted = (item.substats || []).map(sub => ({
        type: sub.type,
        value: item.augmentedStats && item.augmentedStats[sub.type] !== undefined
            ? item.augmentedStats[sub.type]
            : sub.value,
    })).sort((a, b) => (b.value - a.value) || a.type.localeCompare(b.type));

    const substats = sorted.length
        ? [sorted[0]].concat(sorted.slice(1).sort((a, b) => a.type.localeCompare(b.type)))
        : sorted;

    // the game shows the reforged stats only when the item was actually reforged, and
    // the optimizer data can be stale either way, so both value sets are kept
    const baseSubstats = (item.substats || []).map(sub => ({ type: sub.type, value: sub.value }))
        .sort((a, b) => (b.value - a.value) || a.type.localeCompare(b.type));

    const baseValues = [item.main.value].concat((item.substats || []).map(sub => sub.value));
    const reforgedValues = [item.main.value].concat(substats.map(sub => sub.value));

    return {
        id: item.id,
        slot: item.gear,
        set: item.set,
        mainType: item.main.type,
        mainValue: item.main.value,
        substats: substats,
        baseSubstats: baseSubstats.length
            ? [baseSubstats[0]].concat(baseSubstats.slice(1).sort((a, b) => a.type.localeCompare(b.type)))
            : baseSubstats,
        baseValues,
        reforgedValues,
    };
}

// While a run is in progress the same button turns into the cancel button; once the
// cancel is requested it is disabled until the run actually stops.
function setButtonRunning(running) {
    const button = document.getElementById('emulatorSelectHero');
    if (!button) {
        return;
    }

    button.disabled = false;
    button.style.opacity = '';
    button.value = running ? i18next.t('Cancel operation') : i18next.t('One-Click Equip');
}

function setButtonStopping() {
    const button = document.getElementById('emulatorSelectHero');
    if (!button) {
        return;
    }

    button.disabled = true;
    button.style.opacity = '0.6';
    button.value = i18next.t('Stopping...');
}

let allItemsCache = null;

async function getAllItems() {
    if (!allItemsCache) {
        const response = await Api.getAllItems();
        allItemsCache = response.items || [];
    }

    return allItemsCache;
}

async function resolveItem(entry) {
    if (entry && entry.main) {
        return entry;
    }

    const response = await Api.getItemById(entry.id);
    return response && response.item ? response.item : null;
}

async function resolveItems(entries) {
    const items = [];

    for (const entry of entries) {
        const item = await resolveItem(entry);
        if (!item || !item.main) {
            throw new Error(i18next.t('Item not found'));
        }
        items.push(item);
    }

    return items.sort((a, b) => SLOT_ORDER.indexOf(a.gear) - SLOT_ORDER.indexOf(b.gear));
}

module.exports = {
    buildTarget,

    initialize: () => {
        const button = document.getElementById('emulatorSelectHero');
        if (button) {
            button.addEventListener('click', () => {
                if (busy) {
                    if (stopping) {
                        return;
                    }
                    stopping = true;
                    setButtonStopping();
                    equip.requestCancel();
                    return;
                }
                module.exports.equipHeroBuild();
            });
        }
    },

    // 6-piece flow: select all six pieces; the user presses 更换装备 once at the end
    // and the game applies all pending selections
    equipHeroBuild: async () => {
        if (busy) {
            return;
        }

        const hero = HeroesGrid.getSelectedRow ? HeroesGrid.getSelectedRow() : null;
        if (!hero) {
            Dialog.htmlError(i18next.t('Select a hero first'));
            return;
        }

        const checked = HeroesTab.getSelectedGear ? HeroesTab.getSelectedGear() : [];
        if (checked.length !== 6) {
            Dialog.htmlError(i18next.t('Need 6 items: check all six, or select a build row'));
            return;
        }

        busy = true;
        stopping = false;
        let currentSlot = '';
        let cancelled = false;
        setButtonRunning(true);
        equip.clearCancel();

        // fail fast when the game is not on the manage equipment page
        try {
            await equip.ensureManagePage();
        } catch (error) {
            busy = false;
            setButtonRunning(false);
            Dialog.htmlError(i18next.t('Please open the Manage Equipment page in game first'));
            return;
        }

        try {
            const items = await resolveItems(checked);
            const allItems = await getAllItems();
            equip.resetFilterSession();

            // the optimizer data may be stale, so every piece is attempted; a slot that
            // fails (e.g. already worn in game) does not stop the rest
            const failed = [];

            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                currentSlot = i18next.t(item.gear);

                // stays visible while this slot is being processed
                const progress = Notifier.stickyRaw
                    ? Notifier.stickyRaw(`${i18next.t('Equipping in game...')} ${currentSlot} (${index + 1}/${items.length})`)
                    : null;

                try {
                    // select only: the game keeps the pending selections and applies them
                    // when the user presses 更换装备 once at the end
                    await equip.selectItem(module.exports.buildTarget(item), { allItems });
                } catch (error) {
                    if (error.cancelled) {
                        cancelled = true;
                        break;
                    }

                    // a page problem on the very first slot means the game is not on the
                    // manage equipment page: stop instead of failing all six slots
                    if (index === 0 && /管理装备/.test(error.message)) {
                        Dialog.htmlError(i18next.t('Please open the Manage Equipment page in game first'));
                        return;
                    }

                    console.warn('[emulator] slot failed', item.gear, error);
                    failed.push({ slot: currentSlot, message: error.message });
                } finally {
                    // the toast stays until the slot is done, then the next slot shows its own
                    if (progress) {
                        progress.close();
                    }
                }
            }

            if (cancelled) {
                Notifier.info(i18next.t('Operation cancelled'));
                return;
            }

            if (failed.length === 0) {
                Dialog.htmlSuccessDisableOutsideClick(i18next.t('All items are selected. Confirm and press Equip once in game.'));
                return;
            }

            const detail = failed.map(entry => `${entry.slot}: ${entry.message}`).join('<br>');
            if (failed.length === items.length) {
                Dialog.htmlError(i18next.t('In-game equip failed: ') + '<br>' + detail);
            } else {
                Dialog.htmlError(i18next.t('Some slots could not be equipped (may already be worn):') + '<br>' + detail);
            }
        } catch (error) {
            if (error.cancelled) {
                Notifier.info(i18next.t('Operation cancelled'));
                return;
            }

            Dialog.htmlError(i18next.t('In-game equip failed: ') + error.message);
        } finally {
            busy = false;
            stopping = false;
            setButtonRunning(false);
        }
    },

    // single item helper (kept for future use)
    equipSingleItem: async (entry) => {
        if (busy) {
            return;
        }

        busy = true;
        try {
            const item = await resolveItem(entry);
            if (!item) {
                throw new Error(i18next.t('Item not found'));
            }
            Notifier.info(i18next.t('Locating the item in the emulator...'));
            await equip.selectItem(module.exports.buildTarget(item));
            Notifier.success(i18next.t('Item selected in the emulator. Check the panel, then tap Equip in game.'));
        } catch (error) {
            Dialog.htmlError(i18next.t('In-game equip failed: ') + error.message);
        } finally {
            busy = false;
        }
    },
};
