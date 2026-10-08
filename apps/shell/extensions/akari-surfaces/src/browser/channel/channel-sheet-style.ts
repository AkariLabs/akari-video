export const CHANNEL_SHEET_STYLE_ID = 'akari-channel-sheet-style';
export const channelSheetCss = `
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
@media(max-width:650px) { .akari-channel-wizard-grid { grid-template-columns:1fr; } }
`;
