import { interfaces } from '@theia/core/shared/inversify';

/**
 * 1 枚の画面 v0 — チャンネルの左パネル（契約 §3 レーン K）の束ね口。
 * 司令塔が frontend module に呼び出し行だけ先に配線した空殻。レーン K が
 * `channel/` 配下の widget・`AkariChannelContextService` の binding をここに足す。
 */
export function bindChannelPanel(_bind: interfaces.Bind): void {
    // レーン K が埋める。
}
