import { guardInitLayout } from 'akari-theme/lib/browser/init-layout-guard';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { AkariDeveloperModeService } from './akari-developer-mode-service';
import { AkariScopeService } from './akari-scope-service';
import { readRightRailLastTab, rightRailWidgetForTab } from './right-rail-last-tab';

const OUTLINE_WIDGET_ID = 'outline-view';
const OUTLINE_WIDGET_RANK = 500;
const PROJECT_WIDGET_IDS = new Set([
    'akari-inspector-widget', 'akari-daihon-widget', 'akari-review-panel-widget',
    'akari-session-viewer-widget', 'akari-audio-meter-widget'
]);

/**
 * F7: 右パネルは denylist 方式で Outline だけを可逆的に外す。
 * widget を dispose せず DockPanel から detach して保持するため、developer mode
 * ON への切替時に同じ instance を再追加できる。パートナー等の他 widget には触れない。
 */
@injectable()
export class AkariRightPanelCuration implements FrontendApplicationContribution {

    @inject(AkariDeveloperModeService)
    protected readonly developerMode!: AkariDeveloperModeService;
    @inject(AkariScopeService)
    protected readonly scope!: AkariScopeService;

    protected shell: ApplicationShell | undefined;
    protected hiddenOutline: Widget | undefined;
    protected restoringOutline = false;
    protected readonly loggedIds = new Set<string>();
    protected readonly hiddenProject = new Map<string, { widget: Widget; rank: number }>();
    protected restoringProject = false;

    onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-shell-strip', () => {
            this.shell = app.shell;
            this.reconcile('onDidInitializeLayout');
            if (this.scope?.scope === 'project') void this.restoreLastTab();
            app.shell.onDidAddWidget(widget => this.reconcile(`onDidAddWidget:${widget.id}`));
            this.developerMode.onDidChange(enabled => this.reconcile(`developerMode:${enabled}`));
            this.scope?.onDidChangeScope(scope => {
                this.reconcile(`scope:${scope}`);
                if (scope === 'project' && !this.restoringProject) void this.restoreLastTab();
            });
        });
    }

    protected reconcile(trigger: string): void {
        const shell = this.shell;
        if (!shell) {
            return;
        }

        const rightPanel = shell.rightPanelHandler;
        const rightWidgets = Array.from(rightPanel.dockPanel.widgets());
        if (this.scope.scope === 'channel') {
            rightWidgets.forEach((widget, rank) => {
                if (PROJECT_WIDGET_IDS.has(widget.id) && !widget.isDisposed) {
                    this.hiddenProject.set(widget.id, { widget, rank });
                    widget.parent = null;
                }
            });
        } else if (!this.restoringProject && this.hiddenProject.size) {
            this.restoringProject = true;
            void (async () => {
                for (const [id, { widget, rank }] of [...this.hiddenProject].sort((a, b) => a[1].rank - b[1].rank)) {
                    if (!widget.isDisposed && !widget.isAttached) await shell.addWidget(widget, { area: 'right', rank });
                    this.hiddenProject.delete(id);
                }
            })().finally(() => {
                this.restoringProject = false;
                void this.restoreLastTab();
            });
        }
        for (const title of Array.from(rightPanel.tabBar.titles)) {
            const id = title.owner.id;
            if (!this.loggedIds.has(id)) {
                this.loggedIds.add(id);
                console.info(
                    `[akari-shell-strip] right panel widget observed (trigger=${trigger}):`,
                    JSON.stringify({ id, label: title.label })
                );
            }
        }

        if (this.developerMode.isEnabled) {
            const outline = this.hiddenOutline;
            if (!outline || outline.isDisposed || rightWidgets.includes(outline) || this.restoringOutline) {
                if (outline?.isDisposed || (outline && rightWidgets.includes(outline))) {
                    this.hiddenOutline = undefined;
                }
                return;
            }
            this.restoringOutline = true;
            void shell.addWidget(outline, { area: 'right', rank: OUTLINE_WIDGET_RANK }).then(() => {
                this.hiddenOutline = undefined;
                console.info(`[akari-shell-strip] restored right panel widget (trigger=${trigger}):`, OUTLINE_WIDGET_ID);
            }).finally(() => {
                this.restoringOutline = false;
            });
            return;
        }

        const outline = rightWidgets.find(widget => widget.id === OUTLINE_WIDGET_ID);
        if (!outline || outline.isDisposed) {
            return;
        }
        this.hiddenOutline = outline;
        // Lumino の parent=null は DockPanel の widgetRemoved を発火し、tab も同期して
        // 外すが Widget 自体は dispose しない。developer mode ON で再利用可能。
        outline.parent = null;
        console.info(`[akari-shell-strip] hid right panel widget without disposing (trigger=${trigger}):`, OUTLINE_WIDGET_ID);
    }

    protected async restoreLastTab(): Promise<void> {
        const shell = this.shell;
        if (!shell || this.scope.scope !== 'project') return;
        let last;
        try { last = readRightRailLastTab(window.localStorage); } catch { return; }
        if (!last) return;
        const ids = Array.from(shell.rightPanelHandler.dockPanel.widgets()).filter(widget => {
            if (widget.id.startsWith('terminal-')) {
                const terminal = widget as Widget & { exitStatus?: unknown; terminalId?: number };
                return !terminal.exitStatus && (terminal.terminalId ?? -1) >= 0;
            }
            if (widget.id === 'akari-partner-web') {
                const web = widget as Widget & { isRunning?: () => boolean };
                return web.isRunning?.() === true;
            }
            return true;
        }).map(widget => widget.id);
        const id = rightRailWidgetForTab(last, ids);
        if (id) await shell.revealWidget(id);
    }
}
