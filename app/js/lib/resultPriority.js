const RESULT_PRIORITY_FIELDS = [
    {field: 'atk', label: 'Atk'},
    {field: 'def', label: 'Def'},
    {field: 'hp', label: 'Hp'},
    {field: 'spd', label: 'Spd'},
    {field: 'cr', label: 'CRate'},
    {field: 'cd', label: 'CDmg'},
    {field: 'eff', label: 'Eff'},
    {field: 'res', label: 'Res'},
    {field: 'ehp', label: 'Ehp'},
    {field: 'dmg', label: 'Dmg'},
    {field: 'mcdmg', label: 'Mcd'},
    {field: 'dmgh', label: 'DmgH'},
    {field: 'dmgd', label: 'DmgD'},
    {field: 's1', label: 'S1'},
    {field: 's2', label: 'S2'},
    {field: 's3', label: 'S3'},
];

const FIELD_NAMES = RESULT_PRIORITY_FIELDS.reduce((result, item) => {
    result[item.field] = item.label;
    return result;
}, {});

/**
 * Returns a clean ordered result-priority state.
 *
 * @param {Object} state saved result-priority state
 * @returns {{order: string[], disliked: string[]}}
 */
function normalizeState(state) {
    const validFields = new Set(RESULT_PRIORITY_FIELDS.map(item => item.field));
    const legacyOrder = [
        ...((state && state.preferred) || []),
        ...((state && state.disliked) || []),
    ];
    const order = [];
    const disliked = [];
    const savedOrder = state && state.order ? state.order : legacyOrder;

    for (const field of savedOrder) {
        if (validFields.has(field) && !order.includes(field)) {
            order.push(field);
        }
    }

    for (const field of (state && state.disliked) || []) {
        if (order.includes(field) && !disliked.includes(field)) {
            disliked.push(field);
        }
    }

    return {order, disliked};
}

/**
 * Returns fields that are not assigned to the result-priority list.
 *
 * @param {Object} state result-priority state
 * @returns {string[]}
 */
function getAvailableFields(state) {
    const normalized = normalizeState(state);
    return RESULT_PRIORITY_FIELDS
        .map(item => item.field)
        .filter(field => !normalized.order.includes(field));
}

module.exports = {
    RESULT_PRIORITY_FIELDS,
    FIELD_NAMES,
    normalizeState,
    getAvailableFields,
};
