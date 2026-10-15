import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/preview-chat-review.ts', import.meta.url), 'utf8');
const declaration = source.match(/export function reviewNotePosition\([\s\S]*?\n\}/)?.[0];
assert.ok(declaration);
const javascript = ts.transpileModule(`${declaration.replace('export function', 'function')}\nglobalThis.position = reviewNotePosition;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const context = vm.createContext({});
vm.runInContext(javascript, context);
const position = context.position;
const viewport = { width: 400, height: 300 };
const popup = { width: 180, height: 70 };

function box(x, y) { return { left: x, right: x + 20, top: y, bottom: y + 20 }; }

test('note appears beneath the mark when there is room', () => {
    const result = position(box(180, 50), popup, viewport);
    assert.equal(result.top, 78);
    assert.equal(result.left, 100);
});

test('note flips above a mark near the bottom', () => {
    const result = position(box(180, 260), popup, viewport);
    assert.equal(result.top, 182);
});

test('note stays inside horizontal viewport edges', () => {
    assert.equal(position(box(0, 60), popup, viewport).left, 8);
    assert.equal(position(box(390, 60), popup, viewport).left, 212);
});

test('note stays visible when neither side has enough room', () => {
    const result = position(box(180, 125), { width: 180, height: 180 }, viewport);
    assert.ok(result.top >= 8);
    assert.ok(result.top + 180 <= 292);
    const oversized = position(box(180, 125), { width: 180, height: 500 }, viewport);
    assert.equal(oversized.maxHeight, 284);
    assert.equal(oversized.top, 8);
});

const positionStart = source.indexOf('        const positionNote = () => {');
const positionEnd = source.indexOf('        window.addEventListener(\'resize\', positionNote);', positionStart);
assert.ok(positionStart >= 0 && positionEnd > positionStart);
const positionScript = source.slice(positionStart, positionEnd) + '\npositionNote();';

function placedNote(review, strokeRect) {
    const badgeRect = { left: 515, right: 535, top: 100, bottom: 120 };
    const badge = { getBoundingClientRect: () => badgeRect };
    const stroke = strokeRect && { getBoundingClientRect: () => strokeRect };
    const note = { style: {}, getBoundingClientRect: () => ({ width: 180, height: 70 }) };
    const marksNode = { querySelector: selector => selector.startsWith('.review-mark-stroke') ? stroke : badge };
    vm.runInNewContext(positionScript, { activeNote: { id: 'mark' }, markIndex: () => 0,
        marks: [{ review }], marksNode, seekMarks: { querySelector: () => null }, seek: badge,
        note, notePosition: position, window: { innerWidth: 1100, innerHeight: 500 } });
    return note.style;
}

test('pen note uses the entire stroke for horizontal placement and vertical flipping', () => {
    const review = { tool: 'pen', points: [[.1, .1], [.8, .7]] };
    assert.deepEqual(placedNote(review, { left: 525, right: 575, top: 100, bottom: 200 }),
        { left: '460px', top: '208px', maxHeight: '484px' });
    assert.deepEqual(placedNote(review, { left: 525, right: 575, top: 100, bottom: 470 }),
        { left: '460px', top: '22px', maxHeight: '484px' });
});

test('legacy pen note uses its shape badge', () => {
    assert.deepEqual(placedNote({ tool: 'pen', shape: { x: .5, y: .5 } }, null),
        { left: '435px', top: '128px', maxHeight: '484px' });
});
