import { t } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ChatAttachment } from '../common/chat-review-attachments';
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

function workspaceRelativeImagePath(projectRoot: URI, workspaceRootUri: string, imagePath: string): string {
    const normalized = (uri: string): string => uri.replace(/^file:\/\/\/tmp(?=\/|$)/, 'file:///private/tmp').replace(/\/$/, '');
    const root = normalized(workspaceRootUri);
    const project = normalized(projectRoot.toString());
    const projectPath = project === root ? '' : decodeURIComponent(project.slice(root.length + 1));
    return projectPath ? `${projectPath}/${imagePath}` : imagePath;
}

export async function attachReviewToPartner(projectRoot: URI, workspaceRootUri: string,
    attachments: readonly ChatAttachment[], target: ReviewPartnerTarget | undefined,
    commands: CommandRegistry, files: FileService, messages: MessageService, chatEnabled = true): Promise<boolean> {
    const destination = reviewAttachDestination(target?.kind, chatEnabled);
    if (destination === 'chat') {
        if (!commands.getCommand('akari.chat.attach') || !commands.getCommand('akari.annotations.composePacket')) {
            messages.error(t('preview.previewChatReviewHost.ui.packetFailedError'));
            return false;
        }
        try {
            const packetAttachments: ChatAttachment[] = [];
            for (const item of attachments) {
                if (item.kind !== 'review' || !item.review.annotationId) return false;
                const packet = await commands.executeCommand<string>('akari.annotations.composePacket',
                    { projectRootUri: workspaceRootUri, ids: [item.review.annotationId] });
                if (typeof packet !== 'string' || !packet) throw new Error('Empty annotation packet');
                packetAttachments.push({ ...item, review: { ...item.review, packet } });
            }
            await commands.executeCommand('akari.chat.attach', { attachments: packetAttachments });
        } catch {
            messages.error(t('preview.previewChatReviewHost.ui.packetFailedError'));
            return false;
        }
        return true;
    }
    if (!commands.getCommand('akari.annotations.handToPartner')) {
        messages.error(t('preview.previewChatReviewHost.ui.handoffFailedError'));
        return false;
    }
    const images = await saveReviewImages(projectRoot, attachments, files);
    const ids = attachments.flatMap(item => item.kind === 'review' && item.review.annotationId ? [item.review.annotationId] : []);
    if (ids.length !== attachments.length) return false;
    const extraLines = [...images.values()].map(path => t('preview.previewChatReviewHost.ui.frameImagePathLabel',
        { path: workspaceRelativeImagePath(projectRoot, workspaceRootUri, path) }));
    try {
        void commands.executeCommand('akari.annotations.handToPartner', { projectRootUri: workspaceRootUri, ids, extraLines })
            .catch(() => messages.error(t('preview.previewChatReviewHost.ui.handoffFailedError')));
    } catch {
        messages.error(t('preview.previewChatReviewHost.ui.handoffFailedError'));
        return false;
    }
    return true;
}
