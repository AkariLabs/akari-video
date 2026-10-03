import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('akari-project-service.ts', readFileSync(new URL('../src/node/akari-project-service.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariProjectServiceImpl');
assert.ok(owner);
const method = owner.members.find(node => node.name?.getText(source) === 'getAssetCatalogView');
assert.ok(method);
const compiled = ts.transpileModule(`class Service { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const getAssetCatalogView = new Function('mergeAssetCatalogViews', `${compiled}\nreturn Service.prototype.getAssetCatalogView;`)((left, right) => [...left, ...right]);

test('omitted intent is automatic even with a preferenceRoot; explicit user stays online', async () => {
    const intents = [];
    const service = {
        loadResolverCatalogItems: async intent => {
            intents.push(intent);
            return { items: [], status: 'ok', entitlementsStatus: 'no_credentials', entitledProducts: [] };
        },
        loadLocalCatalogViewItems: async () => ({ items: [], packs: [] }),
        loadLibraryPacks: async () => []
    };
    await getAssetCatalogView.call(service, undefined);
    await getAssetCatalogView.call(service, '');
    await getAssetCatalogView.call(service, '', 'user');
    await getAssetCatalogView.call(service, undefined, 'user');
    assert.deepEqual(intents, ['automatic', 'automatic', 'user', 'user']);
});
