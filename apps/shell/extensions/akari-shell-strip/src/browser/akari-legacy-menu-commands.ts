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
        registry.registerCommand({ id: AKARI_COMMANDS.railToggleExpanded, label: '左の列を広げる' }, {
            execute: () => {
                if (document.body.hasAttribute('data-akari-rail-expanded')) document.body.removeAttribute('data-akari-rail-expanded');
                else document.body.setAttribute('data-akari-rail-expanded', 'true');
            }
        });
        registry.registerCommand({ id: AKARI_COMMANDS.previewServerOpen, label: 'ブラウザプレビューを開く' }, {
            execute: () => this.openPreview()
        });
        registry.registerCommand({ id: AKARI_COMMANDS.projectCleanData, label: '不要なデータを整理' }, {
            execute: () => this.cleanProject()
        });
    }

    protected async openPreview(): Promise<void> {
        if (this.previewBusy) return;
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root) { void this.messages.info('プロジェクトを開くとブラウザプレビューを起動できます。'); return; }
        if (!(await this.availability.refresh()).exists) {
            void this.messages.info('edit.json がまだありません。編集を進めてからプレビューしてください。');
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
                void this.messages.info(status.failureSummary ?? 'ブラウザプレビューを起動できませんでした');
            }
        } catch (error) {
            this.stopPolling();
            void this.messages.info(`ブラウザプレビューを起動できませんでした: ${String(error)}`);
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
            if (!root) { void this.messages.info('プロジェクトが開かれていないため整理できません'); return; }
            const inspected = await this.cleanService.inspect(root.toString());
            const inspection = inspected.inspection;
            if (!inspected.ok || !inspection) { void this.messages.info(inspected.reason ?? 'プロジェクトを調べられませんでした'); return; }
            if (!inspection.disposable.length) { void this.messages.info(this.describeNothingToClean(inspection)); return; }
            const confirmed = await new ConfirmDialog({
                title: '不要なデータを整理', msg: this.cleanConfirmation(inspection),
                ok: `${formatBytes(inspection.disposableBytes)} を削除`, cancel: 'キャンセル'
            }).open();
            if (!confirmed) return;
            const result = await this.cleanService.clean(root.toString());
            void this.messages.info(result.cleaned
                ? `不要なデータ ${formatBytes(result.bytes ?? 0)}（${result.count ?? 0} 件）を削除しました`
                : result.reason ?? '整理できませんでした');
        } catch (error) {
            void this.messages.info(`整理できませんでした: ${String(error)}`);
        } finally { this.cleanBusy = false; }
    }

    protected describeNothingToClean(inspection: ProjectCleanInspection): string {
        const held = inspection.undecided.filter(entry => entry.heldReason);
        if (!held.length) return '削除できる不要なデータはありませんでした';
        return `いま削除できる不要なデータはありません（${held.length} 件 ${formatBytes(
            held.reduce((sum, entry) => sum + entry.bytes, 0)
        )} は「${held[0].heldReason}」として保留中です）`;
    }

    protected cleanConfirmation(inspection: ProjectCleanInspection): HTMLElement {
        const node = document.createElement('div');
        const lead = document.createElement('p');
        lead.style.margin = '0 0 8px';
        lead.textContent = `次の ${inspection.disposable.length} 件（合計 ${formatBytes(inspection.disposableBytes)}）を削除します。原本・書き出し済みの動画・検証の証跡は削除しません。`;
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
            note.textContent = `${held.length} 件（${formatBytes(held.reduce((sum, entry) => sum + entry.bytes, 0))}）は「${held[0].heldReason}」のため今回は残します。`;
            node.appendChild(note);
        }
        return node;
    }
}
