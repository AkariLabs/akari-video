import { PartnerAgentId, PartnerConnectionMarker } from './akari-partner-protocol';

/**
 * アプリ単位マーカーの中身を組み立てるだけの純関数（DOM も fs も触らない）。
 * 置き場の解決と書き込みは node 側（`../node/partner-connection-writer.ts`）が
 * 担い、ここは「何を書くか」だけを持つ。
 */

/** ホームディレクトリ配下の AKARI 共有ディレクトリ名（`update-check.json` と同じ場所）。 */
export const AKARI_HOME_DIRNAME = '.akari';

/** アプリ単位マーカーのファイル名。 */
export const PARTNER_CONNECTION_MARKER_FILENAME = 'partner-connection.json';

/** マーカーのスキーマ版（`update-check.json` と同じく単調増加の整数）。 */
export const PARTNER_CONNECTION_MARKER_SCHEMA = 1;

export function buildPartnerConnectionMarker(
    agent: PartnerAgentId,
    executablePath: string,
    connectedAt: string
): PartnerConnectionMarker {
    return {
        schema: PARTNER_CONNECTION_MARKER_SCHEMA,
        status: 'ok',
        agent,
        executablePath,
        connected_at: connectedAt
    };
}
