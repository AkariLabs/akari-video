import { CommandContribution, CommandRegistry, CommandService, MessageService } from '@theia/core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { buildTimelineMap, outputToSource } from '@akari-video/edit-store/lib/timeline-map';
import type { EditCut } from '@akari-video/edit-store';
import { AkariRoughCanvasService, RoughCanvasBackdrop } from '../common/rough-canvas-protocol';
import { currentTimelineEditUri } from './active-timeline';
import { TimelineSelectionModel, TimelineSelectionSnapshot } from './timeline-selection-model';
import { RoughCanvasPopup } from './rough-canvas/rough-canvas-popup';
import { buildRoughCanvasSubject, openingPlan } from './rough-canvas/rough-canvas-model';
import { ROUGH_CANVAS_COMMANDS, SKETCH_NOT_OPEN, validRoughCanvasTool, withOpenRoughCanvas } from './rough-canvas/rough-canvas-command-model';

// akari-surfaces の設定キーの文字列ミラー（拡張間の依存を増やさない）。
const VIBE_PREVIEW_KEY = 'akari.vibePreview.enabled';
const previewEnabled = (): boolean => {
    try { return window.localStorage.getItem(VIBE_PREVIEW_KEY) === '1'; } catch { return false; }
};

function selectionTargets(snapshot: TimelineSelectionSnapshot): string[] {
    if (!snapshot) return [];
    if (snapshot.kind === 'multi') return snapshot.items.flatMap(selectionTargets);
    if (snapshot.kind === 'cut') return [`timeline:cut:${snapshot.index}`];
    if ('id' in snapshot && typeof snapshot.id === 'string') return [`timeline:${snapshot.kind}:${snapshot.id}`];
    return [];
}

@injectable()
export class RoughCanvasCommands implements CommandContribution {
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(TimelineSelectionModel) protected readonly selection!: TimelineSelectionModel;
    @inject(AkariRoughCanvasService) protected readonly service!: AkariRoughCanvasService;
    private popup?: RoughCanvasPopup;
    private opening?: Promise<{ ok: boolean; reason?: string }>;
    private readonly playing = new Map<string, boolean>();

    registerCommands(registry: CommandRegistry): void {
        window.addEventListener('akari.preview.playbackTick', event => {
            const detail = (event as CustomEvent<{ videoUri?: string; playing?: boolean }>).detail;
            if (detail?.videoUri && typeof detail.playing === 'boolean') this.playing.set(detail.videoUri, detail.playing);
        });
        const available = { isEnabled: previewEnabled, isVisible: previewEnabled };
        registry.registerCommand(ROUGH_CANVAS_COMMANDS.open, { ...available, execute: () => previewEnabled() ? this.open() : SKETCH_NOT_OPEN });
        registry.registerCommand(ROUGH_CANVAS_COMMANDS.close, { ...available, execute: () => previewEnabled() && this.withPopup(p => p.closeSafely()) });
        registry.registerCommand(ROUGH_CANVAS_COMMANDS.next, { ...available, execute: () => previewEnabled() && this.withPopup(p => p.next()) });
        registry.registerCommand(ROUGH_CANVAS_COMMANDS.backdrop, { ...available, execute: () => previewEnabled() && this.withPopup(p => p.setBackdrop()) });
        registry.registerCommand(ROUGH_CANVAS_COMMANDS.tool, { ...available, execute: (argument: unknown) => {
            if (!previewEnabled()) return SKETCH_NOT_OPEN;
            if (!this.popup?.isOpen) return SKETCH_NOT_OPEN;
            return validRoughCanvasTool(argument) ? this.withPopup(p => p.setTool(argument.tool))
                : { ok: false, reason: 'invalid-tool' };
        } });
        registry.registerCommand(ROUGH_CANVAS_COMMANDS.deleteSelected, { ...available, execute: () => previewEnabled() && this.withPopup(p => p.deleteSelected()) });
        registry.registerCommand(ROUGH_CANVAS_COMMANDS.submit, { ...available, execute: (argument: unknown) => {
            if (!previewEnabled()) return SKETCH_NOT_OPEN;
            if (!this.popup?.isOpen) return SKETCH_NOT_OPEN;
            const mode = (argument as { mode?: unknown } | undefined)?.mode;
            if (mode !== 'task' && mode !== 'send') return { ok: false, reason: 'invalid-mode' };
            return this.withPopup(p => p.submit(mode));
        } });
    }
    private withPopup<T>(action: (popup: RoughCanvasPopup) => T): T | typeof SKETCH_NOT_OPEN {
        return withOpenRoughCanvas(this.popup, action);
    }
    private async capture(editUri: string, hash: string): Promise<RoughCanvasBackdrop | undefined> {
        try {
            const result = await this.commands.executeCommand<{ image: string; time: number }>(
                'akari.preview.captureFrame', { editUri, purpose: 'memo' });
            if (!result || typeof result.image !== 'string' || !Number.isFinite(result.time)) return undefined;
            return { image: result.image, outputT: result.time, editSha256: hash };
        } catch { return undefined; }
    }
    open(): Promise<{ ok: boolean; reason?: string }> {
        if (this.popup?.isOpen) { this.popup.bringToFront(); return Promise.resolve({ ok: true }); }
        if (this.opening) return this.opening;
        this.opening = this.openNew().finally(() => { this.opening = undefined; });
        return this.opening;
    }
    private async openNew(): Promise<{ ok: boolean; reason?: string }> {
        const workspaceRoot = this.workspace.tryGetRoots()[0]?.resource;
        if (!workspaceRoot) { this.messages.error('プロジェクトを開いてください。'); return { ok: false, reason: 'project-not-open' }; }
        const project = await this.files.exists(workspaceRoot.resolve('edit.json')) ? workspaceRoot : workspaceRoot.resolve('project');
        const edit = currentTimelineEditUri(project);
        if (!await this.files.exists(edit)) { this.messages.error('タイムラインを開いてください。'); return { ok: false, reason: 'edit-not-found' }; }
        const editUri = edit.toString();
        let parsed: { output?: { width?: number; height?: number }; cuts?: EditCut[] } = {};
        try { parsed = JSON.parse((await this.files.readFile(edit)).value.toString()); } catch { /* A blank paper still opens. */ }
        const w = parsed.output?.width, h = parsed.output?.height;
        const aspect = typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0
            ? { w, h } : { w: 1920, h: 1080 };
        const aspectSource = w === aspect.w && h === aspect.h ? 'edit.json' as const : 'default' as const;
        const subjectAtOpen = async (capturedTime?: number) => {
            const playhead = capturedTime ?? await this.commands.executeCommand<number>('akari.timeline.playhead').catch(() => 0);
            const outputT = Number.isFinite(playhead) ? playhead : 0;
            let projected: ReturnType<typeof outputToSource> = { segment: null, sourceT: null };
            try { projected = outputToSource(buildTimelineMap(parsed.cuts ?? []).segments, outputT); }
            catch { /* Keep the output time if an older edit cannot be projected. */ }
            return buildRoughCanvasSubject(outputT, selectionTargets(this.selection.snapshot),
                { src: projected.segment?.src, sourceT: projected.sourceT, cutIndex: projected.segment?.cutIndex });
        };
        let subject = await subjectAtOpen();
        const hash = await this.service.hashEdit(editUri).catch(() => '');
        const capture = (): Promise<RoughCanvasBackdrop | undefined> => this.capture(editUri, hash);
        const playing = this.playing.get(editUri) === true;
        const previewElement = document.querySelector<HTMLElement>('[data-akari-onboarding-target="output"]');
        const canCapture = !!previewElement?.isConnected && previewElement.getClientRects().length > 0;
        let backdrop: RoughCanvasBackdrop | undefined;
        for (const step of openingPlan(canCapture, playing)) {
            if (step === 'pause') await this.commands.executeCommand('akari.preview.pause', { editUri }).catch(() => undefined);
            if (step === 'capture') backdrop = await capture();
        }
        if (backdrop) subject = await subjectAtOpen(backdrop.outputT);
        const previewRect = canCapture ? previewElement?.getBoundingClientRect() : undefined;
        const previewWidth = previewRect?.width;
        const popup = new RoughCanvasPopup({ projectRootUri: project.toString(), aspect, aspectSource,
            subject, subjectAtOpen, service: this.service, capture,
            send: async packet => this.commands.executeCommand<boolean>('akari.partner.injectPrompt', packet).catch(() => false),
            notify: message => this.messages.info(message), previewWidth,
            previewRect: previewRect ? { left: previewRect.left, top: previewRect.top,
                width: previewRect.width, height: previewRect.height } : undefined, backdrop });
        this.popup = popup;
        void popup.open().finally(() => { if (this.popup === popup) this.popup = undefined; });
        return { ok: true };
    }
}
