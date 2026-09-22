import { injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AKARI_SETTINGS_UI_CSS } from '../settings/settings-ui-style';

// 表示属性の付与漏れやフェード中の detach で透明のまま残らないよう、フェードインは行わない。
export const AKARI_SETTINGS_DIALOG_CSS = `
[data-akari-settings-dialog] [data-akari-settings-section][hidden] {
    display: none !important;
}

.lm-Widget.dialogOverlay[data-akari-settings-dialog] {
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    background: rgba(0, 0, 0, .45);
    transition: opacity 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .lm-Widget.dialogOverlay[data-akari-settings-dialog] {
        transition: none;
    }
}
`;

@injectable()
export class AkariSettingsDialogStyleContribution implements FrontendApplicationContribution {
    onStart(): void {
        // 背景のブラーと、ダイアログ内の部品（settings/settings-ui-style.ts）は別の <style> に分けて持つ。
        for (const [id, css] of [['akari-settings-dialog-backdrop', AKARI_SETTINGS_DIALOG_CSS], ['akari-settings-dialog-ui', AKARI_SETTINGS_UI_CSS]]) {
            if (document.getElementById(id)) { continue; }
            const style = document.createElement('style');
            style.id = id;
            style.textContent = css;
            document.head.appendChild(style);
        }
    }
}
