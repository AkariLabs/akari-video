import { setLanguage } from '@akari-video/i18n';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { t } = require('../../lib/common/project-text.js');

setLanguage('ja');
// Extracted widget methods in older tests run through new Function().
globalThis.t = t;
globalThis.project_text_1 = { t };
process.once('exit', () => {
    delete globalThis.t;
    delete globalThis.project_text_1;
    setLanguage(undefined);
});
