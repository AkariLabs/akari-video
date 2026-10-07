const schemaKeys = new Set(['type', 'enum', 'items', 'maxItems', 'maxLength', 'minimum',
    'exclusiveMinimum', 'required', 'properties', 'additionalProperties']);
const types = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);

export function validateSchema(schema, path = 'valueSchema') {
    const errors = [];
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [`${path}: object required`];
    for (const key of Object.keys(schema)) if (!schemaKeys.has(key)) errors.push(`${path}: unknown ${key}`);
    if (Array.isArray(schema.type)) {
        if (schema.type.length < 2 || new Set(schema.type).size !== schema.type.length ||
            schema.type.some(type => !['number', 'string', 'boolean'].includes(type))) errors.push(`${path}: invalid type`);
    } else if (!types.has(schema.type)) errors.push(`${path}: invalid type`);
    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length ||
        schema.enum.some(value => !['string', 'number', 'boolean'].includes(typeof value)))) errors.push(`${path}: invalid enum`);
    for (const key of ['maxItems', 'maxLength']) {
        if (schema[key] !== undefined && (!Number.isInteger(schema[key]) || schema[key] < 0)) errors.push(`${path}: invalid ${key}`);
    }
    for (const key of ['minimum', 'exclusiveMinimum']) {
        if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) errors.push(`${path}: invalid ${key}`);
    }
    if (schema.items !== undefined) errors.push(...validateSchema(schema.items, `${path}.items`));
    if (schema.properties !== undefined) {
        if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) errors.push(`${path}: invalid properties`);
        else for (const [key, value] of Object.entries(schema.properties)) errors.push(...validateSchema(value, `${path}.properties.${key}`));
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) ||
        schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(schema.properties ?? {}, key)))) errors.push(`${path}: invalid required`);
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) errors.push(`${path}: additionalProperties must be false`);
    if (schema.type !== 'object' && (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined)) errors.push(`${path}: object keywords on non-object`);
    if (schema.type !== 'array' && (schema.items !== undefined || schema.maxItems !== undefined)) errors.push(`${path}: array keywords on non-array`);
    if (schema.type !== 'string' && schema.maxLength !== undefined) errors.push(`${path}: string keyword on non-string`);
    if (!['integer', 'number'].includes(schema.type) && (schema.minimum !== undefined || schema.exclusiveMinimum !== undefined)) errors.push(`${path}: numeric keyword on non-number`);
    return errors;
}

export function validateCatalog(catalog) {
    const errors = [];
    if (!catalog || typeof catalog !== 'object' || catalog.schema !== 'akari.jev-actions/v0') return {ok:false, errors:['invalid catalog schema']};
    const base = catalog.baseAllowedCommandIds;
    if (!Array.isArray(base) || base.length !== 33 || new Set(base).size !== 33 || base.some(id => typeof id !== 'string')) errors.push('baseAllowedCommandIds must contain 33 unique ids');
    if (!Array.isArray(catalog.neverByVoice) || !catalog.neverByVoice.length || catalog.neverByVoice.some(value => typeof value !== 'string' || !value)) errors.push('invalid neverByVoice');
    if (!Array.isArray(catalog.settingsOpenSections) || new Set(catalog.settingsOpenSections).size !== catalog.settingsOpenSections.length ||
        catalog.settingsOpenSections.some(value => typeof value !== 'string' || !value)) errors.push('invalid settingsOpenSections');
    if (!catalog.uiReceptors || typeof catalog.uiReceptors !== 'object') errors.push('invalid uiReceptors');
    else for (const [name, state] of Object.entries(catalog.uiReceptors)) {
        if (!name || !['shipped', 'pending'].includes(state)) errors.push(`invalid receptor ${name}`);
    }
    if (!Array.isArray(catalog.actions)) errors.push('invalid actions');
    const actions = Array.isArray(catalog.actions) ? catalog.actions : [];
    const baseSet = new Set(Array.isArray(base) ? base : []);
    const ids = new Set(), pairs = new Set();
    const availableNew = new Set(actions.filter(action => action?.available === true).flatMap(action =>
        Array.isArray(action.commands) ? action.commands.map(command => command.commandId).filter(id => !baseSet.has(id)) : []));
    const unavailableNew = new Set(actions.filter(action => action?.available === false).flatMap(action =>
        Array.isArray(action.commands) ? action.commands.map(command => command.commandId).filter(id => !baseSet.has(id)) : []));
    for (const action of actions) {
        if (!action || typeof action !== 'object') { errors.push('invalid action'); continue; }
        const label = action.id ?? '?', pair = `${action.action}\u0000${action.target}`;
        if (ids.has(label)) errors.push(`${label}: duplicate id`);
        if (pairs.has(pair)) errors.push(`${label}: duplicate action/target`);
        ids.add(label); pairs.add(pair);
        if (typeof label !== 'string' || !label || typeof action.action !== 'string' || typeof action.target !== 'string' || typeof action.intent !== 'string') errors.push(`${label}: invalid identity`);
        if (!['ui', 'task'].includes(action.family) || !['existing', 'J2', 'E1', 'E4', 'E5'].includes(action.owner) || typeof action.contract !== 'string') errors.push(`${label}: invalid classification`);
        if (![1, 2, 3].includes(action.tierMax) || !['yes', 'conditional', 'no'].includes(action.reversible)) errors.push(`${label}: invalid tier/reversible`);
        if (action.tierMax === 3 && (action.reversible !== 'no' || (action.commands?.length ?? 0) !== 0 || !(action.family === 'task' || action.action?.startsWith('scratch.') || action.action === 'browser.open'))) errors.push(`${label}: tier 3 must stop before command`);
        if (action.reversible === 'no' && action.tierMax !== 3) errors.push(`${label}: irreversible action must be tier 3`);
        if (!Array.isArray(action.explicitWords) || action.explicitWords.some(word => typeof word !== 'string') || (action.explicitWords.length && (action.family !== 'ui' || !['browser', 'sketch'].includes(action.target)))) errors.push(`${label}: invalid explicitWords`);
        if (!Array.isArray(action.needsUi) || action.needsUi.some(name => typeof name !== 'string')) errors.push(`${label}: invalid needsUi`);
        if (typeof action.available !== 'boolean') errors.push(`${label}: invalid availability`);
        if (action.available) for (const name of action.needsUi ?? []) if (catalog.uiReceptors?.[name] !== 'shipped') errors.push(`${label}: pending receptor ${name}`);
        if (!Array.isArray(action.commands)) errors.push(`${label}: invalid commands`);
        for (const command of action.commands ?? []) {
            if (!command || typeof command.commandId !== 'string') { errors.push(`${label}: invalid command`); continue; }
            if (action.owner === 'existing' && !baseSet.has(command.commandId)) errors.push(`${label}: existing command outside base`);
            if (action.available && !baseSet.has(command.commandId) && !availableNew.has(command.commandId)) errors.push(`${label}: unavailable command`);
            if (!action.available && baseSet.has(command.commandId)) errors.push(`${label}: unavailable command entered allowlist`);
            if (!action.available && availableNew.has(command.commandId)) errors.push(`${label}: unavailable command entered allowlist`);
            if (command.argsMap !== undefined && (!command.argsMap || typeof command.argsMap !== 'object' ||
                Object.values(command.argsMap).some(value => !/^value(?:\.[A-Za-z][\w]*)*$/.test(value)))) errors.push(`${label}: invalid argsMap`);
            else for (const source of Object.values(command.argsMap ?? {})) {
                let schema = action.valueSchema;
                for (const part of source.split('.').slice(1)) schema = schema?.properties?.[part];
                if (!schema) errors.push(`${label}: argsMap source missing from valueSchema`);
            }
        }
        errors.push(...validateSchema(action.valueSchema, `${label}.valueSchema`));
        const forbidden = catalog.neverByVoice ?? [];
        const values = [action.id, action.action, action.target, action.intent, ...((action.commands ?? []).flatMap(command => [command.commandId, ...Object.keys(command.argsMap ?? {})])), ...Object.keys(action.valueSchema?.properties ?? {}),
            ...Object.values(action.valueSchema?.properties ?? {}).flatMap(schema => schema.enum ?? [])];
        if (values.some(value => forbidden.some(term => typeof value === 'string' &&
            (value === term || value.startsWith(`${term}.`) || value.endsWith(`.${term}`) || value.includes(`.${term}.`))))) errors.push(`${label}: neverByVoice target`);
    }
    for (const id of unavailableNew) if (baseSet.has(id) || availableNew.has(id)) errors.push(`${id}: unavailable command in allowlist`);
    return {ok:errors.length === 0, errors};
}
