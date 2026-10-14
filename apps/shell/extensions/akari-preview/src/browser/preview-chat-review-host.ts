import { t } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ChatAttachment, reviewAttachArgument } from '../common/chat-review-attachments';
import { describeReviewAttachments } from './preview-chat-review-text';
import { reviewAttachDestination } from '../common/review-attach-destination';

export interface ReviewPartnerTarget {
    kind: 'terminal' | 'web' | 'extension' | 'chat';
    name: string;
}

export async function currentReviewPartner(commands: CommandRegistry): Promise<ReviewPartnerTarget | undefined> {
    if (!commands.getCommand('akari.partner.current')) return undefined;
    try { return await commands.executeCommand<ReviewPartnerTarget | undefined>('akari.partner.current'); }
    catch { return undefined; }
}

async function saveReviewImages(root: URI, attachments: readonly ChatAttachment[], files: FileService): Promise<Map<number, string>> {
    const paths = new Map<number, string>();
    for (const [index, item] of attachments.entries()) {
        if (item.kind !== 'review' || !item.review.thumbnail) continue;
        const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.review.thumbnail);
        if (!match) continue;
        const relative = `.akari/review/attachments/${crypto.randomUUID()}.jpg`;
        const bytes = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0));
        await files.createFolder(root.resolve('.akari/review/attachments'));
        await files.createFile(root.resolve(relative), BinaryBuffer.wrap(bytes), { overwrite: false });
        paths.set(index, relative);
    }
    return paths;
}

export async function attachReviewToPartner(root: URI, attachments: readonly ChatAttachment[], target: ReviewPartnerTarget | undefined,
    commands: CommandRegistry, files: FileService, clipboard: ClipboardService, messages: MessageService, chatEnabled = true): Promise<boolean> {
    const destination = reviewAttachDestination(target?.kind, chatEnabled);
    if (destination === 'chat') {
        if (!commands.getCommand('akari.chat.attach')) {
            messages.info(t('preview.previewChatReviewHost.ui.openAkariChatAction'));
            return false;
        }
        await commands.executeCommand('akari.chat.attach', reviewAttachArgument(attachments));
        return true;
    }
    const images = await saveReviewImages(root, attachments, files);
    const text = describeReviewAttachments(attachments, images);
    if (destination === 'terminal' && commands.getCommand('akari.partner.insertText')) {
        try {
            if (await commands.executeCommand<boolean>('akari.partner.insertText', { text })) return true;
        } catch { /* Clipboard fallback below. */ }
    }
    await clipboard.writeText(text);
    messages.info(target && target.kind !== 'chat' ? t('preview.previewChatReviewHost.ui.pasteIntoInputFieldTargetAction', { target: target.name }) : t('preview.previewChatReviewHost.ui.reviewCopiedClipboardLabel'));
    return true;
}
