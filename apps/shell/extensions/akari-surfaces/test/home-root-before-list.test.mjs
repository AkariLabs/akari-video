import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
import { channelFromProjectPath } from '../lib/browser/channel/channel-context-model.js';

const URI = uriModule.default ?? uriModule;
const source = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariHomeWidget');
const body = ['syncCreatorRootContext', 'resolveStandaloneProjects', 'refreshCurrentLocation']
    .map(name => declaration.members.find(node => node.name?.getText(ast) === name)?.getText(ast)).join('\n');
const code = ts.transpileModule(`class Home { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('一覧を読んでいなくても作業場内のプロジェクトを単体へ混ぜない', async () => {
    const Home = new Function('URI', 'channelFromProjectPath', 'CREATOR_ROOT_CHANNELS_DIRNAME', 'CREATOR_ROOT_VIDEOS_DIRNAME',
        `${code}\nreturn Home;`)(URI, channelFromProjectPath, 'channels', 'videos');
    const home = new Home();
    const root = new URI('file:///creator');
    const inside = root.resolve('channels/main/videos/current');
    const outside = new URI('file:///other/video');
    home.channelContext = { rootUri: root, channels: ['main'], currentProjectUri: inside };
    home.creatorRootProjects = [];
    home.projectRowVersions = new Map();
    home.syncCreatorRootContext();
    assert.equal(home.creatorRootUri.toString(), root.toString());
    assert.equal(home.creatorRootAvailable, true);
    assert.deepEqual(home.channels, ['main']);
    home.workspaceService = { recentWorkspaces: async () => [inside.toString(), outside.toString()] };
    let checked = 0;
    home.isScaffoldedProject = async () => { checked++; return true; };
    home.readProjectTitle = async () => '単体';
    home.readProjectDetails = async () => ({ updatedAt: 1 });
    const standalone = await home.resolveStandaloneProjects();
    assert.deepEqual(standalone.map(project => project.uri.toString()), [outside.toString()]);
    assert.equal(checked, 1);
    home.workspaceService.roots = Promise.resolve([{ resource: inside }]);
    home.formatDisplayPath = async () => '作業場';
    home.update = () => {};
    await home.refreshCurrentLocation();
    assert.equal(home.currentLocation.kind, 'inside');
    assert.equal(home.currentLocation.channel, 'main');
});

test('起動時に軽い作業場情報を一覧より先に確定する', () => {
    assert.match(source, /await this\.channelContext\.ensureLocation\(\);\s*this\.syncCreatorRootContext\(\);[\s\S]*?measureStep\('loadCreatorRootProjects'/);
    assert.match(source, /this\.channelContext\.onDidChange\(/);
});
