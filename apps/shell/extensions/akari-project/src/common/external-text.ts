export function sanitizeExternalText(value: string, max: number): string {
    return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, '').slice(0, max);
}

export function wrapExternalText(value: string, { id }: { id: string }): string {
    const safeId = /^[0-9]{8}-[0-9]{6}-[a-f0-9]{6}$/u.test(id) ? id : 'invalid';
    const data = sanitizeExternalText(value, 200)
        .replace(/https?:\/\/[^\s<>"']+/giu, '[url]')
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[email]');
    const escaped = JSON.stringify(data).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e').replace(/&/gu, '\\u0026');
    return `<external-data source="browser" id="${safeId}" trust="none">${escaped}</external-data>`;
}

export function detectInjectionSuspect(value: string): boolean {
    const text = sanitizeExternalText(value, 3000);
    return /以前の指示を無視|ignore\s+(?:all\s+)?previous\s+instructions|you\s+are\s+now|system\s*:/iu.test(text)
        || /(?:送信して|fetch|curl|このURLにアクセス)[\s\S]{0,160}https?:\/\//iu.test(text)
        || /オーナーは承認済み|approved\s+by/iu.test(text);
}
