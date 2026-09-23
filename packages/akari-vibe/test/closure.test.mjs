import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {filesUnder,auditModules,inspectImports} from './import-audit.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
test('every shipped module obeys the public import boundary', () => {
    const files = new Map(filesUnder(root).map(name=>[name,fs.readFileSync(new URL('../'+name,import.meta.url))]));
    const {counts,errors} = auditModules(files);
    assert.deepEqual(errors,[]);
    assert.ok(counts.modules > 0);
});
test('import scanner sees multiline, commented and nested expressions', () => {
    const keyword = 'im'+'port';
    for (const expression of ['name', "'./ok.mjs' + suffix", '`./ok.mjs`', '(name)', 'new URL(name,base)']) {
        assert.equal(inspectImports(`${keyword} /* gap */ (\n${expression}\n)`).nonLiteral.length,1);
    }
    assert.equal(inspectImports('`text ${'+keyword+'(name)}`').nonLiteral.length,1);
    assert.equal(inspectImports(`// ${keyword}(name)\nconst s = "${keyword}(name)"; const r=/${keyword}\\(name\\)/;`).nonLiteral.length,0);
    const parsed = inspectImports(`${keyword} /* gap */ ('./ok.mjs'); export {x} from './other.mjs';`);
    assert.deepEqual(parsed.imports.map(i=>i.specifier),['./ok.mjs','./other.mjs']);
});
test('an unreferenced module still fails and only approved workspace libraries may escape', () => {
    const keyword = 'im'+'port';
    const files = new Map([
        ['entry.mjs',Buffer.from('export const ok = true;')],
        ['unused.mjs',Buffer.from(`${keyword}(unknown)`) ],
        ['src/sample.mjs',Buffer.from(`${keyword} '../../edit-store/lib/index.js'; ${keyword} 'dependency'; ${keyword} './missing.mjs';`) ],
        ['cases/private.txt',Buffer.from('')],
    ]);
    const {counts} = auditModules(files);
    assert.equal(counts.nonLiteral,1); assert.equal(counts.bare,1);
    assert.equal(counts.outside,1); assert.equal(counts.forbidden,1);
});
