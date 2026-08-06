import { CLOUD_PROVIDER_ID } from './cloud-connections';

/**
 * 接続成立判定（純ロジック・I/O なし）。
 *
 * akari-home-widget.tsx の `readProjectConnected()` / `readAppConnected()` /
 * `readConnected()` と**同じ判定**をここに集約し、パートナー接続ダイアログ
 * （task 2026-08-06-partner-connect-popup）から監視できるようにする。
 *
 * ホーム側（akari-surfaces）は akari-partner より先にビルドされる
 * （`build:ext` の並び。akari-partner-command-contribution.ts の既存コメント参照）ため、
 * この共通モジュールを直接 import できない。ホーム側の同名ロジックは既存のまま
 * 独立して残る — これは意図的な重複であり、`CLOUD_PROVIDER_ID` を home-widget.tsx が
 * 別途ローカル定数として持っている既存の流儀と同じ理由による。
 */

export interface PartnerConnectionRawSnapshot {
    /** `.akari/connections.json` の生テキスト。読めない/無ければ `undefined`。 */
    projectConnectionsRaw: string | undefined;
    /** アプリ単位マーカー（`~/.akari/partner-connection.json`）の生テキスト。読めない/無ければ `undefined`。 */
    appMarkerRaw: string | undefined;
}

/** `connections.json` の `akari-cloud` provider の doctor.status が `ok` か。 */
export function isProjectConnectionsOk(raw: string | undefined): boolean {
    if (raw === undefined) {
        return false;
    }
    try {
        const parsed = JSON.parse(raw);
        const providers: unknown[] = Array.isArray(parsed?.providers) ? parsed.providers : [];
        const partner = providers.find(provider =>
            !!provider && typeof provider === 'object' && (provider as { id?: unknown }).id === CLOUD_PROVIDER_ID
        ) as { doctor?: { status?: unknown } } | undefined;
        return partner?.doctor?.status === 'ok';
    } catch {
        return false;
    }
}

/** アプリ単位マーカーの `status` が `ok` か。 */
export function isAppMarkerOk(raw: string | undefined): boolean {
    if (raw === undefined) {
        return false;
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed?.status === 'ok';
    } catch {
        return false;
    }
}

/** 「プロジェクト単位 or アプリ単位のどちらかが ok」— ホームの `readConnected()` と同じ OR 判定。 */
export function isPartnerConnected(snapshot: PartnerConnectionRawSnapshot): boolean {
    return isProjectConnectionsOk(snapshot.projectConnectionsRaw) || isAppMarkerOk(snapshot.appMarkerRaw);
}
