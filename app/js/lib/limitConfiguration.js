const LIMIT_CONFIGURATIONS = [
    {
        minKey: 'inputAtkMinLimit',
        maxKey: 'inputAtkMaxLimit',
        minId: 'inputMinAtkLimit',
        maxId: 'inputMaxAtkLimit',
        minConfiguredKey: 'inputAtkMinConfigured',
        maxConfiguredKey: 'inputAtkMaxConfigured',
    },
    {
        minKey: 'inputHpMinLimit',
        maxKey: 'inputHpMaxLimit',
        minId: 'inputMinHpLimit',
        maxId: 'inputMaxHpLimit',
        minConfiguredKey: 'inputHpMinConfigured',
        maxConfiguredKey: 'inputHpMaxConfigured',
    },
    {
        minKey: 'inputDefMinLimit',
        maxKey: 'inputDefMaxLimit',
        minId: 'inputMinDefLimit',
        maxId: 'inputMaxDefLimit',
        minConfiguredKey: 'inputDefMinConfigured',
        maxConfiguredKey: 'inputDefMaxConfigured',
    },
    {
        minKey: 'inputSpdMinLimit',
        maxKey: 'inputSpdMaxLimit',
        minId: 'inputMinSpdLimit',
        maxId: 'inputMaxSpdLimit',
        minConfiguredKey: 'inputSpdMinConfigured',
        maxConfiguredKey: 'inputSpdMaxConfigured',
    },
    {
        minKey: 'inputCrMinLimit',
        maxKey: 'inputCrMaxLimit',
        minId: 'inputMinCrLimit',
        maxId: 'inputMaxCrLimit',
        minConfiguredKey: 'inputCrMinConfigured',
        maxConfiguredKey: 'inputCrMaxConfigured',
    },
    {
        minKey: 'inputCdMinLimit',
        maxKey: 'inputCdMaxLimit',
        minId: 'inputMinCdLimit',
        maxId: 'inputMaxCdLimit',
        minConfiguredKey: 'inputCdMinConfigured',
        maxConfiguredKey: 'inputCdMaxConfigured',
    },
    {
        minKey: 'inputEffMinLimit',
        maxKey: 'inputEffMaxLimit',
        minId: 'inputMinEffLimit',
        maxId: 'inputMaxEffLimit',
        minConfiguredKey: 'inputEffMinConfigured',
        maxConfiguredKey: 'inputEffMaxConfigured',
    },
    {
        minKey: 'inputResMinLimit',
        maxKey: 'inputResMaxLimit',
        minId: 'inputMinResLimit',
        maxId: 'inputMaxResLimit',
        minConfiguredKey: 'inputResMinConfigured',
        maxConfiguredKey: 'inputResMaxConfigured',
    },
];

module.exports = {
    definitions: LIMIT_CONFIGURATIONS,

    setRequestFlags: (request, index, isConfigured) => {
        for (const definition of LIMIT_CONFIGURATIONS) {
            request[definition.minConfiguredKey] = isConfigured(definition.minId + index);
            request[definition.maxConfiguredKey] = isConfigured(definition.maxId + index);
        }
    },

    isConfigured: (request, valueKey, configuredKey, defaultValue) => {
        if (request[configuredKey] != null) {
            return request[configuredKey];
        }
        return request[valueKey] != null && request[valueKey] != defaultValue;
    },

    displayValue: (request, valueKey, configuredKey, defaultValue) => {
        if (!module.exports.isConfigured(request, valueKey, configuredKey, defaultValue)) {
            return '';
        }
        return request[valueKey];
    },
};
