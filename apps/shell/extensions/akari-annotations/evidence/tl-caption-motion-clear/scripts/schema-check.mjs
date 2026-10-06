// captions.json を packages/schemas/captions.schema.json（JSON Schema 2020-12）で Ajv 検証する（ラッパー作成の検証スクリプト）。
// validate-captions CLI は textAnimation の minProperties を見ないため、空の animation {} の検出はこちらで行う。
// 単体: node schema-check.mjs <captions.json>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default ?? require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(path.join(REPO, 'packages/schemas/captions.schema.json'), 'utf8')));

export function schemaCheck(file) {
    const ok = validate(JSON.parse(readFileSync(file, 'utf8')));
    return { ok, errors: ok ? [] : validate.errors.slice(0, 5).map(e => `${e.instancePath} ${e.keyword} ${e.message}`) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const r = schemaCheck(process.argv[2]);
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
}
