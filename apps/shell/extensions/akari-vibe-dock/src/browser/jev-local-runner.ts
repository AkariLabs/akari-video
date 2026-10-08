import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariEarFrontend } from '../common/ear-frontend';
import type { EarUtterance } from '../common/ear-protocol';
import { AkariEarService, type AkariEarService as EarService } from '../common/ear-protocol';
import { matchJev, normalizeJev, type JevPlan } from '../common/jev-local-grammar';
import { JEV_LOCAL_ACTIONS, validateValue, type JevValueSchema } from '../common/jev-catalog.generated';
import type { JevRouteResult, JevUtteranceRouter } from '../common/jev-utterance-router';
import { effectiveVibeMode, readVibeMode, VIBE_MODE_KEY } from '../common/vibe-mode';
import { VibeDockState } from '../common/vibe-dock-state';
import { JevHandGuard } from './jev-hand-guard';
import { EarSession } from './ear-session';
import { NowVibeDockTab } from './vibe-dock-tabs';

interface CommandStep { commandId: string; args: Record<string, unknown> }
interface CatalogView {
    tab: 'project' | 'library';
    materials: { kinds: string[]; sort: { by: string; order: string }; query: string };
    library: { source: string; price: string[]; license: string[]; status: string[]; query: string; category?: string };
}
interface LedgerEntry {
    id: string; at: number; utterance: string; planId: string; label: string;
    commands: CommandStep[]; inverse: CommandStep[]; tier: number; undone: boolean;
    resultView?: CatalogView;
}
interface Pending { utterance: EarUtterance; plan: JevPlan; timer: ReturnType<typeof setTimeout>; status: Disposable }
const CONFIRM_KEY = 'akari.jev.browserSearchNoticeSeen';
const actionById = new Map<string, typeof JEV_LOCAL_ACTIONS[number]>(JEV_LOCAL_ACTIONS.map(action => [action.id, action]));

@injectable()
export class JevLocalRunner implements JevUtteranceRouter, FrontendApplicationContribution {
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(AkariEarFrontend) protected readonly ear!: AkariEarFrontend;
    @inject(AkariEarService) protected readonly earService!: EarService;
    @inject(VibeDockState) protected readonly dock!: VibeDockState;
    @inject(NowVibeDockTab) protected readonly now!: NowVibeDockTab;
    @inject(EarSession) protected readonly session!: EarSession;
    protected readonly hand = new JevHandGuard();
    protected readonly ledger: LedgerEntry[] = [];
    protected readonly actionTimes: number[] = [];
    protected readonly undoTimes: number[] = [];
    protected undoStreak = 0;
    protected latestUndone: LedgerEntry | undefined;
    protected lastAction: { key: string; at: number } | undefined;
    protected notice: Disposable | undefined;
    protected pending: Pending | undefined;
    protected paperOpen = false;
    protected playback = { time: 0, playing: false, editUri: '' };
    protected sequence = 0;
    protected capabilities: Awaited<ReturnType<AkariEarFrontend['capabilities']>> | undefined;
    protected capabilityRequest: Promise<Awaited<ReturnType<AkariEarFrontend['capabilities']>>> | undefined;
    protected directTestSubscription: Disposable | undefined;
    protected directTestQueue: Promise<void> = Promise.resolve();
    protected readonly opened = (): void => { this.paperOpen = true; };
    protected readonly closed = (): void => { this.paperOpen = false; };
    protected readonly tick = (event: Event): void => {
        const value = (event as CustomEvent<{ time?: number; playing?: boolean; editUri?: string; videoUri?: string }>).detail;
        if (Number.isFinite(value?.time)) this.playback.time = value.time!;
        if (typeof value?.playing === 'boolean') this.playback.playing = value.playing;
        if (value?.editUri || value?.videoUri) this.playback.editUri = value.editUri ?? value.videoUri ?? '';
    };
    protected readonly testUtterance = (event: Event): void => {
        const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
        if (typeof text === 'string') void this.earService.injectTestUtterance?.(text);
    };

    onStart(): void {
        this.hand.start();
        window.addEventListener('akari.sketch.opened', this.opened);
        window.addEventListener('akari.sketch.closed', this.closed);
        window.addEventListener('akari.preview.playbackTick', this.tick);
        void this.getCapabilities().then(capabilities => {
            if (!capabilities.testText) return;
            window.addEventListener('akari.ear.testUtterance', this.testUtterance);
            this.directTestSubscription = this.ear.onUtterance(value => {
                if (!value.id.startsWith('test-utterance-') || this.session.state.state !== 'idle') return;
                this.directTestQueue = this.directTestQueue.then(async () => {
                    const result = await this.route(value).catch(() => ({ outcome: 'memo' as const }));
                    if (result.outcome === 'memo' && value.kind !== 'command') {
                        this.now.acceptUtterance(value, this.playback.time, 'label' in result && result.label === 'negated');
                    }
                });
            });
        }).catch(() => undefined);
    }
    onStop(): void {
        this.hand.stop();
        window.removeEventListener('akari.sketch.opened', this.opened);
        window.removeEventListener('akari.sketch.closed', this.closed);
        window.removeEventListener('akari.preview.playbackTick', this.tick);
        window.removeEventListener('akari.ear.testUtterance', this.testUtterance);
        this.directTestSubscription?.dispose();
        this.clearPending(false);
        this.notice?.dispose();
    }
    protected async getCapabilities(): Promise<Awaited<ReturnType<AkariEarFrontend['capabilities']>>> {
        if (this.capabilities) return this.capabilities;
        this.capabilityRequest ??= this.ear.capabilities();
        return this.capabilities = await this.capabilityRequest;
    }
    protected say(line: string, tone: 'info' | 'warn' | 'error' = 'info',
        actions?: Array<{ label: string; run: () => void }>, duration = 5000): void {
        this.notice?.dispose();
        const notice = this.dock.status.set(line, tone, 'jev', actions);
        this.notice = notice;
        if (this.dock.layout === 'closed') this.dock.setLayout('open');
        if (duration > 0) setTimeout(() => { if (this.notice === notice) { notice.dispose(); this.notice = undefined; } }, duration);
    }
    protected clearPending(asMemo: boolean): Pending | undefined {
        const pending = this.pending;
        if (!pending) return undefined;
        clearTimeout(pending.timer);
        pending.status.dispose();
        this.pending = undefined;
        if (asMemo) this.now.acceptUtterance(pending.utterance, this.playback.time);
        return pending;
    }
    protected async executeConfirmed(pending: Pending): Promise<JevRouteResult> {
        let result: JevRouteResult;
        try { result = await this.execute(pending.plan, pending.utterance); }
        catch { this.say('操作できませんでした', 'warn'); result = { outcome: 'memo' }; }
        if (result.outcome !== 'memo') return result;
        this.now.acceptUtterance(pending.utterance, this.playback.time);
        return { outcome: 'handled', label: pending.plan.label };
    }
    async route(utterance: EarUtterance): Promise<JevRouteResult> {
        const capabilities = await this.getCapabilities().catch(() => ({ engines: [] }));
        const mode = effectiveVibeMode({ mode: readVibeMode(this.preferences),
            companionEnabled: this.preferences.inspect<boolean>('akari.companion.enabled')?.globalValue !== false,
            // 検証用
            liveAvailable: 'testText' in capabilities && Boolean(capabilities.testText)
                || capabilities.engines.some(engine => engine.id === 'speechanalyzer-live' && engine.available)
        }).mode;
        if (mode === 'off') return { outcome: 'memo' };
        if (this.pending) {
            const reply = matchJev(utterance.text, { paperOpen: this.paperOpen, confirming: true });
            if (reply?.kind === 'yes') {
                const confirmed = this.clearPending(false)!;
                return this.executeConfirmed(confirmed);
            }
            if (reply?.kind === 'no') { this.clearPending(true); this.say('見送りました'); return { outcome: 'handled', label: '見送りました' }; }
            this.clearPending(true);
        }
        if (this.paperOpen && utterance.kind !== 'command') return { outcome: 'pass' };
        const split = utterance.text.split(/[、，]/u);
        if (split.length > 1 && !this.paperOpen) {
            if (utterance.text.normalize('NFKC').length > 40) return { outcome: 'memo' };
            const clauses = split.map(text => text.trim()).filter(text => normalizeJev(text) !== '');
            if (!clauses.length) return { outcome: 'memo' };
            // 全節を先に調べる。言い直し・否定・編集依頼が混ざる文では前半も動かさない。
            if (clauses.some(text => {
                const matched = matchJev(text, { paperOpen: false, confirming: false });
                return matched?.kind !== 'plan' || !this.steps(matched.plan)?.length;
            })) return { outcome: 'memo' };
            for (const clause of clauses) {
                const result = await this.routeSingle({ ...utterance, text: clause });
                if (result.outcome !== 'handled') return { outcome: 'memo' };
            }
            return { outcome: 'handled' };
        }
        return this.routeSingle(utterance);
    }
    protected async routeSingle(utterance: EarUtterance): Promise<JevRouteResult> {
        const matched = matchJev(utterance.text, { paperOpen: this.paperOpen, confirming: false });
        if (!matched) return { outcome: this.paperOpen ? 'pass' : 'memo' };
        if (matched.kind === 'negated') return { outcome: this.paperOpen ? 'pass' : 'memo', label: 'negated' };
        if (matched.kind === 'undo' || matched.kind === 'wrong') return this.undo(matched.kind === 'wrong');
        if (matched.kind === 'redo') return this.redo();
        if (matched.kind === 'task-seed') return this.seed(utterance);
        if (matched.kind !== 'plan') return { outcome: 'memo' };
        const plan = matched.plan;
        if (this.hand.busy(plan.surface)) {
            this.say('手で操作中のため見送りました');
            return { outcome: 'memo' };
        }
        const now = Date.now();
        this.actionTimes.splice(0, this.actionTimes.findIndex(at => at >= now - 10000) < 0 ? this.actionTimes.length : this.actionTimes.findIndex(at => at >= now - 10000));
        if (this.actionTimes.length >= 5) return { outcome: 'memo' };
        const key = `${plan.actionId}:${JSON.stringify(plan.value)}`;
        if (this.lastAction?.key === key && now - this.lastAction.at < 3000) return { outcome: 'handled', label: plan.label };
        if (plan.actionId === 'browser.search') {
            let seen = false;
            try { seen = localStorage.getItem(CONFIRM_KEY) === '1'; } catch { /* 確認する */ }
            if (!seen) return this.confirm(plan, utterance, '検索の言葉がウェブの検索サービスに送られます。続けますか');
        }
        if (plan.actionId === 'roughCanvas.submit') return this.confirm(plan, utterance, 'この内容を送りますか');
        if (plan.replace) return this.replace(plan, utterance);
        return this.execute(plan, utterance);
    }
    protected async replace(plan: JevPlan, utterance: EarUtterance): Promise<JevRouteResult> {
        const previous = [...this.ledger].reverse().find(item => !item.undone);
        if (previous?.planId !== 'A1' || !previous.inverse.length) return { outcome: 'memo' };
        try {
            for (const step of previous.inverse) await this.commands.executeCommand(step.commandId, step.args);
            const result = await this.execute(plan, utterance);
            if (result.outcome === 'handled') {
                this.ledger.splice(this.ledger.indexOf(previous), 1);
                this.now.markActionUndone(previous.id);
            } else for (const step of previous.commands) await this.commands.executeCommand(step.commandId, step.args);
            return result;
        } catch { return { outcome: 'memo' }; }
    }
    protected confirm(plan: JevPlan, utterance: EarUtterance, line: string): JevRouteResult {
        const status = this.dock.status.set(line, 'warn', 'jev', [
            { label: 'はい', run: () => { const pending = this.clearPending(false); if (pending) {
                void this.executeConfirmed(pending);
            } } },
            { label: 'いいえ', run: () => { this.clearPending(true); this.say('見送りました'); } }
        ]);
        if (this.dock.layout === 'closed') this.dock.setLayout('open');
        const timer = setTimeout(() => { this.clearPending(true); this.say('確認がなかったため見送りました'); }, 8000);
        this.pending = { plan, utterance, status, timer };
        return { outcome: 'handled', label: line };
    }
    protected steps(plan: JevPlan): CommandStep[] | undefined {
        const action = actionById.get(plan.actionId);
        const value = (plan.actionId === 'B4' || plan.actionId === 'B4.pause')
            ? { ...plan.value, editUri: this.playback.editUri } : plan.value;
        if (!action || !validateValue(action.valueSchema as unknown as JevValueSchema, value)) return undefined;
        return action.commands.map(command => {
            const args: Record<string, unknown> = {};
            if ('argsMap' in command && command.argsMap) for (const [key, source] of Object.entries(command.argsMap)) {
                args[key] = source.split('.').slice(1).reduce<unknown>((part, name) =>
                    part && typeof part === 'object' ? (part as Record<string, unknown>)[name] : undefined, value);
            } else Object.assign(args, value);
            if ((command.commandId === 'akari.preview.play' || command.commandId === 'akari.preview.pause') && this.playback.editUri) {
                args.editUri = this.playback.editUri;
            }
            if (command.commandId === 'akari.preview.seekOutput' && this.playback.editUri) args.editUri = this.playback.editUri;
            return { commandId: command.commandId, args };
        });
    }
    protected async snapshot(): Promise<CatalogView | undefined> {
        try { return await this.commands.executeCommand<CatalogView>('akari.catalog.getView'); } catch { return undefined; }
    }
    protected inverse(plan: JevPlan, before: CatalogView | undefined, result: unknown): CommandStep[] {
        const previous = result && typeof result === 'object' ? (result as { previous?: unknown }).previous : undefined;
        if (['A1', 'A2', 'A3', 'A4', 'A5', 'A7', 'A8'].includes(plan.actionId) && before) return [
            { commandId: 'akari.catalog.setMaterialFilter', args: { kind: before.materials.kinds } },
            { commandId: 'akari.catalog.setMaterialSort', args: before.materials.sort },
            { commandId: 'akari.catalog.setMaterialQuery', args: { query: before.materials.query } },
            { commandId: 'akari.library.setFilter', args: { source: before.library.source,
                price: before.library.price, license: before.library.license, status: before.library.status } },
            { commandId: 'akari.catalog.open', args: { tab: 'library', query: before.library.query,
                ...(before.library.category ? { category: before.library.category } : {}) } },
            ...(before.tab === 'project' ? [{ commandId: 'akari.catalog.open', args: {
                tab: 'project', query: before.materials.query } }] : [])
        ];
        if (plan.actionId === 'B3') return [
            { commandId: 'akari.timeline.seek', args: { seconds: this.playback.time } },
            { commandId: 'akari.preview.seekOutput', args: { time: this.playback.time, editUri: this.playback.editUri } }
        ];
        if (plan.actionId === 'B4' || plan.actionId === 'B4.pause') return [{
            commandId: this.playback.playing ? 'akari.preview.play' : 'akari.preview.pause', args: { editUri: this.playback.editUri }
        }];
        if (plan.actionId === 'roughCanvas.open') return [{ commandId: 'akari.sketch.close', args: {} }];
        if (plan.actionId === 'browser.search') return [{ commandId: 'akari.browser.close', args: {} }];
        if (plan.actionId === 'browser.pickMode') return [{ commandId: 'akari.browser.pickMode', args: { on: !plan.value.on } }];
        if (previous && typeof previous === 'object' && 'kind' in previous) return [{ commandId: 'akari.catalog.setMaterialFilter', args: { kind: (previous as { kind: unknown }).kind } }];
        return [];
    }
    protected async execute(plan: JevPlan, utterance: EarUtterance): Promise<JevRouteResult> {
        const steps = this.steps(plan);
        if (!steps?.length) return { outcome: 'memo' };
        if (['B3', 'B4', 'B4.pause'].includes(plan.actionId) && !this.playback.editUri) return { outcome: 'memo' };
        const before = await this.snapshot();
        if (['A1', 'A2', 'A3', 'A4', 'A5', 'A7', 'A8'].includes(plan.actionId) && !before) {
            this.say('画面の状態を読めませんでした', 'warn');
            return { outcome: 'memo' };
        }
        if (plan.actionId === 'A7' && before?.materials.query) {
            steps.push({ commandId: 'akari.catalog.setMaterialQuery', args: { query: '' } });
        }
        const inverse = this.inverse(plan, before, undefined);
        let attempted = 0;
        let failureLine = '操作できませんでした';
        const previousMark = this.dock.mark;
        this.dock.setMark('acting');
        try {
            let result: unknown;
            for (const step of steps) {
                attempted++;
                result = await this.commands.executeCommand(step.commandId, step.args);
                if (result && typeof result === 'object' && (result as { matched?: boolean }).matched === false) {
                    failureLine = '見つかりませんでした';
                    throw new Error(failureLine);
                }
                if (result && typeof result === 'object' && (result as { ok?: boolean }).ok === false) {
                    const message = (result as { message?: unknown }).message;
                    failureLine = typeof message === 'string' && message.trim() ? message : failureLine;
                    throw new Error(failureLine);
                }
                // catalog.open の boolean はカテゴリ/カードの指定が有効かを示す。検索結果 0 件でも true。
                if (result === false && step.commandId === 'akari.catalog.open') failureLine = '見つかりませんでした';
                if (result === false || result === 'mismatched-asset') throw new Error(failureLine);
            }
            if (plan.actionId === 'browser.search') {
                try { localStorage.setItem(CONFIRM_KEY, '1'); } catch { /* 次回も確認する */ }
            }
            const undoSteps = inverse.length ? inverse : this.inverse(plan, before, result);
            const resultView = plan.actionId.startsWith('A') ? await this.snapshot() : undefined;
            const entry: LedgerEntry = { id: `jev-${++this.sequence}`, at: Date.now(), utterance: utterance.text,
                planId: plan.actionId, label: plan.label, commands: steps, inverse: undoSteps,
                tier: Number(actionById.get(plan.actionId)?.tierMax ?? 1), undone: false, resultView };
            this.ledger.push(entry);
            if (this.ledger.length > 20) this.ledger.shift();
            this.latestUndone = undefined;
            this.undoStreak = 0;
            this.actionTimes.push(entry.at);
            this.lastAction = { key: `${plan.actionId}:${JSON.stringify(plan.value)}`, at: entry.at };
            const undo = undoSteps.length ? () => { void this.undoEntry(entry); } : undefined;
            this.now.acceptAction(`やりました: ${plan.label}`, '操作', entry.id, undo);
            this.say(`やりました: ${plan.label}`, 'info', undo ? [{ label: '戻す', run: undo }] : undefined);
            return { outcome: 'handled', label: plan.label, entryId: entry.id };
        } catch {
            // 失敗を返す前に画面を変更し得るため、失敗したステップも含めて事前状態へ戻す。
            let browserCloseAttempted = false;
            if (attempted) {
                for (const step of inverse) {
                    try {
                        await this.commands.executeCommand(step.commandId, step.args);
                        if (step.commandId === 'akari.browser.close') browserCloseAttempted = true;
                    } catch { /* 元の失敗を優先 */ }
                }
            }
            if (plan.actionId === 'browser.search' && !browserCloseAttempted) {
                try { await this.commands.executeCommand('akari.browser.close', {}); } catch { /* 後始末を続ける */ }
            }
            this.say(failureLine, 'warn');
            return { outcome: 'memo' };
        } finally { this.dock.setMark(previousMark); }
    }
    protected async undoEntry(entry: LedgerEntry): Promise<{ undone: boolean; stopped: boolean }> {
        if (entry.undone || !entry.inverse.length) return { undone: false, stopped: false };
        try {
            const currentView = entry.resultView ? await this.snapshot() : undefined;
            const changed = currentView && JSON.stringify(currentView) !== JSON.stringify(entry.resultView);
            if (entry.planId === 'task-seed') {
                const board = await this.commands.executeCommand<{ rows?: Array<{ id: string; state: string }> }>('akari.tasks.nextRows');
                const taskId = entry.inverse[0].args.id;
                if (!board?.rows?.some(row => row.id === taskId && row.state === 'unsent')) {
                    this.say('もう始まっています', 'warn');
                    return { undone: false, stopped: false };
                }
            }
            for (const step of entry.inverse) await this.commands.executeCommand(step.commandId, step.args);
            entry.undone = true;
            this.latestUndone = entry;
            this.now.markActionUndone(entry.id);
            this.say(changed ? '手で変えた後なので、変える前の状態に戻しました' : '元に戻しました');
            const at = Date.now();
            this.undoTimes.push(at);
            this.undoStreak++;
            while (this.undoTimes[0] < at - 60000) this.undoTimes.shift();
            const stopped = this.undoStreak >= 3 || this.undoTimes.length >= 3;
            if (stopped) {
                await this.preferences.set(VIBE_MODE_KEY, 'off', PreferenceScope.User);
                this.say('Jev を止めました。続けるときは設定の聞き取りから', 'warn', undefined, 0);
            }
            return { undone: true, stopped };
        } catch { this.say('元に戻せませんでした', 'warn'); return { undone: false, stopped: false }; }
    }
    protected async undo(wrong: boolean): Promise<JevRouteResult> {
        const entry = [...this.ledger].reverse().find(item => !item.undone && item.inverse.length);
        if (!entry) { this.say('戻せる操作がありません'); return { outcome: 'memo' }; }
        const result = await this.undoEntry(entry);
        if (wrong && result.undone && !result.stopped) this.say('もう一度言ってください', 'warn');
        return { outcome: result.undone ? 'handled' : 'memo', entryId: entry.id };
    }
    protected async redo(): Promise<JevRouteResult> {
        const entry = this.latestUndone;
        if (!entry || entry.planId === 'task-seed') return { outcome: 'memo' };
        try {
            for (const step of entry.commands) await this.commands.executeCommand(step.commandId, step.args);
            entry.undone = false;
            this.latestUndone = undefined;
            this.now.markActionRedone(entry.id);
            this.say(`やりました: ${entry.label}`);
            return { outcome: 'handled', entryId: entry.id };
        } catch { return { outcome: 'memo' }; }
    }
    protected async seed(utterance: EarUtterance): Promise<JevRouteResult> {
        try {
            const created = await this.commands.executeCommand<{ id?: string }>('akari.tasks.create',
                { text: utterance.text, via: 'voice' });
            if (!created?.id) return { outcome: 'memo' };
            const id = `jev-${++this.sequence}`;
            const entry: LedgerEntry = { id, at: Date.now(), utterance: utterance.text, planId: 'task-seed',
                label: 'タスクの種', commands: [], inverse: [{ commandId: 'akari.tasks.dismiss', args: { id: created.id } }],
                tier: 3, undone: false };
            this.ledger.push(entry);
            if (this.ledger.length > 20) this.ledger.shift();
            this.now.acceptAction(`タスクにしました: ${utterance.text}`, 'タスク', id, () => { void this.undoEntry(entry); });
            this.say('タスクにしました（自動では実行しません）');
            return { outcome: 'handled', entryId: id };
        } catch { return { outcome: 'memo' }; }
    }
}
