import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const listSource = readFileSync(new URL('../src/browser/home/project-list-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('list.tsx', listSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const card = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProjectCard');
const code = ts.transpileModule(card.getText(ast).replace(/^export /u, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

test('隠れたカードは版が変わっても読まず、表示時に一度だけ読む', async () => {
    const states = [];
    const refs = [];
    const effects = [];
    let cursor = 0;
    const React = {
        createElement: () => ({}),
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = initial;
            return [states[index], value => { states[index] = value; }];
        },
        useRef(initial) {
            const index = cursor++;
            if (!(index in refs)) refs[index] = { current: initial };
            return refs[index];
        },
        useEffect(callback, dependencies) {
            const index = cursor++;
            const previous = effects[index];
            if (previous && dependencies.every((value, offset) => Object.is(value, previous.dependencies[offset]))) return;
            previous?.cleanup?.();
            effects[index] = { dependencies, cleanup: callback() };
        }
    };
    const ProjectCard = new Function('React', 'stageSummary', 'projectCardCache', `${code}\nreturn ProjectCard;`)(React, () => '札', new Map());
    let presenceReads = 0;
    let thumbnailReads = 0;
    const base = {
        row: { key: 'one', uri: { toString: () => 'one' }, name: 'one' },
        onOpen: () => {},
        readPresence: async () => { presenceReads++; return {}; },
        loadThumbnails: async () => { thumbnailReads++; return ['image']; }
    };
    const render = (active, rowVersion) => { cursor = 0; ProjectCard({ ...base, active, rowVersion }); };
    render(true, 1);
    await new Promise(resolve => setImmediate(resolve));
    render(false, 1);
    render(false, 2);
    assert.deepEqual([presenceReads, thumbnailReads], [1, 1]);
    render(true, 2);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([presenceReads, thumbnailReads], [2, 2]);
    render(false, 2);
    render(true, 2);
    assert.deepEqual([presenceReads, thumbnailReads], [2, 2]);
});

test('枠から外れて戻ったカードは結果を保ち、再読込しない', async () => {
    const cache = new Map();
    let reads = 0;
    let thumbnails = 0;
    const row = { key: 'cached', uri: { toString: () => 'cached' }, name: 'cached' };
    const props = { row, active: true, rowVersion: 1, onOpen: () => {},
        readPresence: async () => { reads++; return {}; },
        loadThumbnails: async () => { thumbnails++; return ['image']; } };
    const mount = () => {
        const states = [];
        const React = {
            createElement: () => ({}),
            useState(initial) {
                const index = states.length;
                states.push(initial);
                return [initial, value => { states[index] = value; }];
            },
            useEffect(callback) { callback(); }
        };
        const ProjectCard = new Function('React', 'stageSummary', 'projectCardCache', `${code}\nreturn ProjectCard;`)(React, () => '札', cache);
        ProjectCard(props);
        return states;
    };
    mount();
    await new Promise(resolve => setImmediate(resolve));
    const restored = mount();
    assert.deepEqual([reads, thumbnails], [1, 1]);
    assert.deepEqual(restored, ['札', 'image', true]);
});

test('ホームと別タブは各自の表示状態をカードへ渡す', () => {
    const home = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    const list = readFileSync(new URL('../src/browser/akari-project-list-widget.tsx', import.meta.url), 'utf8');
    assert.match(home, /<ProjectCard[^>]*active=\{this\.isVisible\}/u);
    assert.match(home, /<ProjectListView[^>]*active=\{active\}/u);
    assert.match(list, /home\?\.renderProjectListForTab\(this\.isVisible\)/u);
    assert.match(listSource, /if \(!props\.active\) return;/u);
    assert.equal((listSource.match(/active=\{props\.active\}/gu) ?? []).length, 2);
});
