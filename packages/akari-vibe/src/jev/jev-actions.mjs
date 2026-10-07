import fs from 'node:fs';
import {validateCatalog} from './validate-actions.mjs';

function freezeDeep(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeDeep(child);
        Object.freeze(value);
    }
    return value;
}

export function loadCatalog() {
    const catalog = JSON.parse(fs.readFileSync(new URL('./jev-actions.json', import.meta.url), 'utf8'));
    const result = validateCatalog(catalog);
    if (!result.ok) throw new Error(`Invalid Jev catalog: ${result.errors.join('; ')}`);
    return freezeDeep(catalog);
}

export function derivedAllowedCommandIds(catalog) {
    const ids = [...catalog.baseAllowedCommandIds];
    const seen = new Set(ids);
    for (const action of catalog.actions) {
        if (!action.available) continue;
        for (const {commandId} of action.commands) {
            if (!seen.has(commandId)) { ids.push(commandId); seen.add(commandId); }
        }
    }
    return ids;
}

export function validateValue(schema, value) {
    if (!schema || typeof schema !== 'object') return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (Array.isArray(schema.type)) return schema.type.some(type => validateValue({...schema, type}, value));
    switch (schema.type) {
        case 'string': return typeof value === 'string' && (schema.maxLength === undefined || value.length <= schema.maxLength);
        case 'number':
        case 'integer': return typeof value === 'number' && Number.isFinite(value)
            && (schema.type !== 'integer' || Number.isInteger(value))
            && (schema.minimum === undefined || value >= schema.minimum)
            && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum);
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value) && (schema.maxItems === undefined || value.length <= schema.maxItems)
            && (!schema.items || value.every(item => validateValue(schema.items, item)));
        case 'object': {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            const props = schema.properties ?? {};
            if ((schema.required ?? []).some(key => !Object.hasOwn(value, key))) return false;
            return Object.entries(value).every(([key, item]) =>
                Object.hasOwn(props, key) ? validateValue(props[key], item) : schema.additionalProperties !== false);
        }
        default: return false;
    }
}

export function toCommandInstructions(action, value) {
    if (!validateValue(action.valueSchema, value)) return null;
    return action.commands.map(({commandId, argsMap}) => {
        if (!argsMap) return {commandId, args:value};
        const args = {};
        for (const [key, source] of Object.entries(argsMap)) {
            const path = source.split('.').slice(1);
            let result = value;
            for (const part of path) result = result?.[part];
            args[key] = result;
        }
        return {commandId, args};
    });
}
