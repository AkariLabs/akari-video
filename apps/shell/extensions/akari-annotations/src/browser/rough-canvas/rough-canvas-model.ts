import type { RoughCanvasSubject } from '../../common/rough-canvas-protocol';

export function popupBounds(viewportWidth: number, viewportHeight: number, previewWidth: number | undefined,
    aspect: { w: number; h: number }, stored?: { left: number; top: number; width: number },
    preview?: { left: number; top: number; width: number; height: number }) {
    const available = Math.max(0, viewportWidth - 16);
    const preferred = previewWidth && previewWidth > 0 ? previewWidth * 0.45 : viewportWidth * 0.45;
    // Open at the comfortable width; dragging the resize corner may reach the 480 px floor.
    const width = Math.min(available, Math.max(480, stored?.width ?? Math.max(600, preferred)));
    const height = Math.min(viewportHeight - 16, (width - 32) * aspect.h / aspect.w + 120);
    const left = Math.max(0, Math.min(viewportWidth - width,
        stored?.left ?? (preview ? preview.left + (preview.width - width) / 2 : (viewportWidth - width) / 2)));
    const top = Math.max(0, Math.min(viewportHeight - height,
        stored?.top ?? (preview ? preview.top + (preview.height - height) / 2 : (viewportHeight - height) / 2)));
    return { left, top, width, height };
}

export function openingPlan(canCapture: boolean, playing: boolean): Array<'pause' | 'capture' | 'open'> {
    return canCapture ? [...(playing ? ['pause' as const] : []), 'capture', 'open'] : ['open'];
}

export function buildRoughCanvasSubject(outputT: number, selection: string[],
    source?: { src?: string; sourceT?: number | null; cutIndex?: number | null }): RoughCanvasSubject {
    return { playhead: {
        outputT,
        ...(source?.src ? { src: source.src } : {}),
        ...(typeof source?.sourceT === 'number' ? { sourceT: source.sourceT } : {}),
        ...(typeof source?.cutIndex === 'number' ? { cutIndex: source.cutIndex } : {})
    }, selection: selection.filter(value => value.startsWith('timeline:')), doc: 'edit.json' };
}

export function formatRoughCanvasPacket(id: string, subject: RoughCanvasSubject, memo: string | null): string {
    const time = Math.floor(subject.playhead.outputT);
    const details = [`出力 ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`];
    if (subject.playhead.cutIndex !== undefined) details.push(`cut:${subject.playhead.cutIndex}`);
    if (subject.selection.length) details.push(`選択: ${subject.selection.join(', ')}`);
    return [`【メモ】${id}（${details.join(' / ')}）について:`,
        ...(memo?.trim() ? [`話した言葉: 「${memo.trim()}」`] : []),
        `紙: review/canvas/${id}/paper.png（線: review/canvas/${id}/ink.json）`,
        'このメモに対応してください。'].join('\n');
}
