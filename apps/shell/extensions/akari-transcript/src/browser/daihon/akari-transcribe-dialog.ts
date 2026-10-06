import { ApplicationShell, OpenerService, open } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { AKARI_TRANSCRIPT_SEEK_REQUESTED } from '../akari-transcript-commands';

export { AkariTranscribeDialog, TRANSCRIBE_ENGINE_CARDS } from './akari-caption-popup';
export { transcribeEngineList } from '../../common/transcribe-steps';

export function transcribeElement<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
}
export function transcribeButton(label: string, action: () => void, disabled = false): HTMLButtonElement {
    const control = transcribeElement('button', label);
    control.type = 'button'; control.disabled = disabled; control.onclick = action;
    return control;
}

/** Listen to a selected difference using the raw material preview. */
export async function listenTranscribeRange(commands: CommandService, shell: ApplicationShell,
    opener: OpenerService, videoUri: string, start: number, end?: number): Promise<() => void> {
    await open(opener, new URI(videoUri));
    const widget = shell.widgets.find(value => {
        const preview = value as unknown as { akariPreviewVideoUri?: URI; akariPreviewEditUri?: URI };
        return !preview.akariPreviewEditUri && preview.akariPreviewVideoUri?.normalizePath().toString() === videoUri;
    }) as unknown as { sendMessage(message: unknown): void; akariPreviewLastKnownPlaying?: boolean;
        akariPreviewLastKnownTime?: number; onDidDispose(callback: () => void): { dispose(): void } } | undefined;
    if (!widget) throw new Error('対象素材のプレビューを開けませんでした');
    if (end === undefined) {
        const result = await commands.executeCommand<string>(AKARI_TRANSCRIPT_SEEK_REQUESTED.id,
            { videoUri, time: start, captionId: 'transcribe-diff' });
        if (result !== 'seeked') throw new Error('対象素材へシークできませんでした');
        return () => undefined;
    }
    await new Promise<void>((resolve, reject) => {
        const ready = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.mediaUri === videoUri && Math.abs(detail.sourceT - start) < .1) finish();
        };
        const finish = (error?: Error) => {
            clearTimeout(timer); window.removeEventListener('akari.preview.rawAnnotationState', ready);
            if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('プレビューのシークを確認できませんでした')), 5000);
        window.addEventListener('akari.preview.rawAnnotationState', ready);
        if (widget.akariPreviewLastKnownPlaying) widget.sendMessage({ type: 'akari-preview-toggle-playback' });
        void commands.executeCommand<string>(AKARI_TRANSCRIPT_SEEK_REQUESTED.id,
            { videoUri, time: start, captionId: 'transcribe-diff' }).then(result => {
            if (result !== 'seeked') finish(new Error('対象素材へシークできませんでした'));
            else if (Math.abs((widget.akariPreviewLastKnownTime ?? -Infinity) - start) < .1) finish();
        }, error => finish(error));
    });
    let disposed = false;
    const stop = () => {
        if (disposed) return;
        disposed = true;
        window.removeEventListener('akari.preview.rawAnnotationState', tick);
        if (widget.akariPreviewLastKnownPlaying) widget.sendMessage({ type: 'akari-preview-toggle-playback' });
        disposeListener.dispose();
    };
    const tick = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.mediaUri === videoUri && detail.sourceT >= end) stop();
    };
    const disposeListener = widget.onDidDispose(stop);
    window.addEventListener('akari.preview.rawAnnotationState', tick);
    if (!widget.akariPreviewLastKnownPlaying) widget.sendMessage({ type: 'akari-preview-toggle-playback' });
    return stop;
}
