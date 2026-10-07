import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';

// `.theia-button`（Theia 標準ボタン）は @theia/core の CSS で
// `color: var(--theia-button-foreground)` は指定するが `background-color` は
// どのビルトイン CSS にも存在しない（意図的な省略か既知の抜け）。そのため
// 未指定のまま Chromium のダーク配色ネイティブ既定（青系）で描画される
// （オーナー指摘「プラスボタンの青」の実体はこれ）。
//
// 実測した既知の挙動: akari-color-contribution.ts の ColorContribution で
// `button.background` / `button.foreground` / `button.hoverBackground` /
// `button.secondaryBackground` 系を上書きしても、実機では
// `--theia-button-background` 等の CSS 変数に反映されない（他の大半のトークン
// は反映される中、この一群だけ既定の青のまま = Theia/monaco 側のどこかで
// 早期に解決 or キャッシュされていると推測、根本原因は未特定）。
// 独立した --akari-* 変数でこの CSS だけ確実に上書きする
// （akari-color-contribution.ts 側の button.* 登録は他の消費経路
// （webview の --vscode-button-* ミラー等）向けに残す）。
//
// 他の akari-* 拡張は tsc -b のみのビルド（asset copy 無し）のため、
// import './x.css' で lib/ に .css を要求すると esbuild バンドル時に
// 解決できず theia build が落ちる。TS 側から <style> を注入する形にして
// asset copy 抜きの既存ビルド構成のまま完結させる。
//
// 2026-07-30: 直値をやめ、akari-css-variable-force-contribution.ts が
// テーマ追従で書き込む --akari-* 変数を参照する（ライトモード対応）。
// フォールバック値はダークパレット（変数が書かれる前の一瞬のため）。
const CSS = `
/* シェル root は v0.1.41 / 4b5878a1 で color-scheme: dark を導入した
   （未チェックのネイティブフォームが白箱になる問題の修正。root の指定は残す）。
   Theia の node_modules/@theia/plugin-ext/src/main/browser/webview/pre/index.html
   は color-scheme 未指定 = light。CSS Color Adjust に従い Chromium は iframe 要素と
   埋め込み document root の used color-scheme が異なると、埋め込み側の配色で
   不透明なキャンバスを描く。root の dark 継承による不一致が不透明な白の原因。
   WebviewWidget.doShow（lib/main/browser/webview/webview.js）が className = webview
   で作る外側 iframe だけ light に一致させ、キャンバスを透明に戻す。 */
iframe.webview { color-scheme: light; }

.theia-button {
    box-sizing: border-box;
    height: 28px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
}

.theia-button {
    background-color: var(--akari-accent) !important;
    color: var(--akari-bg) !important;
    font-weight: 650;
}
.theia-button:hover:not(:disabled) {
    background-color: var(--akari-accent-light) !important;
}

.theia-button.secondary {
    background-color: var(--akari-button-secondary) !important;
    border-color: var(--akari-button-secondary-line) !important;
    color: var(--akari-ink) !important;
}
.theia-button.secondary { font-weight: 500; }
.theia-button.secondary:hover:not(:disabled) {
    background-color: var(--akari-button-secondary-hover) !important;
    border-color: var(--akari-button-secondary-hover-line) !important;
}

.theia-button.quiet {
    background-color: transparent !important;
    color: var(--akari-button-quiet-ink) !important;
    font-weight: 500;
}
.theia-button.quiet:hover:not(:disabled) {
    background-color: var(--akari-elevated) !important;
    color: var(--akari-ink) !important;
}

.theia-button.danger {
    background-color: transparent !important;
    color: var(--akari-danger) !important;
    font-weight: 500;
}
.theia-button.danger:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--akari-danger) 12%, transparent) !important;
}

.theia-button.small {
    height: 24px;
    padding: 0 9px;
}
.theia-button:focus-visible {
    outline: 2px solid;
    outline-color: var(--akari-accent) !important;
    outline-offset: 2px;
}
.theia-button:disabled {
    opacity: .42;
    cursor: default;
}

/* class / style のない素の button だけを低詳細度で救済する。
   作者が付けたクラス・inline style と各パネルの規則を上書きしない。 */
:where(.lm-Widget[id^="akari-"], .akari-library-import, .akari-import-sheet, [data-akari-settings-dialog], .akari-export-dialog-host) :where(button:not([class]):not([style])) {
    box-sizing: border-box;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--akari-button-secondary-line);
    border-radius: 6px;
    background-color: var(--akari-button-secondary);
    color: var(--akari-ink);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
}
:where(.lm-Widget[id^="akari-"], .akari-library-import, .akari-import-sheet, [data-akari-settings-dialog], .akari-export-dialog-host) :where(button:not([class]):not([style]):hover:not(:disabled)) {
    background-color: var(--akari-button-secondary-hover);
    border-color: var(--akari-button-secondary-hover-line);
}
:where(.lm-Widget[id^="akari-"], .akari-library-import, .akari-import-sheet, [data-akari-settings-dialog], .akari-export-dialog-host) :where(button:not([class]):not([style]):focus-visible) {
    outline: 2px solid var(--akari-accent);
    outline-offset: 2px;
}
:where(.lm-Widget[id^="akari-"], .akari-library-import, .akari-import-sheet, [data-akari-settings-dialog], .akari-export-dialog-host) :where(button:not([class]):not([style]):disabled) {
    opacity: .42;
    cursor: default;
}

:where(.lm-Widget[id^="akari-"], .akari-library-import, .akari-import-sheet, [data-akari-settings-dialog], .akari-export-dialog-host) :where(hr) {
    border: 0;
    border-top: 1px solid var(--akari-line-inner);
}

.akari-seg {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background-color: var(--akari-card);
}
.akari-seg > :is(button, [role="tab"]) {
    margin: 0;
    min-width: 0;
    border: 0;
    border-radius: 6px;
    background-color: transparent !important;
    color: var(--akari-muted) !important;
    font-weight: 500;
}
.akari-seg > :is(button, [role="tab"]):is([aria-pressed="true"], [role="tab"][aria-selected="true"]) {
    background-color: var(--akari-selected) !important;
    color: var(--akari-selected-ink) !important;
    font-weight: 600;
}
.akari-seg > :is(button, [role="tab"]):hover:not(:disabled):not([aria-pressed="true"]):not([aria-selected="true"]) {
    background-color: var(--akari-elevated) !important;
    color: var(--akari-ink) !important;
}

/* 進捗バー（theia-progress-bar）も同じ理由で progressBar.background が
   反映されないため上書きする。 */
.theia-progress-bar {
    background-color: var(--akari-accent, #f97316) !important;
}

/* ネイティブフォームコントロール（チェックボックス・ラジオ・range）は
   Theia の色トークンを経由せず、ブラウザの accent-color 既定（青系）に
   依存している。LP モックと同じ方針（accent-color: var(--accent) 相当）で上書き。 */
input[type="checkbox"],
input[type="radio"],
input[type="range"] {
    accent-color: var(--akari-accent, #f97316) !important;
}

/* フォーカスリング。focusBorder が反映されないケースの保険。 */
:focus-visible {
    outline-color: var(--akari-accent-light, #fb923c) !important;
}

/* Theia の :focus:not(iframe) は widget の root にも四角い outline を付ける。
   ホームの onActivateRequest は root（tabIndex=-1）へ focus() するため、
   カードの overflow:hidden + 角丸でその枠が切れる。コンテナ自身だけ抑制し、
   子の操作部品・操作用 ARIA role・編集可能要素のリングはそのまま残す。
   :focus-visible だけでなく、クリック後のプログラム的 focus も対象にする。 */
#theia-app-shell .lm-Widget:is(:not([role]), [role="tabpanel"], [role="region"], [role="group"]):not(button):not(input):not(select):not(textarea):not(a[href]):not([contenteditable]:not([contenteditable="false"])):focus {
    outline: none !important;
}
`;

@injectable()
export class AkariButtonStyleContribution implements FrontendApplicationContribution {
    onStart(): void {
        const style = document.createElement('style');
        style.id = 'akari-theme-button-fix';
        style.textContent = CSS;
        document.head.appendChild(style);
    }
}
