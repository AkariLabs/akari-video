import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { deriveTargets, type InkDocument, type InkTarget } from '../../common/ink-model';
import type { RoughCanvasManifest } from '../../common/rough-canvas-protocol';
import { contextAt, editContextLine, enumerateEditContext } from './taskify-edit-context';

export interface BundleInput { canvas: RoughCanvasManifest; ink: InkDocument; transcript?: { segments?: Array<{
    t0: number; t1: number; text: string; kind?: string }> }; paper: Buffer; backdrop?: Buffer;
    includeBackdrop: boolean; editText?: string; scriptText?: string }
const stamp = (n: number): string => Number.isFinite(n) ? `${Math.round(n * 10) / 10}s` : '不明';
const coord = (p: number[]): string => `(${p.map(v => Number(v.toFixed(2))).join(',')})`;
export function buildBundle(input: BundleInput): { context: string; files: Record<string, Buffer> } {
    let edit: any;
    try { edit = input.editText ? JSON.parse(input.editText) : undefined; } catch { /* Context is optional. */ }
    const subject = input.canvas.subject;
    const t = typeof subject?.playhead?.outputT === 'number' ? subject.playhead.outputT : undefined;
    const entries = contextAt(enumerateEditContext(edit), t);
    const targets: InkTarget[] = entries.filter(entry => entry.box).map(entry => ({ ref: entry.ref, box: entry.box! }));
    const ink = deriveTargets(input.ink, targets);
    const speech = (input.transcript?.segments ?? []).filter(s => s.kind === 'speech');
    const utterances = speech.length ? speech.map(s => {
        const related = input.ink.objects.map((obj, i) => obj.recT && obj.recT[0] <= s.t1 && obj.recT[1] >= s.t0 ? `ink-${i + 1}` : '')
            .filter(Boolean);
        return `${stamp(s.t0)}–${stamp(s.t1)} ${s.text}${related.length ? `・重なる線 ${related.join(', ')}` : ''}`;
    })
        : input.canvas.memo ? [`typed: ${input.canvas.memo}`] : ['なし'];
    const strokes = ink.objects.map((obj, i) => {
        const shape = obj.type === 'arrow' ? `矢印 ${coord(obj.from)}→${coord(obj.to)}`
            : obj.type === 'text' ? `文字 ${JSON.stringify(obj.text)} ${coord(obj.at)}`
                : `線 ${obj.points.map(coord).join('→')}`;
        const target = obj.type === 'arrow' ? obj.pointsTo : obj.type === 'text' ? obj.over : obj.around;
        return `ink-${i + 1} ${shape}・先 = ${target ?? 'null'}・${stamp(t ?? NaN)}${obj.recT ? `・記録 ${stamp(obj.recT[0])}–${stamp(obj.recT[1])}` : ''}`;
    });
    const editHash = input.editText ? createHash('sha256').update(input.editText).digest('hex') : '';
    const stale = !!input.canvas.backdrop?.editSha256 && !!editHash && input.canvas.backdrop.editSha256 !== editHash;
    const paragraphs = input.scriptText?.split(/\n\s*\n/).filter(Boolean) ?? [];
    const marker = `${String(Math.floor((t ?? 0) / 60)).padStart(2, '0')}:${String(Math.floor((t ?? 0) % 60)).padStart(2, '0')}`;
    const index = Math.max(0, paragraphs.findIndex(part => part.includes(marker)));
    const context = [
        '# メモの言葉', ...utterances,
        '# 紙の線', ...(strokes.length ? strokes : ['なし']),
        '# 対象', `出力 ${stamp(t ?? NaN)}・src ${subject.playhead.src ?? 'なし'}・sourceT ${stamp(subject.playhead.sourceT ?? NaN)}・cutIndex ${subject.playhead.cutIndex ?? 'なし'}`,
        `選択 ${subject.selection?.join(', ') || 'なし'}`, `stale:${stale} ${stale ? '紙は古い編集の上に描かれた' : ''}`,
        '# プロジェクトの文脈', ...(entries.length ? entries.map(editContextLine) : ['文脈なし']),
        ...(paragraphs.length ? ['台本の抜粋', paragraphs.slice(Math.max(0, index - 1), index + 2).join('\n\n')] : []),
        !input.includeBackdrop ? '画面内の物の矩形: ' + JSON.stringify(targets) : ''
    ].filter(Boolean).join('\n') + '\n';
    const files: Record<string, Buffer> = { 'context.md': Buffer.from(context), 'paper.png': input.paper };
    if (input.includeBackdrop && input.backdrop) files['backdrop.png'] = input.backdrop;
    return { context, files };
}
export async function writeBundle(dir: string, bundle: ReturnType<typeof buildBundle>): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(bundle.files)) await fs.writeFile(join(dir, name), content);
}
