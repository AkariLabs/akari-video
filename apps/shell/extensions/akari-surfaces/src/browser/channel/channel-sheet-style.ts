export const CHANNEL_SHEET_STYLE_ID = 'akari-channel-sheet-style';
export const channelSheetCss = `
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet input:not([type=checkbox]):not([type=radio]):not([type=file]),
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet textarea,
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet select { background:var(--theia-input-background); color:var(--theia-input-foreground); border:1px solid var(--theia-input-border,var(--theia-widget-border)); border-radius:5px; padding:6px 8px; font:inherit; outline-offset:-1px; }
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet input:not([type=checkbox]):not([type=radio]):not([type=file]):focus,
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet textarea:focus,
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet select:focus { border-color:var(--theia-focusBorder); }
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet input::placeholder,
.akari-home-sheet-scrim[data-akari-home-dialog^=channel-] .akari-home-sheet textarea::placeholder { color:var(--theia-input-placeholderForeground,var(--theia-descriptionForeground)); }
.akari-home-sheet-scrim[data-akari-home-dialog=channel-design-wizard] .akari-home-sheet { width:min(760px,95vw); }
.akari-channel-wizard-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:20px; }
.akari-channel-wizard-column { min-width:0; }
.akari-channel-wizard-step { color:var(--theia-descriptionForeground); font-size:12px; margin-bottom:15px; }
.akari-channel-wizard-question { font-size:13px; font-weight:600; margin:0 0 5px; }
.akari-channel-wizard-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin:12px 0; }
.akari-channel-wizard-option { border:1px solid var(--theia-widget-border); border-radius:7px; background:var(--theia-editor-background); color:var(--theia-foreground); padding:8px; text-align:left; cursor:pointer; font-size:12px; }
.akari-channel-wizard-option[aria-pressed=true] { background:var(--theia-list-activeSelectionBackground); border:1px solid var(--theia-focusBorder); }
.akari-channel-wizard-option:hover { border-color:var(--theia-focusBorder); }
.akari-channel-wizard-free { width:100%; box-sizing:border-box; }
.akari-channel-wizard-nav,.akari-channel-sheet-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:16px; }
.akari-channel-sheet-actions { justify-content:space-between; border-top:1px solid var(--theia-widget-border); padding-top:16px; }
.akari-channel-wizard-draft { white-space:pre-wrap; overflow:auto; max-height:210px; padding:10px; border:1px solid var(--theia-widget-border); border-radius:7px; background:var(--theia-editor-background); font-size:12px; line-height:1.5; }
.akari-channel-wizard-types { display:grid; gap:7px; max-height:225px; overflow:auto; }
.akari-channel-wizard-type { border:1px solid var(--theia-widget-border); border-radius:7px; padding:9px; font-size:12px; }
.akari-channel-wizard-type b,.akari-channel-wizard-type span { display:block; margin-bottom:4px; }
.akari-channel-wizard-type span { color:var(--theia-descriptionForeground); }
.akari-channel-sheet-section { margin:14px 0; font-size:12px; line-height:1.6; }
.akari-channel-sheet-section h4 { font-size:13px; margin:0 0 4px; }
.akari-channel-form-fields { display:grid; gap:12px; }
.akari-channel-form-row { display:flex; align-items:center; gap:8px; font-size:12px; }
.akari-channel-form-row label { width:95px; flex:0 0 95px; }
.akari-channel-form-row input[type=text] { flex:1; min-width:0; }
.akari-channel-form-section { display:grid; gap:5px; font-size:12px; }
.akari-channel-form-section textarea { width:100%; box-sizing:border-box; resize:vertical; }
.akari-channel-form-add { display:flex; gap:8px; margin-top:8px; }
.akari-channel-form-add input { flex:1; }
.akari-home-sheet-scrim[data-akari-home-dialog=channel-skills] .akari-home-sheet { width:min(690px,95vw); }
.akari-channel-skills-list,.akari-channel-skills-options { display:grid; gap:8px; }
.akari-channel-skills-list { max-height:230px; overflow:auto; margin-bottom:16px; }
.akari-channel-skill-row,.akari-channel-skill-option { display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--theia-widget-border); border-radius:8px; padding:10px; background:var(--theia-editor-background); }
.akari-channel-skill-body,.akari-channel-skill-option > div { min-width:0; }
.akari-channel-skill-heading,.akari-channel-skill-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.akari-channel-skill-heading code,.akari-channel-skill-option code { font-family:var(--theia-code-font-family,monospace); font-size:12px; }
.akari-channel-skill-heading small,.akari-channel-skill-description,.akari-channel-skill-option small,.akari-channel-skill-option span { color:var(--theia-descriptionForeground); font-size:11px; }
.akari-channel-skill-description { margin-top:5px; line-height:1.5; }
.akari-channel-skill-option > div { display:grid; gap:4px; font-size:12px; }
.akari-channel-skill-actions { flex:0 0 auto; }
.akari-channel-skill-remove { border:0; background:transparent; color:var(--theia-foreground); font-size:18px; cursor:pointer; }
.akari-channel-skills-modes { display:flex; flex-wrap:wrap; gap:7px; padding:12px 0; border-top:1px solid var(--theia-widget-border); }
.akari-channel-skills-modes button[aria-pressed=true] { outline:1px solid var(--theia-focusBorder); }
.akari-channel-skills-options { max-height:340px; overflow:auto; }
.akari-channel-skills-form { display:grid; gap:9px; }
.akari-channel-skills-form label { display:grid; gap:5px; font-size:12px; }
.akari-channel-skills-form input,.akari-channel-skills-form textarea { width:100%; box-sizing:border-box; }
.akari-channel-skills-form textarea { resize:vertical; }
.akari-channel-skills-form button { justify-self:end; }
.akari-channel-skills-error { color:var(--theia-errorForeground); }
.akari-home-sheet-scrim[data-akari-home-dialog=channel-types-catalog] .akari-home-sheet { width:min(900px,95vw); }
.akari-channel-types-filters { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:14px 0; font-size:12px; }
.akari-channel-types-filters > span:not(:first-child) { margin-left:10px; }
.akari-channel-types-filters button[aria-pressed=true] { outline:1px solid var(--theia-focusBorder); }
.akari-channel-types-filters input { flex:1 1 140px; min-width:100px; margin-left:auto; }
.akari-channel-types-grid { display:grid; grid-template-columns:190px minmax(0,1fr) 300px; gap:12px; align-items:start; }
.akari-channel-types-fields,.akari-channel-types-list,.akari-channel-types-detail { min-width:0; }
.akari-channel-types-fields { display:grid; gap:4px; }
.akari-channel-types-fields button { display:flex; justify-content:space-between; gap:5px; width:100%; border:0; border-radius:6px; padding:8px; background:transparent; color:var(--theia-foreground); text-align:left; cursor:pointer; }
.akari-channel-types-fields button[aria-current=true] { background:var(--theia-list-activeSelectionBackground); }
.akari-channel-types-fields small { color:var(--theia-descriptionForeground); padding:4px 8px; }
.akari-channel-types-list { display:grid; gap:7px; max-height:460px; overflow:auto; }
.akari-channel-types-list > p { margin:0 0 4px; color:var(--theia-descriptionForeground); font-size:12px; }
.akari-channel-types-card { display:grid; gap:4px; width:100%; border:1px solid var(--theia-widget-border); border-radius:8px; padding:9px; background:var(--theia-editor-background); color:var(--theia-foreground); text-align:left; cursor:pointer; }
.akari-channel-types-card[aria-current=true] { background:var(--theia-list-activeSelectionBackground); border-color:var(--theia-focusBorder); }
.akari-channel-types-card b { font-size:12px; }
.akari-channel-types-card span,.akari-channel-types-card small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
.akari-channel-types-card small { color:var(--theia-descriptionForeground); }
.akari-channel-types-detail { max-height:460px; overflow:auto; border:1px solid var(--theia-widget-border); border-radius:8px; padding:10px; font-size:12px; line-height:1.5; }
.akari-channel-types-detail h4 { margin:0 0 4px; font-size:14px; }
.akari-channel-types-detail h5 { margin:12px 0 4px; font-size:12px; }
.akari-channel-types-detail p { margin:4px 0; }
.akari-channel-types-detail pre { white-space:pre-wrap; font-size:12px; background:var(--theia-editor-background); padding:8px; overflow-wrap:anywhere; }
.akari-channel-types-near { display:flex; flex-wrap:wrap; gap:5px; }
.akari-channel-types-near button { font-size:11px; }
.akari-channel-sheet-actions > div { display:flex; flex-wrap:wrap; gap:8px; }
.akari-home-sheet-scrim[data-akari-home-dialog=channel-types-apply] .akari-home-sheet { width:min(560px,95vw); }
.akari-home-sheet-scrim[data-akari-home-dialog=channel-helper-consent] .akari-home-sheet { width:min(460px,95vw); }
.akari-channel-apply-row { display:grid; grid-template-columns:150px minmax(0,1fr); gap:6px 10px; align-items:start; border-top:1px solid var(--theia-widget-border); padding:10px 0; font-size:12px; }
.akari-channel-apply-row > span { min-width:0; }
.akari-channel-apply-row > div { grid-column:2; display:flex; flex-wrap:wrap; gap:6px; }
.akari-channel-apply-row > div:empty { display:none; }
.akari-channel-apply-row button { font-size:11px; }
.akari-channel-apply-row button[aria-pressed=true] { outline:1px solid var(--theia-focusBorder); }
.akari-channel-apply-note { color:var(--theia-descriptionForeground); }
.akari-channel-type-banner { border:1px solid var(--theia-widget-border); border-radius:7px; padding:10px; margin:0 0 12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.akari-channel-type-banner small { color:var(--theia-descriptionForeground); }
.akari-channel-row-hint { display:block; opacity:.6; font-size:11px; padding:0 8px 6px; }
@media(max-width:900px) { .akari-channel-types-grid { grid-template-columns:1fr; } .akari-channel-types-fields { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:440px) { .akari-channel-apply-row { grid-template-columns:1fr; } .akari-channel-apply-row > div { grid-column:1; } }
@media(max-width:650px) { .akari-channel-wizard-grid { grid-template-columns:1fr; } }
`;
