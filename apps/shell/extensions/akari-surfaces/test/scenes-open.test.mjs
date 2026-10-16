import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
const URI = uriModule.default ?? uriModule;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
const { projectLocation } = await import('../lib/common/project-location.js');
const { titleBarCenter } = await import('../lib/browser/title-bar/title-bar-model.js');
const { sceneBadge } = await import('../lib/browser/home/project-progress-model.js');
const { readSceneList } = await import('../lib/browser/home/scene-list.js');
const { classifyChannelProjectChange } = await import('../lib/browser/channel/channel-project-change-model.js');

test('location accepts only a project or one scene level', () => {
    assert.deepEqual(projectLocation('channels/test/videos/p1'), { channel: 'test', project: 'p1' });
    assert.deepEqual(projectLocation('channels/test/videos/p1/scenes/s01'), { channel: 'test', project: 'p1', scene: 's01' });
    for (const path of ['channels/test/videos/p1/scenes', 'channels/test/videos/p1/scenes/s01/edit.json',
        'channels/test/videos/p1/foo/s01', 'channels/test/videos/p1/scenes/s01/shots/x']) assert.equal(projectLocation(path), undefined);
});

test('breadcrumb model preserves single projects and adds the scene', () => {
    assert.deepEqual(titleBarCenter({ scope: 'project', channel: 'test', project: 'p1' }), ['test', 'p1']);
    assert.deepEqual(titleBarCenter({ scope: 'project', channel: 'test', project: 'p1', scene: 's01' }), ['test', 'p1', 's01']);
});

test('scene list reads valid edits and falls back for broken intake', async () => {
    const root = new URI('file:///tmp/project');
    const scenes = root.resolve('scenes');
    const child = id => ({ name: id, isDirectory: true, resource: scenes.resolve(id) });
    const files = {
        async resolve(uri) {
            const path = uri.path.toString();
            if (path.endsWith('/scenes')) return { children: [child('s02'), child('s01'), child('empty')] };
            if (path.endsWith('/empty/edit.json')) throw new Error('missing');
            if (path.endsWith('/edit.json')) return { isFile: true, mtime: 123 };
            if (path.endsWith('/assets')) return { children: [{ isFile: true, name: 'a.mp4' }] };
            throw new Error(path);
        },
        async readFile(uri) {
            const path = uri.path.toString();
            if (path.endsWith('/s01/.akari/intake.json')) return { value: Buffer.from('{broken') };
            if (path.endsWith('/s02/.akari/intake.json')) return { value: Buffer.from('{"title":"Rose"}') };
            if (path.endsWith('/edit.json')) return { value: Buffer.from('{"duration_s":62}') };
            throw new Error(path);
        }
    };
    const rows = await readSceneList(files, root);
    assert.deepEqual(rows.map(row => [row.id, row.title, row.duration, row.assets]),
        [['s01', 's01', '1:02', 1], ['s02', 'Rose', '1:02', 1]]);
});

test('home badge appears only for scenes', () => {
    assert.equal(sceneBadge({ sceneCount: 2 }), 'シーン 2');
    assert.equal(sceneBadge({ sceneCount: 0 }), undefined);
    assert.equal(sceneBadge({}), undefined);
});

test('a new scene edit invalidates its project card', () => {
    const change = classifyChannelProjectChange('channels/test/videos/p1/scenes/s01/edit.json', 1,
        'channels/test/videos/p1/scenes/s02');
    assert.equal(change?.card, true);
});

test('presence counts scene edits and leaves a single project without a scene count', async () => {
    const source = readFileSync(new URL('../src/browser/home/project-progress.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('progress.ts', source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ProjectProgressService');
    const body = ['readPresence', 'countScenes'].map(name => declaration.members.find(node => node.name?.getText(ast) === name).getText(ast)).join('\n');
    const code = ts.transpileModule(`class Progress { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Progress = new Function('MEDIA_EXT', 'VIDEO_EXT', `${code}\nreturn Progress;`)(/\.(mp4|png)$/i, /\.mp4$/i);
    const root = new URI('file:///tmp/project');
    const progress = new Progress();
    progress.countRecursive = async () => 0;
    progress.countTopLevel = async () => 0;
    progress.readEditHasContent = async () => false;
    let scenes = [];
    progress.files = {
        exists: async uri => uri.path.toString().endsWith('/s01/edit.json') || uri.path.toString().endsWith('/s02/edit.json'),
        resolve: async () => ({ children: scenes.map(id => ({ name: id, isDirectory: true, resource: root.resolve(`scenes/${id}`) })) })
    };
    assert.equal((await progress.readPresence(root)).sceneCount, undefined);
    scenes = ['s01', 's02', 'empty'];
    assert.equal((await progress.readPresence(root)).sceneCount, 2);
});

test('scene page owns reading, card fields and add action outside the home widget', () => {
    const widget = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    const view = readFileSync(new URL('../src/browser/home/scene-list-view.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(widget, /protected (renderSceneList|addScene)\(/);
    assert.match(widget, /<SceneListView/);
    for (const field of ['row.title', 'row.duration', 'row.assets', 'row.updatedAt', 'data-akari-open-scene']) assert.ok(view.includes(field));
    assert.match(view, /readSceneList\(files, root\)/);
    assert.match(view, /projectService\.addScene\(root\.toString\(\), id\)/);
});

test('scene page gives cards and actions their own spacing', () => {
    const view = readFileSync(new URL('../src/browser/home/scene-list-view.tsx', import.meta.url), 'utf8');
    assert.match(view, /\.akari-os-scene-grid\{[^}]*gap:14px/u);
    assert.match(view, /\.akari-os-scene-list \.akari-os-scene-card\{[^}]*padding:16px 18px[^}]*border-radius:11px/u);
    assert.match(view, /\.akari-os-scene-card small\{[^}]*line-height:1\.55/u);
    assert.match(view, /\.akari-os-scene-card button\{[^}]*min-height:32px/u);
    assert.match(view, /\.akari-os-scene-add\{[^}]*min-height:36px/u);
    assert.match(view, /surfaces\.home\.projectLastUpdated\.label/u);
});
