import { interfaces } from '@theia/core/shared/inversify';

/**
 * 1 枚の画面 v0 — ホーム側の追加の束ね口（契約 §3 レーン H）。
 * 司令塔が frontend module に呼び出し行だけ先に配線した空殻。レーン H がここに
 * 「プロジェクト一覧」タブ・開く確認・閉じる などの binding を足す。
 */
export function bindHomeOneShell(_bind: interfaces.Bind): void {
    // レーン H が埋める。
}
