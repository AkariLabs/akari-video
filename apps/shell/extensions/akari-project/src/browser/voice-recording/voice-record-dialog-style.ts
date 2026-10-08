const STYLE_ID = 'akari-voice-record-dialog-style';

export function ensureVoiceRecordDialogStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.akari-voice-record-dialog-host { background:transparent!important; pointer-events:none; }
.akari-voice-record-dialog-host .dialogBlock { width:360px!important; min-width:360px!important; max-width:360px!important; max-height:calc(100vh - 16px); padding:0!important; border:0!important; border-radius:14px!important; overflow:hidden; background:var(--akari-card)!important; pointer-events:auto; position:fixed; margin:0; }
.akari-voice-record-dialog-host .dialogTitle,.akari-voice-record-dialog-host .dialogControl { display:none!important; }
.akari-voice-record-dialog-host .dialogContent { padding:0!important; color:var(--akari-ink); }
.akari-voice-record-dialog-host * { box-sizing:border-box; }
.akari-voice-record-dialog-host .voice-popup { width:360px; display:flex; flex-direction:column; max-height:calc(100vh - 16px); overflow:hidden; background:var(--akari-card); border:1px solid var(--akari-line); border-radius:14px; font:12px/1.45 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif; }
.akari-voice-record-dialog-host .voice-header { display:flex; flex:none; align-items:center; justify-content:space-between; padding:5px 8px 5px 14px; border-bottom:1px solid var(--akari-line-inner); font-size:12.5px; font-weight:700; min-height:0; cursor:move; }
.akari-voice-record-dialog-host .voice-close-x { width:22px; height:22px; border:0; background:transparent; color:var(--akari-ink); font-size:15px; cursor:pointer; }
.akari-voice-record-dialog-host .voice-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; }
.akari-voice-record-dialog-host .voice-body { padding:10px 14px 8px; }
.akari-voice-record-dialog-host .voice-script { margin-bottom:8px; padding:7px 10px; border:1px solid var(--akari-line); border-radius:9px; }
.akari-voice-record-dialog-host .voice-script strong { display:block; margin-bottom:2px; font-size:11px; }
.akari-voice-record-dialog-host .voice-script-text { max-height:4.5em; overflow-y:auto; white-space:pre-wrap; font-size:13px; line-height:1.5; }
.akari-voice-record-dialog-host .voice-script small { display:block; margin-top:3px; color:var(--akari-muted); font-size:10.5px; }
.akari-voice-record-dialog-host .voice-card { display:flex; align-items:center; gap:14px; padding:9px 12px; border:1px solid var(--akari-line); border-radius:11px; background:var(--akari-bg); }
.akari-voice-record-dialog-host .voice-record { width:56px; height:56px; border-radius:50%; border:0; background:#e24444; color:white; display:grid; place-items:center; cursor:pointer; flex:none; box-shadow:0 0 0 4px rgba(226,68,68,.12); }
.akari-voice-record-dialog-host .voice-record:disabled { opacity:.45; cursor:default; }
.akari-voice-record-dialog-host .voice-record.is-recording { animation:voice-pulse 1.4s ease-in-out infinite; }
.akari-voice-record-dialog-host .voice-record .stop-square { width:18px; height:18px; border-radius:3px; background:#fff; }
@keyframes voice-pulse { 50% { box-shadow:0 0 0 8px rgba(226,68,68,.08); } }
.akari-voice-record-dialog-host .voice-clock { font:600 20px/1.2 "SF Mono",Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }
.akari-voice-record-dialog-host .voice-status { margin-top:5px; color:var(--akari-muted); font-size:11px; overflow-wrap:anywhere; }
.akari-voice-record-dialog-host .voice-status.error { color:var(--akari-danger,#f85149); }
.akari-voice-record-dialog-host .voice-meter { display:flex; align-items:end; gap:2px; height:20px; margin:9px 0; }
.akari-voice-record-dialog-host .voice-meter span { width:4px; height:20px; border-radius:2px; background:var(--akari-elevated); }
.akari-voice-record-dialog-host .voice-meter span.active { background:var(--akari-accent); }
.akari-voice-record-dialog-host .voice-field { margin:7px 0; }
.akari-voice-record-dialog-host .voice-field label { display:block; margin-bottom:3px; font-weight:600; }
.akari-voice-record-dialog-host .voice-device-heading { display:flex; justify-content:space-between; align-items:baseline; }
.akari-voice-record-dialog-host .voice-field select,.akari-voice-record-dialog-host .voice-gain-number { background:var(--akari-bg); border:1px solid var(--akari-line); border-radius:7px; color:var(--akari-ink); padding:7px; }
.akari-voice-record-dialog-host .voice-field select { width:100%; padding:5px 7px; font-size:12px; }
.akari-voice-record-dialog-host .voice-hint { color:var(--akari-faint); font-size:10.5px; }
.akari-voice-record-dialog-host .voice-gain { display:flex; align-items:center; gap:10px; }
.akari-voice-record-dialog-host .voice-gain label { width:auto; margin-bottom:0; }
.akari-voice-record-dialog-host .voice-gain input[type=range] { flex:1; accent-color:var(--akari-accent); }
.akari-voice-record-dialog-host .voice-gain-number { width:54px; }
.akari-voice-record-dialog-host .voice-options { border-top:1px solid var(--akari-line-inner); padding:8px 14px 10px; }
.akari-voice-record-dialog-host .voice-option { display:flex; gap:7px; margin-bottom:6px; font-size:12px; }
.akari-voice-record-dialog-host .voice-option:last-child { margin-bottom:0; }
.akari-voice-record-dialog-host .voice-option:has(input:disabled) { opacity:.45; }
.akari-voice-record-dialog-host .voice-option small { display:block; color:var(--akari-muted); margin-top:2px; font-size:10.5px; }
`;
    document.head.appendChild(style);
}
