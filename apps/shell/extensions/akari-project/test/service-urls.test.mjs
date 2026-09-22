import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { LEGACY_AKARI_HOST } from '../../../../../packages/akari-launcher/src/service-urls.cjs';

const require = createRequire(import.meta.url);
function compile(source, fileName, imports = {}) {
    const { outputText } = ts.transpileModule(source, {
        fileName,
        compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
    });
    const exports = {};
    new Function('require', 'exports', outputText)(name => imports[name] ?? require(name), exports);
    return exports;
}
const catalog = compile(readFileSync(new URL('../src/common/asset-catalog-view.ts', import.meta.url), 'utf8'), 'view.ts');
const dialogSource = ts.createSourceFile('dialog.ts', readFileSync(new URL('../../akari-surfaces/src/browser/akari-settings-dialog.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const dialog = dialogSource.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AkariSettingsDialog');
const renderStore = dialog.members.find(node => node.name?.getText(dialogSource) === 'renderStore').getText(dialogSource);
const componentSource = readFileSync(new URL('../../akari-surfaces/src/browser/akari-store-settings.tsx', import.meta.url), 'utf8');

for (const [input, lab] of [
    [undefined, 'https://akari.video/lab'],
    [`https://${LEGACY_AKARI_HOST}/api/store`, 'https://akari.video/lab'],
    [`https://${LEGACY_AKARI_HOST}/api/store/`, 'https://akari.video/lab'],
    ['https://akari.video/api/store', 'https://akari.video/lab'],
    ['http://localhost:8788/api/store', 'http://localhost:8788/lab'],
]) {
    test(`purchase and both Store buttons use the normalized URL: ${input}`, () => {
        assert.equal(catalog.deriveStoreLabBaseUrl(input), lab);
        assert.equal(catalog.storeProductUrl(input, 'a b'), `${lab}/asset.html?id=a%20b`);
        const opened = [];
        const windows = { openNewWindow: (url, options) => opened.push({ url, options }) };
        const state = { connection: { url: input, connected: true }, phase: 'idle' };
        const actions = [];
        const element = () => ({ style: {}, setAttribute() {}, append() {}, replaceChildren() {} });
        const action = (label, click) => { actions.push({ label, click }); return {}; };
        const compiledMethod = ts.transpileModule(`return class { ${renderStore} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
        const Dialog = new Function('deriveStoreLabBaseUrl', 'element', 'description', 'action', compiledMethod)(catalog.deriveStoreLabBaseUrl, element, element, action);
        const instance = new Dialog();
        Object.assign(instance, { storeState: state, storeRow: element(), windows });
        instance.renderStore();
        actions.find(item => item.label === 'ストアを開く').click();

        const buttons = [];
        let hook = 0;
        const react = {
            useState: () => [hook++ === 0 ? state : 'ok', () => {}],
            useMemo: fn => fn(), useEffect() {},
            createElement: (tag, props, ...children) => {
                if (tag === 'button') buttons.push({ props, children });
                return { tag, props, children };
            }
        };
        const { AkariStoreSettings } = compile(componentSource, 'settings.tsx', {
            '@theia/core/shared/react': react,
            'akari-project/lib/common/asset-catalog-view': catalog,
            'akari-project/lib/common/store-connection-flow': { StoreConnectionFlowController: class {} },
            '../common/store-entitlements-visibility': { storeReconnectRequired: () => false }
        });
        AkariStoreSettings({ service: {}, windows, refreshKey: 0 });
        buttons.find(button => button.children.includes('ストアを開く')).props.onClick();
        assert.deepEqual(opened, [
            { url: `${lab}/`, options: { external: true } },
            { url: `${lab}/`, options: { external: true } }
        ]);
    });
}
