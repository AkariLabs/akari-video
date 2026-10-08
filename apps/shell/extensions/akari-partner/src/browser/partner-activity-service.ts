import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContextKey, ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { PartnerActivityState } from '../common/partner-activity-state';
import { PartnerTerminal } from './partner-session-service';

export const PARTNER_BUSY_CONTEXT_KEY = 'akari.partner.busy';

@injectable()
export class PartnerActivityService implements FrontendApplicationContribution {
    @inject(TerminalService) protected readonly terminals!: TerminalService;
    @inject(ContextKeyService) protected readonly contextKeys!: ContextKeyService;

    protected readonly state = new PartnerActivityState();
    protected readonly changed = new Emitter<boolean>();
    readonly onDidChange: Event<boolean> = this.changed.event;
    protected readonly watched = new WeakSet<TerminalWidget>();
    protected readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    protected busyKey?: ContextKey<boolean>;

    get anyBusy(): boolean { return this.state.anyBusy; }
    isBusy(id: string): boolean { return this.state.isBusy(id); }

    onStart(): void {
        this.busyKey = this.contextKeys.createKey<boolean>(PARTNER_BUSY_CONTEXT_KEY, false);
        this.terminals.all.forEach(terminal => this.observe(terminal));
        this.terminals.onDidCreateTerminal(terminal => this.observe(terminal));
    }

    protected publish(): void {
        this.busyKey?.set(this.anyBusy);
        this.changed.fire(this.anyBusy);
    }

    protected observe(terminal: TerminalWidget): void {
        if (terminal.kind !== PartnerTerminal.KIND || this.watched.has(terminal)) return;
        this.watched.add(terminal);
        const id = terminal.id;
        terminal.onOutput(chunk => {
            if (this.state.feed(id, chunk, Date.now())) this.publish();
            this.schedule(id);
        });
        terminal.onTerminalDidClose(() => {
            this.clearTimer(id);
            if (this.state.close(id)) this.publish();
        });
    }

    protected clearTimer(id: string): void {
        const timer = this.timers.get(id);
        if (timer) clearTimeout(timer);
        this.timers.delete(id);
    }

    protected schedule(id: string): void {
        this.clearTimer(id);
        const delay = this.state.nextCheckDelayMs(id, Date.now());
        if (delay === undefined) return;
        this.timers.set(id, setTimeout(() => {
            this.timers.delete(id);
            if (this.state.checkTurnEnd(id, Date.now())) this.publish();
            else this.schedule(id);
        }, delay + 50));
    }
}
