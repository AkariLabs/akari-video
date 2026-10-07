import type { AkariTasksService, Task } from '../../common/akari-tasks-protocol';
import { composeBatchPacket, composeTaskPacket } from '../../common/task-packet';
import { chooseRoute } from '../../common/task-route';
import type { SendResult } from './task-service';

export interface TaskPorts {
    backend: AkariTasksService;
    execute: (id: string, ...args: unknown[]) => Promise<unknown>;
    hasCommand: (id: string) => boolean;
    copy: (text: string) => Promise<void>;
    getSentIds: (reviewUri: string) => Promise<string[]>;
    resolveAnnotation: (id: string) => Promise<unknown>;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
}

export class DebouncedTaskRefresh {
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(private readonly refresh: () => void | Promise<void>, private readonly delay = 300) { }
    schedule(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, this.delay);
    }
}

export class TaskOperations {
    private readonly imported = new Map<string, Set<string>>();
    constructor(private readonly ports: TaskPorts) { }

    async load(root: string, reviewUri: string): Promise<Task[]> {
        let result = await this.ports.backend.list({ projectRootUri: root });
        const sent = await this.ports.getSentIds(reviewUri);
        const imported = this.imported.get(root) ?? new Set<string>();
        const alreadySent = new Set(result.tasks.filter(task => task.state !== 'unsent' && task.ref && typeof task.ref === 'object')
            .map(task => (task.ref as { id?: string }).id));
        const missing = (Array.isArray(sent) ? sent : []).filter(id => /^a-\d{4,}$/.test(id)
            && !imported.has(id) && !alreadySent.has(id));
        if (missing.length) {
            result = await this.ports.backend.importSent({ projectRootUri: root, ids: missing });
            missing.forEach(id => imported.add(id));
            this.imported.set(root, imported);
        }
        return result.tasks;
    }

    async send(ids: string[], tasks: readonly Task[], root: string): Promise<SendResult> {
        const unique = [...new Set(ids)];
        const selected = unique.map(id => tasks.find(task => task.id === id));
        const eligible = selected.filter((task): task is Task => !!task && task.state === 'unsent'
            && task.needsConfirm !== true && !task.unknown);
        const skipped = unique.length - eligible.length;
        if (skipped) this.ports.warn(`${skipped} 件は頼む対象から外しました。`);
        if (!eligible.length) return { sent: [], skipped, route: 'none' };
        let target: { form: 'cli' | 'extension' | 'none'; agent?: string; focusCommandId?: string };
        try { target = await this.ports.execute('akari.partner.deliveryTarget') as typeof target; }
        catch { target = { form: 'none' }; }
        const choice = chooseRoute({ target: target.form, count: eligible.length });
        if (choice.route === 'none') {
            this.ports.warn('パートナーが未接続です。');
            return { sent: [], skipped, route: 'none' };
        }
        let packet: string;
        let batchId: string | undefined;
        try {
            if (eligible.length === 1) packet = composeTaskPacket(eligible[0]);
            else {
                batchId = await this.ports.backend.nextBatchId({ projectRootUri: root });
                const batch = composeBatchPacket(eligible, batchId);
                await this.ports.backend.writeOutbox({ projectRootUri: root, batchId, markdown: batch.markdown });
                packet = batch.line;
            }
            if (choice.route === 'pty') {
                if (await this.ports.execute('akari.partner.injectPrompt', packet) !== true) {
                    this.ports.warn('パートナーへ渡せませんでした。');
                    return { sent: [], skipped, route: choice.route };
                }
            } else {
                try { await this.ports.copy(packet); }
                catch {
                    this.ports.warn(`コピーできませんでした。次の文を手でコピーしてください: ${packet}`);
                    return { sent: [], skipped, route: choice.route };
                }
                if (target.focusCommandId && this.ports.hasCommand(target.focusCommandId)) {
                    try { await this.ports.execute(target.focusCommandId); }
                    catch { /* コピーした文はそのまま使える。 */ }
                }
                this.ports.info('依頼文をコピーしました。入力欄に貼り付けて（⌘V）送ってください。');
            }
        } catch (error) {
            this.ports.warn(`依頼文を渡せませんでした: ${String(error)}`);
            return { sent: [], skipped, route: choice.route };
        }
        const sent: string[] = [];
        for (const task of eligible) {
            await this.ports.backend.update({ projectRootUri: root, id: task.id,
                patch: { state: 'sent', sentAt: new Date().toISOString(),
                    ...(batchId ? { batchId } : {}),
                    sentTo: { agent: target.agent, form: target.form, route: choice.route } }, actor: 'app' });
            sent.push(task.id);
        }
        return { sent, skipped, route: choice.route };
    }

    async confirm(task: Task, root: string): Promise<Task> {
        if (task.state !== 'review') throw new Error('確認するタスクが見つかりません。');
        const ref = task.ref as { kind?: string; id?: string } | undefined;
        if (ref?.kind === 'annotation' && ref.id) {
            try { await this.ports.resolveAnnotation(ref.id); }
            catch (error) {
                this.ports.error(`注釈を確認できませんでした: ${String(error)}`);
                throw error;
            }
        }
        return this.ports.backend.update({ projectRootUri: root, id: task.id, patch: { state: 'done' }, actor: 'human' });
    }
}
