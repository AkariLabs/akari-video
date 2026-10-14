/**
 * Theia は webview の中で押されたキーを、その iframe を target にしてホストへ再送する
 * （plugin-ext webview.js の did-keydown → keybindings.dispatchKeyDown(data, iframe)）。
 * プレビュー等の Akari の webview（viewType が `akari.`）から来たキーはタイムラインのものだが、
 * Claude Code / Codex など拡張の webview から来たキーはその入力欄で打った文字であり、
 * Space の再生・T の文字置き・Backspace の削除などに使ってはいけない。
 */
export type WebviewKeydownSource = 'none' | 'akari' | 'foreign';

export interface WebviewOwnerLike {
    node: { contains(other: unknown): boolean };
    viewType?: string;
}

interface FrameLike { tagName?: string }

export function webviewKeydownSource(focused: FrameLike | null | undefined, target: unknown,
    webviews: Iterable<WebviewOwnerLike>): WebviewKeydownSource {
    const isFrame = (value: unknown): value is FrameLike => !!value && typeof value === 'object'
        && (value as FrameLike).tagName === 'IFRAME';
    const frame = isFrame(focused) ? focused : isFrame(target) ? target : undefined;
    if (!frame) return 'none';
    for (const webview of webviews) {
        if (webview.node.contains(frame)) {
            return typeof webview.viewType === 'string' && webview.viewType.startsWith('akari.') ? 'akari' : 'foreign';
        }
    }
    // 持ち主の分からない iframe は打鍵の中身が見えないので、ショートカットに使わない側へ倒す。
    return 'foreign';
}
