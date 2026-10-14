import { t } from './preview-text';
const JSON_PARSE_MESSAGE = /(?:\bJSON\b|Unexpected (?:token|end)|Expected (?:property|double-quoted|','|':')|position \d+|line \d+ column \d+)/iu;
const STACK_FRAGMENT = /\s+at\s+(?:[^()\s]+\s*)?\([^\r\n()]+:\d+:\d+\)\s*$/u;
const MISSING_FILE_MESSAGE = /^ENOENT: no such file or directory, \w+ '(.+)'$/u;
const MAX_SUMMARY_LENGTH = 160;

export const summarizePreviewError = (error: unknown): string => {
    const isJsonParseError = error instanceof SyntaxError && JSON_PARSE_MESSAGE.test(error.message);
    let raw = '';
    if (error instanceof Error) {
        raw = error.message;
    } else if (error !== null && error !== undefined) {
        try {
            raw = String(error);
        } catch {
            raw = '';
        }
    }
    let summary = raw.split(/\r?\n/u, 1)[0]
        .replace(STACK_FRAGMENT, '')
        .replace(/\s+/gu, ' ')
        .trim();

    if (isJsonParseError && summary) {
        summary = t('preview.outputPreview.errors.couldNotParseEditJsonJsonError', { p1: (summary) });
    }
    // 長い絶対パスは途中で切れてどのファイルか分からなくなる。ファイル名だけを出す。
    const missingFile = MISSING_FILE_MESSAGE.exec(summary);
    if (missingFile) {
        summary = t('preview.outputPreview.errors.materialNotFoundYetError', {
            p1: (missingFile[1].split(/[\\/]/u).pop() || missingFile[1])
        });
    }
    if (!summary || summary === '[object Object]') {
        return t('preview.outputPreview.errors.unknownErrorOccurredError');
    }
    return summary.length > MAX_SUMMARY_LENGTH
        ? `${summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
        : summary;
};
