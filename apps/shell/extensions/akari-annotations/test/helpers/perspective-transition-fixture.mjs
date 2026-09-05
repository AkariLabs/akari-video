import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import * as perspective from '../../lib/browser/inspector/perspective-fields.js';
import * as transition from '../../lib/browser/inspector/transition-fields.js';
import * as mask from '../../lib/browser/inspector/mask-fields.js';
import * as motion from '../../lib/browser/inspector/motion-fields.js';
import * as crop from '../../lib/browser/inspector/crop-fields.js';
import * as framing from '../../lib/browser/inspector/framing-fields.js';
import * as freeze from '../../lib/browser/inspector/freeze-fields.js';
import * as mappings from '../../lib/browser/inspector/field-mappings.js';
import { composeInspectorSections } from '../../lib/browser/inspector/section-model.js';

export const inspectorSource = readFileSync(new URL('../../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
export const timelineSource = readFileSync(new URL('../../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('inspector.ts', inspectorSource, ts.ScriptTarget.Latest, true);
const names = [
    'PERSPECTIVE_FIELDS', 'cutTransitionFields', 'CROP_FIELDS', 'cutFramingFields', 'cutFreezeFields',
    'LAYER_SECTIONS', 'TREE_ITEM_SECTIONS', 'CUT_SECTIONS', 'MASK_FIELDS', 'MOTION_FIELDS',
    'formatTimestamp', 'formatDurationSeconds', 'withDefaultNumber', 'formatDecimal1', 'orDash'
];
const declarations = names.map(name => {
    const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === name);
    assert.ok(node, name);
    return node.getText(ast);
});
for (const name of ['LAYER_BLEND_OPTIONS', 'CUT_FRAMING_CROP_DISABLED_TITLE']) {
    const node = ast.statements.find(statement => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name));
    assert.ok(node, name);
    declarations.push(node.getText(ast));
}
const dependencies = { ...perspective, ...transition, ...mask, ...motion, ...crop, ...framing, ...freeze, ...mappings,
    TRANSITION_VOCABULARY, composeInspectorSections };
delete dependencies.default;
delete dependencies['module.exports'];
const code = ts.transpileModule(declarations.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
export const { perspectiveFields, transitionFields, layerSections, itemSections, cutSections } = new Function(
    ...Object.keys(dependencies), `${code}\nreturn {
        perspectiveFields: PERSPECTIVE_FIELDS, transitionFields: cutTransitionFields,
        layerSections: LAYER_SECTIONS, itemSections: TREE_ITEM_SECTIONS, cutSections: CUT_SECTIONS
    };`
)(...Object.values(dependencies));

export function timelineMethod(name, dependencies = {}) {
    const ast = ts.createSourceFile('timeline.ts', timelineSource, ts.ScriptTarget.Latest, true);
    const widget = ast.statements.find(statement => ts.isClassDeclaration(statement)
        && statement.name?.text === 'AkariAnnotationsWidget');
    const method = widget.members.find(member => member.name?.getText(ast) === name);
    assert.ok(method, name);
    const code = ts.transpileModule(`class Handler { ${method.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    return new Function(...Object.keys(dependencies), `${code}\nreturn Handler.prototype.${name};`)(...Object.values(dependencies));
}

export function visualSnapshot(kind = 'layer', fields = {}) {
    return { kind, id: 'visual-1', layerKind: 'video', itemKind: 'media', sourceKind: 'media',
        outputStart: 0, duration: 5, durationFrames: 150, trackName: 'Video', clipName: 'Clip', ...fields };
}

export function cutSnapshot(fields = {}) {
    return { kind: 'cut', index: 0, itemId: 'cut-1', sourceIn: 0, sourceOut: 5,
        outputStart: 0, outputEnd: 5, trackName: 'Video', clipName: 'Clip', ...fields };
}
