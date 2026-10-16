import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const text = readFileSync(new URL('../src/browser/akari-outputs-pane.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('akari-outputs-pane.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const style = readFileSync(new URL('../src/browser/style/project-panel-bands.css', import.meta.url), 'utf8');
const pane = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariOutputsPane');

function method(name) {
    const member = pane?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name);
    assert.ok(member?.body, `${name} exists`);
    return member;
}

function elements(node, tagName) {
    const found = [];
    function visit(child) {
        if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child))
            && child.tagName.getText(source) === tagName) found.push(child);
        ts.forEachChild(child, visit);
    }
    visit(node);
    return found;
}

function attribute(element, name) {
    return element.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);
}

function classElement(node, tagName, className) {
    const element = elements(node, tagName).find(item => attribute(item, 'className')?.initializer?.text === className);
    assert.ok(element, `${className} exists`);
    return element;
}

test('export row has icon, filename, and date without action buttons; click and context menu remain', () => {
    const row = method('renderExportRow');
    const rowElement = classElement(row, 'div', 'akari-export-row');
    assert.equal(elements(row, 'button').length, 0);
    assert.match(attribute(rowElement, 'onClick')?.getText(source) ?? '', /this\.host\.openFile\(entry\.uri\)/u);
    assert.match(attribute(rowElement, 'onContextMenu')?.getText(source) ?? '', /this\.openOutputContextMenu\(event, entry\)/u);
    assert.match(row.getText(source), /entry\.thumbnailUri/u);
    assert.match(row.getText(source), /this\.outputIcon\(entry\)/u);
    assert.match(row.getText(source), /className='akari-export-name'>\{entry\.name\}/u);
    assert.match(row.getText(source), /formatExportTimestamp\(entry\.mtime\)/u);
    assert.match(style, /\.akari-export-row\s*\{[^}]*height:\s*22px;/u);
});

test('export band height depends only on saved height and panel height, with all rows inside its scroll area', () => {
    const render = method('renderOutputsPane');
    const band = classElement(render, 'div', 'akari-export-band');
    const heightStyle = attribute(band, 'style');
    assert.ok(heightStyle?.initializer && ts.isJsxExpression(heightStyle.initializer));
    const values = heightStyle.initializer.expression;
    assert.ok(values && ts.isObjectLiteralExpression(values));
    const height = values.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === 'height');
    assert.ok(height && ts.isTemplateExpression(height.initializer));
    assert.equal(height.initializer.templateSpans.length, 1);
    assert.equal(height.initializer.templateSpans[0].expression.getText(source),
        'clampExportBandHeight(this.exportBandHeight, this.exportBandPanelHeight)');
    assert.match(render.getText(source), /bands\.exportAll\.map\(entry => this\.renderExportRow\(entry\)\)/u);
    assert.match(style, /\.akari-export-list\s*\{[^}]*overflow-y:\s*auto;/u);
    assert.doesNotMatch(text, /allExportsOpen|data-akari-all-exports|showAllExports|exportPreview/u);
});

test('resize handle is wired to dragging, persistence, reset, and the panel limit', () => {
    const handle = classElement(method('renderOutputsPane'), 'div', 'akari-export-band-handle');
    for (const [event, handler] of [
        ['onPointerDown', 'onExportBandPointerDown'],
        ['onPointerMove', 'onExportBandPointerMove'],
        ['onPointerUp', 'onExportBandPointerEnd'],
        ['onPointerCancel', 'onExportBandPointerEnd'],
        ['onDoubleClick', 'resetExportBandHeight']
    ]) assert.match(attribute(handle, event)?.getText(source) ?? '', new RegExp(`this\\.${handler}\\(`));
    assert.match(method('onExportBandPointerDown').getText(source), /setPointerCapture\(event\.pointerId\)/u);
    assert.match(method('onExportBandPointerMove').getText(source), /dragExportBandHeight\(/u);
    assert.match(method('onExportBandPointerEnd').getText(source), /localStorage\.setItem\(EXPORT_BAND_HEIGHT_KEY/u);
    assert.match(method('resetExportBandHeight').getText(source), /localStorage\.removeItem\(EXPORT_BAND_HEIGHT_KEY\)/u);
    assert.match(style, /\.akari-export-band-handle\s*\{[^}]*height:\s*6px;[^}]*cursor:\s*row-resize;/u);
    assert.match(style, /\.akari-export-band\s*\{[^}]*max-height:\s*70%;/u);
});
