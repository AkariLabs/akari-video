import { Emitter, Event, MessageService, CommandService, CommandRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, StorageService } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { AkariTasksService, Task, TaskSource, TaskState } from '../../common/akari-tasks-protocol';
import { AkariTasksService as AkariTasksServiceToken } from '../../common/akari-tasks-protocol';
import { pickNextRows, summarizeTasks } from '../../common/task-order';
import { availableActions } from '../../common/task-actions';
import { ReviewModel } from '../review-model';
import { DebouncedTaskRefresh, TaskOperations } from './task-operations';

export interface NewTask {
    text: string;
    via: string;
    target?: string;
    source?: TaskSource;
    priority?: 'high' | 'normal' | 'low';
}
export interface SendResult { sent: string[]; skipped: number; route: 'pty' | 'clipboard' | 'none' }
export type TaskSummary = ReturnType<typeof summarizeTasks>;

@injectable()
export class TaskService implements FrontendApplicationContribution {
    @inject(AkariTasksServiceToken) protected readonly backend!: AkariTasksService;
    @inject(ReviewModel) protected readonly review!: ReviewModel;
    @inject(FileService) protected readonly files!: FileService;
    @inject(StorageService) protected readonly storage!: StorageService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(CommandRegistry) protected readonly registry!: CommandRegistry;
    @inject(MessageService) protected readonly messages!: MessageService;

    protected tasks: Task[] = [];
    protected readonly refreshScheduler = new DebouncedTaskRefresh(() => this.refresh());
    protected refreshSequence = 0;
    protected readonly changed = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changed.event;
    protected taskOperations: TaskOperations | undefined;

    protected operations(): TaskOperations {
        return this.taskOperations ??= new TaskOperations({
            backend: this.backend,
            execute: (id, ...args) => this.commands.executeCommand(id, ...args),
            hasCommand: id => !!this.registry.getCommand(id),
            copy: text => navigator.clipboard.writeText(text),
            getSentIds: reviewUri => this.storage.getData<string[]>(`akari-review-sent-annotations:${reviewUri}`, []),
            resolveAnnotation: id => this.review.resolveAnnotation(id),
            info: message => { this.messages.info(message); },
            warn: message => { this.messages.warn(message); },
            error: message => { this.messages.error(message); }
        });
    }

    onStart(): void {
        this.review.onChanged(() => this.scheduleRefresh());
        this.files.onDidFilesChange(event => {
            const location = this.review.location;
            if (!location) return;
            const root = location.root.toString().replace(/\/$/, '');
            const targets = new Set([`${root}/.akari/tasks.json`, location.reviewUri.toString()]);
            if (event.changes.some(change => targets.has(change.resource.toString()))) this.scheduleRefresh();
        });
        this.scheduleRefresh();
    }

    protected scheduleRefresh(): void {
        this.refreshScheduler.schedule();
    }

    async refresh(): Promise<void> {
        const sequence = ++this.refreshSequence;
        const location = this.review.location;
        if (!location) {
            this.publish([]);
            return;
        }
        const root = location.root.toString();
        try {
            const tasks = await this.operations().load(root, location.reviewUri.toString());
            if (sequence === this.refreshSequence && root === this.review.location?.root.toString()) this.publish(tasks);
        } catch (error) {
            this.messages.error(`タスクを読み込めませんでした: ${String(error)}`);
        }
    }

    protected publish(tasks: Task[]): void {
        if (JSON.stringify(this.tasks) === JSON.stringify(tasks)) return;
        this.tasks = tasks;
        this.changed.fire();
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('akari.tasks.changed', { detail: this.summary() }));
        }
    }

    list(filter?: { source?: TaskSource; state?: TaskState }): Task[] {
        return this.tasks.filter(task => (!filter?.source || task.source === filter.source)
            && (!filter?.state || task.state === filter.state));
    }

    summary(): TaskSummary { return summarizeTasks(this.tasks); }

    nextRows(): { rows: Array<Task & { actions: ReturnType<typeof availableActions> }>; summary: TaskSummary; clipboardPending: number } {
        return { rows: pickNextRows(this.tasks).map(task => ({ ...task, actions: availableActions(task) })), summary: this.summary(),
            clipboardPending: this.tasks.filter(task => task.state === 'sent' && (task.sentTo as { route?: string; pasted?: boolean } | undefined)?.route === 'clipboard'
                && (task.sentTo as { pasted?: boolean }).pasted !== true).length };
    }

    async create(input: NewTask): Promise<Task> {
        const root = this.projectRoot();
        if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('タスクの本文が必要です。');
        const task = await this.backend.create({ projectRootUri: root, task: {
            body: input.text, via: input.via, target: input.target,
            source: input.source ?? 'annotation', priority: input.priority
        } });
        await this.refresh();
        return task;
    }

    async update(id: string, patch: Partial<Task>, actor: 'human' | 'app' = 'human'): Promise<Task> {
        const task = await this.backend.update({ projectRootUri: this.projectRoot(), id, patch, actor });
        await this.refresh();
        return task;
    }

    async send(ids: string[]): Promise<SendResult> {
        const tasks = this.tasks.map(task => {
            const ref = task.ref as { kind?: string; id?: string } | undefined;
            const annotation = ref?.kind === 'annotation'
                ? this.review.annotations.find(candidate => candidate.id === ref.id) : undefined;
            return annotation ? { ...task, hasStrokes: Array.isArray(annotation.strokes) && annotation.strokes.length > 0 } : task;
        });
        const result = await this.operations().send(ids, tasks, this.projectRoot());
        if (result.sent.length) await this.refresh();
        return result;
    }

    async dismiss(id: string): Promise<Task> {
        return this.update(id, { state: 'done', outcome: 'dismissed' }, 'human');
    }

    async confirm(id: string): Promise<Task> {
        const task = this.tasks.find(candidate => candidate.id === id);
        if (!task) throw new Error('確認するタスクが見つかりません。');
        const updated = await this.operations().confirm(task, this.projectRoot());
        await this.refresh();
        return updated;
    }

    async markPasted(id: string): Promise<Task> {
        const task = this.tasks.find(candidate => candidate.id === id);
        const sentTo = task?.sentTo as { route?: string; pasted?: boolean } | undefined;
        if (task?.state !== 'sent' || sentTo?.route !== 'clipboard') throw new Error('貼り付け待ちのタスクではありません。');
        return this.update(id, { sentTo: { ...sentTo, pasted: true } }, 'human');
    }

    protected projectRoot(): string {
        const root = this.review.location?.root.toString();
        if (!root) throw new Error('プロジェクトを特定できません。');
        return root;
    }
}
