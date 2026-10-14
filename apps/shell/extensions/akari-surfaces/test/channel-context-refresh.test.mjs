import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
import { projectRefreshDelay } from '../lib/browser/channel/channel-project-refresh-model.js';

const URI = uriModule.default ?? uriModule;
const source = readFileSync(new URL('../src/browser/channel/akari-channel-context-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('context.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariChannelContextService');
const names = ['setListVisible', 'ensureProjects', 'scheduleProjects', 'flushProjects'];
const body = names.map(name => declaration.members.find(node => node.name?.getText(ast) === name)?.getText(ast)).join('\n');
const code = ts.transpileModule(`class Context { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('非表示中の通知を溜め、表示時には変わった行を一回だけ読む', async () => {
    const timers = new Set();
    const Context = new Function('setTimeout', 'clearTimeout', 'projectRefreshDelay', 'compareText', `${code}\nreturn Context;`)(
        callback => { timers.add(callback); return callback; }, callback => timers.delete(callback), projectRefreshDelay,
        (a, b) => a.localeCompare(b));
    const context = new Context();
    const root = new URI('file:///creator');
    context.rootUri = root;
    context.viewers = new Set();
    context.listLoaded = true;
    context.watchAvailable = true;
    context.projects = new Map([['main', [
        { name: 'one', uri: root.resolve('channels/main/videos/one') },
        { name: 'two', uri: root.resolve('channels/main/videos/two') }
    ]]]);
    context.pendingProjects = new Map();
    let reads = 0, fires = 0;
    context.readProject = async uri => { reads++; return { name: uri.path.base, uri, updatedAt: reads }; };
    context.projectChanged = { fire: () => { fires++; } };
    context.changed = { fire: () => {} };
    context.ensureProjects = async () => {};
    for (let i = 0; i < 20; i++) {
        context.pendingProjects.set('main/two', { channel: 'main', project: 'two', kind: 'upsert' });
        context.scheduleProjects();
    }
    assert.equal(reads, 0);
    assert.equal(timers.size, 0);
    context.setListVisible('home', true);
    assert.equal(timers.size, 1);
    const callback = [...timers][0];
    callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1);
    assert.equal(fires, 1);
    assert.equal(context.projects.get('main').length, 2);
    assert.equal(context.projects.get('main').filter(project => project.name === 'two').length, 1);
});

test('表示時の保留分は一覧を渡す前にその行だけ反映する', async () => {
    const timers = new Set();
    const Context = new Function('setTimeout', 'clearTimeout', 'projectRefreshDelay', 'compareText', `${code}\nreturn Context;`)(
        callback => { timers.add(callback); return callback; }, callback => timers.delete(callback), projectRefreshDelay,
        (a, b) => a.localeCompare(b));
    const context = new Context();
    const root = new URI('file:///creator');
    context.rootUri = root;
    context.viewers = new Set(['launcher']);
    context.listLoaded = true;
    context.projects = new Map([['main', []]]);
    context.pendingProjects = new Map([['main/other', { channel: 'main', project: 'other', kind: 'upsert' }]]);
    context.readProject = async uri => ({ name: uri.path.base, uri });
    context.projectChanged = { fire: () => {} };
    context.changed = { fire: () => {} };
    await context.ensureProjects();
    assert.equal(context.projects.get('main').length, 1);
    assert.equal(context.pendingProjects.size, 0);
    assert.equal(timers.size, 0);
});

test('500ms おきの通知は数秒ごとにまとめて反映する', async () => {
    let now = 0;
    let timerId = 0;
    const timers = new Map();
    const schedule = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; };
    const Context = new Function('setTimeout', 'clearTimeout', 'Date', 'projectRefreshDelay', 'compareText', `${code}\nreturn Context;`)(
        schedule, id => timers.delete(id), { now: () => now }, projectRefreshDelay, (a, b) => a.localeCompare(b));
    const root = new URI('file:///creator');
    const context = new Context();
    context.rootUri = root;
    context.viewers = new Set(['home']);
    context.listLoaded = true;
    context.pendingProjects = new Map();
    context.projects = new Map([['main', []]]);
    const reads = new Map();
    context.readProject = async uri => {
        const key = uri.path.base;
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return { name: key, uri, updatedAt: now };
    };
    let flushes = 0;
    context.projectChanged = { fire: () => { flushes++; } };
    context.changed = { fire: () => {} };
    const advance = async target => {
        while (true) {
            const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
            if (!next || next[1].due > target) break;
            now = next[1].due;
            timers.delete(next[0]);
            next[1].callback();
            await new Promise(resolve => setImmediate(resolve));
        }
        now = target;
    };
    for (let index = 0; index < 20; index++) {
        await advance(index * 500);
        const project = `project-${index % 3}`;
        context.pendingProjects.set(`main/${project}`, { channel: 'main', project, kind: 'upsert' });
        context.scheduleProjects();
    }
    await advance(12000);
    assert.ok(flushes <= 6, `反映 ${flushes} 回`);
    assert.ok(flushes >= 3);
    for (const count of reads.values()) assert.ok(count <= flushes);
    assert.equal(context.pendingProjects.size, 0);
});
