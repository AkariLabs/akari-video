import { t } from '@akari-video/i18n';
import type { ChatAttachment } from '../common/chat-review-attachments';

const oneLine = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim();

export function describeReviewAttachments(attachments: readonly ChatAttachment[], imagePaths: ReadonlyMap<number, string> = new Map()): string {
    return attachments.map((item, index) => {
        if (item.kind === 'file') return t('preview.previewChatReviewText.ui.labelPathLabel', { label: oneLine(item.label), path: oneLine(item.path) });
        const mark = item.review;
        const time = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
        const span = mark.timeEnd === undefined ? time(mark.time) : `${time(mark.time)}〜${time(mark.timeEnd)}`;
        const tool = { pen: t('preview.previewChatReviewText.ui.penLabel'), pin: t('preview.previewChatReviewText.ui.pinLabel'), range: t('preview.previewChatReviewText.ui.rangeLabel') }[mark.tool];
        const context = mark.elements?.length ? t('preview.previewChatReviewText.ui.nearElementsLabel', { elements: mark.elements.map(oneLine).join(t('preview.previewChatReviewText.punctuation.listSeparator')) }) : '';
        const body = oneLine(mark.text);
        const base = t('preview.previewChatReviewText.ui.reviewAttachmentText', { sourceLabel: oneLine(mark.sourceLabel), timeSpan: span, tool: tool, context: context, bodySuffix: body ? `: ${body}` : '', source: oneLine(mark.source) });
        const image = imagePaths.get(index);
        return image ? t('preview.previewChatReviewText.ui.baseTextLabel', { baseText: base, image: image }) : base;
    }).join('\n') + (attachments.length ? '\n' : '');
}
