import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateCatalog} from '../../../../../packages/akari-vibe/src/jev/validate-actions.mjs';
import {derivedAllowedCommandIds} from '../../../../../packages/akari-vibe/src/jev/jev-actions.mjs';

const catalogUrl = new URL('../../../../../packages/akari-vibe/src/jev/jev-actions.json', import.meta.url);
const defaultOutput = new URL('../src/common/jev-actions.generated.ts', import.meta.url);
const dockOutput = new URL('../../akari-vibe-dock/src/common/jev-catalog.generated.ts', import.meta.url);
const validatorUrl = new URL('../src/common/jev-catalog-validate.ts', import.meta.url);

function commandValueSchema(action, argsMap) {
    if (!argsMap) return action.valueSchema;
    const properties = {}, required = [];
    for (const [key, source] of Object.entries(argsMap)) {
        const path = source.split('.').slice(1);
        let schema = action.valueSchema;
        for (const part of path) schema = schema?.properties?.[part];
        if (!schema) throw new Error(`Missing valueSchema for ${source}`);
        properties[key] = schema;
        if (action.valueSchema.required?.includes(path[0])) required.push(key);
    }
    return {type:'object', properties, required, additionalProperties:false};
}

export function generatedData(catalog) {
    const result = validateCatalog(catalog);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const base = catalog.baseAllowedCommandIds;
    const baseSet = new Set(base);
    const derived = derivedAllowedCommandIds(catalog).filter(id => !baseSet.has(id));
    const schemas = {};
    for (const action of catalog.actions) {
        if (!action.available) continue;
        for (const {commandId, argsMap} of action.commands) {
            if (baseSet.has(commandId)) continue;
            const schema = commandValueSchema(action, argsMap);
            if (schemas[commandId] && JSON.stringify(schemas[commandId]) !== JSON.stringify(schema)) {
                throw new Error(`Conflicting valueSchema for ${commandId}`);
            }
            schemas[commandId] = schema;
        }
    }
    return {base, derived, schemas, settingsOpenSections: catalog.settingsOpenSections};
}

export function generateJevActions(catalog) {
    const {base, derived, schemas, settingsOpenSections} = generatedData(catalog);
    const json = value => JSON.stringify(value, null, 2);
    return `// 自動生成・編集しない・再生成は npm run gen:jev\n` +
        `export const JEV_BASE_ALLOWED_COMMAND_IDS = ${json(base)} as const;\n` +
        `export const JEV_DERIVED_COMMAND_IDS = ${json(derived)} as const;\n` +
        `export const JEV_SETTINGS_OPEN_SECTIONS = ${json(settingsOpenSections)} as const;\n` +
        `export const JEV_COMMAND_VALUE_SCHEMAS = ${json(schemas)} as Record<string, import('./jev-catalog-validate').JevValueSchema>;\n`;
}

export function writeGenerated(catalog, output = defaultOutput) {
    fs.writeFileSync(output, generateJevActions(catalog));
    if (output === defaultOutput) fs.writeFileSync(dockOutput, generateDockCatalog(catalog));
}

export function generateDockCatalog(catalog) {
    const result = validateCatalog(catalog);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const actions = catalog.actions.filter(action => action.available).map(action => ({
        id: action.id, tierMax: action.tierMax, reversible: action.reversible,
        valueSchema: action.valueSchema, commands: action.commands
    }));
    return '// 自動生成・編集しない・再生成は npm run gen:jev\n' +
        fs.readFileSync(validatorUrl, 'utf8') + '\n' +
        `export const JEV_LOCAL_ACTIONS = ${JSON.stringify(actions, null, 2)} as const;\n`;
}

if (process.argv[1] && fs.existsSync(process.argv[1]) &&
    fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    const outIndex = process.argv.indexOf('--out');
    if (outIndex >= 0 && !process.argv[outIndex + 1]) throw new Error('--out needs a path');
    const output = outIndex >= 0 ? process.argv[outIndex + 1] : defaultOutput;
    const catalog = JSON.parse(fs.readFileSync(catalogUrl, 'utf8'));
    writeGenerated(catalog, output);
}
