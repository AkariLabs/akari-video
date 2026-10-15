import { t } from '../common/project-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, FrontendApplication, FrontendApplicationContribution, Widget } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariProjectService } from '../common/akari-project-protocol';
import { GateRequestedEvent } from '../common/automation-events';

const STYLE = `#theia-top-panel{flex-direction:column}
    #theia-top-panel.akari-gate-visible{height:calc(var(--akari-title-height,40px) + var(--akari-gate-height,0px)) !important;
        min-height:calc(var(--akari-title-height,40px) + var(--akari-gate-height,0px)) !important}
    #theia-top-panel.akari-gate-visible > #theia-drag-panel{height:var(--akari-title-height,40px) !important;
        flex:0 0 var(--akari-title-height,40px)}
    #theia-top-panel > #akari-gate-band-widget{flex:0 0 auto;width:100%;box-sizing:border-box;
        -webkit-app-region:no-drag}
    .akari-gate-band.lm-mod-hidden{display:none}
    .akari-gate-band{box-sizing:border-box;border:1px solid var(--theia-focusBorder);
    border-radius:10px;background:var(--theia-sideBar-background);color:var(--theia-foreground);
    padding:12px 15px;display:flex;align-items:center;gap:12px}
    .akari-gate-band .copy{flex:1;min-width:0}.akari-gate-band strong{font-size:13px}
    .akari-gate-band p{font-size:12px;margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
    .akari-gate-band .controls{display:flex;gap:6px;flex-wrap:wrap}
    .akari-gate-band button{cursor:pointer}
    @media(max-width:640px){.akari-gate-band{align-items:flex-start;flex-direction:column}}`;

/** Independent of the Home React tree, so refreshes cannot dismiss a pending request. */
@injectable()
export class AutomationGateBand implements FrontendApplicationContribution {
    @inject(AkariProjectService) protected readonly service!: AkariProjectService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    private root?: string;
    private gates: GateRequestedEvent[] = [];
    private index = 0;
    private host?: HTMLElement;
    private widget?: Widget;
    private shell?: ApplicationShell;
    private resizeObserver?: ResizeObserver;
    private watchGeneration = 0;
    private refreshing = false;
    private refreshQueued = false;
    private resolving = false;

    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        // onStart precedes attachShell; add the Lumino widget only after the shell is attached.
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);
        this.shell = app.shell;
        const widget = new Widget({ tag: 'section' });
        widget.id = 'akari-gate-band-widget';
        this.widget = widget;
        this.host = widget.node;
        widget.addClass('akari-gate-band');
        this.host.dataset.akariGateBand = 'true';
        this.host.setAttribute('role', 'region');
        this.host.setAttribute('aria-live', 'polite');
        widget.hide();
        await app.shell.addWidget(widget, { area: 'top' });
        this.resizeObserver = new ResizeObserver(() => this.syncHeight());
        this.resizeObserver.observe(widget.node);
        this.workspace.onWorkspaceChanged(() => void this.watchGates());
        void this.watchGates();
    }

    private async watchGates(): Promise<void> {
        const generation = ++this.watchGeneration;
        const root = (await this.workspace.roots)[0]?.resource.toString();
        await this.refresh();
        if (!root || generation !== this.watchGeneration) return;
        let revision = 0;
        const service = this.service as AkariProjectService & {
            waitForGateChange(projectUri: string, afterRevision: number): Promise<{ revision: number; watching: boolean }>;
        };
        while (generation === this.watchGeneration) {
            try {
                const result = await service.waitForGateChange(root, revision);
                if (generation !== this.watchGeneration) return;
                if (result.revision !== revision || !result.watching) await this.refresh();
                revision = result.revision;
            } catch (error) {
                console.warn('[akari-project] gate watcher unavailable; retrying:', error);
                await new Promise(resolve => setTimeout(resolve, 10000));
                if (generation === this.watchGeneration) await this.refresh();
            }
        }
    }

    private syncHeight(): void {
        const shell = this.shell;
        const widget = this.widget;
        if (!shell || !widget || widget.isHidden) return;
        const height = widget.node.getBoundingClientRect().height;
        if (!height) return;
        const value = `${height}px`;
        if (shell.topPanel.node.style.getPropertyValue('--akari-gate-height') === value) return;
        shell.topPanel.node.style.setProperty('--akari-gate-height', value);
        shell.fit();
    }

    private async refresh(): Promise<void> {
        if (this.resolving) return;
        if (this.refreshing) { this.refreshQueued = true; return; }
        this.refreshing = true;
        try {
            const root = (await this.workspace.roots)[0]?.resource.toString();
            this.root = root;
            this.gates = root ? await this.service.pendingGates(root) : [];
            this.index = Math.min(this.index, Math.max(this.gates.length - 1, 0));
            this.render();
        } catch (error) { console.warn('[akari-project] gate refresh failed:', error); }
        finally {
            this.refreshing = false;
            if (this.refreshQueued) {
                this.refreshQueued = false;
                void this.refresh();
            }
        }
    }

    private async resolve(decision: 'approved' | 'declined'): Promise<void> {
        const gate = this.gates[this.index];
        if (!gate || !this.root || this.resolving) return;
        this.resolving = true;
        try {
            await this.service.resolveGate(this.root, gate.requestId, decision);
        } catch (error) { this.messages.error(String(error)); }
        finally { this.resolving = false; await this.refresh(); }
    }

    private button(label: string, click: () => void, primary = false): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `theia-button ${primary ? '' : 'secondary'}`;
        button.textContent = label;
        button.disabled = this.resolving;
        button.addEventListener('click', click);
        return button;
    }

    private render(): void {
        const host = this.host;
        const widget = this.widget;
        const shell = this.shell;
        if (!host || !widget || !shell) return;
        const gate = this.gates[this.index];
        host.replaceChildren();
        if (!gate) {
            const wasVisible = !widget.isHidden;
            if (wasVisible) widget.hide();
            shell.topPanel.node.classList.remove('akari-gate-visible');
            shell.topPanel.node.style.removeProperty('--akari-gate-height');
            if (wasVisible) shell.fit();
            return;
        }
        const copy = document.createElement('div');
        copy.className = 'copy';
        const title = document.createElement('strong');
        const gateKey = gate.gate.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
        title.textContent = `${t(`project.automation.gate.${gateKey}`)} · ${gate.summary}`;
        copy.appendChild(title);
        if (gate.detail) {
            const detail = document.createElement('p');
            detail.textContent = gate.detail;
            copy.appendChild(detail);
        }
        const controls = document.createElement('div');
        controls.className = 'controls';
        if (this.gates.length > 1) {
            const position = document.createElement('span');
            position.textContent = t('project.automation.gate.position', { current: this.index + 1, total: this.gates.length });
            controls.appendChild(position);
            controls.appendChild(this.button('‹', () => { this.index = (this.index + this.gates.length - 1) % this.gates.length; this.render(); }));
            controls.appendChild(this.button('›', () => { this.index = (this.index + 1) % this.gates.length; this.render(); }));
        }
        controls.appendChild(this.button(t('project.automation.gate.approve'), () => void this.resolve('approved'), true));
        controls.appendChild(this.button(t('project.automation.gate.decline'), () => void this.resolve('declined')));
        controls.appendChild(this.button(t('project.automation.gate.history'), () => void this.commands.executeCommand('akari.project.actionHistory')));
        host.append(copy, controls);
        widget.show();
        shell.topPanel.node.classList.add('akari-gate-visible');
        this.syncHeight();
    }
}
