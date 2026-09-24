import type { ConnectionDoctor } from '../common/akari-connections-protocol';

/** A read-only fal request. Only an actual successful HTTP response counts as connected. */
export async function checkFalImageAiConnection(secret: string | undefined,
    fetchImpl: typeof fetch = fetch): Promise<ConnectionDoctor> {
    const checked = new Date().toISOString();
    if (!secret) return { status: 'unconfigured', detail: 'キーを設定すると使えます。', last_checked: checked };
    try {
        const response = await fetchImpl('https://rest.alpha.fal.ai/billing/user_balance', {
            method: 'GET', headers: { Authorization: `Key ${secret}` }, signal: AbortSignal.timeout(10000)
        });
        return response.ok ? { status: 'ok', detail: '接続できました。', last_checked: checked }
            : response.status === 401 || response.status === 403
                ? { status: 'unauthorized', detail: 'キーを確認してください。', last_checked: checked }
                : { status: 'unchecked', detail: `接続を確認できませんでした（HTTP ${response.status}）。`, last_checked: checked };
    } catch { return { status: 'unchecked', detail: '接続を確認できませんでした。ネットワークを確認してください。', last_checked: checked }; }
}
