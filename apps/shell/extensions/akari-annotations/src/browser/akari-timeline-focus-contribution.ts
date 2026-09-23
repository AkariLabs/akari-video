import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariAnnotationsWidget } from './akari-annotations-widget';

// 外から要素を選択・シーク・可視化・強調するための一般的な受け口。
// キーボードショートカット・パートナー・
// 将来の入力手段のどれからでも akari.timeline.* コマンドとして呼べる一般口として作る。
export interface FocusTimelineItemArgs {
    itemId: string;
    seek?: boolean;
    reveal?: boolean;
    pulse?: boolean;
}
export const FOCUS_TIMELINE_ITEM: Command = { id: 'akari.timeline.focusItem' };

export interface TimelineSeekArgs { seconds: number; }
export const TIMELINE_SEEK: Command = { id: 'akari.timeline.seek' };

export interface TimelineSetViewArgs { startSeconds?: number; durationSeconds?: number; fit?: boolean; }
export const TIMELINE_SET_VIEW: Command = { id: 'akari.timeline.setView' };

export interface TimelineSetToolArgs { tool: 'select' | 'razor' | 'frame'; }
export const TIMELINE_SET_TOOL: Command = { id: 'akari.timeline.setTool' };

export interface TimelineSetSnapArgs { enabled: boolean; }
export const TIMELINE_SET_SNAP: Command = { id: 'akari.timeline.setSnap' };

export const REVEAL_TIMELINE: Command = { id: 'akari.timeline.reveal' };

@injectable()
export class AkariTimelineFocusContribution implements CommandContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(FOCUS_TIMELINE_ITEM, {
            execute: async (request: unknown): Promise<boolean> => {
                const args = request as Partial<FocusTimelineItemArgs> | undefined;
                if (typeof args?.itemId !== 'string' || !args.itemId) return false;
                const widget = this.resolveWidget();
                if (!widget) return false;
                return widget.focusTimelineItem(args.itemId, {
                    seek: args.seek === true, reveal: args.reveal === true, pulse: args.pulse === true
                });
            }
        });
        commands.registerCommand(TIMELINE_SEEK, {
            execute: async (request: unknown): Promise<void> => {
                const args = request as Partial<TimelineSeekArgs> | undefined;
                if (typeof args?.seconds !== 'number' || !Number.isFinite(args.seconds)) return;
                await this.resolveWidget()?.seekTimelineOutput(args.seconds);
            }
        });
        commands.registerCommand(TIMELINE_SET_VIEW, {
            execute: (request: unknown): void => {
                const args = request as Partial<TimelineSetViewArgs> | undefined;
                this.resolveWidget()?.setTimelineView({
                    ...(typeof args?.startSeconds === 'number' && Number.isFinite(args.startSeconds)
                        ? { startSeconds: args.startSeconds } : {}),
                    ...(typeof args?.durationSeconds === 'number' && Number.isFinite(args.durationSeconds) && args.durationSeconds > 0
                        ? { durationSeconds: args.durationSeconds } : {}),
                    ...(args?.fit === true ? { fit: true } : {})
                });
            }
        });
        commands.registerCommand(TIMELINE_SET_TOOL, {
            execute: (request: unknown): void => {
                const args = request as Partial<TimelineSetToolArgs> | undefined;
                if (args?.tool !== 'select' && args?.tool !== 'razor' && args?.tool !== 'frame') return;
                this.resolveWidget()?.setTimelineToolMode(args.tool);
            }
        });
        commands.registerCommand(TIMELINE_SET_SNAP, {
            execute: (request: unknown): void => {
                const args = request as Partial<TimelineSetSnapArgs> | undefined;
                if (typeof args?.enabled !== 'boolean') return;
                this.resolveWidget()?.setTimelineSnapEnabled(args.enabled);
            }
        });
        commands.registerCommand(REVEAL_TIMELINE, {
            execute: async (): Promise<boolean> => {
                const attached = this.resolveWidget();
                if (attached) {
                    await this.shell.activateWidget(attached.id);
                    return true;
                }
                const existing = this.widgetManager.getWidgets(AkariAnnotationsWidget.FACTORY_ID)
                    .find((candidate): candidate is AkariAnnotationsWidget =>
                        candidate instanceof AkariAnnotationsWidget && !candidate.isDisposed);
                if (existing) {
                    this.shell.addWidget(existing, { area: 'bottom' });
                    await this.shell.activateWidget(existing.id);
                    return true;
                }
                if (!this.workspaceService.opened) return false;
                const created = await this.widgetManager.getOrCreateWidget<AkariAnnotationsWidget>(
                    AkariAnnotationsWidget.FACTORY_ID);
                this.shell.addWidget(created, { area: 'bottom' });
                await this.shell.activateWidget(created.id);
                return true;
            }
        });
    }

    /** 添付済みの AkariAnnotationsWidget を1つ選ぶ。無ければ undefined（全コマンド no-op）。 */
    protected resolveWidget(): AkariAnnotationsWidget | undefined {
        const widgets = this.widgetManager.getWidgets(AkariAnnotationsWidget.FACTORY_ID)
            .filter((candidate): candidate is AkariAnnotationsWidget =>
                candidate instanceof AkariAnnotationsWidget && candidate.isAttached && !candidate.isDisposed);
        if (widgets.length === 0) return undefined;
        const current = this.shell.activeWidget;
        return widgets.find(candidate => candidate === current) ?? widgets[0];
    }
}
