import { injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';

// 表示属性の付与漏れやフェード中の detach で透明のまま残らないよう、フェードインは行わない。
export const AKARI_SETTINGS_DIALOG_CSS = `
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
        if (document.getElementById('akari-settings-dialog-backdrop')) { return; }
        const style = document.createElement('style');
        style.id = 'akari-settings-dialog-backdrop';
        style.textContent = AKARI_SETTINGS_DIALOG_CSS;
        document.head.appendChild(style);
    }
}
