import './support/i18n-ja.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { PROJECT_GITIGNORE } from 'akari-video/src/history-policy.mjs';
import { GATE_TYPES, readAutomationEvents, unresolvedGates } from '../lib/common/automation-events.js';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

const exec = promisify(execFile);
const git = (root, ...args) => exec('git', ['-C', root, ...args]);

class Service extends AkariProjectServiceImpl {
    fsPath(uri) { return uri; }
    async event(root, file) { await this.handleEvent(root, file); }
}

async function project() {
    const root = await mkdtemp(join(tmpdir(), 'akari-automation-'));
    await git(root, 'init', '-q');
    await mkdir(join(root, '.akari', 'events'), { recursive: true });
    await writeFile(join(root, '.gitignore'), PROJECT_GITIGNORE);
    await writeFile(join(root, 'edit.json'), '{"step":0}\n');
    await git(root, 'add', '-A');
    await git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'Initial');
    return root;
}

async function addEvent(root, event) {
    const file = join(root, '.akari', 'events', `${event.occurredAt.replace(/\D/g, '')}-${event.id}.json`);
    await writeFile(file, `${JSON.stringify(event)}\n`);
    return file;
}

test('tolerant reader skips one broken file and closes matching requests', () => {
    const base = { version: 1, occurredAt: '2026-10-16T01:00:00Z' };
    const request = { ...base, id: 'gate-1', type: 'gate-requested', gate: 'paid',
        requestId: 'r-1', summary: 'Estimate', detail: '$2', extra: 42 };
    const events = readAutomationEvents(['{broken', JSON.stringify(request),
        JSON.stringify({ ...base, id: 'unknown', type: 'future-event' })]);
    assert.equal(events.length, 1);
    assert.equal(events[0].extra, 42);
    assert.deepEqual(unresolvedGates(events).map(item => item.requestId), ['r-1']);
    const resolved = { ...base, id: 'resolved-1', type: 'gate-resolved', requestId: 'r-1',
        decision: 'approved', by: 'human' };
    assert.equal(unresolvedGates([...events, resolved]).length, 0);
});

test('each closed gate has a label in both languages', async () => {
    for (const language of ['ja', 'en']) {
        const catalog = JSON.parse(await readFile(new URL(`../../../../../packages/i18n/locales/${language}/project.json`, import.meta.url), 'utf8'));
        for (const gate of GATE_TYPES) {
            const key = `project.automation.gate.${gate.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())}`;
            assert.ok(catalog[key], `${language}: ${key}`);
        }
    }
});

test('two agent actions create two summary commits; gate events do not commit', async () => {
    const root = await project();
    try {
        const service = new Service();
        for (let step = 1; step <= 2; step++) {
            await writeFile(join(root, 'edit.json'), `{"step":${step}}\n`);
            const file = await addEvent(root, { version: 1, id: `act-${step}`, type: 'agent-action',
                occurredAt: `2026-10-16T01:00:0${step}Z`, actor: 'partner',
                summary: `Edit ${step}`, files: ['edit.json'] });
            await service.event(root, file);
        }
        const { stdout: subjects } = await git(root, 'log', '-2', '--format=%s');
        assert.deepEqual(subjects.trim().split('\n'), ['Edit 2', 'Edit 1']);
        const { stdout: body } = await git(root, 'show', '-s', '--format=%b', 'HEAD');
        assert.match(body, /AKARI-Actor: partner/);
        assert.match(body, /AKARI-Files: edit\.json/);
        assert.equal((await service.actionHistory(root)).entries[0].fileCount, 1);
        const before = (await git(root, 'rev-list', '--count', 'HEAD')).stdout.trim();
        const request = { version: 1, id: 'gate-1', type: 'gate-requested',
            occurredAt: '2026-10-16T01:01:00Z', gate: 'paid', requestId: 'req-1', summary: 'Generate', detail: '$2' };
        const gateFile = await addEvent(root, request);
        await service.event(root, gateFile);
        assert.equal((await service.pendingGates(root)).length, 1);
        assert.equal((await git(root, 'rev-list', '--count', 'HEAD')).stdout.trim(), before);
        await service.resolveGate(root, 'req-1', 'approved');
        assert.equal((await service.pendingGates(root)).length, 0);
        const names = await readdir(join(root, '.akari', 'events'));
        const id = `res-${createHash('sha256').update('req-1').digest('hex').slice(0, 20)}`;
        const resolutionName = names.find(name => name.endsWith(`-${id}.json`));
        assert.ok(resolutionName);
        const resolution = JSON.parse(await readFile(join(root, '.akari', 'events', resolutionName), 'utf8'));
        assert.equal(resolution.id, id);
        assert.equal(resolutionName, `${resolution.occurredAt.replace(/\D/g, '')}-${resolution.id}.json`);
        assert.equal(resolution.by, 'human');
        await assert.rejects(() => service.resolveGate(root, 'req-1', 'declined'), /すでに解決/);
        assert.equal((await git(root, 'rev-list', '--count', 'HEAD')).stdout.trim(), before);
        const nextGate = await addEvent(root, { ...request, id: 'gate-2', requestId: 'req-2',
            occurredAt: '2026-10-16T01:01:01Z' });
        await service.event(root, nextGate);
        const answers = await Promise.allSettled([
            service.resolveGate(root, 'req-2', 'approved'),
            service.resolveGate(root, 'req-2', 'declined')
        ]);
        assert.deepEqual(answers.map(answer => answer.status).sort(), ['fulfilled', 'rejected']);
        assert.equal((await service.pendingGates(root)).length, 0);
        await writeFile(join(root, 'edit.json'), '{"step":3}\n');
        const next = await addEvent(root, { version: 1, id: 'act-3', type: 'agent-action',
            occurredAt: '2026-10-16T01:02:00Z', actor: 'partner', summary: 'Edit 3', files: ['edit.json'] });
        await service.event(root, next);
        const { stdout: tracked } = await git(root, 'ls-tree', '-r', '--name-only', 'HEAD');
        assert.ok(tracked.includes('act-3.json'));
        assert.ok(!tracked.includes('gate-1.json'));
        assert.ok(!tracked.includes(`${id}.json`));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('restore before the second of three actions creates a new milestone without erasing history', async () => {
    const root = await project();
    try {
        const service = new Service();
        const shas = [];
        for (let step = 1; step <= 3; step++) {
            await writeFile(join(root, 'edit.json'), `{"step":${step}}\n`);
            const file = await addEvent(root, { version: 1, id: `act-${step}`, type: 'agent-action',
                occurredAt: `2026-10-16T02:00:0${step}Z`, actor: 'unattended',
                summary: `Edit ${step}`, files: ['edit.json'] });
            await service.event(root, file);
            shas.push((await git(root, 'rev-parse', 'HEAD')).stdout.trim());
        }
        assert.equal((await service.actionHistory(root)).entries[0].actor, 'unattended');
        const before = Number((await git(root, 'rev-list', '--count', 'HEAD')).stdout.trim());
        await mkdir(join(root, 'assets'), { recursive: true });
        await mkdir(join(root, 'exports'), { recursive: true });
        await writeFile(join(root, 'assets', 'original.mov'), 'original-media');
        await writeFile(join(root, 'exports', 'final.mp4'), 'rendered-media');
        await service.restoreBeforeAction(root, shas[1]);
        assert.equal(JSON.parse(await readFile(join(root, 'edit.json'), 'utf8')).step, 1);
        assert.equal(await readFile(join(root, 'assets', 'original.mov'), 'utf8'), 'original-media');
        assert.equal(await readFile(join(root, 'exports', 'final.mp4'), 'utf8'), 'rendered-media');
        assert.equal(Number((await git(root, 'rev-list', '--count', 'HEAD')).stdout.trim()), before + 1);
        const { stdout: all } = await git(root, 'rev-list', 'HEAD');
        assert.ok(shas.every(sha => all.includes(sha)));
        assert.match((await git(root, 'show', '-s', '--format=%s', 'HEAD')).stdout,
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} の前に戻した\n$/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
