export type ChatAttachment =
    | { kind: 'file'; path: string; label: string }
    | { kind: 'review'; label: string; review: ChatReviewMark };

export interface ChatReviewMark {
    tool: 'pen' | 'pin' | 'range';
    source: string;
    sourceLabel: string;
    time: number;
    timeEnd?: number;
    shape?: { x: number; y: number; w?: number; h?: number };
    elements?: string[];
    text: string;
    thumbnail?: string;
}

export function reviewTimeSpan(mark: ChatReviewMark): string {
    const time = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    return mark.timeEnd === undefined ? time(mark.time) : `${time(mark.time)}〜${time(mark.timeEnd)}`;
}

export function describeAttachments(attachments: readonly ChatAttachment[]): string {
    return attachments.map(item => {
        if (item.kind === 'file') return `[ファイル] ${item.label}: ${item.path}`;
        const mark = item.review;
        const span = reviewTimeSpan(mark);
        const tool = { pen: 'ペン', pin: 'ピン', range: '範囲' }[mark.tool];
        const context = mark.elements?.length ? `（${mark.elements.join('、')}付近）` : '';
        return `[レビュー] ${mark.sourceLabel} ${span} ${tool}${context}: ${mark.text} [${mark.source}]`;
    }).join('\n');
}
