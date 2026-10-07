const STYLE_ID = 'akari-voice-record-dialog-style';

export function ensureVoiceRecordDialogStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.akari-voice-record-dialog-host { background:transparent!important; pointer-events:none; }
.akari-voice-record-dialog-host .dialogBlock { width:360px!important; min-width:360px!important; max-width:360px!important; max-height:calc(100vh - 32px); padding:0!important; border:0!important; border-radius:14px!important; overflow:hidden; background:var(--akari-card,#141414)!important; pointer-events:auto; position:fixed; margin:0; }
.akari-voice-record-dialog-host .dialogTitle,.akari-voice-record-dialog-host .dialogControl { display:none!important; }
.akari-voice-record-dialog-host .dialogContent { padding:0!important; color:var(--akari-ink,#e5e5e5); }
.akari-voice-record-dialog-host * { box-sizing:border-box; }
.akari-voice-record-dialog-host .voice-popup { width:360px; max-height:calc(100vh - 32px); overflow-y:auto; background:var(--akari-card,#141414); border:1px solid #333; border-radius:14px; font:12px/1.45 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif; }
.akari-voice-record-dialog-host .voice-header { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid #303030; font-size:16px; font-weight:700; cursor:move; }
.akari-voice-record-dialog-host .voice-close-x { width:28px; height:28px; border:0; background:transparent; color:var(--akari-ink,#e5e5e5); font-size:20px; cursor:pointer; }
.akari-voice-record-dialog-host .voice-body { padding:18px; }
.akari-voice-record-dialog-host .voice-card { display:flex; align-items:center; gap:18px; padding:14px; border:1px solid #333; border-radius:11px; background:var(--akari-bg,#0a0a0a); }
.akari-voice-record-dialog-host .voice-record { width:72px; height:72px; border-radius:50%; border:0; background:#e24444; color:white; display:grid; place-items:center; cursor:pointer; flex:none; box-shadow:0 0 0 5px rgba(226,68,68,.12); }
.akari-voice-record-dialog-host .voice-record:disabled { opacity:.45; cursor:default; }
.akari-voice-record-dialog-host .voice-record.is-recording { animation:voice-pulse 1.4s ease-in-out infinite; }
.akari-voice-record-dialog-host .voice-record .stop-square { width:22px; height:22px; border-radius:3px; background:#fff; }
@keyframes voice-pulse { 50% { box-shadow:0 0 0 11px rgba(226,68,68,.08); } }
.akari-voice-record-dialog-host .voice-clock { font:600 24px/1.2 "SF Mono",Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }
.akari-voice-record-dialog-host .voice-status { margin-top:5px; color:#aaa; font-size:11px; overflow-wrap:anywhere; }
.akari-voice-record-dialog-host .voice-status.error { color:#f85149; }
.akari-voice-record-dialog-host .voice-meter { display:flex; align-items:end; gap:2px; height:40px; margin:20px 0; }
.akari-voice-record-dialog-host .voice-meter span { width:4px; height:40px; border-radius:2px; background:#414141; }
.akari-voice-record-dialog-host .voice-meter span.active { background:var(--akari-accent,#f97316); }
.akari-voice-record-dialog-host .voice-field { margin:15px 0; }
.akari-voice-record-dialog-host .voice-field label { display:block; margin-bottom:7px; font-weight:600; }
.akari-voice-record-dialog-host .voice-field select,.akari-voice-record-dialog-host .voice-gain-number { background:var(--akari-bg,#0a0a0a); border:1px solid #444; border-radius:7px; color:var(--akari-ink,#e5e5e5); padding:7px; }
.akari-voice-record-dialog-host .voice-field select { width:100%; }
.akari-voice-record-dialog-host .voice-hint { color:#888; margin-top:5px; font-size:11px; }
.akari-voice-record-dialog-host .voice-gain { display:flex; align-items:center; gap:10px; }
.akari-voice-record-dialog-host .voice-gain input[type=range] { flex:1; accent-color:var(--akari-accent,#f97316); }
.akari-voice-record-dialog-host .voice-gain-number { width:62px; }
.akari-voice-record-dialog-host .voice-options { border-top:1px solid #303030; padding:12px 18px 2px; }
.akari-voice-record-dialog-host .voice-option { display:flex; gap:8px; opacity:.45; margin-bottom:14px; }
.akari-voice-record-dialog-host .voice-option small { display:block; color:#aaa; margin-top:2px; }
.akari-voice-record-dialog-host .voice-soon { margin-left:auto; border:1px solid #777; border-radius:10px; padding:0 5px; height:17px; font-size:10px; white-space:nowrap; }
.akari-voice-record-dialog-host .voice-footer { border-top:1px solid #303030; padding:12px 18px; text-align:right; }
.akari-voice-record-dialog-host .voice-footer button { padding:7px 18px; border:1px solid #555; border-radius:7px; background:#282828; color:var(--akari-ink,#e5e5e5); cursor:pointer; }
`;
    document.head.appendChild(style);
}
