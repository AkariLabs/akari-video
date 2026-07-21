import { Disposable, DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';

const IDLE_FLUSH_MS = 700;

// Simplified ANSI/OSC escape stripping (contract §T4-2: "簡易処理で可" — full
// rendering fidelity is out of scope for v0; the bar is "injection reaches +
// the reply is readable in the gawa"). The ESC byte is built via
// String.fromCharCode so no raw control character sits in the source file.
const ESC = String.fromCharCode(27);
const OSC_PATTERN = new RegExp(ESC + '\\][^\\u0007]*(?:\\u0007|' + ESC + '\\\\)', 'g');
const CSI_PATTERN = new RegExp(ESC + '\\[[0-9;?]*[ -/]*[@-~]', 'g');
const CHARSET_PATTERN = new RegExp(ESC + '[()#][0-9A-Za-z@]', 'g');
const LONE_ESC_PATTERN = new RegExp(ESC, 'g');

export function stripAnsi(input: string): string {
    return input
        .replace(OSC_PATTERN, '')
        .replace(CSI_PATTERN, '')
        .replace(CHARSET_PATTERN, '')
        .replace(LONE_ESC_PATTERN, '')
        .replace(/\r/g, '');
}

/**
 * チャットガワが依存する最小 API（契約 §4 レーン B / task.md 指示5「ガワの API
 * を薄く保つ」）。ガワ（吹き出し UI）はこのインターフェースだけを見て組む。
 * 裏の実体を隠しターミナル CLI から中期の Agent SDK 自前ペインへ差し替えても、
 * ガワ側のコードは無変更で済む構造にするための境界。
 */
export interface PartnerChannel extends Disposable {
    /** テキスト化・簡易 ANSI 除去済みの応答チャンク。 */
    readonly onReply: Event<string>;
    /** ユーザー発話をパートナーへ注入する。 */
    send(text: string): void;
}

/**
 * PartnerChannel の v0 実装。既存の隠しターミナル（PARTNER_TERMINAL_KIND =
 * 'akari-partner'、partner-session-service.ts と同じ PTY）を Terminal API の
 * sendText/onOutput だけで叩く。VS Code / Theia 拡張の入力欄への外部注入は
 * しない（契約 §1-4 / task.md 禁止事項）。
 */
export class TerminalPartnerChannel implements PartnerChannel {

    protected readonly onReplyEmitter = new Emitter<string>();
    readonly onReply: Event<string> = this.onReplyEmitter.event;

    protected readonly toDispose = new DisposableCollection();
    protected pending = '';
    protected idleTimer?: ReturnType<typeof setTimeout>;

    constructor(protected readonly terminal: TerminalWidget) {
        this.toDispose.push(this.onReplyEmitter);
        this.toDispose.push(terminal.onOutput(chunk => this.onChunk(chunk)));
    }

    send(text: string): void {
        const trimmed = text.trim();
        if (!trimmed || this.terminal.isDisposed) {
            return;
        }
        this.terminal.sendText(`${trimmed}\r`);
    }

    protected onChunk(chunk: string): void {
        const clean = stripAnsi(chunk);
        if (!clean.trim()) {
            return;
        }
        this.pending += clean;
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        // PTY 出力はストリーミングで小刻みに届く。idle 判定でまとめてから
        // 1 つの AI 吹き出しとして流す（partner-session-service.ts の
        // PTY_IDLE_THRESHOLD_MS と同じ思想、ガワ表示向けに短め）。
        this.idleTimer = setTimeout(() => this.flush(), IDLE_FLUSH_MS);
    }

    protected flush(): void {
        this.idleTimer = undefined;
        const text = this.pending.trim();
        this.pending = '';
        if (text) {
            this.onReplyEmitter.fire(text);
        }
    }

    dispose(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
        this.toDispose.dispose();
    }
}
