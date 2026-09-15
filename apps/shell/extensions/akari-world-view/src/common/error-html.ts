const escapeHtml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function errorHtml(message: string): string {
    return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>body{margin:0;background:#111620;color:#edf2ff;font:13px sans-serif}pre{margin:18px;padding:14px;border:1px solid #704657;border-radius:8px;white-space:pre-wrap}</style><pre>${escapeHtml(message)}</pre></html>`;
}
