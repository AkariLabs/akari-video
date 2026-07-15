import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangeType } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';

export const PTY_IDLE_THRESHOLD_MS = 1500;
const EVENT_SETTLE_DELAY_MS = 60;
const PARTNER_TERMINAL_KIND = 'akari-partner';

interface AkariEvent {
    type: string;
    at: string;
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
            if (typeof parsed.type !== 'string' || typeof parsed.at !== 'string' || Number.isNaN(Date.parse(parsed.at))) {
                console.warn('[akari-partner] invalid event schema; skipped:', resource.toString());
                return;
            }
            if (parsed.path !== undefined && typeof parsed.path !== 'string') {
                console.warn('[akari-partner] invalid event path; skipped:', resource.toString());
                return;
            }
            this.processedContent.set(resource.toString(), content);
            this.queue.push(this.nudgeFor(parsed as AkariEvent));
            this.scheduleFlush();
        } catch (error) {
            console.warn('[akari-partner] invalid event JSON; skipped:', resource.toString(), error);
        }
    }

    protected nudgeFor(event: AkariEvent): string {
        const safePath = event.path?.replace(/[\r\n]+/g, ' ').trim();
        return safePath
            ? `回答が更新されました: ${safePath} を確認してください`
            : `AKARI イベント (${event.type}) が更新されました。内容を確認してください`;
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
