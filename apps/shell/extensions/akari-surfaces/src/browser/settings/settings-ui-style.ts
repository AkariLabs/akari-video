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

${S} .akari-set-nav { flex: 0 0 270px; max-width: 42%; overflow-y: auto; box-sizing: border-box; padding: 10px; display: flex; flex-direction: column; gap: 1px; background: var(--akari-bg); border-right: 1px solid var(--akari-line-inner); }
${S} .akari-set-nav-title { font-weight: 600; font-size: 14px; padding: 4px 10px 12px; margin: 0; color: var(--akari-ink); }
${S} .akari-set-nav-group { font-size: 11px; color: var(--akari-faint); padding: 10px 10px 3px; margin: 0; font-weight: 400; }
${S} .akari-set-nav-group[hidden] { display: none; }
${S} button.akari-set-nav-item { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 6px 10px; border: 0; border-radius: 8px; color: var(--akari-muted); white-space: nowrap; font-size: 12.5px; }
${S} .akari-set-nav-label { flex: 0 1 auto; min-width: 0; }
${S} button.akari-set-nav-item[data-settings-nav="privacy"] { font-size: 11.5px; }
${S} .akari-set-nav-badge { margin-left: auto; flex: 0 0 auto; color: var(--akari-accent-light); font-size: 10px; font-weight: 400; }
${S} .akari-set-nav-badge-soon { color: var(--akari-faint); }
${S} button.akari-set-nav-item:hover { background: var(--akari-card); color: var(--akari-ink); }
${S} button.akari-set-nav-item[hidden] { display: none; }
${S} button.akari-set-nav-item[aria-current="true"] { background: var(--akari-elevated); color: var(--akari-ink); font-weight: 600; }
${S} button.akari-set-nav-item[aria-current="true"] .akari-set-icon { color: var(--akari-accent); }
${S} button.akari-set-nav-item:focus-visible { outline: 1px solid var(--akari-accent-light); outline-offset: -1px; }

${S} .akari-set-page { flex: 1; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 24px 28px 32px; color: var(--akari-ink); }
${S} .akari-set-page h2 { font-size: 17px; margin: 0 0 4px; color: var(--akari-ink); }
${S} .akari-set-lead { color: var(--akari-muted); margin: 0 0 20px; font-size: 13px; line-height: 1.55; }
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

${S} .akari-set-seg { display: inline-flex; position: relative; background: var(--akari-bg); border: 1px solid var(--akari-line); border-radius: 999px; padding: 2px; flex-wrap: wrap; }
${S} .akari-set-seg-thumb { position: absolute; top: 2px; bottom: 2px; left: 2px; border-radius: 999px; background: var(--akari-elevated); box-shadow: 0 0 0 1px var(--akari-line) inset; pointer-events: none; }
${S} .akari-set-seg[data-ready="true"] .akari-set-seg-thumb { transition: transform .28s cubic-bezier(.32,.72,0,1), width .28s cubic-bezier(.32,.72,0,1); }
${S} button.akari-set-seg-item { all: unset; box-sizing: border-box; cursor: pointer; position: relative; z-index: 1; padding: 5px 14px; border-radius: 999px; color: var(--akari-muted); font-size: 12px; white-space: nowrap; }
${S} button.akari-set-seg-item[aria-checked="true"] { color: var(--akari-ink); font-weight: 600; }
${S} button.akari-set-seg-item:disabled { opacity: .4; cursor: default; }
${S} button.akari-set-seg-item:focus-visible { outline: 1px solid var(--akari-accent-light); }

${S} button.akari-set-switch { all: unset; box-sizing: border-box; cursor: pointer; width: 34px; height: 20px; flex: 0 0 34px; border-radius: 999px; position: relative; background: color-mix(in srgb, var(--akari-faint) 55%, var(--akari-bg)); transition: background .28s cubic-bezier(.32,.72,0,1); }
${S} .akari-set-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--akari-ink); transition: transform .28s cubic-bezier(.32,.72,0,1); }
${S} button.akari-set-switch[aria-checked="true"] { background: var(--akari-accent); }
${S} button.akari-set-switch[aria-checked="true"] .akari-set-switch-knob { transform: translateX(14px); background: var(--akari-bg); }
${S} button.akari-set-switch:disabled { opacity: .45; cursor: default; }
${S} button.akari-set-switch:focus-visible { outline: 1px solid var(--akari-accent-light); outline-offset: 2px; }

${S} .akari-set-cards { display: grid; gap: 10px; padding: 14px 16px 16px; }
${S} .akari-set-cards-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
${S} .akari-set-cards-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
${S} .akari-set-cards-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
${S} button.akari-set-card { all: unset; box-sizing: border-box; cursor: pointer; border: 1px solid var(--akari-line); border-radius: 8px; background: var(--akari-bg); padding: 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; transition: background .28s cubic-bezier(.32,.72,0,1), border-color .28s cubic-bezier(.32,.72,0,1), transform .28s cubic-bezier(.32,.72,0,1); }
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
${S} .akari-set-theme-preview[data-theme="system"] { background: linear-gradient(135deg, ${DARK.bgDeep} 50%, ${LIGHT.bgDeep} 50%); }
${S} .akari-set-theme-preview[data-theme="system"] i { background: linear-gradient(135deg, ${DARK.bg} 50%, ${LIGHT.bg} 50%); }
${S} .akari-set-theme-preview[data-theme="system"] i.m::after { background: ${DARK.accent}; }

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
${S} .akari-set-search-wrap { position: sticky; top: 0; z-index: 2; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; margin: 0 0 10px; padding: 7px 10px; background: var(--akari-card); border: 1px solid var(--akari-line); border-radius: 8px; color: var(--akari-faint); box-shadow: 0 0 0 10px var(--akari-bg); }
${S} .akari-set-search-wrap:focus-within { border-color: var(--akari-accent-light); }
${S} input.akari-set-search { all: unset; min-width: 0; flex: 1; color: var(--akari-ink); font-size: 12px; }
${S} .akari-set-search-wrap kbd { font: 10px ui-monospace, monospace; padding: 1px 4px; border: 1px solid var(--akari-line); border-radius: 4px; }
${S} .akari-set-search-hit { background: color-mix(in srgb, var(--akari-accent) 7%, transparent); border-radius: 6px; }
${S} .akari-set-search-hit.akari-set-row { margin: 2px 4px; padding-inline: 12px; }
${S} .akari-set-zoom { display: flex; align-items: center; gap: 8px; }
${S} .akari-set-storage-detail { padding: 0 16px 14px; color: var(--akari-muted); font-size: 12px; overflow-wrap: anywhere; }
${S} .akari-set-partner-icon { width: 18px; height: 18px; }
${S} .akari-set-stats { position: relative; min-height: 180px; display: grid; place-items: center; }
${S} .akari-set-stats-sample { filter: blur(14px); opacity: .25; user-select: none; pointer-events: none; }
${S} .akari-set-stats-label { position: absolute; padding: 12px 20px; border: 1px solid var(--akari-line); border-radius: 10px; background: var(--akari-card); font-weight: 600; }
${S} .akari-set-storage-parts { display: flex; height: 7px; overflow: hidden; gap: 2px; border-radius: 999px; background: var(--akari-line); margin: 0 0 14px; }
${S} .akari-set-storage-parts i { display: block; background: var(--akari-faint); opacity: .35; }
${S} .akari-set-diagnostic-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 14px 16px; font-size: 12px; color: var(--akari-muted); }
${S} .akari-set-diagnostic-list > span { display: flex; align-items: center; gap: 6px; }
${S} .akari-set-diagnostic-list .akari-set-icon { color: var(--akari-accent); }
${S} .akari-set-group details { padding: 12px 16px; border-top: 1px solid var(--akari-line-inner); font-size: 13px; }
${S} .akari-set-group details:first-of-type { border-top: 0; }
${S} .akari-set-group summary { cursor: pointer; }
${S} .akari-set-group-title { display: flex; align-items: center; justify-content: space-between; padding-bottom: 4px; }
${S} .akari-set-group-title > span { letter-spacing: 0; font-size: 11px; }
${S} .akari-set-partner-row { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--akari-line-inner); }
${S} .akari-set-group-title + .akari-set-partner-row { border-top: 0; }
${S} .akari-set-partner-tile { width: 30px; height: 30px; box-sizing: border-box; border-radius: 8px; background: var(--akari-bg); border: 1px solid var(--akari-line); display: grid; place-items: center; }
${S} .akari-set-partner-name { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
${S} .akari-set-partner-name b { font-weight: 500; }
${S} .akari-set-partner-chip { font-size: 10.5px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--akari-line); color: var(--akari-faint); font-weight: 400; }
${S} .akari-set-partner-sub { font-size: 11.5px; color: var(--akari-faint); }
${S} .akari-set-caution { margin: 0 16px 12px; padding: 8px 10px; border-radius: 8px; background: var(--akari-bg); border: 1px solid var(--akari-line-inner); color: var(--akari-muted); font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
${S} .akari-set-caution .akari-set-icon { color: var(--akari-faint); margin-top: 1px; }
${S} .akari-set-storage-total { padding: 18px 16px 12px; display: grid; gap: 3px; }
${S} .akari-set-storage-total b { font-size: 24px; font-weight: 650; }
${S} .akari-set-storage-total span { color: var(--akari-faint); font-size: 12px; }
${S} .akari-set-storage-usage { display: flex; height: 8px; overflow: hidden; border-radius: 999px; background: var(--akari-line); margin: 0 16px 12px; }
${S} .akari-set-storage-usage i { display: block; height: 100%; }
${S} .akari-set-storage-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 0 16px 16px; font-size: 11px; color: var(--akari-faint); }
${S} .akari-set-storage-legend span::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 2px; background: var(--akari-storage-color); }
${S} .akari-set-storage-row { border-top: 1px solid var(--akari-line-inner); }
${S} .akari-set-group-title + .akari-set-storage-row { border-top: 0; }
${S} button.akari-set-storage-header { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 14px minmax(0, 1fr) auto 80px; gap: 10px; align-items: center; width: 100%; padding: 11px 16px; cursor: pointer; }
${S} button.akari-set-storage-header:hover { background: var(--akari-card); }
${S} button.akari-set-storage-header b { font-size: 13px; font-weight: 500; }
${S} button.akari-set-storage-header > .akari-set-icon { color: var(--akari-faint); transition: transform .2s cubic-bezier(.32,.72,0,1); }
${S} .akari-set-storage-open > button.akari-set-storage-header > .akari-set-icon { transform: rotate(90deg); }
${S} button.akari-set-storage-header > span:last-child { font: 12px ui-monospace, monospace; color: var(--akari-muted); text-align: right; }
${S} .akari-set-storage-safe, ${S} .akari-set-storage-keep { font-size: 10.5px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--akari-line); color: var(--akari-faint); }
${S} .akari-set-storage-safe { color: ${OK}; border-color: color-mix(in srgb, ${OK} 35%, transparent); }
${S} .akari-set-storage-detail { padding: 0 16px 12px 40px; }
${S} .akari-set-storage-detail[hidden] { display: none; }
${S} .akari-set-storage-why { display: flex; gap: 8px; color: var(--akari-muted); font-size: 12px; margin: 8px 0; }
${S} .akari-set-storage-why .akari-set-icon { color: ${OK}; }
${S} .akari-set-storage-detail table { width: 100%; border-collapse: collapse; font-size: 12px; }
${S} .akari-set-storage-detail td { padding: 5px 0; border-top: 1px dashed var(--akari-line-inner); color: var(--akari-muted); }
${S} .akari-set-storage-detail td:nth-child(2) { color: var(--akari-faint); font: 11px ui-monospace, monospace; overflow-wrap: anywhere; }
${S} .akari-set-storage-detail td:last-child { text-align: right; white-space: nowrap; font: 12px ui-monospace, monospace; }
${S} .akari-set-storage-actions { display: flex; gap: 8px; margin-top: 8px; }
${S} .akari-set-storage-confirm { position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; background: rgba(0,0,0,.55); }
${S} .akari-set-storage-confirm-box { width: min(420px, calc(100% - 32px)); box-sizing: border-box; background: var(--akari-card); border: 1px solid var(--akari-line); border-radius: 14px; padding: 18px; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
${S} .akari-set-storage-confirm h4 { margin: 0 0 12px; font-size: 14px; }
${S} .akari-set-storage-confirm ul { margin: 0 0 10px; padding-left: 18px; color: var(--akari-muted); font-size: 12px; overflow-wrap: anywhere; }
${S} .akari-set-storage-confirm-no { color: var(--akari-faint) !important; }
${S} .akari-set-storage-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
${S} .akari-set-permission-row { display: grid; grid-template-columns: 30px minmax(0,1fr) auto auto; gap: 12px; align-items: center; padding: 11px 16px; border-top: 1px solid var(--akari-line-inner); }
${S} .akari-set-group-title + .akari-set-permission-row { border-top: 0; }
${S} .akari-set-permission-row b { display: block; font-size: 12.5px; font-weight: 500; }
${S} .akari-set-permission-row div > span { color: var(--akari-faint); font-size: 11.5px; }
${S} .akari-set-permission-state { white-space: nowrap; color: var(--akari-faint); border: 1px solid var(--akari-line); border-radius: 999px; font-size: 10.5px; padding: 0 7px; }
${S} .akari-set-permission-state-ok { color: ${OK}; border-color: color-mix(in srgb, ${OK} 35%, transparent); }
${S} .akari-set-soon { position: relative; border-radius: 12px; overflow: hidden; }
${S} .akari-set-soon-blur { filter: blur(5px) grayscale(1); opacity: .45; pointer-events: none; user-select: none; }
${S} .akari-set-soon-veil { position: absolute; inset: 0; display: grid; place-items: center; background: linear-gradient(180deg, transparent, rgba(0,0,0,.38)); }
${S} .akari-set-soon-veil div { text-align: center; }
${S} .akari-set-soon-veil b { display: block; font-size: 15px; letter-spacing: .06em; }
${S} .akari-set-soon-veil span { font-size: 12px; color: var(--akari-faint); }
${S} .akari-set-stats-kpi { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; padding: 8px 16px 14px; }
${S} .akari-set-stats-kpi div { background: var(--akari-bg); border: 1px solid var(--akari-line-inner); border-radius: 8px; padding: 8px 10px; }
${S} .akari-set-stats-kpi span { display: block; font-size: 10.5px; color: var(--akari-faint); }
${S} .akari-set-stats-kpi b { font-size: 15px; }
${S} .akari-set-stats-chart { display: flex; align-items: flex-end; gap: 5px; height: 110px; padding: 10px 16px 6px; }
${S} .akari-set-stats-chart i { display: block; flex: 1; border-radius: 3px 3px 0 0; background: #4a4a4a; }
${S} .akari-set-stats-chart-hi { background: #7a7a7a !important; }
${S} .akari-set-stats-service { display: grid; grid-template-columns: 22px 1fr 90px 70px; gap: 10px; align-items: center; padding: 8px 16px; border-top: 1px solid var(--akari-line-inner); font-size: 12px; }
${S} .akari-set-stats-service-logo { width: 20px; height: 20px; border-radius: 5px; background: var(--akari-muted); }
${S} .akari-set-stats-service-bar { height: 4px; border-radius: 2px; background: var(--akari-line); }
${S} .akari-set-stats-service-bar i { display: block; height: 100%; background: var(--akari-faint); }
${S} .akari-set-about-hero { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: center; padding: 18px 16px; }
${S} .akari-set-about-hero img { width: 64px; height: 64px; border-radius: 15px; object-fit: contain; }
${S} .akari-set-about-hero h3 { margin: 0; font-size: 18px; }
${S} .akari-set-about-hero p { margin: 2px 0 0; color: var(--akari-faint); font: 12px ui-monospace, monospace; }
${S} .akari-set-about-release { display: flex; align-items: center; gap: 12px; padding: 10px 16px; font-size: 12px; }
${S} .akari-set-about-release > span { color: var(--akari-faint); }
${S} .akari-set-about-release > button { margin-left: auto; }
${S} .akari-set-diagnostic-excluded { color: var(--akari-faint); }
@media (prefers-reduced-motion: reduce) { ${S} .akari-set-seg[data-ready="true"] .akari-set-seg-thumb, ${S} button.akari-set-switch, ${S} .akari-set-switch-knob, ${S} button.akari-set-card { transition: none !important; } }
`;
