import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const previewText = require('../../lib/common/preview-text.js');

// Extracted webview and compiled host snippets run without their module imports.
// Supply the same translation function that those snippets receive in the app.
export function installPreviewTestI18n() {
    const previousT = globalThis.t;
    const previousModule = globalThis.preview_text_1;
    const createContext = vm.createContext;
    const runInNewContext = vm.runInNewContext;
    globalThis.t = previewText.t;
    globalThis.preview_text_1 = previewText;
    const withText = context => Object.assign(context ?? {}, { t: previewText.t, preview_text_1: previewText });
    vm.createContext = (context, ...options) => createContext(withText(context), ...options);
    vm.runInNewContext = (code, context, ...options) => runInNewContext(code, withText(context), ...options);
    return () => {
        vm.createContext = createContext;
        vm.runInNewContext = runInNewContext;
        if (previousT === undefined) delete globalThis.t;
        else globalThis.t = previousT;
        if (previousModule === undefined) delete globalThis.preview_text_1;
        else globalThis.preview_text_1 = previousModule;
    };
}
