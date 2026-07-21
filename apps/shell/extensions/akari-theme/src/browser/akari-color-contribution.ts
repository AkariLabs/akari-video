import { injectable } from '@theia/core/shared/inversify';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { ColorDefinition } from '@theia/core/lib/common/color';

// トークン出典: akari-video-lp/index.html の :root（LP と同一の黒×オレンジ配色）。
// task 契約 tasks/2026-07-21-theme-orange/task.md §2 の表がこのファイル内の値の正典。
const TOKEN = {
    bgDeep: '#050505',
    bg: '#0a0a0a',
    card: '#141414',
    elevated: '#1a1a1a',
    ink: '#e5e5e5',
    muted: '#a3a3a3',
    faint: '#737373',
    accent: '#f97316',
    accentLight: '#fb923c',
    accentLighter: '#fdba74',
    accentDark: '#ea580c',
    accentTint: '#26160c',
    accentTintDeep: '#150e08',
    border: '#262626',
    borderSubtle: '#1a1a1a'
};

/**
 * 起動時の既定テーマ（Theia 標準 'dark'）が使う workbench 配色トークンを
 * LP と同一の黒×オレンジへ丸ごと上書きする ColorContribution。
 *
 * dark_plus.json（既定エディタテーマ）は "colors" セクションを持たない
 * （syntax highlight のみを定義）ため、ここで登録する defaults がそのまま
 * 全 workbench 色の実値になる（テーマ固有 override に負けない）。
 *
 * dark/light/hcDark/hcLight のすべてに同一の LP 値を設定する
 * （AKARI Video はブランド上ダーク単色構成で、Light/HC への切替は
 * 想定シナリオ外のため、切替時にも青へ戻さず黒×オレンジを維持する）。
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

        return [
            // --- AKARI 独自トークン（既存 VS Code 標準色に該当が無い LP 概念。
            //     webview 内では --vscode-akariTheme-* として同じ値がミラーされる） ---
            { id: 'akariTheme.accent', defaults: solid(TOKEN.accent), description: 'AKARI LP accent' },
            { id: 'akariTheme.accentLight', defaults: solid(TOKEN.accentLight), description: 'AKARI LP accent-light' },
            { id: 'akariTheme.accentTint', defaults: solid(TOKEN.accentTint), description: 'AKARI LP accent-tint（選択・アクティブ背景）' },
            { id: 'akariTheme.accentTintDeep', defaults: solid(TOKEN.accentTintDeep), description: 'AKARI LP accent-tint-deep' },

            // --- ステータスバー（既定 #007acc 系 青を全廃） ---
            { id: 'statusBar.background', defaults: solid(TOKEN.bgDeep), description: 'override' },
            { id: 'statusBar.foreground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'statusBar.border', defaults: solid(TOKEN.borderSubtle), description: 'override' },
            { id: 'statusBar.noFolderBackground', defaults: solid(TOKEN.bgDeep), description: 'override' },
            { id: 'statusBar.noFolderForeground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'statusBarItem.remoteBackground', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'statusBarItem.remoteForeground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'statusBarItem.hoverBackground', defaults: solid(TOKEN.elevated), description: 'override' },
            { id: 'statusBarItem.activeBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'statusBarItem.prominentBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'statusBarItem.prominentForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },

            // --- focusBorder（青いフォーカスリングを全廃） ---
            { id: 'focusBorder', defaults: solid(TOKEN.accentLight), description: 'override' },

            // --- ボタン（button.background 系。プラスボタン等の青を全廃） ---
            { id: 'button.background', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'button.foreground', defaults: solid(TOKEN.bg), description: 'override' },
            { id: 'button.hoverBackground', defaults: solid(TOKEN.accentLight), description: 'override' },
            { id: 'button.border', defaults: solid(TOKEN.accentDark), description: 'override' },
            { id: 'button.secondaryBackground', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'button.secondaryForeground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'button.secondaryHoverBackground', defaults: solid(TOKEN.elevated), description: 'override' },
            // Theia 独自の secondaryButton.* id（.theia-button.secondary が直接参照する。
            // 上の button.secondary* とは別の色 id なので両方上書きする）。
            { id: 'secondaryButton.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'secondaryButton.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'secondaryButton.hoverBackground', defaults: solid(TOKEN.elevated), description: 'override' },

            // --- 選択・アクティブ背景（list.activeSelection・editor.selection 系） ---
            { id: 'list.activeSelectionBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'list.activeSelectionForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },
            { id: 'list.activeSelectionIconForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },
            { id: 'list.inactiveSelectionBackground', defaults: solid(TOKEN.accentTintDeep), description: 'override' },
            { id: 'list.inactiveSelectionForeground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'list.hoverBackground', defaults: solid(TOKEN.elevated), description: 'override' },
            { id: 'list.hoverForeground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'list.focusBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'list.focusForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },
            { id: 'list.focusOutline', defaults: solid(TOKEN.accentLight), description: 'override' },
            { id: 'list.highlightForeground', defaults: solid(TOKEN.accentLight), description: 'override（検索/クイックオープンの一致文字強調。既定は青）' },
            { id: 'list.dropBackground', defaults: solid(TOKEN.accentTintDeep), description: 'override' },
            { id: 'list.inactiveFocusBackground', defaults: solid(TOKEN.accentTintDeep), description: 'override' },

            { id: 'editor.background', defaults: solid(TOKEN.bg), description: 'override' },
            { id: 'editor.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'editor.selectionBackground', defaults: solid('#f9731640'), description: 'override（accent 25% alpha）' },
            { id: 'editor.inactiveSelectionBackground', defaults: solid('#f9731626'), description: 'override（accent 15% alpha）' },
            { id: 'editor.selectionHighlightBackground', defaults: solid('#f9731633'), description: 'override（accent 20% alpha）' },
            { id: 'editor.lineHighlightBackground', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'editor.lineHighlightBorder', defaults: solid(TOKEN.borderSubtle), description: 'override' },
            { id: 'editorCursor.foreground', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'editorLineNumber.foreground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'editorLineNumber.activeForeground', defaults: solid(TOKEN.accentLight), description: 'override' },
            { id: 'editorWidget.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'editorWidget.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'editorWidget.border', defaults: solid(TOKEN.border), description: 'override' },
            { id: 'editorHoverWidget.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'editorHoverWidget.border', defaults: solid(TOKEN.border), description: 'override' },
            { id: 'editorGutter.background', defaults: solid(TOKEN.bg), description: 'override' },

            // --- アクティビティバーのアクティブ表示 ---
            { id: 'activityBar.background', defaults: solid(TOKEN.bgDeep), description: 'override' },
            { id: 'activityBar.foreground', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'activityBar.inactiveForeground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'activityBar.activeBorder', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'activityBar.activeBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'activityBar.activeFocusBorder', defaults: solid(TOKEN.accentLight), description: 'override' },
            { id: 'activityBar.border', defaults: solid(TOKEN.borderSubtle), description: 'override' },
            { id: 'activityBarBadge.background', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'activityBarBadge.foreground', defaults: solid(TOKEN.bg), description: 'override' },

            // --- 進捗・バッジ・リンク色 ---
            { id: 'progressBar.background', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'badge.background', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'badge.foreground', defaults: solid(TOKEN.bg), description: 'override' },
            { id: 'textLink.foreground', defaults: solid(TOKEN.accentLight), description: 'override' },
            { id: 'textLink.activeForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },

            // --- タイトルバー・パネル最深部 ---
            { id: 'titleBar.activeBackground', defaults: solid(TOKEN.bgDeep), description: 'override' },
            { id: 'titleBar.activeForeground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'titleBar.inactiveBackground', defaults: solid(TOKEN.bgDeep), description: 'override' },
            { id: 'titleBar.inactiveForeground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'titleBar.border', defaults: solid(TOKEN.borderSubtle), description: 'override' },

            // --- メニュー（ドロップダウン・コンテキストメニュー） ---
            { id: 'menu.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'menu.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'menu.selectionBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'menu.selectionForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },
            { id: 'menu.separatorBackground', defaults: solid(TOKEN.border), description: 'override' },
            { id: 'menu.border', defaults: solid(TOKEN.borderSubtle), description: 'override' },
            { id: 'menubar.selectionBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'menubar.selectionForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },

            // --- パネル・サイドバー ---
            { id: 'panel.background', defaults: solid(TOKEN.bg), description: 'override' },
            { id: 'panel.border', defaults: solid(TOKEN.borderSubtle), description: 'override' },
            { id: 'panelTitle.activeForeground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'panelTitle.activeBorder', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'panelTitle.inactiveForeground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'sideBar.background', defaults: solid(TOKEN.bg), description: 'override' },
            { id: 'sideBar.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'sideBar.border', defaults: solid(TOKEN.borderSubtle), description: 'override' },
            { id: 'sideBarSectionHeader.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'sideBarSectionHeader.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'sideBarTitle.foreground', defaults: solid(TOKEN.ink), description: 'override' },

            // --- タブ ---
            { id: 'tab.activeBackground', defaults: solid(TOKEN.bg), description: 'override' },
            { id: 'tab.activeForeground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'tab.inactiveBackground', defaults: solid(TOKEN.bgDeep), description: 'override' },
            { id: 'tab.inactiveForeground', defaults: solid(TOKEN.muted), description: 'override' },
            { id: 'tab.border', defaults: solid(TOKEN.borderSubtle), description: 'override' },
            { id: 'tab.activeBorderTop', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'tab.unfocusedActiveBorderTop', defaults: solid(TOKEN.accentDark), description: 'override' },
            { id: 'tab.hoverBackground', defaults: solid(TOKEN.elevated), description: 'override' },

            // --- 入力欄・クイックオープン ---
            { id: 'input.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'input.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'input.border', defaults: solid(TOKEN.border), description: 'override' },
            { id: 'input.placeholderForeground', defaults: solid(TOKEN.faint), description: 'override' },
            { id: 'inputOption.activeBorder', defaults: solid(TOKEN.accentDark), description: 'override' },
            { id: 'inputOption.activeBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'inputOption.activeForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },
            { id: 'dropdown.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'dropdown.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'dropdown.border', defaults: solid(TOKEN.border), description: 'override' },
            { id: 'quickInput.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'quickInput.foreground', defaults: solid(TOKEN.ink), description: 'override' },
            { id: 'quickInputList.focusBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'quickInputList.focusForeground', defaults: solid(TOKEN.accentLighter), description: 'override' },
            { id: 'pickerGroup.foreground', defaults: solid(TOKEN.accent), description: 'override' },
            { id: 'pickerGroup.border', defaults: solid(TOKEN.border), description: 'override' },

            // --- チェックボックス ---
            { id: 'checkbox.background', defaults: solid(TOKEN.card), description: 'override' },
            { id: 'checkbox.border', defaults: solid(TOKEN.border), description: 'override' },
            { id: 'checkbox.foreground', defaults: solid(TOKEN.accentLighter), description: 'override' },
            { id: 'checkbox.selectBackground', defaults: solid(TOKEN.accentTint), description: 'override' },
            { id: 'checkbox.selectBorder', defaults: solid(TOKEN.accentDark), description: 'override' },

            // --- ウィジェット枠 ---
            { id: 'widget.border', defaults: solid(TOKEN.border), description: 'override' }
        ];
    }
}
