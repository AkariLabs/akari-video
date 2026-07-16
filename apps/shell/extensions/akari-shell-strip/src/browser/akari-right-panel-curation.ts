import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { AkariDeveloperModeService } from './akari-developer-mode-service';

const OUTLINE_WIDGET_ID = 'outline-view';
const OUTLINE_WIDGET_RANK = 500;

/**
 * F7: 右パネルは denylist 方式で Outline だけを可逆的に外す。
 * widget を dispose せず DockPanel から detach して保持するため、developer mode
 * ON への切替時に同じ instance を再追加できる。パートナー等の他 widget には触れない。
 */
@injectable()
export class AkariRightPanelCuration implements FrontendApplicationContribution {

    @inject(AkariDeveloperModeService)
    protected readonly developerMode!: AkariDeveloperModeService;

    protected shell: ApplicationShell | undefined;
    protected hiddenOutline: Widget | undefined;
    protected restoringOutline = false;
    protected readonly loggedIds = new Set<string>();

    onDidInitializeLayout(app: FrontendApplication): void {
        this.shell = app.shell;
        this.reconcile('onDidInitializeLayout');
        app.shell.onDidAddWidget(widget => this.reconcile(`onDidAddWidget:${widget.id}`));
        this.developerMode.onDidChange(enabled => this.reconcile(`developerMode:${enabled}`));
    }

    protected reconcile(trigger: string): void {
        const shell = this.shell;
        if (!shell) {
            return;
        }

        const rightPanel = shell.rightPanelHandler;
        const rightWidgets = Array.from(rightPanel.dockPanel.widgets());
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
                if (outline?.isDisposed || rightWidgets.includes(outline)) {
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
}
