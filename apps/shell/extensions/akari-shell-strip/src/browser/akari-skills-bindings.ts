import { interfaces } from '@theia/core/shared/inversify';

/**
 * 1 枚の画面 v0 — スキルの左パネル（契約 §3 レーン S）の束ね口。
 * 司令塔が frontend module に呼び出し行だけ先に配線した空殻。レーン S が
 * `skills/` 配下の widget と `common/skill-catalog.ts` の binding をここに足す。
 */
export function bindSkillsPanel(_bind: interfaces.Bind): void {
    // レーン S が埋める。
}
