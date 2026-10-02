export { replaceCaptionLine } from '@akari-video/edit-store/lib/caption-line-ops';

export function replaceReportBlock(source: string, blockId: string, text: string): string {
    const htmlRange = findHtmlBlock(source, blockId);
    if (htmlRange) {
        return `${source.slice(0, htmlRange.contentStart)}${escapeHtml(text)}${source.slice(htmlRange.contentEnd)}`;
    }

    const escapedId = escapeRegExp(blockId);
    const linePattern = new RegExp(
        `^(\\s*(?:#{1,6}\\s+|[-*+]\\s+|>\\s+)?)(.*?)(\\s*\\{[^}]*data-block-id\\s*=\\s*(["'])${escapedId}\\4[^}]*\\}\\s*)(\\r?\\n|$)$`,
        'm'
    );
    if (linePattern.test(source)) {
        return source.replace(linePattern, (_match, prefix, _content, annotation, _quote, ending) =>
            `${prefix}${text.replace(/\r?\n/g, ' ')}${annotation}${ending}`);
    }
    throw new Error(`ブロック ${blockId} が元ファイルにありません。`);
}

function findHtmlBlock(source: string, blockId: string): { contentStart: number; contentEnd: number } | undefined {
    const openingTags = /<([a-z][\w:-]*)\b[^>]*\bdata-block-id\s*=\s*(["'])(.*?)\2[^>]*>/gi;
    let opening: RegExpExecArray | null;
    while ((opening = openingTags.exec(source))) {
        if (opening[3] !== blockId) {
            continue;
        }
        if (/\/\s*>$/.test(opening[0])) {
            throw new Error(`ブロック ${blockId} に編集できる本文がありません。`);
        }
        const tag = opening[1];
        const tagPattern = new RegExp(`<\\/?${escapeRegExp(tag)}\\b[^>]*>`, 'gi');
        tagPattern.lastIndex = openingTags.lastIndex;
        let depth = 1;
        let token: RegExpExecArray | null;
        while ((token = tagPattern.exec(source))) {
            if (/^<\//.test(token[0])) {
                depth--;
                if (depth === 0) {
                    return { contentStart: openingTags.lastIndex, contentEnd: token.index };
                }
            } else if (!/\/\s*>$/.test(token[0])) {
                depth++;
            }
        }
        throw new Error(`ブロック ${blockId} の閉じタグがありません。`);
    }
    return undefined;
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
