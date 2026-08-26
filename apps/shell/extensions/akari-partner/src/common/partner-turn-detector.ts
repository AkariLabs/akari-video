/**
 * パートナー PTY の「処理が終わった」を出力ストリームから推定する純ロジック
 * （task 2026-08-25-shell-window-and-notify ①完了通知）。
 *
 * 前提（実測に基づく）: Claude Code / Codex / opencode の TUI は応答生成・ツール実行中、
 * スピナー再描画やストリーミングで PTY 出力がほぼ途切れず流れ続ける。ユーザー入力待ちに
 * なると画面は静止し出力が止まる。そこで:
 *
 *   - 「間隔 maxGapMs 未満で出力が続く連なり（burst）」が armAfterMs 以上続いたら
 *     「処理中」と判定（armed）。キー入力エコーのような散発出力では armed にならない。
 *   - armed の状態で idleFireMs 以上出力が止まったら「処理が終わった」（turn end）。
 *   - BEL (\x07) は CLI 側の明示的な通知（Claude Code の terminal_bell 等）なので、
 *     armed に関係なく即時に「要注意」イベントとして扱う。
 *
 * タイマー管理・通知表示は browser 層（PartnerTurnNotifier）が担い、このクラスは
 * 状態遷移だけを持つ（node --test で単体検証できるように window/DOM へ依存しない）。
 */

export interface PartnerTurnDetectorOptions {
    /** この間隔（ms）未満で続く出力を一つの burst とみなす。 */
    maxGapMs?: number;
    /** burst がこの長さ（ms）続いたら「処理中」と判定する。 */
    armAfterMs?: number;
    /** 処理中判定の後、この長さ（ms）出力が止まったら「処理が終わった」。 */
    idleFireMs?: number;
}

export const PARTNER_TURN_DETECTOR_DEFAULTS: Required<PartnerTurnDetectorOptions> = {
    maxGapMs: 1200,
    armAfterMs: 3000,
    idleFireMs: 2000
};

export interface PartnerTurnFeedResult {
    /** chunk に BEL が含まれていた（CLI の明示通知）。 */
    bell: boolean;
    /** 現在「処理中」と判定しているか。 */
    armed: boolean;
}

export class PartnerTurnDetector {

    protected readonly options: Required<PartnerTurnDetectorOptions>;
    protected burstStartAt = -1;
    protected lastOutputAt = -1;
    protected armed = false;

    constructor(options: PartnerTurnDetectorOptions = {}) {
        this.options = { ...PARTNER_TURN_DETECTOR_DEFAULTS, ...options };
    }

    get isArmed(): boolean {
        return this.armed;
    }

    /** 出力 chunk を 1 つ観測する。 */
    feed(chunk: string, nowMs: number): PartnerTurnFeedResult {
        const bell = chunk.includes('\u0007');
        if (this.lastOutputAt < 0 || nowMs - this.lastOutputAt > this.options.maxGapMs) {
            this.burstStartAt = nowMs;
        }
        this.lastOutputAt = nowMs;
        if (!this.armed && nowMs - this.burstStartAt >= this.options.armAfterMs) {
            this.armed = true;
        }
        if (bell) {
            // BEL 自体を通知するので、直後の静止をもう一度 turn end として重ねない。
            this.armed = false;
        }
        return { bell, armed: this.armed };
    }

    /**
     * アイドル判定。armed かつ idleFireMs 以上出力が無ければ true（一度だけ）を返す。
     * タイマー満了時に呼ぶ想定（早すぎた場合は false のままなので再スケジュールする）。
     */
    checkTurnEnd(nowMs: number): boolean {
        if (!this.armed || this.lastOutputAt < 0) {
            return false;
        }
        if (nowMs - this.lastOutputAt >= this.options.idleFireMs) {
            this.armed = false;
            return true;
        }
        return false;
    }

    /** 次の checkTurnEnd を予約すべき遅延（ms）。armed でなければ undefined。 */
    nextCheckDelayMs(nowMs: number): number | undefined {
        if (!this.armed || this.lastOutputAt < 0) {
            return undefined;
        }
        return Math.max(0, this.options.idleFireMs - (nowMs - this.lastOutputAt));
    }
}
