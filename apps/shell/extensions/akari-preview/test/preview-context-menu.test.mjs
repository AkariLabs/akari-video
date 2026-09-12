import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { buildPreviewContextMenuMessage } from '../lib/common/preview-context-menu.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('akari-preview-open-handler.js', compiled,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

const methods = new Map();
function visit(node) {
    if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.getText(ast));
    ts.forEachChild(node, visit);
}
visit(ast);

const hostAdapterMethod = methods.get('hostAdapterScript');
const prepareHtmlMethod = methods.get('prepareHtml');
assert.ok(hostAdapterMethod);
assert.ok(prepareHtmlMethod);

const hostAdapterScript = vm.runInNewContext(`({ ${hostAdapterMethod} }).hostAdapterScript`, {
    preview_playback_rate_1: require('../lib/common/preview-playback-rate.js'),
    preview_context_menu_1: require('../lib/common/preview-context-menu.js'),
    layer_perspective_visual_1: require('../lib/common/layer-perspective-visual.js'),
    layer_hit_region_1: require('../lib/common/layer-hit-region.js'),
    audio_schedule_1: require('../lib/common/audio-schedule.js'),
    edit_store_1: require('@akari-video/edit-store'),
    audio_meter_model_1: require('../lib/common/audio-meter-model.js'),
    preview_content_end_1: require('../lib/common/preview-content-end.js'),
    preview_composite_layout_1: require('../lib/common/preview-composite-layout.js')
});
const generatedScript = hostAdapterScript.call({});

test('generated host adapter owns one capture-phase contextmenu handler', () => {
    const marker = "addEventListener('contextmenu'";
    assert.equal(generatedScript.split(marker).length - 1, 1);
    const handlerStart = generatedScript.indexOf("document.addEventListener('contextmenu'");
    const handlerEnd = generatedScript.indexOf('}, true);', handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
    const handler = generatedScript.slice(handlerStart, handlerEnd + '}, true);'.length);
    assert.ok(handler.includes('event.preventDefault()'));
    assert.ok(handler.endsWith('}, true);'));
    assert.ok(handler.includes('buildPreviewContextMenuMessageFn('));
    assert.ok(handler.includes('vscode.postMessage(message)'));
    assert.ok(generatedScript.includes("type: 'akari-preview-context-menu'"));
});

test('generated host adapter embeds the context menu payload builder function body', () => {
    assert.ok(generatedScript.includes(buildPreviewContextMenuMessage.toString()));
});

test('compiled prepareHtml embeds the shared host adapter independently of frame-engine scripts', () => {
    assert.equal(prepareHtmlMethod.split('this.hostAdapterScript()').length - 1, 1);
    const conditionalStart = prepareHtmlMethod.indexOf('const frameEngineScripts =');
    const conditionalEnd = prepareHtmlMethod.indexOf('const frameEngineCsp =', conditionalStart);
    const hostAdapterPosition = prepareHtmlMethod.indexOf('${this.hostAdapterScript()}');
    assert.ok(conditionalStart >= 0 && conditionalEnd > conditionalStart);
    assert.ok(hostAdapterPosition > conditionalEnd);
    assert.ok(!prepareHtmlMethod.slice(conditionalStart, conditionalEnd).includes('hostAdapterScript'));
});

test('context menu payload normalizes and clamps preview-stage coordinates', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    assert.deepEqual(buildPreviewContextMenuMessage(300, 100, rect, 12.5, 'cut-1'), {
        type: 'akari-preview-context-menu', x: 0.5, y: 0.25, timelineT: 12.5, selectedPrimary: 'cut-1'
    });
    assert.deepEqual(buildPreviewContextMenuMessage(0, 999, rect, -4), {
        type: 'akari-preview-context-menu', x: 0, y: 1, timelineT: 0
    });
});

test('compiled host turns the context menu hook into the registered annotation menu', () => {
    const branchStart = compiled.indexOf("if (message?.type === 'akari-preview-context-menu')");
    const branchEnd = compiled.indexOf("if (message?.type === 'akari-preview-gesture'", branchStart);
    assert.ok(branchStart >= 0 && branchEnd > branchStart);
    const branch = compiled.slice(branchStart, branchEnd);
    assert.ok(branch.includes("console.debug('[akari-preview] context menu', message);"));
    assert.ok(branch.includes("kind === 'output'"));
    assert.ok(branch.includes('this.primaryTimelineSelections.get(editUri)'));
    assert.ok(branch.includes('this.contextMenuRenderer.render({'));
    assert.ok(branch.includes('menuPath: webview_1.WEBVIEW_CONTEXT_MENU'));
    assert.ok(branch.includes('x: rect.x + rect.width * message.x'));
    assert.ok(branch.includes('y: rect.y + rect.height * message.y'));
    assert.ok(compiled.includes("id: 'akari.preview.annotateAtPoint'"));
    assert.ok(compiled.includes("label: 'この位置に注釈'"));
    assert.ok(compiled.includes("'akari.review.clipAnnotation.request'"));
});
