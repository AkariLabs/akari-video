import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const frameEngine = readFileSync(new URL('../src/browser/preview-script-frame-engine-bootstrap.ts', import.meta.url), 'utf8');
const prepareStart = handler.indexOf('    protected prepareHtml(');
const prepareEnd = handler.indexOf('    protected prepareMessageHtml(', prepareStart);
assert.ok(prepareStart >= 0 && prepareEnd > prepareStart);
const preview = handler.slice(prepareStart, prepareEnd);

test('preview body defeats the injected webview padding and uses the theme pasteboard', () => {
    const bodyRule = preview.match(/^html, html body \{[^\n]+\}$/mu)?.[0];
    assert.ok(bodyRule);
    assert.match(bodyRule, /\bpadding:\s*0;/u);
    assert.match(bodyRule, /\bbackground:\s*var\(--akari-preview-pasteboard\);/u);
    assert.doesNotMatch(bodyRule, /#141414|!important/u);
    // html body has two type selectors; Theia's body:where(...) has one.
    const bodySelector = bodyRule.slice(0, bodyRule.indexOf(' {')).split(', ')[1];
    assert.deepEqual([...bodySelector.matchAll(/\b(?:html|body)\b/gu)].map(match => match[0]), ['html', 'body']);
    assert.ok(preview.indexOf(bodyRule) < preview.indexOf("${kind === 'raw'"));
});

test('output and material stages keep black letterboxing one pixel inside the edge', () => {
    assert.match(preview, /^\* \{ box-sizing: border-box; \}$/mu);
    const stageStart = preview.indexOf('#preview-stage {');
    const stageEnd = preview.indexOf('html.akari-gen-capture-fit #preview-stage', stageStart);
    assert.ok(stageStart >= 0 && stageEnd > stageStart);
    const stageTemplate = preview.slice(stageStart, stageEnd);
    for (const kind of ['output', 'raw']) {
        const css = vm.runInNewContext(`\`${stageTemplate}\``, { kind, width: 1920, height: 1080 });
        assert.match(css, /#preview-stage\s*\{[^\n]*background:\s*#000 content-box;\s*padding:\s*1px;/u);
    }
});

test('frame engine root stays transparent while filling the stage', () => {
    const rootStyle = frameEngine.match(/Object\.assign\(root\.style,\s*\{([^}]+)\}\);/u)?.[1];
    assert.ok(rootStyle);
    assert.match(rootStyle, /position:\s*'absolute',\s*inset:\s*'0'/u);
    assert.match(rootStyle, /background:\s*'transparent'/u);
    assert.doesNotMatch(rootStyle, /background:\s*'#000'/u);
});
