/**
 * 設定ダイアログの部品の CSS（2026-09-22 設定ダイアログ刷新）。見た目の正は内部リポのモック
 * planning/notes-2026-09-22-shell-ui-refresh-mock.html の ①。
 *
 * 色は AKARI のトークンだけ（`--akari-*` と akari-theme が登録する `--theia-akariTheme-*`）。直値を書かないので
 * ダーク / ライトの切り替えにそのまま追従する。選択中の面（アクセントの薄い面）はトークンの color-mix で作る。
 * すべて `[data-akari-settings-dialog]` の中に閉じる（他の画面へ漏らさない）。
 */
import { AkariPalette, DARK, LIGHT } from 'akari-theme/lib/browser/akari-theme-tokens';
import { SETTINGS_ICON_PATHS } from './settings-icons';

const S = '[data-akari-settings-dialog]';
const ACCENT_TINT = 'color-mix(in srgb, var(--akari-accent) 9%, var(--akari-bg))';
const OK = 'var(--theia-akariTheme-placedTextGreen, var(--akari-accent))';
/** CSS だけで描く線画アイコン（DOM に SVG を置けない所 = Store のアカウント帯のアバター）。形は settings-icons.ts と同じ。 */
const maskIcon = (name: keyof typeof SETTINGS_ICON_PATHS): string =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${SETTINGS_ICON_PATHS[name].replace(/"/g, "'")}</svg>`)}")`;
const THEME_PREVIEW_PALETTES: ReadonlyArray<readonly [string, AkariPalette]> = [['dark', DARK], ['light', LIGHT]];

export const AKARI_SETTINGS_UI_CSS = `
${S} .akari-set-icon { width: 16px; height: 16px; flex: 0 0 16px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; display: block; }
${S} .akari-set-icon-sm { width: 13px; height: 13px; flex-basis: 13px; }

${S} .akari-set-nav { flex: 0 0 210px; max-width: 34%; overflow-y: auto; box-sizing: border-box; padding: 14px 10px; display: flex; flex-direction: column; gap: 2px; background: var(--akari-bg); border-right: 1px solid var(--akari-line-inner); }
${S} .akari-set-nav-title { font-weight: 600; font-size: 14px; padding: 4px 10px 12px; margin: 0; color: var(--akari-ink); }
${S} .akari-set-nav-group { font-size: 11px; color: var(--akari-faint); padding: 14px 10px 4px; margin: 0; font-weight: 400; }
${S} button.akari-set-nav-item { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 0; border-radius: 8px; color: var(--akari-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
${S} button.akari-set-nav-item:hover { background: var(--akari-card); color: var(--akari-ink); }
${S} button.akari-set-nav-item[aria-current="true"] { background: var(--akari-elevated); color: var(--akari-ink); font-weight: 600; }
${S} button.akari-set-nav-item[aria-current="true"] .akari-set-icon { color: var(--akari-accent); }
${S} button.akari-set-nav-item:focus-visible { outline: 1px solid var(--akari-accent-light); outline-offset: -1px; }

${S} .akari-set-page { flex: 1; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 24px 28px 32px; color: var(--akari-ink); }
${S} .akari-set-page h2 { font-size: 17px; margin: 0 0 4px; color: var(--akari-ink); }
${S} .akari-set-lead { color: var(--akari-muted); margin: 0 0 18px; font-size: 13px; line-height: 1.55; }
${S} .akari-set-notice { color: var(--theia-errorForeground); flex-shrink: 0; margin: 12px 28px 0; font-size: 12px; }
${S} .akari-set-notice:empty { display: none; }

${S} .akari-set-group { background: var(--akari-elevated); border: 1px solid var(--akari-line); border-radius: 12px; margin: 0 0 14px; min-width: 0; }
${S} .akari-set-group-title { padding: 12px 16px 0; font-size: 11px; color: var(--akari-faint); letter-spacing: .04em; }
${S} .akari-set-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 12px 16px; border-top: 1px solid var(--akari-line-inner); }
${S} .akari-set-group > .akari-set-row:first-child, ${S} .akari-set-group-title + .akari-set-row,
${S} .akari-set-group > .akari-set-prov:first-child, ${S} .akari-set-group-title + .akari-set-prov,
${S} .akari-set-group > .akari-set-tool:first-child, ${S} .akari-set-group-title + .akari-set-tool { border-top: 0; }
${S} .akari-set-row-label { font-weight: 500; font-size: 13px; overflow-wrap: anywhere; }
${S} .akari-set-row-desc { color: var(--akari-faint); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
${S} .akari-set-row-control { display: flex; align-items: center; gap: 6px; justify-content: flex-end; flex-wrap: wrap; min-width: 0; }
${S} .akari-set-note { margin: 0 16px 14px; color: var(--akari-faint); font-size: 12px; line-height: 1.55; }
${S} .akari-set-page > .akari-set-note { margin: 0 0 14px; }

${S} button.akari-set-btn { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; font-weight: 600; font-size: 13px; white-space: nowrap; }
${S} button.akari-set-btn-primary { background: var(--akari-accent); color: var(--akari-bg); }
${S} button.akari-set-btn-primary:hover:not(:disabled) { background: var(--akari-accent-light); }
${S} button.akari-set-btn-ghost { background: transparent; color: var(--akari-ink); border: 1px solid var(--akari-line); font-weight: 500; }
${S} button.akari-set-btn-ghost:hover:not(:disabled) { background: var(--akari-card); }
${S} button.akari-set-btn-sm { padding: 4px 10px; font-size: 12px; }
${S} button.akari-set-btn:disabled { opacity: .45; cursor: default; }
${S} button.akari-set-btn:focus-visible { outline: 1px solid var(--akari-accent-light); outline-offset: 1px; }

${S} .akari-set-pill { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--akari-line); color: var(--akari-faint); white-space: nowrap; line-height: 1.6; }
${S} .akari-set-pill-ok { color: ${OK}; border-color: color-mix(in srgb, ${OK} 35%, transparent); background: color-mix(in srgb, ${OK} 8%, transparent); }
${S} .akari-set-pill-warn { color: var(--theia-errorForeground); border-color: color-mix(in srgb, var(--theia-errorForeground) 40%, transparent); }
${S} .akari-set-pill-accent { color: var(--akari-accent-light); border-color: color-mix(in srgb, var(--akari-accent) 45%, transparent); background: ${ACCENT_TINT}; }

${S} .akari-set-seg { display: inline-flex; background: var(--akari-bg); border: 1px solid var(--akari-line); border-radius: 999px; padding: 2px; flex-wrap: wrap; }
${S} button.akari-set-seg-item { all: unset; box-sizing: border-box; cursor: pointer; padding: 5px 14px; border-radius: 999px; color: var(--akari-muted); font-size: 12px; white-space: nowrap; }
${S} button.akari-set-seg-item[aria-checked="true"] { background: var(--akari-elevated); color: var(--akari-ink); font-weight: 600; box-shadow: 0 0 0 1px var(--akari-line) inset; }
${S} button.akari-set-seg-item:disabled { opacity: .4; cursor: default; }
${S} button.akari-set-seg-item:focus-visible { outline: 1px solid var(--akari-accent-light); }

${S} button.akari-set-switch { all: unset; box-sizing: border-box; cursor: pointer; width: 34px; height: 20px; flex: 0 0 34px; border-radius: 999px; position: relative; background: color-mix(in srgb, var(--akari-faint) 55%, var(--akari-bg)); transition: background .16s; }
${S} .akari-set-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--akari-ink); transition: transform .2s cubic-bezier(.32,.72,0,1); }
${S} button.akari-set-switch[aria-checked="true"] { background: var(--akari-accent); }
${S} button.akari-set-switch[aria-checked="true"] .akari-set-switch-knob { transform: translateX(14px); background: var(--akari-bg); }
${S} button.akari-set-switch:disabled { opacity: .45; cursor: default; }
${S} button.akari-set-switch:focus-visible { outline: 1px solid var(--akari-accent-light); outline-offset: 2px; }

${S} .akari-set-cards { display: grid; gap: 10px; padding: 14px 16px 16px; }
${S} .akari-set-cards-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
${S} .akari-set-cards-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
${S} .akari-set-cards-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
${S} button.akari-set-card { all: unset; box-sizing: border-box; cursor: pointer; border: 1px solid var(--akari-line); border-radius: 8px; background: var(--akari-bg); padding: 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
${S} button.akari-set-card:hover { border-color: color-mix(in srgb, var(--akari-ink) 25%, transparent); }
${S} button.akari-set-card[aria-checked="true"] { border-color: var(--akari-accent); background: ${ACCENT_TINT}; }
${S} button.akari-set-card:focus-visible { outline: 1px solid var(--akari-accent-light); outline-offset: 1px; }
${S} .akari-set-card-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: var(--akari-ink); }
${S} .akari-set-card-title .akari-set-icon { color: var(--akari-muted); }
${S} button.akari-set-card[aria-checked="true"] .akari-set-card-title .akari-set-icon { color: var(--akari-accent); }
${S} .akari-set-card-desc { font-size: 11.5px; color: var(--akari-faint); line-height: 1.5; }

/* テーマの見本: 今のテーマに関係なく、そのテーマの実パレット（akari-theme-tokens の DARK / LIGHT）で描く */
${S} .akari-set-theme-preview { height: 84px; border-radius: 8px; display: grid; grid-template-columns: 22% 1fr 26%; gap: 4px; padding: 5px; overflow: hidden; margin-bottom: 6px; box-sizing: border-box; }
${S} .akari-set-theme-preview i { border-radius: 4px; display: block; position: relative; }
${S} .akari-set-theme-preview i.m::after { content: ""; position: absolute; left: 10%; right: 10%; bottom: 10%; height: 6px; border-radius: 3px; opacity: .8; }
${THEME_PREVIEW_PALETTES.map(([theme, p]) => `${S} .akari-set-theme-preview[data-theme="${theme}"] { background: ${p.bgDeep}; }
${S} .akari-set-theme-preview[data-theme="${theme}"] i { background: ${p.bg}; }
${S} .akari-set-theme-preview[data-theme="${theme}"] i.m { background: ${p.card}; }
${S} .akari-set-theme-preview[data-theme="${theme}"] i.m::after { background: ${p.accent}; }`).join('\n')}

${S} .akari-set-chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 0 16px 14px; }
${S} button.akari-set-chip { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; background: var(--akari-bg); border: 1px solid var(--akari-line); font-size: 12px; color: var(--akari-ink); }
${S} .akari-set-chip-box { width: 14px; height: 14px; flex: 0 0 14px; box-sizing: border-box; border-radius: 4px; border: 1.5px solid color-mix(in srgb, var(--akari-faint) 70%, transparent); display: grid; place-items: center; }
${S} .akari-set-chip-box .akari-set-icon { width: 10px; height: 10px; flex-basis: 10px; stroke-width: 2.5; visibility: hidden; }
${S} button.akari-set-chip[aria-checked="true"] .akari-set-chip-box { background: var(--akari-accent); border-color: var(--akari-accent); color: var(--akari-bg); }
${S} button.akari-set-chip[aria-checked="true"] .akari-set-chip-box .akari-set-icon { visibility: visible; }
${S} button.akari-set-chip:focus-visible { outline: 1px solid var(--akari-accent-light); }

${S} .akari-set-dropdown { position: relative; }
${S} button.akari-set-dropdown-button { all: unset; box-sizing: border-box; cursor: pointer; min-width: 220px; max-width: 320px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 12px; border-radius: 8px; background: var(--akari-bg); border: 1px solid var(--akari-line); font-size: 13px; color: var(--akari-ink); }
${S} button.akari-set-dropdown-button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--akari-ink) 25%, transparent); }
${S} button.akari-set-dropdown-button:disabled { opacity: .45; cursor: default; }
${S} button.akari-set-dropdown-button:focus-visible { outline: 1px solid var(--akari-accent-light); }
${S} button.akari-set-dropdown-button .akari-set-icon { color: var(--akari-faint); }
${S} .akari-set-dropdown-current { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${S} .akari-set-dropdown-list { position: absolute; right: 0; top: calc(100% + 6px); min-width: 280px; max-height: 320px; overflow-y: auto; box-sizing: border-box; background: var(--akari-card); border: 1px solid var(--akari-line); border-radius: 8px; padding: 4px; box-shadow: 0 14px 34px rgba(0, 0, 0, .35); z-index: 20; outline: none; }
${S} .akari-set-dropdown-up .akari-set-dropdown-list { top: auto; bottom: calc(100% + 6px); }
${S} .akari-set-dropdown-list[hidden] { display: none; }
${S} .akari-set-option { display: grid; grid-template-columns: 16px 1fr; gap: 8px; padding: 7px 10px; border-radius: 6px; cursor: pointer; align-items: start; font-size: 13px; color: var(--akari-ink); }
${S} .akari-set-option-active { background: var(--akari-elevated); }
${S} .akari-set-option[aria-disabled="true"] { opacity: .45; cursor: default; }
${S} .akari-set-option .akari-set-icon { color: var(--akari-accent); visibility: hidden; margin-top: 3px; }
${S} .akari-set-option[aria-selected="true"] .akari-set-icon { visibility: visible; }
${S} .akari-set-option-desc { display: block; color: var(--akari-faint); font-size: 11.5px; }

${S} input.akari-set-input { all: unset; box-sizing: border-box; width: 200px; padding: 6px 10px; border-radius: 8px; background: var(--akari-bg); border: 1px solid var(--akari-line); color: var(--akari-ink); font-size: 12px; }
${S} input.akari-set-input-wide { width: 260px; }
${S} input.akari-set-input[type="password"] { font-family: var(--theia-code-font-family, ui-monospace, monospace); }
${S} input.akari-set-input::placeholder { color: var(--akari-faint); }
${S} input.akari-set-input:focus { border-color: var(--akari-accent-light); }

/* Akari アカウント */
${S} .akari-set-account { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 18px; }
${S} .akari-set-avatar { width: 44px; height: 44px; border-radius: 12px; background: var(--akari-bg); border: 1px solid var(--akari-line); display: grid; place-items: center; color: var(--akari-muted); }
${S} .akari-set-avatar-user::before { content: ""; width: 22px; height: 22px; background: currentColor; -webkit-mask: ${maskIcon('user')} center / contain no-repeat; mask: ${maskIcon('user')} center / contain no-repeat; }
${S} .akari-set-account-name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
${S} .akari-set-account-desc { color: var(--akari-faint); font-size: 12px; line-height: 1.55; }
${S} .akari-set-store-controls { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
${S} .akari-set-store-error { color: var(--theia-errorForeground); font-size: 12px; margin: 0 16px 12px; }

/* 接続と API キー */
${S} .akari-set-prov { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 14px 16px; border-top: 1px solid var(--akari-line-inner); }
${S} .akari-set-logo { width: 32px; height: 32px; border-radius: 8px; overflow: hidden; background: var(--akari-bg); border: 1px solid var(--akari-line-inner); box-sizing: border-box; display: grid; place-items: center; font-weight: 700; color: var(--akari-muted); }
${S} .akari-set-logo img { width: 100%; height: 100%; display: block; object-fit: cover; }
${S} .akari-set-prov-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 600; font-size: 13px; }
${S} .akari-set-prov-desc { color: var(--akari-faint); font-size: 12px; line-height: 1.55; margin-top: 2px; overflow-wrap: anywhere; }
${S} .akari-set-prov-desc em { font-style: normal; color: var(--akari-accent-light); }
${S} .akari-set-prov-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
${S} .akari-set-keyin { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
${S} .akari-set-key-tail { font-family: var(--theia-code-font-family, ui-monospace, monospace); font-size: 12px; color: var(--akari-muted); padding: 3px 8px; border-radius: 6px; background: var(--akari-bg); border: 1px solid var(--akari-line); }
${S} .akari-set-bal { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
${S} .akari-set-bal-value { font-family: var(--theia-code-font-family, ui-monospace, monospace); font-size: 12px; color: var(--akari-ink); padding: 3px 8px; border-radius: 6px; background: var(--akari-bg); border: 1px solid var(--akari-line); }
${S} .akari-set-bal-value[data-state="idle"] { color: var(--akari-faint); }
${S} .akari-set-bal-time { font-size: 11px; color: var(--akari-faint); }
${S} .akari-set-bal-error { font-size: 12px; color: var(--theia-errorForeground); }
${S} .akari-set-prov-status { font-size: 12px; color: var(--akari-faint); margin-top: 6px; overflow-wrap: anywhere; }
${S} .akari-set-defaults { margin-top: 10px; border-top: 1px solid var(--akari-line-inner); }
${S} .akari-set-defaults .akari-set-row { padding: 10px 0 0; border-top: 0; }
${S} .akari-set-source { font-size: 11px; color: var(--akari-faint); }

/* 道具 */
${S} .akari-set-tool { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 16px; border-top: 1px solid var(--akari-line-inner); }
${S} .akari-set-tool-icon { width: 28px; height: 28px; border-radius: 7px; background: var(--akari-bg); border: 1px solid var(--akari-line); display: grid; place-items: center; color: var(--akari-muted); box-sizing: border-box; }
${S} .akari-set-tool-name { font-weight: 500; font-size: 13px; }
${S} .akari-set-tool-desc { display: block; font-size: 12px; color: var(--akari-faint); line-height: 1.55; overflow-wrap: anywhere; }
${S} .akari-set-tool-extra { display: block; font-size: 11.5px; color: var(--akari-muted); margin-top: 3px; overflow-wrap: anywhere; }
${S} .akari-set-tool-extra[data-tone="error"] { color: var(--theia-errorForeground); }
${S} .akari-set-progress { height: 4px; border-radius: 999px; background: var(--akari-bg); overflow: hidden; margin-top: 6px; }
${S} .akari-set-progress > i { display: block; height: 100%; background: var(--akari-accent); }

/* はじめかた */
${S} .akari-set-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 18px; }
${S} .akari-set-hero-title { font-weight: 600; font-size: 14px; }
${S} .akari-set-steps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0 16px 16px; }
${S} .akari-set-step { border: 1px solid var(--akari-line); border-radius: 8px; padding: 12px; background: var(--akari-bg); }
${S} .akari-set-step-name { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
${S} .akari-set-step-name .akari-set-icon { color: var(--akari-faint); }
${S} .akari-set-step[data-done="true"] .akari-set-step-name .akari-set-icon { color: ${OK}; }
${S} .akari-set-step-desc { font-size: 12px; color: var(--akari-faint); }
`;
