"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTasksFile = readTasksFile;
exports.writeTasksFile = writeTasksFile;
exports.withTasksLock = withTasksLock;
exports.nextTaskId = nextTaskId;
exports.applyTaskPatch = applyTaskPatch;
exports.deriveTasks = deriveTasks;
exports.toOverlayEntry = toOverlayEntry;
exports.importSentAnnotationIds = importSentAnnotationIds;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const SOURCES = new Set(['annotation', 'lint', 'proposal', 'export']);
const STATES = new Set(['unsent', 'sent', 'review', 'done']);
const TASKS_VERSION = 0;
const PATCH_FIELDS = new Set([
    'state', 'via', 'priority', 'rank', 'outcome', 'title', 'body', 'target', 'anchor',
    'ref', 'attachments', 'gate', 'undo', 'batchId', 'sentAt', 'sentTo', 'response',
    'needsConfirm', 'updatedAt', 'orphaned', 'kind', 'targetDetail', 'evidence',
    'confidence', 'question', 'risk', 'route', 'dependsOn', 'origin', 'mergedFrom'
]);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
async function readTasksFile(filePath) {
    let source;
    try {
        source = await node_fs_1.promises.readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            const doc = { version: 0, tasks: [] };
            return { ok: true, exists: false, doc, version: 0, tasks: doc.tasks, warnings: [] };
        }
        throw error;
    }
    let raw;
    try {
        raw = JSON.parse(source);
    }
    catch {
        return { ok: false, reason: 'broken', warnings: [] };
    }
    if (!isObject(raw))
        return { ok: false, reason: 'broken', warnings: [] };
    if (typeof raw.version === 'number' && raw.version > 0) {
        return { ok: false, reason: 'newer', version: raw.version, warnings: [] };
    }
    if (raw.version !== TASKS_VERSION || !Array.isArray(raw.tasks))
        return { ok: false, reason: 'broken', warnings: [] };
    const warnings = [];
    for (const [index, task] of raw.tasks.entries()) {
        if (!isObject(task)) {
            warnings.push(`tasks[${index}] の形が不正です`);
            continue;
        }
        for (const field of ['id', 'source', 'state', 'createdAt']) {
            if (typeof task[field] !== 'string')
                warnings.push(`tasks[${index}].${field} がありません`);
        }
        if (!SOURCES.has(String(task.source)) || !STATES.has(String(task.state))) {
            warnings.push(`tasks[${index}] は未知の状態または出どころです`);
        }
    }
    const doc = raw;
    return { ok: true, exists: true, doc, version: doc.version, tasks: doc.tasks, warnings };
}
async function writeTasksFile(filePath, doc) {
    const current = await readTasksFile(filePath);
    if (!current.ok)
        throw new Error(current.reason === 'newer'
            ? 'tasks.json は新しい形式です。スキル / アプリを更新してください。'
            : 'tasks.json が壊れています。上書きしません。');
    if (!isObject(doc) || doc.version !== TASKS_VERSION || !Array.isArray(doc.tasks))
        throw new Error('tasks.json の形が不正です。');
    await node_fs_1.promises.mkdir((0, node_path_1.dirname)(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    try {
        await node_fs_1.promises.writeFile(temporary, `${JSON.stringify(doc, null, 2)}\n`);
        await node_fs_1.promises.rename(temporary, filePath);
    }
    catch (error) {
        await node_fs_1.promises.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function withTasksLock(filePath, operation) {
    const lockPath = `${filePath}.lock`;
    await node_fs_1.promises.mkdir((0, node_path_1.dirname)(filePath), { recursive: true });
    for (let attempt = 0;; attempt++) {
        try {
            await node_fs_1.promises.mkdir(lockPath);
            break;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            try {
                if (Date.now() - (await node_fs_1.promises.stat(lockPath)).mtimeMs > 60_000) {
                    await node_fs_1.promises.rmdir(lockPath);
                    continue;
                }
            }
            catch (inspectError) {
                if (inspectError.code !== 'ENOENT')
                    throw inspectError;
                continue;
            }
            if (attempt >= 1200)
                throw new Error('tasks.json は別の処理が書き込み中です。');
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    try {
        return await operation();
    }
    finally {
        await node_fs_1.promises.rmdir(lockPath);
    }
}
function nextTaskId(tasks) {
    const maximum = tasks.reduce((max, task) => {
        const match = /^t-(\d{4,})$/.exec(String(task?.id ?? ''));
        const number = match ? BigInt(match[1]) : 0n;
        return number > max ? number : max;
    }, 0n);
    return `t-${String(maximum + 1n).padStart(4, '0')}`;
}
function applyTaskPatch(task, patch, actor) {
    if (!SOURCES.has(task.source) || !STATES.has(task.state))
        throw new Error('未知のタスクは変更できません。');
    if (!isObject(patch))
        throw new Error('変更内容が不正です。');
    for (const key of Object.keys(patch))
        if (!PATCH_FIELDS.has(key))
            throw new Error(`${key} は変更できません。`);
    if (isObject(task.ref) && task.ref.kind === 'annotation') {
        for (const key of ['title', 'body', 'target', 'anchor', 'via', 'ref']) {
            if (key in patch)
                throw new Error(`注釈の ${key} は review.json で変更してください。`);
        }
    }
    const nextState = patch.state ?? task.state;
    if (typeof nextState !== 'string' || !STATES.has(nextState))
        throw new Error('状態が不正です。');
    if (nextState !== task.state) {
        const dismissed = nextState === 'done' && patch.outcome === 'dismissed' && actor !== 'agent';
        const permitted = dismissed ||
            (task.state === 'unsent' && nextState === 'sent') ||
            (task.state === 'sent' && nextState === 'review') ||
            (task.state === 'sent' && nextState === 'done' && task.source === 'lint' && actor !== 'agent') ||
            (task.state === 'review' && nextState === 'done' && actor !== 'agent') ||
            (task.state === 'review' && nextState === 'unsent' && actor !== 'agent');
        if (!permitted)
            throw new Error(`${task.state} から ${nextState} には進めません。`);
    }
    if (actor === 'agent' && nextState === 'done')
        throw new Error('AI はタスクを完了にできません。');
    const result = { ...task, ...patch };
    if (result.risk === 'outbound' && result.gate === 'auto-ok')
        throw new Error('外部へ出るタスクを自動実行にできません。');
    return result;
}
function deriveTasks(reviewJsonText, overlayDoc) {
    const warnings = [];
    let annotations = [];
    if (reviewJsonText) {
        try {
            const review = JSON.parse(reviewJsonText);
            if (!Array.isArray(review.annotations))
                warnings.push('review.json に annotations 配列がありません。');
            else
                annotations = review.annotations;
        }
        catch {
            warnings.push('review.json が壊れています。');
        }
    }
    const overlay = Array.isArray(overlayDoc.tasks) ? overlayDoc.tasks : [];
    const overlaysByRef = new Map();
    for (const task of overlay) {
        if (isObject(task) && SOURCES.has(String(task.source)) && STATES.has(String(task.state)) && isObject(task.ref)
            && task.ref.kind === 'annotation' && typeof task.ref.id === 'string')
            overlaysByRef.set(task.ref.id, task);
    }
    const seen = new Set();
    const used = [...overlay];
    const result = [];
    annotations.sort((a, b) => {
        const first = isObject(a) ? a : {};
        const second = isObject(b) ? b : {};
        return String(first.createdAt ?? '').localeCompare(String(second.createdAt ?? ''))
            || String(first.id ?? '').localeCompare(String(second.id ?? ''));
    });
    for (const value of annotations) {
        if (!isObject(value) || typeof value.id !== 'string') {
            warnings.push('不正な注釈を読み飛ばしました。');
            continue;
        }
        const annotation = value;
        seen.add(annotation.id);
        const found = overlaysByRef.get(annotation.id);
        const virtualId = found?.id ?? nextTaskId(used);
        if (!found)
            used.push({ id: virtualId, source: 'annotation', state: 'unsent', createdAt: String(annotation.createdAt ?? '') });
        const status = annotation.status;
        const state = status === 'addressed' ? 'review' : status === 'resolved' ? 'done'
            : found?.state === 'sent' ? 'sent' : found?.state === 'done' && found.outcome === 'dismissed' ? 'done' : 'unsent';
        const text = typeof annotation.text === 'string' ? annotation.text : '';
        const derived = {
            ...found, id: virtualId, source: 'annotation', state,
            createdAt: String(annotation.createdAt ?? found?.createdAt ?? ''), createdBy: 'human',
            priority: found?.priority ?? 'normal',
            via: annotation.input === 'session' ? 'voice' : annotation.input,
            title: Array.from(text).slice(0, 40).join(''), body: text,
            target: annotation.target ?? null,
            anchor: { sourceT: annotation.sourceT ?? null, sourceRange: annotation.sourceRange ?? null },
            ref: { kind: 'annotation', id: annotation.id }
        };
        if (text.startsWith('[要確認]'))
            derived.gate = 'ask';
        if (status === 'addressed')
            derived.outcome = isObject(annotation.response) ? annotation.response.action ?? null : null;
        if (status !== 'addressed' && found?.outcome !== 'dismissed')
            delete derived.outcome;
        if (isObject(annotation.response))
            derived.response = annotation.response;
        else
            delete derived.response;
        delete derived.orphaned;
        result.push(derived);
    }
    for (const task of overlay) {
        if (!isObject(task)) {
            result.push({ id: `invalid-${result.length}`, source: 'unknown', state: 'unknown', createdAt: '', unknown: true });
            continue;
        }
        if (!SOURCES.has(String(task.source)) || !STATES.has(String(task.state))
            || typeof task.id !== 'string' || typeof task.createdAt !== 'string') {
            result.push({ ...task, id: String(task.id ?? `invalid-${result.length}`),
                source: String(task.source ?? 'unknown'), state: String(task.state ?? 'unknown'),
                createdAt: String(task.createdAt ?? ''), unknown: true });
            continue;
        }
        if (isObject(task.ref) && task.ref.kind === 'annotation' && typeof task.ref.id === 'string') {
            if (!seen.has(task.ref.id))
                result.push({ ...task, orphaned: true });
        }
        else
            result.push({ ...task });
    }
    result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return { tasks: result, warnings };
}
function toOverlayEntry(derivedTask, existingTasks = []) {
    return {
        id: /^t-\d{4,}$/.test(derivedTask.id) && !existingTasks.some(task => task.id === derivedTask.id)
            ? derivedTask.id : nextTaskId(existingTasks),
        source: derivedTask.source, ref: derivedTask.ref ?? null,
        state: derivedTask.state, priority: derivedTask.priority ?? 'normal',
        createdAt: derivedTask.createdAt
    };
}
function importSentAnnotationIds(overlay, ids) {
    const tasks = [...overlay.tasks];
    for (const id of ids) {
        if (!/^a-\d{4,}$/.test(id))
            continue;
        if (tasks.some(task => isObject(task) && isObject(task.ref) && task.ref.kind === 'annotation' && task.ref.id === id))
            continue;
        tasks.push({ id: nextTaskId(tasks), source: 'annotation', state: 'sent',
            createdAt: new Date(0).toISOString(), ref: { kind: 'annotation', id }, priority: 'normal' });
    }
    return { ...overlay, tasks };
}
