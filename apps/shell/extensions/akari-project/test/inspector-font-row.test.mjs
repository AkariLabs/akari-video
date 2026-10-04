import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { readInspectorSource } from '../../akari-annotations/test/helpers/inspector-source.mjs';

const readSource = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');
const stateSource = await readSource('../../akari-annotations/src/common/caption-panel-state.ts');
assert.match(stateSource, /export \{ CAPTION_FONT_FAMILY \} from 'akari-preview\/lib\/common\/caption-visual-contract';/u);
const visualContractSource = await readSource('../../akari-preview/src/common/caption-visual-contract.ts');
assert.match(visualContractSource, /export const CAPTION_FONT_FAMILY = contract\.font_family;/u);
const CAPTION_FONT_FAMILY = JSON.parse(await readSource('../../../../../packages/edit-store/src/caption-visual-contract.json')).font_family;

const catalogSource = await readSource('../../akari-annotations/src/common/caption-panel-catalog.ts');
const catalogExports = {};
new Function('exports', ts.transpileModule(catalogSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
}).outputText)(catalogExports);
const { CAPTION_PANEL_FONTS } = catalogExports;

const source = readInspectorSource();
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement)
    && statement.name.text === 'captionFontFamilyField');
assert.ok(declaration);
const code = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const captionFontFamilyField = new Function('CAPTION_FONT_FAMILY', `${code}\nreturn captionFontFamilyField;`)(CAPTION_FONT_FAMILY);
const faceDeclaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement)
    && statement.name.text === 'captionRowFontFace');
assert.ok(faceDeclaration);
const faceCode = ts.transpileModule(faceDeclaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const captionRowFontFace = new Function('CAPTION_FONT_FAMILY', 'CAPTION_PANEL_FONTS',
    `${faceCode}\nreturn captionRowFontFace;`)(CAPTION_FONT_FAMILY, CAPTION_PANEL_FONTS);

test('字幕と置いた文字のフォント行は書体名を示し、フォントパネルのコマンドへつなぐ', async () => {
    assert.match(source, /captionFontFamilyField\(rowSnapshot as TimelineCaptionSelection/u);
    assert.match(source, /executeCommand<boolean>\('akari\.captionPanel\.toggle', \{ panel: 'font' \}\)/u);
    for (const timeDomain of ['source', 'output']) {
        const calls = [];
        const snapshot = { kind: 'caption', id: 'c-1', timeDomain,
            effectiveTextStyle: { fontFamily: 'Noto Serif JP' } };
        const row = captionFontFamilyField(snapshot, async () => {
            calls.push(['akari.captionPanel.toggle', { panel: 'font' }]); return true;
        });
        assert.equal(row.label, 'フォント');
        assert.equal(row.getValue(), 'Noto Serif JP');
        assert.equal(row.actionLabel, 'Noto Serif JP  ›');
        assert.deepEqual(await row.action(snapshot), { ok: true });
        assert.deepEqual(calls, [['akari.captionPanel.toggle', { panel: 'font' }]]);
    }
    assert.equal(CAPTION_PANEL_FONTS.length, 31);
    assert.match(source, /captionRowFontFace\(field\.getValue\(snapshot\), this\.captionPanelFontFaces\)/u);
    assert.equal(captionRowFontFace('Noto Sans JP', new Map()), CAPTION_FONT_FAMILY);
    assert.equal(captionRowFontFace(CAPTION_FONT_FAMILY, new Map()), CAPTION_FONT_FAMILY);
    assert.equal(captionRowFontFace('Noto Serif JP', new Map([['noto-serif-jp', 'Noto Serif JP']])), 'Noto Serif JP');
    assert.equal(captionFontFamilyField({ effectiveTextStyle: { fontFamily: CAPTION_FONT_FAMILY } }, async () => true)
        .getValue(), 'Noto Sans JP');
});
