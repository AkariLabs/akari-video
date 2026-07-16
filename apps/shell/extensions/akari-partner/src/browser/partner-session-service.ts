import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangeType } from '@theia/filesystem/lib/common/files';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { AkariPartnerServer } from '../common/akari-partner-protocol';

export const PTY_IDLE_THRESHOLD_MS = 1500;
const EVENT_SETTLE_DELAY_MS = 60;
const PARTNER_TERMINAL_KIND = 'akari-partner';
const RENDER_PINS_RELATIVE = '.akari/render-pins.json';

interface AkariEvent {
    type: string;
    // Canonical events use `occurredAt`; older fixtures used `at`. Accept both.
    occurredAt?: string;
    at?: string;
    // The subject path lives under `asset` (video-added) or `artifact` (gate events).
    asset?: string;
    artifact?: string;
    path?: string;
}

@injectable()
export class PartnerSessionService implements FrontendApplicationContribution {

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(TerminalService)
    protected readonly terminalService!: TerminalService;

    @inject(AkariPartnerServer)
    protected readonly partnerServer!: AkariPartnerServer;

    protected terminal?: TerminalWidget;
    protected terminalDisposables = new DisposableCollection();
    protected workspaceDisposables = new DisposableCollection();
    protected queue: string[] = [];
    protected lastOutputAt = 0;
    protected idleTimer?: ReturnType<typeof setTimeout>;
    protected processedContent = new Map<string, string>();

    async onStart(): Promise<void> {
        this.terminalService.all.forEach(terminal => this.observeTerminal(terminal));
        this.terminalService.onDidCreateTerminal(terminal => this.observeTerminal(terminal));
        this.workspaceService.onWorkspaceChanged(() => this.watchWorkspace());
        await this.workspaceService.ready;
        await this.watchWorkspace();
    }

    useTerminal(terminal: TerminalWidget): void {
        this.observeTerminal(terminal);
    }

    protected observeTerminal(terminal: TerminalWidget): void {
        if (terminal.kind !== PARTNER_TERMINAL_KIND) {
            return;
        }
        this.terminalDisposables.dispose();
        this.terminalDisposables = new DisposableCollection();
        this.terminal = terminal;
        this.lastOutputAt = 0;
        this.terminalDisposables.push(terminal.onOutput(() => {
            this.lastOutputAt = Date.now();
            this.scheduleFlush();
        }));
        this.terminalDisposables.push(terminal.onTerminalDidClose(() => {
            if (this.terminal === terminal) {
                this.terminal = undefined;
            }
        }));
        this.scheduleFlush();
    }

    protected async watchWorkspace(): Promise<void> {
        this.workspaceDisposables.dispose();
        this.workspaceDisposables = new DisposableCollection();
        const roots = await this.workspaceService.roots;
        for (const root of roots) {
            void this.ensureRenderPins(root.resource);
            const eventDirectory = root.resource.resolve('.akari/events');
            this.workspaceDisposables.push(this.fileService.watch(root.resource, { recursive: true, excludes: [] }));
            this.workspaceDisposables.push(this.fileService.onDidFilesChange(event => {
                for (const change of event.changes) {
                    if (change.type === FileChangeType.DELETED || !this.isEventJson(change.resource, eventDirectory)) {
                        continue;
                    }
                    setTimeout(() => this.readEvent(change.resource), EVENT_SETTLE_DELAY_MS);
                }
            }));
        }
    }

    protected isEventJson(resource: URI, eventDirectory: URI): boolean {
        const directory = eventDirectory.toString().replace(/\/$/, '') + '/';
        return resource.toString().startsWith(directory) && resource.path.ext === '.json';
    }

    protected async readEvent(resource: URI): Promise<void> {
        try {
            const content = (await this.fileService.read(resource)).value;
            if (this.processedContent.get(resource.toString()) === content) {
                return;
            }
            const parsed = JSON.parse(content) as Partial<AkariEvent>;
            const timestamp = parsed.occurredAt ?? parsed.at;
            if (typeof parsed.type !== 'string' || typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
                console.warn('[akari-partner] invalid event schema; skipped:', resource.toString());
                return;
            }
            for (const field of ['asset', 'artifact', 'path'] as const) {
                if (parsed[field] !== undefined && typeof parsed[field] !== 'string') {
                    console.warn('[akari-partner] invalid event subject; skipped:', resource.toString());
                    return;
                }
            }
            this.processedContent.set(resource.toString(), content);
            this.queue.push(this.nudgeFor(parsed as AkariEvent));
            this.scheduleFlush();
        } catch (error) {
            console.warn('[akari-partner] invalid event JSON; skipped:', resource.toString(), error);
        }
    }

    /**
     * Name the next concrete step per event type (contract §5). Wording is Japanese,
     * user-visible vocabulary — no git/json jargon; role directories and skill names
     * only. Covers workflow.json gateTypes plus the `video-added` entry event.
     */
    protected nudgeFor(event: AkariEvent): string {
        const subject = this.sanitize(event.asset ?? event.artifact ?? event.path);
        switch (event.type) {
            case 'video-added':
                return subject
                    ? `${subject} が追加されました。analyze-footage スキルで分析を開始してください。`
                    : '新しい素材が追加されました。analyze-footage スキルで分析を開始してください。';
            case 'report-generated':
                return subject
                    ? `レポートを作成しました（${subject}）。内容を確認し、問題なければ承認してください。`
                    : 'レポートを作成しました。内容を確認し、問題なければ承認してください。';
            case 'report-approved':
                return 'レポートが承認されました。edit-plan スキルで編集を進めてください。';
            case 'edit-completed':
                return '編集が完了しました。プレビューで仕上がりを確認し、必要ならテロップ等を overlay-authoring スキルで調整してください。';
            case 'export-completed':
                return subject
                    ? `書き出しが完了しました（${subject}）。exports フォルダーで最終版を確認してください。`
                    : '書き出しが完了しました。exports フォルダーで最終版を確認してください。';
            default:
                return subject
                    ? `${subject} が更新されました。内容を確認し、次の一手を進めてください。`
                    : `更新がありました（${event.type}）。内容を確認し、次の一手を進めてください。`;
        }
    }

    protected sanitize(value: string | undefined): string | undefined {
        const trimmed = value?.replace(/[\r\n]+/g, ' ').trim();
        return trimmed ? trimmed : undefined;
    }

    /**
     * Record the rendering-asset version pins the app currently ships (contract §6 —
     * 器まで). Written once per project (write-if-absent) since a pin is a
     * reproducibility record: it should stay at the version present when first seen.
     */
    protected async ensureRenderPins(root: URI): Promise<void> {
        const target = root.resolve(RENDER_PINS_RELATIVE);
        try {
            // Only record pins inside an actual AKARI project. Gating on the workflow
            // marker keeps us from scaffolding `.akari/` into an unrelated folder (F17).
            if (!(await this.fileService.exists(root.resolve('.akari/workflow.json')))) {
                return;
            }
            if (await this.fileService.exists(target)) {
                return;
            }
            const pins = await this.partnerServer.getRenderPins();
            const body = {
                version: pins.version,
                pins: pins.pins,
                recordedAt: new Date().toISOString()
            };
            await this.fileService.createFile(
                target,
                BinaryBuffer.fromString(JSON.stringify(body, null, 2) + '\n'),
                { overwrite: false }
            );
        } catch (error) {
            console.warn('[akari-partner] render pin write skipped:', error);
        }
    }

    protected scheduleFlush(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        if (!this.terminal || this.queue.length === 0) {
            return;
        }
        const wait = Math.max(0, PTY_IDLE_THRESHOLD_MS - (Date.now() - this.lastOutputAt));
        this.idleTimer = setTimeout(() => this.flushIfIdle(), wait);
    }

    protected flushIfIdle(): void {
        if (!this.terminal || this.queue.length === 0) {
            return;
        }
        const elapsed = Date.now() - this.lastOutputAt;
        if (this.lastOutputAt > 0 && elapsed < PTY_IDLE_THRESHOLD_MS) {
            this.scheduleFlush();
            return;
        }
        const message = this.queue.shift();
        if (message) {
            this.terminal.sendText(`${message}\r`);
            console.info('[akari-partner] PTY nudge sent:', message);
        }
        this.scheduleFlush();
    }
}

export const PartnerTerminal = {
    KIND: PARTNER_TERMINAL_KIND
};
