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
// var() 経由に頼らず、LP トークンの直値でこの CSS だけ確実に上書きする
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
    background-color: var(--akari-accent, #f97316) !important;
    color: var(--akari-bg, #0a0a0a) !important;
}

/* Theia 既定の border-radius は 2px。カード言語（spec §3 のボタン段 = 6px）から
   外れており、明示指定を忘れた箇所にだけ 2px が漏れる — 実測ではメニューの
   一覧行がそれだった。個別に足して回るのではなく、既定そのものを段へ寄せる。
   個別に 8px 等を指定している箇所（一覧行など）はそちらが優先される。 */
.theia-button {
    border-radius: 6px;
}
.theia-button:hover:not([disabled]) {
    background-color: var(--akari-accent-light, #fb923c) !important;
}
.theia-button.secondary {
    background-color: var(--akari-card, #141414) !important;
    color: var(--akari-ink, #e5e5e5) !important;
}
.theia-button.secondary:hover:not([disabled]) {
    background-color: var(--akari-elevated, #1a1a1a) !important;
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
