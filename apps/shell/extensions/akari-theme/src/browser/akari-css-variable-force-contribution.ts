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
//
// 2026-09-05: 反映されないトークンの範囲を実測で洗い直した。
// 起動中のシェルで `--theia-*` を全走査すると、ColorContribution で登録済み
// なのに VS Code 既定値のままのものが 30 個以上残っていた（#252526 の面が
// 11 変数、#454545 の線が 6 変数、選択色の青 #264f78 など）。
// 実際に `#252526` で描かれていた 8 要素はすべて
// `var(--theia-editorWidget-background)` 経由だったので、spec の
// 「#252526 全廃」はこの後勝ち適用でしか閉じられない。
// → 面（背景）・線（枠）・青の残りをまとめてここで固定する。
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
    // 線の階層（spec §2）。ここに列挙したものは「カードの中に、カード外周より
    // 強い線を出さない」の実効値なので、ColorContribution の反映漏れに賭けず
    // 後勝ちで固定する（68 箇所の #262626 の実体が widget/input.border だった）。
    'widget.border': p.lineInner,
    'input.border': p.lineInner,
    'dropdown.border': p.lineInner,
    'checkbox.border': p.lineInner,
    'panel.border': p.lineInner,
    'sideBar.border': p.lineInner,
    'activityBar.border': p.lineInner,
    'tab.border': p.lineInner,
    'editorGroup.border': p.lineInner,
    'editorGroupHeader.tabsBorder': p.lineInner,
    'editorGroupHeader.tabsBackground': p.bg,
    'tab.activeBackground': p.card,
    'tab.inactiveBackground': p.bg,

    // ── VS Code 既定のグレー #252526 が残っていた面（spec §1「#252526 は全廃」）──
    // 実測でここに描かれていたのはホーム / ロールバケットのカード面。
    'editorWidget.background': p.card,
    'editorHoverWidget.background': p.card,
    'editorSuggestWidget.background': p.card,
    // 面だけ直すと文字色が VS Code 既定の #cccccc のまま残り、LP の ink と
    // 半段ずれる（ターミナルのリンク hover ツールチップ等）。対で固定する。
    'editorWidget.foreground': p.ink,
    'editorHoverWidget.foreground': p.ink,
    'editorActionList.background': p.card,
    'quickInput.background': p.card,
    'peekViewResult.background': p.card,
    'peekViewTitle.background': p.card,
    'breadcrumbPicker.background': p.card,
    'listFilterWidget.background': p.card,
    'notifications.background': p.card,
    'notificationCenterHeader.background': p.card,
    'checkbox.selectBackground': p.accentTint,
    'dropdown.background': p.card,
    'settings.checkboxBackground': p.card,
    'settings.dropdownBackground': p.card,
    'settings.textInputBackground': p.card,
    'settings.numberInputBackground': p.card,
    'editorGutter.background': p.bg,
    'breadcrumb.background': p.bg,
    'editorStickyScroll.background': p.bg,
    'editorStickyScrollHover.background': p.elevated,

    // ── VS Code 既定 #454545 / #303031 が残っていた線 ──
    // 浮きもの（メニュー・hover・suggest）は overlay、カードの中は inner。
    'editorWidget.border': p.lineOverlay,
    'editorSuggestWidget.border': p.lineOverlay,
    'editorHoverWidget.border': p.lineOverlay,
    'menu.border': p.lineOverlay,
    'menu.separatorBackground': p.lineOverlay,
    'notifications.border': p.lineOverlay,
    'settings.dropdownBorder': p.lineInner,
    'settings.dropdownListBorder': p.lineInner,
    'settings.textInputBorder': p.lineInner,
    'settings.numberInputBorder': p.lineInner,
    'settings.checkboxBorder': p.lineInner,

    // ── 縦アイコンバー ──
    // ライトでは Theia のテーマ JSON が activityBar.* を握っていて、
    // 実測で background=#ececec（= 地）/ foreground=#000000 /
    // activeBorder=#000000 のまま残っていた。地の色が 1 枚のカードの中に
    // 出ると「カードに穴が空いた」ように見えるので面ごと固定する。
    'activityBar.background': p.bg,
    'activityBar.foreground': p.accent,
    'activityBar.inactiveForeground': p.faint,
    'activityBar.activeBackground': p.accentTint,
    'activityBar.activeBorder': p.accent,
    'activityBar.activeFocusBorder': p.accentLight,
    'sideBar.background': p.bg,
    'panel.background': p.bg,

    // ── ターミナル（既定 #cccccc / #333333 の文字色が LP の ink とずれる） ──
    'terminal.background': p.bg,
    'terminal.foreground': p.ink,
    'terminalCursor.foreground': p.accent,

    // ── スクロールバー・sash（実測でどちらも VS Code 既定のまま残っていた） ──
    // ink を薄めた値。ダークでは白側・ライトでは黒側に寄るので 1 本の式で足りる。
    'scrollbarSlider.background': p.ink + '1f',
    'scrollbarSlider.hoverBackground': p.ink + '33',
    'scrollbarSlider.activeBackground': p.ink + '4d',
    'scrollbar.shadow': '#00000000',
    'sash.hoverBorder': p.accentDark,
    'sash.activeBorder': p.accent,

    // ── 残っていた青（LP 配色に無い色） ──
    'editor.selectionBackground': p.accent + '40',
    'terminal.selectionBackground': p.accent + '40',
    'list.inactiveSelectionBackground': p.accentTintDeep,
    'inputValidation.infoBorder': p.accentDark,
    'radio.activeBorder': p.accentDark
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
        const light = type === 'light' || type === 'hcLight';
        const palette = light ? LIGHT : DARK;
        const root = document.documentElement.style;
        for (const [id, value] of Object.entries(forced(palette))) {
            root.setProperty(`--theia-${id.replace(/\./g, '-')}`, value);
        }
        // ネイティブフォームコントロールの配色スキーム。
        // シェルの document には color-scheme が無く、OS 既定（ライト）で描かれる。
        // accent-color（akari-button-style-contribution.ts）が効くのは **チェック時だけ**で、
        // 未チェックのチェックボックス／ラジオは macOS 既定の白い箱のまま残り、
        // ダークのカードの上で最も明るい面になってしまう（設定パネルで実測）。
        // color-scheme を渡すと未チェック時もブラウザが暗い箱を描く。
        // ライトは既定と同じなので実質ダーク専用の修正。
        root.setProperty('color-scheme', light ? 'light' : 'dark');
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
        root.setProperty('--akari-line', light ? 'rgba(0, 0, 0, 0.13)' : 'rgba(255, 255, 255, 0.13)');
        // カードの中の区切り（レール仕切り・タブ下・セクション境）。
        // --akari-line より必ず弱い（spec §2 / 値の由来は akari-theme-tokens.ts）。
        root.setProperty('--akari-line-inner', palette.lineInner);
        root.setProperty('--akari-muted', palette.muted);
        root.setProperty('--akari-faint', palette.faint);
    }
}
