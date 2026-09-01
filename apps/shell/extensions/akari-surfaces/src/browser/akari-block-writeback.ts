import { applyCaptionTextEdit, type CaptionTextEditRecord } from '@akari-video/edit-store';

export function replaceCaptionLine(source: string, captionId: string, text: string): string {
    if (!captionId) {
        throw new Error('字幕 ID がありません。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== captionId) {
            return line;
        }
        matches++;
        const openIndex = line.indexOf('{');
        const closeIndex = line.lastIndexOf('}');
        if (openIndex < 0 || closeIndex < openIndex) {
            throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
        }
        const record = JSON.parse(line.slice(openIndex, closeIndex + 1)) as CaptionTextEditRecord;
        const updated = applyCaptionTextEdit(record, text).record;
        if (updated === record) return line;
        return line.slice(0, openIndex) + JSON.stringify(updated) + line.slice(closeIndex + 1);
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `字幕 ${captionId} が captions.json にありません。`
            : `字幕 ${captionId} が captions.json に複数あります。`);
    }
    return updated;
}

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

function decodeJsonString(value: string): string {
    try {
        return JSON.parse(`"${value}"`);
    } catch {
        return value;
    }
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
