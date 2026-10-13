import type { ChatAttachment } from '../common/chat-review-attachments';

const oneLine = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim();

export function describeReviewAttachments(attachments: readonly ChatAttachment[], imagePaths: ReadonlyMap<number, string> = new Map()): string {
    return attachments.map((item, index) => {
        if (item.kind === 'file') return `[ファイル] ${oneLine(item.label)}: ${oneLine(item.path)}`;
        const mark = item.review;
        const time = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
        const span = mark.timeEnd === undefined ? time(mark.time) : `${time(mark.time)}〜${time(mark.timeEnd)}`;
        const tool = { pen: 'ペン', pin: 'ピン', range: '範囲' }[mark.tool];
        const context = mark.elements?.length ? `（${mark.elements.map(oneLine).join('、')}付近）` : '';
        const body = oneLine(mark.text);
        const base = `[レビュー] ${oneLine(mark.sourceLabel)} ${span} ${tool}${context}${body ? `: ${body}` : ''} [${oneLine(mark.source)}]`;
        const image = imagePaths.get(index);
        return image ? `${base} [コマの絵: ${image}]` : base;
    }).join('\n') + (attachments.length ? '\n' : '');
}
