import { t } from '@akari-video/i18n';
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
        if (item.kind === 'file') return t('chat.chatAttachments.ui.labelPathLabel', { label: item.label, path: item.path });
        const mark = item.review;
        const span = reviewTimeSpan(mark);
        const tool = { pen: t('chat.chatAttachments.ui.penLabel'), pin: t('chat.chatAttachments.ui.pinLabel'), range: t('chat.chatAttachments.ui.rangeLabel') }[mark.tool];
        const context = mark.elements?.length ? t('chat.chatAttachments.ui.nearElementsLabel', { elements: mark.elements.join('、') }) : '';
        return t('chat.chatAttachments.ui.reviewAttachmentText', { sourceLabel: mark.sourceLabel, timeSpan: span, tool: tool, context: context, text: mark.text, source: mark.source });
    }).join('\n');
}
