export const RESTYLE_DEBOUNCE_MS = 250;
export const RESTYLE_MIN_INTERVAL_MS = 1000;
// 変数消失から 60 秒以内の自己修復、アイドル再送 2 回/分以下が受け入れ条件。
// 45 s なら最悪 45 s（60 s 未満）で復帰し、1.33 回/分（2 以下）に収まる。
export const RESTYLE_HEARTBEAT_MS = 45000;

/** 時計・タイマー・DOM に依存しない、widget ごとの再送判定。時刻は単調増加の ms。 */
export class AkariWebviewRestyleScheduler {
    private eventDueAt: number | undefined;
    private lastSentAt = -Infinity;

    requestEvent(now: number): void {
        this.eventDueAt = now + RESTYLE_DEBOUNCE_MS;
    }

    takeEvent(now: number, visible: boolean): boolean {
        if (this.eventDueAt === undefined || now < this.eventDueAt) {
            return false;
        }
        this.eventDueAt = undefined;
        return this.takeSend(now, visible);
    }

    takeHeartbeat(now: number, visible: boolean): boolean {
        return this.takeSend(now, visible);
    }

    private takeSend(now: number, visible: boolean): boolean {
        if (!visible || now - this.lastSentAt < RESTYLE_MIN_INTERVAL_MS) {
            return false;
        }
        this.lastSentAt = now;
        this.eventDueAt = undefined;
        return true;
    }
}
