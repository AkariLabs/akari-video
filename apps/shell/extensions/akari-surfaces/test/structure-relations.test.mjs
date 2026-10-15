import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildStructureTree, layoutRelations, relationEndpoints, relationPath, inspectionCounts, inspectionLabel,
    showsInspectionBand, showsSceneTabs } from '../lib/common/project-structure-model.js';
import { AkariProjectStructureServiceImpl, hasCaptions } from '../lib/node/project-structure-service.js';
import { requestStructureTab, consumeStructureTab, clearStructureTab } from '../lib/browser/home/structure-navigation.js';
import { setLanguage, t } from '@akari-video/i18n';
import uriModule from '@theia/core/lib/common/uri.js';
const URI = uriModule.default ?? uriModule;

test('structure retains an unreadable scene and derives cut status from visual items', () => {
    const edit = { output: { fps: 30 }, sources: [{ id: 'rose', path: 'assets/rose.mp4' }], tracks: [
        { lane: 'audio', items: [{ id: 'music', duration: 300 }] },
        { lane: 'visual', items: [
            { id: 'a', at: 0, duration: 90, source: { kind: 'media', src: 'rose' } },
            { id: 'b', at: 90, duration: 60, source: { canvas: { origin: 'plan' } } }
        ] }
    ] };
    const tree = buildStructureTree('Project', [
        { id: 's01', title: 'Opening', edit, editMtime: 100, exportMtimes: [90, 110], captions: true },
        { id: 's02', title: 'Broken' }
    ]);
    assert.equal(tree.scenes.length, 2);
    assert.deepEqual(tree.scenes[0].cuts.map(cut => [cut.order, cut.duration, cut.asset]), [[1, 3, 'assets/rose.mp4'], [2, 2, '—']]);
    assert.equal(tree.scenes[0].placeholders, 1);
    assert.equal(tree.scenes[0].exported, true);
    assert.equal(tree.scenes[0].captions, true);
    assert.equal(tree.scenes[1].unreadable, true);
    assert.equal(buildStructureTree('P', [{ id: 's', title: 'S', edit, editMtime: 100, exportMtimes: [99] }]).scenes[0].exported, false);
});

test('relations put unknown kinds in Other and retain missing endpoints as ghost nodes', () => {
    const graph = layoutRelations([{ id: 's', kind: 'scene' }, { id: 'x', kind: 'future' }, { id: 'p', kind: 'person' }],
        [{ from: 's', uses: 'p' }, { from: 's', uses: 'x' }, { from: 's', uses: 'person:gone' }, { from: 's', uses: 'mystery:lost' }]);
    assert.deepEqual(graph.nodes.map(node => [node.id, node.column, node.x, node.y]),
        [['s', 0, 90, 48], ['p', 1, 280, 48], ['person:gone', 1, 280, 112],
            ['mystery:lost', 7, 1420, 48], ['x', 7, 1420, 112]]);
    assert.equal(graph.nodes.find(node => node.id === 'person:gone').missing, true);
    assert.equal(graph.nodes.find(node => node.id === 'mystery:lost').column, 7);
    assert.equal(graph.edges.length, 4);
    const reverse = layoutRelations([{ id: 'tool:a', kind: 'tool-output' }, { id: 'person:b', kind: 'person' }], []).nodes;
    const points = relationEndpoints(reverse.find(node => node.id === 'tool:a'), reverse.find(node => node.id === 'person:b'));
    assert.ok(points.x1 < reverse.find(node => node.id === 'tool:a').x);
    assert.ok(points.x2 > reverse.find(node => node.id === 'person:b').x);
    const wide = relationPath(graph.nodes.find(node => node.id === 'mystery:lost'), graph.nodes.find(node => node.id === 's'));
    const [, startY, controlY] = wide.match(/^M-?\d+ (\d+) C-?\d+ (\d+),/).map(Number);
    assert.ok(controlY > startY + 100, 'wide relation bends around intervening nodes');
    assert.match(wide, /,.*,/);
});

test('inspection label uses the real Japanese and English catalog', () => {
    const counts = inspectionCounts({ findings: [
        { code: 'MISSING_NODE', severity: 'error', edge: { from: 's', uses: 'gone' } },
        { code: 'UNACQUIRED', severity: 'warning', node: 'asset:a' },
        { code: 'STALE', severity: 'info', node: 'p' }
    ] });
    setLanguage('ja');
    assert.equal(inspectionLabel(counts, t), '欠落 1・未取得 1');
    setLanguage('en');
    assert.equal(inspectionLabel(counts, t), '1 missing, 1 not downloaded');
    setLanguage('ja');
    assert.deepEqual([...counts.affected].sort(), ['asset:a', 'gone', 'p', 's']);
    assert.equal(inspectionLabel(inspectionCounts(undefined), t), '');
});

test('single project hides both surfaces; a scene or scene root shows inspection', () => {
    const single = { sceneFolder: false, hasScenes: false, hasRootEdit: true };
    const root = { sceneFolder: false, hasScenes: true, hasRootEdit: false };
    const scene = { sceneFolder: true, hasScenes: false, hasRootEdit: true };
    assert.equal(showsSceneTabs(single), false);
    assert.equal(showsInspectionBand(single), false);
    assert.equal(showsSceneTabs(root), true);
    assert.equal(showsInspectionBand(root), true);
    assert.equal(showsSceneTabs(scene), false);
    assert.equal(showsInspectionBand(scene), true);
});

test('navigation request survives a new window, expires and can be cleared on cancel', () => {
    const savedWindow = globalThis.window;
    const data = new Map();
    globalThis.window = { localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key) } };
    try {
        const root = new URI('file:///tmp/project');
        requestStructureTab(root, 'structure');
        assert.equal(consumeStructureTab(root), 'structure');
        requestStructureTab(root, 'relations');
        clearStructureTab(root);
        assert.equal(consumeStructureTab(root), undefined);
        requestStructureTab(root, 'structure');
        const [key, value] = [...data.entries()][0];
        data.set(key, JSON.stringify({ ...JSON.parse(value), requestedAt: Date.now() - 61_000 }));
        assert.equal(consumeStructureTab(root), undefined);
    } finally { globalThis.window = savedWindow; }
});

test('caption content requires at least one cue', () => {
    for (const value of [[], { captions: [] }, { cues: [] }, { items: [] }, {}]) assert.equal(hasCaptions(value), false);
    for (const value of [[{}], { captions: [{}] }, { cues: [{}] }, { items: [{}] }]) assert.equal(hasCaptions(value), true);
});

test('node reader keeps broken edits and creates a missing check report once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-structure-'));
    try {
        await mkdir(join(root, '.akari'));
        await mkdir(join(root, 'scenes', 's01'), { recursive: true });
        await mkdir(join(root, 'scenes', 's02'));
        await writeFile(join(root, 'scenes', 's01', 'edit.json'), '{broken');
        await writeFile(join(root, 'scenes', 's02', 'edit.json'), JSON.stringify({ version: 2, tracks: [] }));
        await writeFile(join(root, 'scenes', 's01', 'captions.json'), '[]');
        await writeFile(join(root, 'scenes', 's02', 'captions.json'), '{"cues":[{}]}');
        await writeFile(join(root, '.akari', 'manifest.json'), JSON.stringify({ version: 0, kind: 'akari-project-manifest',
            nodes: [{ id: 'scene:s01', kind: 'scene', rev: 1, where: 'scenes/s01' }],
            edges: [{ from: 'scene:s01', uses: 'person:missing' }] }));
        const service = new AkariProjectStructureServiceImpl();
        const uri = pathToFileURL(root).href;
        const scenes = await service.readScenes(uri);
        assert.deepEqual(scenes.map(scene => [scene.id, scene.edit === undefined]), [['s01', true], ['s02', false]]);
        assert.deepEqual(scenes.map(scene => scene.captions), [false, true]);
        const check = await service.readCheck(uri);
        assert.equal(check.summary.error, 1);
        assert.equal((await service.readCheck(uri)).checkedAt, check.checkedAt);
    } finally { await rm(root, { recursive: true, force: true }); }
});
