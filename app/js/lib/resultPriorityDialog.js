const Swal = require('sweetalert2');
const Sortable = require('sortablejs');
const ResultPriority = require('./resultPriority');

/**
 * Opens the result-priority drag-and-drop dialog.
 *
 * @param {{order?: string[], disliked?: string[]}} state saved priority state
 * @returns {Promise<{order: string[], disliked: string[]}|null>}
 */
async function editResultPriorityDialog(state) {
    const normalizedState = ResultPriority.normalizeState(state);
    const renderAvailableItems = (fields) => fields.map(field => {
        const label = ResultPriority.FIELD_NAMES[field];
        return `<div class="resultPriorityItem" data-id="${field}" style="color: var(--font-color)">${i18next.t(label)}</div>`;
    }).join('');
    const renderSelectedItems = (fields) => fields.map(field => {
        const label = ResultPriority.FIELD_NAMES[field];
        const disliked = normalizedState.disliked.includes(field);
        return `<div class="resultPrioritySelectedItem" data-id="${field}">
            <span>${i18next.t(label)}</span>
            <button type="button" class="resultPriorityDirection${disliked ? ' disliked' : ''}">${i18next.t(disliked ? 'Dislike' : 'Prefer')}</button>
        </div>`;
    }).join('');

    const result = await Swal.fire({
        title: i18next.t('Result priority'),
        width: 600,
        html: `
            <div class="groupContainer resultPriorityDialog">
                <div class="groupColumn resultPriorityDataColumn">
                    <div class="dragOrderList">
                        <div class="draggableColumnLabel" style="color: var(--font-color)">${i18next.t('Data type')}</div>
                        <div id="resultPriorityAvailableList" class="draggableMovableContainer resultPriorityDataList">${renderAvailableItems(ResultPriority.getAvailableFields(normalizedState))}</div>
                    </div>
                </div>
                <div class="groupColumn resultPriorityOrderColumn">
                    <div class="dragOrderList">
                        <div class="draggableColumnLabel" style="color: var(--font-color)">${i18next.t('Result order')}</div>
                        <div id="resultPriorityOrderList" class="draggableMovableContainer resultPriorityOrderList">${renderSelectedItems(normalizedState.order)}</div>
                    </div>
                </div>
            </div>
        `,
        didOpen: () => {
            const availableList = document.getElementById('resultPriorityAvailableList');
            const orderList = document.getElementById('resultPriorityOrderList');
            const sortableOptions = {
                group: 'resultPriority',
                animation: 100,
                fallbackOnBody: true,
            };

            Sortable.create(availableList, {
                ...sortableOptions,
                onAdd: event => {
                    event.item.className = 'resultPriorityItem';
                    event.item.innerHTML = i18next.t(ResultPriority.FIELD_NAMES[event.item.dataset.id]);
                },
            });
            Sortable.create(orderList, {
                ...sortableOptions,
                onAdd: event => {
                    event.item.className = 'resultPrioritySelectedItem';
                    event.item.innerHTML = `<span>${i18next.t(ResultPriority.FIELD_NAMES[event.item.dataset.id])}</span><button type="button" class="resultPriorityDirection">${i18next.t('Prefer')}</button>`;
                },
                onRemove: event => {
                    event.item.className = 'resultPriorityItem';
                    event.item.innerHTML = i18next.t(ResultPriority.FIELD_NAMES[event.item.dataset.id]);
                },
            });

            orderList.addEventListener('click', event => {
                if (!event.target.classList.contains('resultPriorityDirection')) {
                    return;
                }

                event.stopPropagation();
                event.preventDefault();
                const button = event.target;
                const disliked = button.classList.toggle('disliked');
                button.textContent = i18next.t(disliked ? 'Dislike' : 'Prefer');
            });
        },
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: i18next.t('Save'),
        cancelButtonText: i18next.t('Cancel'),
        preConfirm: () => {
            const orderItems = Array.from(document.querySelectorAll('#resultPriorityOrderList .resultPrioritySelectedItem'));
            return {
                order: orderItems.map(item => item.dataset.id),
                disliked: orderItems
                    .filter(item => item.querySelector('.resultPriorityDirection').classList.contains('disliked'))
                    .map(item => item.dataset.id),
            };
        },
    });

    return result.isConfirmed ? result.value : null;
}

module.exports = {
    editResultPriorityDialog,
};
