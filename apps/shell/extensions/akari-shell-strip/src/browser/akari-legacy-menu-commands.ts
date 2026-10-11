import { t } from '../common/shell-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { ConfirmDialog, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariPreviewServerService, PreviewServerStatus } from '../common/preview-server-protocol';
import { AkariProjectCleanService, ProjectCleanInspection } from '../common/project-clean-protocol';
import { buildPreviewOpenUrl } from '../common/preview-server-cli';
import { formatBytes } from './export-dialog/export-view-shared';
import { AkariExportAvailabilityService } from './akari-export-availability-service';
import { AKARI_COMMANDS } from '../common/rail-ids';

@injectable()
export class AkariLegacyMenuCommands implements CommandContribution, FrontendApplicationContribution {
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(AkariPreviewServerService) protected readonly preview!: AkariPreviewServerService;
    @inject(AkariProjectCleanService) protected readonly cleanService!: AkariProjectCleanService;
    @inject(AkariExportAvailabilityService) protected readonly availability!: AkariExportAvailabilityService;
    @inject(WindowService) protected readonly windows!: WindowService;
    @inject(MessageService) protected readonly messages!: MessageService;
    protected previewPoll?: number;
    protected previewBusy = false;
    protected cleanBusy = false;

    onStart(): void {
        this.workspace.onWorkspaceChanged(() => {
            this.stopPolling();
            void this.preview.stop().catch(error => console.warn('[akari-shell-strip] プレビュー停止に失敗:', error));
        });
    }

    onStop(): void { this.stopPolling(); }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: AKARI_COMMANDS.railToggleExpanded, label: t('shell.menu.commands.expandLeftRailText') }, {
            execute: () => {
                if (document.body.hasAttribute('data-akari-rail-expanded')) document.body.removeAttribute('data-akari-rail-expanded');
                else document.body.setAttribute('data-akari-rail-expanded', 'true');
            }
        });
        registry.registerCommand({ id: AKARI_COMMANDS.previewServerOpen, label: t('shell.menu.commands.openBrowserPreviewAction') }, {
            execute: () => this.openPreview()
        });
        registry.registerCommand({ id: AKARI_COMMANDS.projectCleanData, label: t('shell.menu.commands.cleanUpUnusedDataText') }, {
            execute: () => this.cleanProject()
        });
    }

    protected async openPreview(): Promise<void> {
        if (this.previewBusy) return;
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root) { void this.messages.info(t('shell.menu.commands.openProjectStartBrowserPreviewMessage')); return; }
        if (!(await this.availability.refresh()).exists) {
            void this.messages.info(t('shell.menu.commands.noEditJsonYetContinueEditingPreviewingMessage'));
            return;
        }
        this.previewBusy = true;
        try {
            let status = await this.preview.getStatus();
            if (status.phase !== 'running' || status.projectRootUri !== root.toString()) {
                this.beginPolling();
                status = await this.preview.start({ projectRootUri: root.toString() });
            }
            if (this.workspace.tryGetRoots()[0]?.resource.toString() !== root.toString()) return;
            if (status.phase === 'running' && status.url) {
                this.windows.openNewWindow(buildPreviewOpenUrl(status.url, 'latest'), { external: true });
                this.beginPolling();
            } else {
                this.stopPolling();
                void this.messages.info(status.failureSummary ?? t('shell.menu.commands.couldNotStartBrowserPreviewError'));
            }
        } catch (error) {
            this.stopPolling();
            void this.messages.info(t('shell.menu.commands.browserPreviewFailedWithReasonError', { value1: String(error) }));
        } finally { this.previewBusy = false; }
    }

    protected beginPolling(): void {
        if (this.previewPoll !== undefined) return;
        this.previewPoll = window.setInterval(() => {
            void this.preview.getStatus().then((status: PreviewServerStatus) => {
                if (status.phase !== 'starting' && status.phase !== 'running') this.stopPolling();
            }).catch(() => this.stopPolling());
        }, 1000);
    }

    protected stopPolling(): void {
        if (this.previewPoll !== undefined) window.clearInterval(this.previewPoll);
        this.previewPoll = undefined;
    }

    protected async cleanProject(): Promise<void> {
        if (this.cleanBusy) return;
        this.cleanBusy = true;
        try {
            const root = (await this.workspace.roots)[0]?.resource;
            if (!root) { void this.messages.info(t('shell.menu.commands.openProjectCleaningUpText')); return; }
            const inspected = await this.cleanService.inspect(root.toString());
            const inspection = inspected.inspection;
            if (!inspected.ok || !inspection) { void this.messages.info(inspected.reason ?? t('shell.menu.commands.couldNotInspectProjectError')); return; }
            if (!inspection.disposable.length) { void this.messages.info(this.describeNothingToClean(inspection)); return; }
            const confirmed = await new ConfirmDialog({
                title: t('shell.menu.commands.cleanUpUnusedDataText'), msg: this.cleanConfirmation(inspection),
                ok: t('shell.menu.commands.deleteAction', { value1: formatBytes(inspection.disposableBytes) }), cancel: t('shell.menu.commands.cancelAction')
            }).open();
            if (!confirmed) return;
            const result = await this.cleanService.clean(root.toString());
            void this.messages.info(result.cleaned
                ? t('shell.menu.commands.deletedUnusedItemsText', { value1: formatBytes(result.bytes ?? 0), value2: result.count ?? 0, n: result.count ?? 0 })
                : result.reason ?? t('shell.menu.commands.couldNotCleanUpError'));
        } catch (error) {
            void this.messages.info(t('shell.menu.commands.cleanUpFailedWithReasonError', { value1: String(error) }));
        } finally { this.cleanBusy = false; }
    }

    protected describeNothingToClean(inspection: ProjectCleanInspection): string {
        const held = inspection.undecided.filter(entry => entry.heldReason);
        if (!held.length) return t('shell.menu.commands.noUnusedDataDeletedText');
        return t('shell.menu.commands.noUnusedDataDeletedItemsHeldBecauseText', { value1: held.length, n: held.length, value2: formatBytes(
            held.reduce((sum, entry) => sum + entry.bytes, 0)
        ), value3: held[0].heldReason });
    }

    protected cleanConfirmation(inspection: ProjectCleanInspection): HTMLElement {
        const node = document.createElement('div');
        const lead = document.createElement('p');
        lead.style.margin = '0 0 8px';
        lead.textContent = t('shell.menu.commands.deleteTheseItemsTotalOriginalFilesExportedVideosVerificationEvidenceMessage', { value1: inspection.disposable.length, n: inspection.disposable.length, value2: formatBytes(inspection.disposableBytes) });
        node.appendChild(lead);
        const list = document.createElement('ul');
        list.style.cssText = 'margin:0;padding-left:18px;max-height:240px;overflow:auto;font-size:0.9em';
        for (const entry of inspection.disposable) {
            const item = document.createElement('li');
            item.textContent = `${entry.path} — ${formatBytes(entry.bytes)}（${entry.reason}）`;
            list.appendChild(item);
        }
        node.appendChild(list);
        const held = inspection.undecided.filter(entry => entry.heldReason);
        if (held.length) {
            const note = document.createElement('p');
            note.style.cssText = 'margin:8px 0 0;opacity:0.75;font-size:0.9em';
            note.textContent = t('shell.menu.commands.keepItemsTimeBecauseMessage', { value1: held.length, n: held.length, value2: formatBytes(held.reduce((sum, entry) => sum + entry.bytes, 0)), value3: held[0].heldReason });
            node.appendChild(note);
        }
        return node;
    }
}
