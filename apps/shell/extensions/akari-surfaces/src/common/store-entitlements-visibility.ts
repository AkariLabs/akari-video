import type { AssetEntitlementsStatus } from 'akari-project/lib/common/akari-project-protocol';

export const STORE_RECONNECT_REQUIRED_MESSAGE =
    '再接続が必要（別の端末で接続されたため解除された可能性）';

/** 保存済み資格情報があり、API が認証失効を返した場合だけ再接続を案内する。 */
export function storeReconnectRequired(
    connected: boolean,
    entitlementsStatus: AssetEntitlementsStatus
): boolean {
    return connected && entitlementsStatus === 'unauthorized';
}
