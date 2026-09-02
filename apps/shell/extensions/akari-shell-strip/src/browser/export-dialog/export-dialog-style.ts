const STYLE_ID = 'akari-export-dialog-style';

export const EXPORT_DIALOG_CSS = `
.akari-export-dialog-host {
  --aed-bg-deep:#050505; --aed-bg:var(--akari-bg,#0a0a0a); --aed-card:var(--akari-card,#141414);
  --aed-elevated:var(--akari-elevated,#1a1a1a); --aed-ink:var(--akari-ink,#e5e5e5);
  --aed-muted:#a3a3a3; --aed-faint:#737373; --aed-accent:var(--akari-accent,#f97316);
  --aed-accent-light:var(--akari-accent-light,#fb923c); --aed-accent-tint:#26160c;
  --aed-accent-tint-deep:#150e08; --aed-border:#262626; --aed-border-subtle:#1a1a1a;
  --aed-good:#3fb950; --aed-bad:#f85149; --aed-warn:#e3b341;
  --aed-sans:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;
  --aed-mono:"SF Mono",Menlo,Consolas,monospace;
}
.akari-export-dialog-host .dialogBlock { width:880px!important; max-width:880px!important; height:664px!important; padding:0!important; border:0!important; border-radius:14px!important; background:transparent!important; overflow:hidden; }
.akari-export-dialog-host .dialogTitle,.akari-export-dialog-host .dialogControl { display:none!important; }
.akari-export-dialog-host .dialogContent { height:664px!important; max-height:none!important; padding:0!important; overflow:hidden!important; color:var(--aed-ink); font:12px/1.5 var(--aed-sans); }
.akari-export-dialog-host * { box-sizing:border-box; }
.akari-export-dialog-host button { font-family:inherit; }
.akari-export-dialog-host .popup { width:880px; height:664px; background:var(--aed-card); border:1px solid var(--aed-border); border-radius:14px; box-shadow:0 40px 100px -20px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.03) inset; display:flex; flex-direction:column; overflow:hidden; }
.akari-export-dialog-host .ph { display:flex; align-items:center; gap:14px; padding:16px 20px 12px; border-bottom:1px solid var(--aed-border-subtle); flex:none; }
.akari-export-dialog-host .ph .ttl { font-size:16px; font-weight:700; letter-spacing:-.01em; }
.akari-export-dialog-host .ph .sub { color:var(--aed-faint); font-size:11.5px; }
.akari-export-dialog-host .ph .x { margin-left:auto; width:28px; height:28px; border-radius:8px; border:1px solid var(--aed-border); background:transparent; color:var(--aed-muted); font-size:16px; line-height:1; display:grid; place-items:center; cursor:pointer; }
.akari-export-dialog-host .pill { font:600 11px/1 var(--aed-sans); padding:5px 9px; border-radius:999px; background:var(--aed-accent-tint); color:var(--aed-accent-light); border:1px solid #4a2a12; display:inline-flex; gap:6px; align-items:center; font-variant-numeric:tabular-nums; }
.akari-export-dialog-host .pill.good { background:#0f2416; color:var(--aed-good); border-color:#1e4a2a; }
.akari-export-dialog-host .pill .dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
.akari-export-dialog-host .pill .dot.blink { animation:aed-blink 1.1s ease-in-out infinite; }
@keyframes aed-blink { 50% { opacity:.25; } }
.akari-export-dialog-host .pb { display:grid; grid-template-columns:352px minmax(0,1fr); gap:22px; padding:18px 20px 0; flex:1; min-height:0; }
.akari-export-dialog-host .pb>.left { min-width:0; }
.akari-export-dialog-host .rwrap { position:relative; min-width:0; min-height:0; }
.akari-export-dialog-host .right { height:100%; overflow-y:auto; padding-right:10px; padding-bottom:18px; scrollbar-width:thin; scrollbar-color:#333 transparent; }
.akari-export-dialog-host .right::-webkit-scrollbar { width:6px; }
.akari-export-dialog-host .right::-webkit-scrollbar-thumb { background:#333; border-radius:3px; }
.akari-export-dialog-host .rwrap::after { content:""; position:absolute; left:0; right:10px; bottom:0; height:44px; background:linear-gradient(rgba(20,20,20,0),var(--aed-card)); pointer-events:none; opacity:0; transition:opacity .2s; }
.akari-export-dialog-host .rwrap.more::after { opacity:1; }
.akari-export-dialog-host .pf { display:flex; align-items:center; gap:10px; padding:14px 20px 16px; border-top:1px solid var(--aed-border-subtle); flex:none; }
.akari-export-dialog-host .pf .sp { flex:1; }
.akari-export-dialog-host .pf .fn { color:var(--aed-faint); font-size:11px; }
.akari-export-dialog-host .btn { border-radius:8px; padding:9px 14px; font:600 12.5px/1.2 var(--aed-sans); border:1px solid var(--aed-border); background:var(--aed-elevated); color:var(--aed-ink); cursor:pointer; display:inline-flex; align-items:center; gap:8px; white-space:nowrap; }
.akari-export-dialog-host .btn.primary { background:var(--aed-accent); border-color:var(--aed-accent); color:#0a0a0a; padding:10px 18px; font-size:13px; }
.akari-export-dialog-host .btn.primary small { font-weight:500; opacity:.75; }
.akari-export-dialog-host .btn.ghost { background:transparent; border-color:transparent; color:var(--aed-muted); }
.akari-export-dialog-host .btn.ghost:hover { border-color:var(--aed-border); }
.akari-export-dialog-host .btn.danger { color:var(--aed-bad); border-color:#3a1a18; background:transparent; }
.akari-export-dialog-host .btn[disabled] { opacity:.45; cursor:default; }
.akari-export-dialog-host .framebox { min-height:198px; display:flex; justify-content:center; align-items:flex-start; }
.akari-export-dialog-host .frame { position:relative; border-radius:8px; overflow:hidden; background:#000; box-shadow:0 0 0 1px var(--aed-border); max-height:260px; }
.akari-export-dialog-host .frame .ratio { position:absolute; right:8px; top:8px; font:600 10.5px var(--aed-mono); color:#fff; background:rgba(0,0,0,.55); padding:3px 7px; border-radius:5px; letter-spacing:.04em; }
.akari-export-dialog-host .frame .safe { position:absolute; inset:5%; border:1px dashed rgba(255,255,255,.18); border-radius:3px; pointer-events:none; }
.akari-export-dialog-host .frame .safe.in { inset:10%; }
.akari-export-dialog-host .kv { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.akari-export-dialog-host .kv span { font:500 11px/1 var(--aed-mono); color:var(--aed-muted); background:var(--aed-elevated); border:1px solid var(--aed-border-subtle); padding:5px 8px; border-radius:6px; }
.akari-export-dialog-host .kv span b { color:var(--aed-ink); font-weight:600; }
.akari-export-dialog-host .fine { color:var(--aed-faint); font-size:11px; margin:8px 0 0; line-height:1.5; }
.akari-export-dialog-host .outsum { margin-top:12px; border:1px solid var(--aed-border-subtle); border-radius:8px; padding:8px 10px; font-size:11px; color:var(--aed-muted); display:grid; grid-template-columns:auto 1fr; gap:3px 10px; }
.akari-export-dialog-host .outsum b { color:var(--aed-ink); font-weight:600; font-family:var(--aed-mono); font-size:11px; }
.akari-export-dialog-host .outsum .h { grid-column:1/3; font-size:10.5px; letter-spacing:.06em; color:var(--aed-faint); font-weight:600; }
.akari-export-dialog-host .sec { font-size:10.5px; letter-spacing:.06em; color:var(--aed-faint); font-weight:600; margin:0 0 8px; display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
.akari-export-dialog-host .sec .r { letter-spacing:0; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.akari-export-dialog-host .opts { display:flex; flex-direction:column; gap:7px; }
.akari-export-dialog-host .opt { width:100%; text-align:left; display:grid; grid-template-columns:18px 1fr auto; gap:12px; align-items:center; padding:10px 12px; border-radius:9px; border:1px solid var(--aed-border); background:var(--aed-bg); color:var(--aed-ink); cursor:pointer; }
.akari-export-dialog-host .opt .rd { width:16px; height:16px; border-radius:50%; border:1.5px solid var(--aed-faint); position:relative; }
.akari-export-dialog-host .opt .nm { font-size:13px; font-weight:700; display:flex; gap:8px; align-items:baseline; }
.akari-export-dialog-host .opt .nm small { font:600 10px/1 var(--aed-sans); color:var(--aed-accent-light); letter-spacing:.05em; }
.akari-export-dialog-host .opt .ds { color:var(--aed-muted); font-size:11.5px; }
.akari-export-dialog-host .opt .est { text-align:right; font:500 11px/1.5 var(--aed-mono); color:var(--aed-muted); font-variant-numeric:tabular-nums; }
.akari-export-dialog-host .opt .est b { color:var(--aed-ink); font-weight:600; display:block; font-size:12px; }
.akari-export-dialog-host .opt .est .enc { display:block; color:var(--aed-faint); font-size:10px; margin-top:1px; }
.akari-export-dialog-host .opt.on { border-color:var(--aed-accent); background:var(--aed-accent-tint-deep); }
.akari-export-dialog-host .opt.on .rd { border-color:var(--aed-accent); }
.akari-export-dialog-host .opt.on .rd::after { content:""; position:absolute; inset:3px; border-radius:50%; background:var(--aed-accent); }
.akari-export-dialog-host .row { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; }
.akari-export-dialog-host .field { display:flex; align-items:center; border:1px solid var(--aed-border); border-radius:8px; background:var(--aed-bg); overflow:hidden; font:12px var(--aed-mono); min-width:0; }
.akari-export-dialog-host .field .dir { padding:8px 10px; color:var(--aed-faint); border-right:1px solid var(--aed-border-subtle); background:var(--aed-card); white-space:nowrap; }
.akari-export-dialog-host .field .nm { padding:8px 10px; color:var(--aed-ink); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-export-dialog-host .protoggle { margin-top:16px; display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--aed-border-subtle); border-radius:9px; background:transparent; color:var(--aed-muted); font:12px var(--aed-sans); cursor:pointer; width:100%; text-align:left; }
.akari-export-dialog-host .protoggle .car { width:0; height:0; border:4px solid transparent; border-left:5px solid var(--aed-faint); transition:transform .15s; }
.akari-export-dialog-host .protoggle[aria-expanded=true] .car { transform:rotate(90deg); }
.akari-export-dialog-host .protoggle .lb { font-weight:600; color:var(--aed-ink); white-space:nowrap; }
.akari-export-dialog-host .protoggle .sum { color:var(--aed-faint); font:11px var(--aed-mono); margin-left:auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-export-dialog-host .pro { display:flex; flex-direction:column; gap:18px; margin-top:14px; padding-top:14px; border-top:1px dashed var(--aed-border); }
.akari-export-dialog-host .legend { font-size:11px; color:var(--aed-faint); display:flex; align-items:center; gap:8px; }
.akari-export-dialog-host .pg { display:flex; flex-direction:column; gap:8px; }
.akari-export-dialog-host .fmt { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.akari-export-dialog-host .fm { position:relative; border:1px solid var(--aed-border); border-radius:8px; padding:8px 10px; background:var(--aed-bg); color:var(--aed-ink); text-align:left; display:flex; flex-direction:column; gap:1px; }
.akari-export-dialog-host .fm b { font-size:12px; color:var(--aed-ink); }
.akari-export-dialog-host .fm small { font-size:10.5px; color:var(--aed-faint); }
.akari-export-dialog-host .fm.on { border-color:var(--aed-accent); background:var(--aed-accent-tint-deep); }
.akari-export-dialog-host .fm.soon { border-style:dashed; opacity:.68; }
.akari-export-dialog-host .fm .ex { font:500 9.5px var(--aed-mono); color:var(--aed-accent-light); margin-top:2px; font-style:normal; }
.akari-export-dialog-host .fm.soon .ex { color:var(--aed-faint); }
.akari-export-dialog-host .fm .soon-tag { position:absolute; right:8px; top:8px; }
.akari-export-dialog-host .soon-tag { font:600 9.5px/1 var(--aed-sans); letter-spacing:.05em; color:var(--aed-faint); border:1px dashed #3a3a3a; padding:3px 6px; border-radius:999px; white-space:nowrap; font-style:normal; }
.akari-export-dialog-host .seg { display:inline-flex; flex-wrap:wrap; border:1px solid var(--aed-border); border-radius:7px; overflow:hidden; max-width:100%; align-self:flex-start; }
.akari-export-dialog-host .seg button { border:0; border-right:1px solid var(--aed-border-subtle); background:transparent; padding:5px 9px; font-size:11px; color:var(--aed-muted); white-space:nowrap; cursor:pointer; }
.akari-export-dialog-host .seg button:last-child { border-right:0; }
.akari-export-dialog-host .seg button.on { background:var(--aed-accent-tint); color:var(--aed-accent-light); }
.akari-export-dialog-host .seg button:disabled { cursor:default; }
.akari-export-dialog-host .seg button.na { color:#4a4a4a; }
.akari-export-dialog-host .seg button.soon { color:var(--aed-faint); background:repeating-linear-gradient(135deg,transparent 0 5px,rgba(255,255,255,.025) 5px 6px); }
.akari-export-dialog-host .seg button.soon::after { content:"近日"; font-size:8.5px; margin-left:5px; color:var(--aed-faint); border:1px dashed #3a3a3a; padding:0 4px; border-radius:999px; vertical-align:1px; }
.akari-export-dialog-host .seg u { text-decoration:none; color:var(--aed-faint); font:500 10px var(--aed-mono); margin-left:3px; }
.akari-export-dialog-host .seg button.on u { color:var(--aed-accent-light); opacity:.75; }
.akari-export-dialog-host .kvgrid { display:grid; grid-template-columns:92px minmax(0,1fr); gap:8px 10px; align-items:center; font-size:11.5px; color:var(--aed-muted); }
.akari-export-dialog-host .with { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.akari-export-dialog-host .chk { border:0; background:transparent; padding:0; display:inline-flex; align-items:center; gap:7px; font-size:11.5px; color:var(--aed-muted); cursor:pointer; }
.akari-export-dialog-host .chk i { width:14px; height:14px; border-radius:4px; border:1.5px solid var(--aed-faint); display:inline-block; }
.akari-export-dialog-host .chk i.on { border-color:var(--aed-accent); background:var(--aed-accent); box-shadow:inset 0 0 0 2px var(--aed-card); }
.akari-export-dialog-host .mt18 { margin-top:18px; }
.akari-export-dialog-host .steps { display:flex; flex-direction:column; margin-top:2px; }
.akari-export-dialog-host .step { display:grid; grid-template-columns:20px 1fr auto; gap:10px; align-items:center; padding:8px 6px; border-bottom:1px solid var(--aed-border-subtle); color:var(--aed-faint); font-size:12.5px; }
.akari-export-dialog-host .step:last-child { border-bottom:0; }
.akari-export-dialog-host .step .ic { width:16px; height:16px; border-radius:50%; border:1.5px solid var(--aed-border); display:grid; place-items:center; font-size:10px; }
.akari-export-dialog-host .step .dt { font:500 11px var(--aed-mono); color:var(--aed-faint); font-variant-numeric:tabular-nums; text-align:right; }
.akari-export-dialog-host .step.done { color:var(--aed-muted); }
.akari-export-dialog-host .step.done .ic { border-color:var(--aed-good); color:var(--aed-good); }
.akari-export-dialog-host .step.done .ic::before { content:"✓"; }
.akari-export-dialog-host .step.active { color:var(--aed-ink); font-weight:600; }
.akari-export-dialog-host .step.active .ic { border-color:var(--aed-accent); }
.akari-export-dialog-host .step.active .ic::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--aed-accent); animation:aed-blink 1.1s ease-in-out infinite; }
.akari-export-dialog-host .step.active .dt { color:var(--aed-accent-light); }
.akari-export-dialog-host .step .sub { display:block; font-weight:400; color:var(--aed-faint); font-size:11px; }
.akari-export-dialog-host .step.active .sub { color:var(--aed-muted); }
.akari-export-dialog-host .step .subbar { grid-column:2/4; height:3px; background:#262626; border-radius:2px; overflow:hidden; margin-top:-2px; }
.akari-export-dialog-host .step .subbar b { display:block; height:100%; background:var(--aed-accent); transition:width .2s linear; }
.akari-export-dialog-host .overall { margin-top:14px; }
.akari-export-dialog-host .overall .lbl { display:flex; justify-content:space-between; font:500 11.5px var(--aed-mono); color:var(--aed-muted); font-variant-numeric:tabular-nums; margin-bottom:6px; }
.akari-export-dialog-host .overall .lbl b { color:var(--aed-ink); font-size:13px; }
.akari-export-dialog-host .bar { height:8px; background:#262626; border-radius:4px; overflow:hidden; }
.akari-export-dialog-host .bar b { display:block; height:100%; background:var(--aed-accent); transition:width .2s linear; }
.akari-export-dialog-host .result { border:1px solid var(--aed-border); border-radius:10px; padding:12px 14px; background:var(--aed-bg); }
.akari-export-dialog-host .result .fnm { font:600 13px var(--aed-mono); color:var(--aed-ink); display:flex; gap:10px; align-items:center; overflow-wrap:anywhere; }
.akari-export-dialog-host .result .fnm .pill { margin-left:auto; flex:none; }
.akari-export-dialog-host .facts { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:10px; }
.akari-export-dialog-host .facts div { background:var(--aed-card); border:1px solid var(--aed-border-subtle); border-radius:7px; padding:7px 9px; }
.akari-export-dialog-host .facts small { display:block; color:var(--aed-faint); font-size:10px; letter-spacing:.05em; }
.akari-export-dialog-host .facts b { font:600 12px var(--aed-mono); color:var(--aed-ink); font-variant-numeric:tabular-nums; }
.akari-export-dialog-host .checks { margin-top:10px; display:flex; flex-direction:column; gap:5px; font-size:11.5px; color:var(--aed-muted); }
.akari-export-dialog-host .checks span::before { content:"✓ "; color:var(--aed-good); font-weight:700; }
.akari-export-dialog-host .acts { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
.akari-export-dialog-host .finding { display:grid; grid-template-columns:6px 1fr; gap:12px; border:1px solid var(--aed-border); border-radius:9px; padding:10px 12px; background:var(--aed-bg); margin-top:8px; font-size:12px; color:var(--aed-muted); }
.akari-export-dialog-host .finding i { border-radius:3px; background:var(--aed-bad); }
.akari-export-dialog-host .finding.warn i { background:var(--aed-warn); }
.akari-export-dialog-host .finding b { color:var(--aed-ink); display:block; font-size:12.5px; margin-bottom:2px; }
.akari-export-dialog-host .finding code { background:var(--aed-elevated); color:var(--aed-accent-light); padding:0 5px; border-radius:4px; font-size:11px; }
@media (prefers-reduced-motion:reduce) { .akari-export-dialog-host .blink,.akari-export-dialog-host .step.active .ic::before { animation:none!important; } }
`;

/** 拡張ビルドに asset copy が無いため、CSS はブラウザへ一度だけ直接登録する。 */
export function ensureExportDialogStyle(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = EXPORT_DIALOG_CSS;
    document.head.appendChild(style);
}
