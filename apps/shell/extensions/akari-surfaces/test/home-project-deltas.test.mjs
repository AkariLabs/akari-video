import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';

const URI = uriModule.default ?? uriModule;
const source = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariHomeWidget');
const body = ['syncCreatorRootProjects', 'applyCreatorRootProjects']
    .map(name => declaration.members.find(node => node.name?.getText(ast) === name)?.getText(ast)).join('\n');
const code = ts.transpileModule(`class Home { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('隠れている間の変更を表示時にその行だけ読む', async () => {
    const Home = new Function('PROJECT_LIST_WIDGET_ID', 'PROJECT_PAGE_SIZE', `${code}\nreturn Home;`)('list', 12);
    const home = new Home();
    const root = new URI('file:///creator');
    const first = root.resolve('channels/main/videos/first');
    const second = root.resolve('channels/main/videos/second');
    home.channelContext = { rootUri: root, channels: ['main'], projectsOf: () => [
        { name: 'first', uri: first, title: '最初' }, { name: 'second', uri: second, title: '新しい題' }
    ] };
    home.creatorRootUri = root;
    home.creatorRootProjects = [
        { name: 'first', channel: 'main', uri: first, title: '最初', updatedAt: 1 },
        { name: 'second', channel: 'main', uri: second, title: '古い題', updatedAt: 1 }
    ];
    home.pendingHomeProjects = new Set(['main/second']);
    home.projectRowVersions = new Map();
    home.projectCardFrames = new Map();
    home.projectCardPreviews = new Map();
    home.widgets = { tryGetWidget: () => undefined };
    home.isVisible = false;
    let reads = 0;
    home.readProjectDetails = async () => { reads++; return { updatedAt: 2, hasEditData: true }; };
    home.sortCreatorRootProjects = entries => entries;
    home.update = () => {};
    assert.equal(reads, 0);
    home.isVisible = true;
    await home.syncCreatorRootProjects();
    assert.equal(reads, 1);
    assert.equal(home.creatorRootProjects.find(entry => entry.name === 'first').updatedAt, 1);
    assert.equal(home.creatorRootProjects.find(entry => entry.name === 'second').title, '新しい題');
    assert.equal(home.projectRowVersions.has(first.toString()), false);
    assert.equal(home.projectRowVersions.get(second.toString()), 1);
    assert.equal(home.pendingHomeProjects.size, 0);
});

test('一覧が持つフォルダ日時を使い、edit と intake の日時だけ追加で読む', async () => {
    const member = declaration.members.find(node => node.name?.getText(ast) === 'readProjectDetails');
    const detailsCode = ts.transpileModule(`class Details { ${member.getText(ast)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Details = new Function('INTAKE_RELATIVE_PATH', `${detailsCode}\nreturn Details;`)('.akari/intake.json');
    const details = new Details();
    const root = new URI('file:///creator/channels/main/videos/current');
    const resolved = [];
    details.fileService = { resolve: async uri => {
        resolved.push(uri.toString());
        return { mtime: uri.path.base === 'edit.json' ? 12 : 11, isFile: true };
    } };
    const result = await details.readProjectDetails(root, 10);
    assert.equal(result.updatedAt, 12);
    assert.equal(result.hasEditData, true);
    assert.deepEqual(resolved, [root.resolve('edit.json').toString(), root.resolve('.akari/intake.json').toString()]);
});

test('読みの途中に届いた連続通知は次の一回へ畳む', async () => {
    const Home = new Function('PROJECT_LIST_WIDGET_ID', 'PROJECT_PAGE_SIZE', `${code}\nreturn Home;`)('list', 12);
    const home = new Home();
    const root = new URI('file:///creator');
    const projects = ['one', 'two', 'three'].map(name => ({
        name, channel: 'main', uri: root.resolve(`channels/main/videos/${name}`), title: name, updatedAt: 1
    }));
    home.channelContext = { rootUri: root, channels: ['main'], projectsOf: () => projects };
    home.creatorRootUri = root;
    home.creatorRootProjects = projects.map(project => ({ ...project }));
    home.pendingHomeProjects = new Set(['main/one']);
    home.projectRowVersions = new Map();
    home.projectCardFrames = new Map();
    home.projectCardPreviews = new Map();
    home.widgets = { tryGetWidget: () => undefined };
    home.isVisible = true;
    home.sortCreatorRootProjects = entries => entries;
    home.update = () => {};
    let release;
    const firstRead = new Promise(resolve => { release = resolve; });
    const reads = new Map();
    home.readProjectDetails = async uri => {
        const name = uri.path.base;
        reads.set(name, (reads.get(name) ?? 0) + 1);
        if (name === 'one' && reads.get(name) === 1) await firstRead;
        return { updatedAt: 2 };
    };
    const first = home.syncCreatorRootProjects();
    for (let index = 0; index < 20; index++) {
        for (const project of projects) home.pendingHomeProjects.add(`main/${project.name}`);
        void home.syncCreatorRootProjects();
    }
    release();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    await home.creatorProjectsRun;
    assert.deepEqual([...reads].sort(), [['one', 2], ['three', 1], ['two', 1]]);
});
