import { t } from '@akari-video/i18n';
import { injectable } from '@theia/core/shared/inversify';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { ColorDefinition } from '@theia/core/lib/common/color';
import { AkariPalette, DARK, LIGHT } from './akari-theme-tokens';

/**
 * 起動時の既定テーマ（Theia 標準 'dark'）が使う workbench 配色トークンを
 * LP と同一の黒×オレンジへ丸ごと上書きする ColorContribution。
 * トークンの実値は akari-theme-tokens.ts（DARK / LIGHT の 2 表）が正典。
 *
 * dark_plus.json（既定エディタテーマ）は "colors" セクションを持たない
 * （syntax highlight のみを定義）ため、ここで登録する defaults がそのまま
 * 全 workbench 色の実値になる（テーマ固有 override に負けない）。
 *
 * dark/hcDark には LP のダーク値、light/hcLight には対になる白×オレンジ値を
 * 設定する（2026-07-30 まで全枠ダーク値だったが、設定画面が「ライト」を
 * 正式に提供しているため、ライト選択時に黒背景×ライト文字色が混ざって
 * 崩れていた。上書きしないトークンは各テーマの既定値に落ちるので、
 * 背景系だけ黒に固定される構図だった）。
 */
@injectable()
export class AkariColorContribution implements ColorContribution {

    registerColors(colors: ColorRegistry): void {
        colors.register(...this.definitions());
    }

    protected definitions(): ColorDefinition[] {
        const solid = (value: string): ColorDefinition['defaults'] => ({
            dark: value, light: value, hcDark: value, hcLight: value
        });
        const palette = (key: keyof AkariPalette): ColorDefinition['defaults'] => ({
            dark: DARK[key], hcDark: DARK[key], light: LIGHT[key], hcLight: LIGHT[key]
        });
        // 半透明はパレットに置けない（トークン表は不透明値の正典）ので、
        // 「下地が何であれ薄く重ねたい」ものはパレット色 + 8 桁 hex の alpha で作る。
        // ink を薄めるとダークでは白側・ライトでは黒側に寄るので、1 本の式で
        // 両テーマとも「面から少しだけ浮く」になる。
        const ta = (key: keyof AkariPalette, a: string): ColorDefinition['defaults'] => ({
            dark: DARK[key] + a, hcDark: DARK[key] + a, light: LIGHT[key] + a, hcLight: LIGHT[key] + a
        });

        return [
            { id: 'akariTheme.placedTextBlue', defaults: palette('placedTextBlue'), description: t('theme.colors.definitionsPlacedTextBlue.description') },
            { id: 'akariTheme.placedTextViolet', defaults: palette('placedTextViolet'), description: t('theme.colors.definitionsPlacedTextPurple.description') },
            { id: 'akariTheme.placedTextGreen', defaults: palette('placedTextGreen'), description: t('theme.colors.definitionsPlacedTextGreen.description') },
            { id: 'akariTheme.placedTextPink', defaults: palette('placedTextPink'), description: t('theme.colors.definitionsPlacedTextPink.description') },
            { id: 'akariTheme.placedTextOrange', defaults: palette('placedTextOrange'), description: t('theme.colors.definitionsPlacedTextOrange.description') },
            { id: 'akariTheme.placedTextCyan', defaults: palette('placedTextCyan'), description: t('theme.colors.definitionsPlacedTextCyan.description') },
            { id: 'akariTheme.placedTextYellow', defaults: palette('placedTextYellow'), description: t('theme.colors.definitionsPlacedTextYellow.description') },
            { id: 'akariTheme.placedTextRed', defaults: palette('placedTextRed'), description: t('theme.colors.definitionsPlacedTextRed.description') },
            // --- AKARI 独自トークン（既存 VS Code 標準色に該当が無い LP 概念。
            //     webview 内では --vscode-akariTheme-* として同じ値がミラーされる） ---
            { id: 'akariTheme.accent', defaults: palette('accent'), description: 'AKARI LP accent' },
            { id: 'akariTheme.accentLight', defaults: palette('accentLight'), description: 'AKARI LP accent-light' },
            { id: 'akariTheme.accentTint', defaults: palette('accentTint'), description: t('theme.colors.definitionsAkariLpAccentTintSelectionActiveBackground.description') },
            { id: 'akariTheme.accentTintDeep', defaults: palette('accentTintDeep'), description: 'AKARI LP accent-tint-deep' },

            // --- ステータスバー（既定 #007acc 系 青を全廃） ---
            { id: 'statusBar.background', defaults: palette('bgDeep'), description: 'override' },
            { id: 'statusBar.foreground', defaults: palette('faint'), description: 'override' },
            { id: 'statusBar.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'statusBar.noFolderBackground', defaults: palette('bgDeep'), description: 'override' },
            { id: 'statusBar.noFolderForeground', defaults: palette('faint'), description: 'override' },
            { id: 'statusBarItem.remoteBackground', defaults: palette('card'), description: 'override' },
            { id: 'statusBarItem.remoteForeground', defaults: palette('ink'), description: 'override' },
            { id: 'statusBarItem.hoverBackground', defaults: palette('elevated'), description: 'override' },
            { id: 'statusBarItem.activeBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'statusBarItem.prominentBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'statusBarItem.prominentForeground', defaults: palette('accentLighter'), description: 'override' },

            // --- focusBorder（青いフォーカスリングを全廃） ---
            { id: 'focusBorder', defaults: palette('accentLight'), description: 'override' },

            // --- ボタン（button.background 系。プラスボタン等の青を全廃） ---
            { id: 'button.background', defaults: palette('accent'), description: 'override' },
            { id: 'button.foreground', defaults: palette('bg'), description: 'override' },
            { id: 'button.hoverBackground', defaults: palette('accentLight'), description: 'override' },
            { id: 'button.border', defaults: palette('accentDark'), description: 'override' },
            { id: 'button.secondaryBackground', defaults: palette('card'), description: 'override' },
            { id: 'button.secondaryForeground', defaults: palette('ink'), description: 'override' },
            { id: 'button.secondaryHoverBackground', defaults: palette('elevated'), description: 'override' },
            // Theia 独自の secondaryButton.* id（.theia-button.secondary が直接参照する。
            // 上の button.secondary* とは別の色 id なので両方上書きする）。
            { id: 'secondaryButton.background', defaults: palette('card'), description: 'override' },
            { id: 'secondaryButton.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'secondaryButton.hoverBackground', defaults: palette('elevated'), description: 'override' },

            // --- 選択・アクティブ背景（list.activeSelection・editor.selection 系） ---
            { id: 'list.activeSelectionBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'list.activeSelectionForeground', defaults: palette('accentLighter'), description: 'override' },
            { id: 'list.activeSelectionIconForeground', defaults: palette('accentLighter'), description: 'override' },
            { id: 'list.inactiveSelectionBackground', defaults: palette('accentTintDeep'), description: 'override' },
            { id: 'list.inactiveSelectionForeground', defaults: palette('ink'), description: 'override' },
            { id: 'list.hoverBackground', defaults: palette('elevated'), description: 'override' },
            { id: 'list.hoverForeground', defaults: palette('ink'), description: 'override' },
            { id: 'list.focusBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'list.focusForeground', defaults: palette('accentLighter'), description: 'override' },
            { id: 'list.focusOutline', defaults: palette('accentLight'), description: 'override' },
            { id: 'list.highlightForeground', defaults: palette('accentLight'), description: t('theme.colors.definitionsOverrideHighlightSearchQuickOpenMatchesBlue.description') },
            { id: 'list.dropBackground', defaults: palette('accentTintDeep'), description: 'override' },
            { id: 'list.inactiveFocusBackground', defaults: palette('accentTintDeep'), description: 'override' },

            { id: 'editor.background', defaults: palette('bg'), description: 'override' },
            { id: 'editor.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'editor.selectionBackground', defaults: solid('#f9731640'), description: 'override（accent 25% alpha）' },
            { id: 'editor.inactiveSelectionBackground', defaults: solid('#f9731626'), description: 'override（accent 15% alpha）' },
            { id: 'editor.selectionHighlightBackground', defaults: solid('#f9731633'), description: 'override（accent 20% alpha）' },
            { id: 'editor.lineHighlightBackground', defaults: palette('card'), description: 'override' },
            { id: 'editor.lineHighlightBorder', defaults: palette('lineInner'), description: 'override' },
            { id: 'editorCursor.foreground', defaults: palette('accent'), description: 'override' },
            { id: 'editorLineNumber.foreground', defaults: palette('faint'), description: 'override' },
            { id: 'editorLineNumber.activeForeground', defaults: palette('accentLight'), description: 'override' },
            { id: 'editorWidget.background', defaults: palette('card'), description: 'override' },
            { id: 'editorWidget.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'editorWidget.border', defaults: palette('lineOverlay'), description: 'override' },
            { id: 'editorHoverWidget.background', defaults: palette('card'), description: 'override' },
            { id: 'editorHoverWidget.border', defaults: palette('lineOverlay'), description: 'override' },
            { id: 'editorGutter.background', defaults: palette('bg'), description: 'override' },

            // --- アクティビティバーのアクティブ表示 ---
            // カードレイアウト（akari-shell-card-layout.ts）では縦アイコンバーは
            // パネルと同じ 1 枚のカードの中に同居する。地の色（bgDeep）のままだと
            // カードに穴が空いて見えるため、パネル面と同じ bg に合わせる。
            { id: 'activityBar.background', defaults: palette('bg'), description: 'override' },
            { id: 'activityBar.foreground', defaults: palette('accent'), description: 'override' },
            { id: 'activityBar.inactiveForeground', defaults: palette('faint'), description: 'override' },
            { id: 'activityBar.activeBorder', defaults: palette('accent'), description: 'override' },
            { id: 'activityBar.activeBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'activityBar.activeFocusBorder', defaults: palette('accentLight'), description: 'override' },
            { id: 'activityBar.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'activityBarBadge.background', defaults: palette('accent'), description: 'override' },
            { id: 'activityBarBadge.foreground', defaults: palette('bg'), description: 'override' },

            // --- 進捗・バッジ・リンク色 ---
            { id: 'progressBar.background', defaults: palette('accent'), description: 'override' },
            { id: 'badge.background', defaults: palette('accent'), description: 'override' },
            { id: 'badge.foreground', defaults: palette('bg'), description: 'override' },
            { id: 'textLink.foreground', defaults: palette('accentLight'), description: 'override' },
            { id: 'textLink.activeForeground', defaults: palette('accentLighter'), description: 'override' },

            // --- タイトルバー・パネル最深部 ---
            { id: 'titleBar.activeBackground', defaults: palette('bgDeep'), description: 'override' },
            { id: 'titleBar.activeForeground', defaults: palette('faint'), description: 'override' },
            { id: 'titleBar.inactiveBackground', defaults: palette('bgDeep'), description: 'override' },
            { id: 'titleBar.inactiveForeground', defaults: palette('faint'), description: 'override' },
            { id: 'titleBar.border', defaults: palette('lineInner'), description: 'override' },

            // --- メニュー（ドロップダウン・コンテキストメニュー） ---
            { id: 'menu.background', defaults: palette('card'), description: 'override' },
            { id: 'menu.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'menu.selectionBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'menu.selectionForeground', defaults: palette('accentLighter'), description: 'override' },
            { id: 'menu.separatorBackground', defaults: palette('lineOverlay'), description: 'override' },
            { id: 'menu.border', defaults: palette('lineOverlay'), description: 'override' },
            { id: 'menubar.selectionBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'menubar.selectionForeground', defaults: palette('accentLighter'), description: 'override' },

            // --- パネル・サイドバー ---
            { id: 'panel.background', defaults: palette('bg'), description: 'override' },
            { id: 'panel.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'panelTitle.activeForeground', defaults: palette('ink'), description: 'override' },
            { id: 'panelTitle.activeBorder', defaults: palette('accent'), description: 'override' },
            { id: 'panelTitle.inactiveForeground', defaults: palette('faint'), description: 'override' },
            { id: 'sideBar.background', defaults: palette('bg'), description: 'override' },
            { id: 'sideBar.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'sideBar.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'sideBarSectionHeader.background', defaults: palette('card'), description: 'override' },
            { id: 'sideBarSectionHeader.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'sideBarTitle.foreground', defaults: palette('ink'), description: 'override' },

            // --- タブ ---
            // タブ帯はカードの中身。帯そのものは card 面（bg）に溶かし、
            // **アクティブだけが raised（card）で浮く**（spec §4）。
            // 地（bgDeep）はカードの中には出さないので inactive も bg に置く。
            // 見た目の骨格（ピル・角丸・余白）は akari-shell-inner-chrome.ts が持つ。
            { id: 'editorGroupHeader.tabsBackground', defaults: palette('bg'), description: 'override' },
            { id: 'editorGroupHeader.tabsBorder', defaults: palette('lineInner'), description: 'override' },
            { id: 'tab.activeBackground', defaults: palette('card'), description: t('theme.colors.definitionsOverrideRaisedSurface.description') },
            { id: 'tab.activeForeground', defaults: palette('ink'), description: 'override' },
            { id: 'tab.inactiveBackground', defaults: palette('bg'), description: t('theme.colors.definitionsOverrideKeepBaseSurfaceOutCards.description') },
            { id: 'tab.inactiveForeground', defaults: palette('muted'), description: 'override' },
            { id: 'tab.unfocusedActiveForeground', defaults: palette('muted'), description: 'override' },
            { id: 'tab.unfocusedInactiveForeground', defaults: palette('faint'), description: 'override' },
            { id: 'tab.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'tab.activeBorderTop', defaults: palette('accent'), description: 'override' },
            { id: 'tab.unfocusedActiveBorderTop', defaults: palette('accentDark'), description: 'override' },
            { id: 'tab.hoverBackground', defaults: palette('elevated'), description: 'override' },
            { id: 'editorGroup.border', defaults: palette('lineInner'), description: t('theme.colors.definitionsOverrideSplitEditorDivider.description') },

            // --- 隙間のリサイズつかみ代（sash）。既定の青を全廃し、掴めることだけ示す ---
            { id: 'sash.hoverBorder', defaults: palette('accentDark'), description: 'override' },
            { id: 'sash.activeBorder', defaults: palette('accent'), description: 'override' },

            // --- スクロールバー（既定 rgba(121,121,121,.4) の灰色はカードの中で浮く） ---
            { id: 'scrollbarSlider.background', defaults: ta('ink', '1f'), description: 'override' },
            { id: 'scrollbarSlider.hoverBackground', defaults: ta('ink', '33'), description: 'override' },
            { id: 'scrollbarSlider.activeBackground', defaults: ta('ink', '4d'), description: 'override' },
            { id: 'scrollbar.shadow', defaults: solid('#00000000'), description: t('theme.colors.definitionsOverrideNoShadowInsideCards.description') },

            // --- 入力欄・クイックオープン ---
            { id: 'input.background', defaults: palette('card'), description: 'override' },
            { id: 'input.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'input.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'input.placeholderForeground', defaults: palette('faint'), description: 'override' },
            { id: 'inputOption.activeBorder', defaults: palette('accentDark'), description: 'override' },
            { id: 'inputOption.activeBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'inputOption.activeForeground', defaults: palette('accentLighter'), description: 'override' },
            { id: 'dropdown.background', defaults: palette('card'), description: 'override' },
            { id: 'dropdown.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'dropdown.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'quickInput.background', defaults: palette('card'), description: 'override' },
            { id: 'quickInput.foreground', defaults: palette('ink'), description: 'override' },
            { id: 'quickInputList.focusBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'quickInputList.focusForeground', defaults: palette('accentLighter'), description: 'override' },
            { id: 'pickerGroup.foreground', defaults: palette('accent'), description: 'override' },
            { id: 'pickerGroup.border', defaults: palette('lineOverlay'), description: 'override' },

            // --- チェックボックス ---
            { id: 'checkbox.background', defaults: palette('card'), description: 'override' },
            { id: 'checkbox.border', defaults: palette('lineInner'), description: 'override' },
            { id: 'checkbox.foreground', defaults: palette('accentLighter'), description: 'override' },
            { id: 'checkbox.selectBackground', defaults: palette('accentTint'), description: 'override' },
            { id: 'checkbox.selectBorder', defaults: palette('accentDark'), description: 'override' },

            // --- ウィジェット枠 ---
            { id: 'widget.border', defaults: palette('lineInner'), description: 'override' }
        ];
    }
}
