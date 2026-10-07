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
    ListTasksRequest, ListTasksResponse, Task, UpdateTaskRequest
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
            if (request.task.source != null && request.task.source !== 'annotation') throw new Error('自由な指示の出どころが不正です。');
            if (request.task.ref != null || request.task.anchor != null) throw new Error('自由な指示に注釈の参照は付けられません。');
            const source = 'annotation';
            const state = request.task.state ?? 'unsent';
            if (!['unsent', 'sent', 'review', 'done'].includes(state)) throw new Error('タスクの状態が不正です。');
            const task: TaskRecord = {
                ...request.task, id: nextTaskId(doc.tasks), source, state, ref: null, anchor: null,
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
