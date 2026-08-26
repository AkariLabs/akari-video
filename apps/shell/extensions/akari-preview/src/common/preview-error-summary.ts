const JSON_PARSE_MESSAGE = /(?:\bJSON\b|Unexpected (?:token|end)|Expected (?:property|double-quoted|','|':')|position \d+|line \d+ column \d+)/iu;
const STACK_FRAGMENT = /\s+at\s+(?:[^()\s]+\s*)?\([^\r\n()]+:\d+:\d+\)\s*$/u;
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
        summary = `edit.json を JSON として読めません（${summary}）`;
    }
    if (!summary || summary === '[object Object]') {
        return '原因不明のエラーです。';
    }
    return summary.length > MAX_SUMMARY_LENGTH
        ? `${summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
        : summary;
};
