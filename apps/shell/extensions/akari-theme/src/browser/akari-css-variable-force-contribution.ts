import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ThemeService } from '@theia/core/lib/browser/theming';

// 実測した既知の挙動（akari-color-contribution.ts のヘッダコメント参照）:
// ColorContribution 経由で button.* / focusBorder / editor.background /
// progressBar.background 等の一部トークンを上書きしても、実機の
// `--theia-<id>` CSS 変数には反映されないことがある（Theia/monaco 側の
// 色解決がどこかで早期キャッシュされていると推測、根本原因は未特定）。
// 一方で statusBar.background 等の大半のトークンは正しく反映される。
//
// ColorApplicationContribution が `themeService.initialized` 解決後に
// 初回の CSS 変数書き込みを行うため、同じ Promise に自分の適用も乗せて
// 「後勝ち」で確実に上書きする（documentElement.style.setProperty は
// 単純な最後勝ちなので、後から呼べば必ず反映される）。
const FORCED: Record<string, string> = {
    'focusBorder': '#fb923c',
    'button.background': '#f97316',
    'button.foreground': '#0a0a0a',
    'button.hoverBackground': '#fb923c',
    'button.secondaryBackground': '#141414',
    'button.secondaryForeground': '#e5e5e5',
    'button.secondaryHoverBackground': '#1a1a1a',
    'secondaryButton.background': '#141414',
    'secondaryButton.foreground': '#e5e5e5',
    'secondaryButton.hoverBackground': '#1a1a1a',
    'list.activeSelectionBackground': '#26160c',
    'list.activeSelectionForeground': '#fdba74',
    'list.hoverBackground': '#1a1a1a',
    'list.highlightForeground': '#fb923c',
    'editor.background': '#0a0a0a',
    'editor.foreground': '#e5e5e5',
    'editorCursor.foreground': '#f97316',
    'activityBarBadge.background': '#f97316',
    'activityBarBadge.foreground': '#0a0a0a',
    'progressBar.background': '#f97316',
    'badge.background': '#f97316',
    'badge.foreground': '#0a0a0a',
    'textLink.foreground': '#fb923c',
    'textLink.activeForeground': '#fdba74',
    'menu.background': '#141414',
    'menu.selectionBackground': '#26160c',
    'menu.selectionForeground': '#fdba74',
    'input.background': '#141414',
    'inputOption.activeBorder': '#ea580c',
    'inputOption.activeBackground': '#26160c',
    'checkbox.background': '#141414',
    'widget.border': '#262626'
};

@injectable()
export class AkariCssVariableForceContribution implements FrontendApplicationContribution {

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    onStart(): void {
        this.themeService.initialized.then(() => this.apply());
        // 保険: プリファレンス反映等で ColorApplicationContribution が
        // 再度 update() を走らせるケースに備え、少し遅らせてもう一度適用する。
        window.setTimeout(() => this.apply(), 1500);
    }

    protected apply(): void {
        const root = document.documentElement.style;
        for (const [id, value] of Object.entries(FORCED)) {
            root.setProperty(`--theia-${id.replace(/\./g, '-')}`, value);
        }
    }
}
