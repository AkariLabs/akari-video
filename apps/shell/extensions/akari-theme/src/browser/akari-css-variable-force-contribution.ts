import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { AkariPalette, DARK, LIGHT } from './akari-theme-tokens';

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
//
// 2026-07-30: 値をダーク直値からパレット参照に変更し、テーマ切替にも追随する
// （切替時は ColorApplicationContribution が全変数を書き直すため、
// onDidColorThemeChange でも同じ「後勝ち」適用をやり直す）。
const forced = (p: AkariPalette): Record<string, string> => ({
    'focusBorder': p.accentLight,
    'button.background': p.accent,
    'button.foreground': p.bg,
    'button.hoverBackground': p.accentLight,
    'button.secondaryBackground': p.card,
    'button.secondaryForeground': p.ink,
    'button.secondaryHoverBackground': p.elevated,
    'secondaryButton.background': p.card,
    'secondaryButton.foreground': p.ink,
    'secondaryButton.hoverBackground': p.elevated,
    'list.activeSelectionBackground': p.accentTint,
    'list.activeSelectionForeground': p.accentLighter,
    'list.hoverBackground': p.elevated,
    'list.highlightForeground': p.accentLight,
    'editor.background': p.bg,
    'editor.foreground': p.ink,
    'editorCursor.foreground': p.accent,
    'activityBarBadge.background': p.accent,
    'activityBarBadge.foreground': p.bg,
    'progressBar.background': p.accent,
    'badge.background': p.accent,
    'badge.foreground': p.bg,
    'textLink.foreground': p.accentLight,
    'textLink.activeForeground': p.accentLighter,
    'menu.background': p.card,
    'menu.selectionBackground': p.accentTint,
    'menu.selectionForeground': p.accentLighter,
    'input.background': p.card,
    'inputOption.activeBorder': p.accentDark,
    'inputOption.activeBackground': p.accentTint,
    'checkbox.background': p.card,
    'widget.border': p.border
});

@injectable()
export class AkariCssVariableForceContribution implements FrontendApplicationContribution {

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    onStart(): void {
        this.themeService.initialized.then(() => this.apply());
        this.themeService.onDidColorThemeChange(() => {
            this.apply();
            // ColorApplicationContribution 側の書き直しに対する「後勝ち」保険。
            window.setTimeout(() => this.apply(), 100);
        });
        // 保険: プリファレンス反映等で ColorApplicationContribution が
        // 再度 update() を走らせるケースに備え、少し遅らせてもう一度適用する。
        window.setTimeout(() => this.apply(), 1500);
    }

    protected apply(): void {
        const type = this.themeService.getCurrentTheme().type;
        const palette = type === 'light' || type === 'hcLight' ? LIGHT : DARK;
        const root = document.documentElement.style;
        for (const [id, value] of Object.entries(forced(palette))) {
            root.setProperty(`--theia-${id.replace(/\./g, '-')}`, value);
        }
        // akari-button-style-contribution.ts の注入 CSS が参照する自前変数。
        // --theia-* と違い他所から書き換えられないので、テーマ追従はここで一元管理する。
        root.setProperty('--akari-accent', palette.accent);
        root.setProperty('--akari-accent-light', palette.accentLight);
        root.setProperty('--akari-card', palette.card);
        root.setProperty('--akari-elevated', palette.elevated);
        root.setProperty('--akari-bg', palette.bg);
        root.setProperty('--akari-ink', palette.ink);
        // akari-shell-card-layout.ts が参照するカードレイアウト用の 2 値。
        // ground = カードの隙間から覗く面。line = カードのヘアライン輪郭
        // （オーナー確定値 alpha 0.13。ダークは白・ライトは黒を薄く重ねる）。
        root.setProperty('--akari-ground', palette.bgDeep);
        root.setProperty(
            '--akari-line',
            type === 'light' || type === 'hcLight' ? 'rgba(0, 0, 0, 0.13)' : 'rgba(255, 255, 255, 0.13)'
        );
    }
}
