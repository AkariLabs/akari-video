const ID = 'akari-rough-canvas-style';
export function ensureRoughCanvasStyle(): void {
    if (document.getElementById(ID)) return;
    const style = document.createElement('style');
    style.id = ID;
    style.textContent = `
.akari-rough-canvas-host { background:transparent!important; pointer-events:none; }
.akari-rough-canvas-host .dialogBlock { position:absolute; margin:0; padding:0!important; min-width:0!important; max-width:none!important; max-height:calc(100vh - 16px); overflow:visible; pointer-events:auto; background:transparent!important; border:0!important; container-type:inline-size; }
.akari-rough-canvas-host .dialogTitle,.akari-rough-canvas-host .dialogControl { display:none!important; }
.akari-rough-canvas-host .dialogContent { padding:0!important; color:var(--akari-ink); height:100%; min-height:0; overflow:visible; }
.akari-rough-canvas-host * { box-sizing:border-box; }
.akari-rough-canvas { display:flex; flex-direction:column; background:var(--akari-card); height:100%; min-height:0; overflow:hidden; border:1px solid var(--akari-line); border-radius:calc(var(--akari-card-radius, 12px) + 2px); box-shadow:0 24px 60px color-mix(in srgb, var(--akari-ground) 65%, transparent); font:11.5px/1.4 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif; }
.akari-rough-canvas-header,.akari-rough-canvas-footer { display:flex; align-items:center; flex:none; min-width:0; white-space:nowrap; }
.akari-rough-canvas-header .theia-button,.akari-rough-canvas-footer .theia-button { min-width:0!important; }
.akari-rough-canvas-header { gap:3px; padding:8px 8px; border-bottom:1px solid var(--akari-line-inner); cursor:move; overflow:hidden; font-size:12.5px; }
.akari-rough-canvas-header strong { font-size:14px; flex:none; letter-spacing:-.03em; }
.akari-rough-canvas-header .grow { flex:1 1 auto; min-width:0; }
.akari-rough-canvas-mark { flex:none; width:8px; height:8px; border-radius:50%; background:var(--akari-faint); }
.akari-rough-canvas-mark.listening { background:var(--akari-accent); box-shadow:0 0 6px var(--akari-accent); }
.akari-rough-canvas-tools,.akari-rough-canvas-ink-toolbar,.akari-rough-canvas-swatches { display:flex; align-items:center; flex:none; min-width:0; }
.akari-rough-canvas-ink-toolbar { gap:3px; }
.akari-rough-canvas-tools .akari-seg { gap:1px; padding:2px; flex-wrap:nowrap; }
.akari-rough-canvas-header .theia-button.small { height:24px; padding:0 4px; margin:0; font-size:inherit; white-space:nowrap; flex:none; }
.akari-rough-canvas-tools .akari-seg > .theia-button { height:22px; padding:0 4px; font-size:inherit; }
.akari-rough-canvas-header .theia-button.icon { width:20px; padding:0; }
.akari-rough-canvas-swatches { gap:3px; }
.akari-rough-canvas-header .akari-rough-canvas-swatch.theia-button { width:20px; height:20px; padding:0; border-radius:50%; }
.akari-rough-canvas-swatch span { display:block; width:18px; height:18px; border-radius:50%; border:1px solid var(--akari-button-secondary-line); }
.akari-rough-canvas-swatch[aria-pressed="true"] { outline:2px solid var(--akari-accent); outline-offset:1px; }
.akari-rough-canvas-underlay-label { display:inline-flex; align-items:center; gap:3px; flex:none; color:var(--akari-muted); cursor:pointer; }
.akari-rough-canvas-underlay-label input { width:12px; height:12px; margin:0; accent-color:var(--akari-accent); }
.akari-rough-canvas-paper { position:relative; flex:0 1 auto; width:calc(100% - 32px); min-height:0; margin:16px; overflow:hidden; border-radius:8px; background:Canvas; color-scheme:light; outline:none!important; }
.akari-rough-canvas-backdrop { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; opacity:.35; pointer-events:none; }
.akari-rough-canvas-ink { position:absolute; inset:0; outline:none!important; }
.akari-rough-canvas-host .akari-rough-canvas-ink:focus,.akari-rough-canvas-host .akari-rough-canvas-ink:focus-visible { outline:none!important; box-shadow:none!important; }
.akari-rough-canvas-hint { position:absolute; left:8px; bottom:8px; pointer-events:none; background:var(--akari-card); color:var(--akari-muted); padding:3px 6px; border-radius:6px; font-size:10px; }
.akari-rough-canvas-footer { gap:3px; min-height:44px; margin-top:auto; padding:8px 8px; border-top:1px solid var(--akari-line-inner); overflow:hidden; }
.akari-rough-canvas-memo { flex:1 1 auto; min-width:0; height:22px; padding:0; margin:0; border:0!important; outline:none!important; background:transparent; color:var(--akari-ink); font:inherit; }
.akari-rough-canvas-memo::placeholder { color:var(--akari-muted); opacity:1; }
.akari-rough-canvas-host .akari-rough-canvas-memo:focus,.akari-rough-canvas-host .akari-rough-canvas-memo:focus-visible { outline:none!important; border:0!important; box-shadow:inset 0 -1px 0 var(--akari-line-inner)!important; }
.akari-rough-canvas-page-controls { display:inline-flex; align-items:center; gap:1px; flex:none; }
.akari-rough-canvas-page-controls .theia-button.icon { width:18px; height:22px; }
.akari-rough-canvas-page-controls > span { color:var(--akari-muted); font-size:10px; white-space:nowrap; }
.akari-rough-canvas-footer .theia-button.small { height:22px; padding:0 5px; margin:0; white-space:nowrap; flex:none; font-size:11px; }
.akari-rough-canvas-error { padding:0 10px; color:var(--akari-danger); }
.akari-rough-canvas-confirm { padding:5px 10px; background:var(--akari-elevated); }
.akari-rough-canvas-confirm-actions { display:flex; justify-content:flex-end; gap:5px; padding-top:4px; }
.akari-rough-canvas-confirm-actions .theia-button { margin:0; }
.akari-rough-canvas-task-packet { display:flex; align-items:center; gap:6px; min-width:0; padding:2px 8px; color:var(--akari-muted); font-size:10px; }
.akari-rough-canvas-task-packet[hidden] { display:none; }
.akari-rough-canvas-task-packet span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-rough-canvas-task-packet label { display:inline-flex; align-items:center; white-space:nowrap; }
.akari-rough-canvas-resize { position:absolute; right:2px; bottom:2px; width:18px; height:18px; cursor:nwse-resize; background:transparent; opacity:0; }
@container (max-width:540px) {
  .akari-rough-canvas-header { gap:2px; padding:8px 5px; font-size:9px; }
  .akari-rough-canvas-header strong { font-size:10.5px; }
  .akari-rough-canvas-ink-toolbar { gap:1px; }
  .akari-rough-canvas-tools .akari-seg { gap:0; padding:1px; }
  .akari-rough-canvas-header .theia-button.small { height:22px; padding:0 2px; }
  .akari-rough-canvas-tools .akari-seg > .theia-button { height:20px; padding:0 2px; }
  .akari-rough-canvas-swatches { gap:1px; }
  .akari-rough-canvas-underlay-label { gap:2px; }
}
`;
    document.head.appendChild(style);
}
