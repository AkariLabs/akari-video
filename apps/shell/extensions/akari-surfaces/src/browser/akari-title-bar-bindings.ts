import { interfaces } from '@theia/core/shared/inversify';

/**
 * 1 枚の画面 v0 — 上の帯（窓の帯）の束ね口（契約 §3 レーン T）。
 * 司令塔が frontend module に呼び出し行だけ先に配線した空殻。レーン T が
 * `title-bar/` 配下の contribution と Theia `ElectronMenuContribution` の rebind をここに足す。
 */
export function bindTitleBar(_bind: interfaces.Bind, _rebind: interfaces.Rebind): void {
    // レーン T が埋める。
}
