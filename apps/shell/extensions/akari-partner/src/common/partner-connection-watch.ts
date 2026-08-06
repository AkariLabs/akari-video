import { isPartnerConnected } from './connection-status';

export type PartnerConnectionState = 'disconnected' | 'connected';

/**
 * 接続ガイドダイアログが 1 回分の判定に必要とする最小の読み取り契約
 * （`cloud-connections.ts` の `ConnectionsFileAccess` と同じ「読めなければ
 * `undefined` を返す」流儀）。実装（Theia `FileService` 経由の読み取り）は
 * browser 側（`akari-partner-widget.tsx`）が持つ — ここは純ロジックのみ。
 */
export interface PartnerConnectionSnapshotAccess {
    readProjectConnections(): Promise<string | undefined>;
    readAppMarker(): Promise<string | undefined>;
}

/** 1 回分の判定。 */
export async function checkPartnerConnection(access: PartnerConnectionSnapshotAccess): Promise<PartnerConnectionState> {
    const [projectConnectionsRaw, appMarkerRaw] = await Promise.all([
        access.readProjectConnections(),
        access.readAppMarker()
    ]);
    return isPartnerConnected({ projectConnectionsRaw, appMarkerRaw }) ? 'connected' : 'disconnected';
}

/**
 * 「未接続 → 接続」の遷移だけを一度きり検知する。
 *
 * ダイアログの契約（task 2026-08-06-partner-connect-popup 指示3）は「成立したら
 * ③ 接続完了へ切り替える。完了表示は無通知の自動クローズをしない」— つまり
 * 遷移の通知は 1 回で足り、以後 disconnected に戻っても（PTY 終了等）再度
 * connected を報告しても再発火しない（フラッピング防止）。
 */
export class PartnerConnectionTransitionDetector {
    protected fired = false;
    protected last: PartnerConnectionState = 'disconnected';

    /** 新しい状態を投入し、「このタイミングで新規に connected へ遷移したか」を返す。 */
    ingest(state: PartnerConnectionState): boolean {
        const justConnected = !this.fired && state === 'connected';
        if (justConnected) {
            this.fired = true;
        }
        this.last = state;
        return justConnected;
    }

    get state(): PartnerConnectionState {
        return this.last;
    }
}
