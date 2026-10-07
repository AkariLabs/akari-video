import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
    applyTaskPatch, deriveTasks, importSentAnnotationIds, nextTaskId,
    readTasksFile, toOverlayEntry, withTasksLock, writeTasksFile,
    type TaskRecord, type TasksDocument
} from '@akari-video/edit-store/lib/tasks-store';
import type {
    AkariTasksService, CreateTaskRequest, ImportSentRequest,
    ListTasksRequest, ListTasksResponse, NextBatchIdRequest, Task, UpdateTaskRequest, WriteOutboxRequest
} from '../common/akari-tasks-protocol';

@injectable()
export class AkariTasksServiceImpl implements AkariTasksService {
    async list(request: ListTasksRequest): Promise<ListTasksResponse> {
        const { tasksPath, reviewPath } = await this.paths(request.projectRootUri);
        const read = await readTasksFile(tasksPath);
        const overlay = read.ok ? read.doc : { version: 0, tasks: [] };
        const reviewText = await fs.readFile(reviewPath, 'utf8').catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
            throw error;
        });
        const derived = deriveTasks(reviewText, overlay);
        return {
            tasks: derived.tasks as Task[],
            warnings: [...read.warnings, ...derived.warnings],
            file: read.ok === true ? (read.exists ? 'ok' : 'absent') : read.reason
        };
    }

    async create(request: CreateTaskRequest): Promise<Task> {
        const { tasksPath } = await this.paths(request.projectRootUri);
        return withTasksLock(tasksPath, async () => {
            const doc = await this.readForWrite(tasksPath);
            if (!request.task || typeof request.task.body !== 'string' || !request.task.body.trim()) {
                throw new Error('タスクの本文が必要です。');
            }
            const source = request.task.source ?? 'annotation';
            if (!['annotation', 'lint', 'export'].includes(source)) throw new Error('自由な指示の出どころが不正です。');
            if (source === 'annotation' && (request.task.ref != null || request.task.anchor != null)) {
                throw new Error('自由な指示に注釈の参照は付けられません。');
            }
            const state = request.task.state ?? 'unsent';
            if (!['unsent', 'sent', 'review', 'done'].includes(state)) throw new Error('タスクの状態が不正です。');
            const task: TaskRecord = {
                ...request.task, id: nextTaskId(doc.tasks), source, state,
                ref: source === 'annotation' ? null : request.task.ref ?? null,
                anchor: source === 'annotation' ? null : request.task.anchor ?? null,
                createdAt: new Date().toISOString(),
                title: request.task.title ?? Array.from(request.task.body).slice(0, 40).join(''),
                priority: request.task.priority ?? 'normal'
            };
            if (task.risk === 'outbound' && task.gate === 'auto-ok') throw new Error('外部へ出るタスクを自動実行にできません。');
            doc.tasks.push(task);
            await writeTasksFile(tasksPath, doc);
            return task as Task;
        });
    }

    async update(request: UpdateTaskRequest): Promise<Task> {
        const { tasksPath, reviewPath } = await this.paths(request.projectRootUri);
        return withTasksLock(tasksPath, async () => {
            const doc = await this.readForWrite(tasksPath);
            const reviewText = await fs.readFile(reviewPath, 'utf8').catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
                throw error;
            });
            const derived = deriveTasks(reviewText, doc);
            const current = derived.tasks.find(task => task.id === request.id);
            if (!current) throw new Error('タスクが見つかりません。');
            const updated = applyTaskPatch(current, request.patch as Record<string, unknown>, request.actor);
            const index = doc.tasks.findIndex(task => task && task.id === request.id);
            if (index >= 0) doc.tasks[index] = {
                ...doc.tasks[index], ...request.patch, updatedAt: new Date().toISOString()
            };
            else doc.tasks.push({
                ...toOverlayEntry(current, doc.tasks), ...request.patch, updatedAt: new Date().toISOString()
            });
            await writeTasksFile(tasksPath, doc);
            return updated as Task;
        });
    }

    async importSent(request: ImportSentRequest): Promise<ListTasksResponse> {
        const { tasksPath } = await this.paths(request.projectRootUri);
        await withTasksLock(tasksPath, async () => {
            const doc = await this.readForWrite(tasksPath);
            await writeTasksFile(tasksPath, importSentAnnotationIds(doc, request.ids));
        });
        return this.list(request);
    }

    async writeOutbox(request: WriteOutboxRequest): Promise<void> {
        if (!/^b-\d{4,}$/.test(request.batchId) || typeof request.markdown !== 'string') {
            throw new Error('依頼文の番号または内容が不正です。');
        }
        const { tasksPath } = await this.paths(request.projectRootUri);
        const sidecar = resolve(tasksPath, '..');
        const root = resolve(sidecar, '..');
        const cache = join(sidecar, 'cache');
        const outbox = join(cache, 'outbox');
        for (const directory of [sidecar, cache, outbox]) {
            await fs.mkdir(directory).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            });
            const actual = await fs.realpath(directory);
            const rel = relative(root, actual);
            if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
                throw new Error('プロジェクト外の場所は使えません。');
            }
        }
        const destination = join(outbox, `${request.batchId}.md`);
        const temporary = join(outbox, `.${request.batchId}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
        try {
            await fs.writeFile(temporary, request.markdown, { flag: 'wx' });
            await fs.link(temporary, destination);
        } finally {
            await fs.rm(temporary, { force: true });
        }
    }

    async nextBatchId(request: NextBatchIdRequest): Promise<string> {
        const { tasksPath } = await this.paths(request.projectRootUri);
        const read = await readTasksFile(tasksPath);
        if (read.ok === false) throw new Error('tasks.json を読めません。');
        const outbox = join(resolve(tasksPath, '..'), 'cache', 'outbox');
        const root = resolve(tasksPath, '..', '..');
        let names: string[] = [];
        for (const directory of [resolve(tasksPath, '..'), join(resolve(tasksPath, '..'), 'cache'), outbox]) {
            try {
                const actual = await fs.realpath(directory);
                const rel = relative(root, actual);
                if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('プロジェクト外の場所は使えません。');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
        try {
            names = await fs.readdir(outbox);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const ids = [...read.doc.tasks.map(task => task.batchId), ...names.map(name => name.replace(/\.md$/, ''))];
        const maximum = ids.reduce<bigint>((max, value) => {
            const match = typeof value === 'string' ? /^b-(\d{4,})$/.exec(value) : null;
            const number = match ? BigInt(match[1]) : 0n;
            return number > max ? number : max;
        }, 0n);
        return `b-${String(maximum + 1n).padStart(4, '0')}`;
    }

    private async readForWrite(tasksPath: string): Promise<TasksDocument> {
        const read = await readTasksFile(tasksPath);
        if (read.ok === false) throw new Error(read.reason === 'newer'
            ? 'tasks.json は新しい形式です。スキル / アプリを更新してください。'
            : 'tasks.json が壊れています。上書きしません。');
        return read.doc;
    }

    private async paths(projectRootUri: string): Promise<{ tasksPath: string; reviewPath: string }> {
        if (typeof projectRootUri !== 'string' || !projectRootUri) throw new Error('プロジェクトの場所が必要です。');
        const root = await fs.realpath(resolve(new URI(projectRootUri).path.fsPath()));
        const sidecar = join(root, '.akari');
        try {
            const actual = await fs.realpath(sidecar);
            const rel = relative(root, actual);
            if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('プロジェクト外の場所は使えません。');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        return { tasksPath: join(sidecar, 'tasks.json'), reviewPath: join(root, 'review.json') };
    }
}
