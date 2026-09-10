import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

// Read the template's cooked text without emitting lib/ or mounting the webview.
function extractTemplate(methodName) {
    const ast = ts.createSourceFile('handler.ts', source, ts.ScriptTarget.Latest, true);
    let template;
    function visit(node) {
        if (ts.isMethodDeclaration(node) && node.name.getText(ast) === methodName) {
            template = node.body.statements.find(ts.isReturnStatement)?.expression;
        } else {
            ts.forEachChild(node, visit);
        }
    }
    visit(ast);
    assert.ok(template, `${methodName} template must exist`);
    if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
    assert.ok(ts.isTemplateExpression(template));
    return template.head.text + template.templateSpans.map(span => `0${span.literal.text}`).join('');
}

const bootstrap = extractTemplate('frameEngineBootstrapScript');
const start = bootstrap.indexOf('const renderFrame = async');
const end = bootstrap.indexOf('scrub = new engine.ScrubController', start);
assert.ok(start >= 0 && end > start);
const renderSource = bootstrap.slice(start, end);

function harness() {
    const measurements = {
        lateFrames: 0, presentedAt: [], seekBeforeMs: [], seekAfterMs: [],
        boundaryBefore: { total: 0, late: 0 }, boundaryAfter: { total: 0, late: 0 }
    };
    const pending = [];
    const closed = [];
    let api;
    api = vm.runInNewContext(`
        let currentAccesses = null, lastCutIndex = null, lastPresentedSec = 0;
        ${renderSource}
        ({ renderFrame, getAccesses: () => currentAccesses })
    `, {
        disposed: false, totalDuration: 10, fps: 30,
        timeline: {}, sources: new Map(), renderOutput: {}, compositor: {}, frameMetrics: {},
        noteRenderScaleActivity() {}, applyRenderScale() { return false; },
        appliedRenderScale: 1, autoRenderScale: 1, scaleEvaluationPlanFn: plan => plan,
        measurements, performance: { now: () => 100 },
        engine: {
            evaluationPlanFromResolvedTimeline: (_timeline, timeUs) => ({
                base: [{ id: `cut-${timeUs / 1e6}` }], layers: []
            }),
            evaluateFrame: plan => new Promise(resolve => {
                const id = plan.base[0].id;
                api.getAccesses().push({ hit: id === 'cut-1' });
                pending.push(() => resolve({ close: () => closed.push(id) }));
            })
        },
        scheduler: { isWarmed: () => false, notePresented() {} },
        audioSupply: { noteRendered() {} }, updateMetrics() {},
        error: { hidden: false, textContent: 'previous failure' }
    });
    return { ...api, measurements, pending, closed };
}

test('overlapping seeks finish safely and keep each call’s hit measurements', async () => {
    const h = harness();
    const a = h.renderFrame(1, 'seek', 10);
    const accessesA = h.getAccesses();
    const b = h.renderFrame(2, 'seek', 20);
    const accessesB = h.getAccesses();
    assert.notEqual(accessesA, accessesB);
    h.pending[0]();
    await assert.doesNotReject(a);
    assert.equal(h.getAccesses(), accessesB, 'A must not clear B’s recording destination');
    assert.deepEqual(h.measurements.seekAfterMs, [90], 'A uses its own cache hit');
    assert.deepEqual(h.measurements.seekBeforeMs, []);
    h.pending[1]();
    await assert.doesNotReject(b);
    assert.deepEqual(h.measurements.seekBeforeMs, [80], 'B uses its own cache miss');
    assert.deepEqual(h.measurements.seekAfterMs, [90]);
    assert.equal(h.getAccesses(), null);
    assert.deepEqual(h.closed, ['cut-1', 'cut-2']);
});

test('render reads local records and clears only its own shared destination', () => {
    assert.doesNotMatch(renderSource, /currentAccesses\s*(?:\?\.)?\s*\.?(?:length|every|filter|find)\b/u);
    assert.match(renderSource, /if \(currentAccesses === accesses\) currentAccesses = null/u);
});

test('initial restored frame joins rendering until its own operation settles', () => {
    const startup = bootstrap.slice(bootstrap.indexOf('// 非同期 mount 中'));
    assert.match(startup, /await waitForRender\(\);\s*const operation = renderFrame\(restoredPosition, 'seek', performance\.now\(\)\);\s*rendering = operation;\s*try \{\s*await operation;\s*\} finally \{\s*if \(rendering === operation\) rendering = null;\s*\}/u);
});
