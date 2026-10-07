const ID = 'akari-rough-canvas-style';
export function ensureRoughCanvasStyle(): void {
    if (document.getElementById(ID)) return;
    const style = document.createElement('style');
    style.id = ID;
    style.textContent = `
.akari-rough-canvas-host { background:transparent!important; pointer-events:none; }
.akari-rough-canvas-host .dialogBlock { position:absolute; margin:0; padding:0!important; min-width:0!important; max-width:none!important; max-height:100vh; overflow:hidden; pointer-events:auto; background:var(--akari-card)!important; border:1px solid var(--akari-line); border-radius:12px; }
.akari-rough-canvas-host .dialogTitle,.akari-rough-canvas-host .dialogControl { display:none!important; }
.akari-rough-canvas-host .dialogContent { padding:0!important; color:var(--akari-ink); height:100%; min-height:0; overflow:hidden; }
.akari-rough-canvas-host * { box-sizing:border-box; }
.akari-rough-canvas { display:flex; flex-direction:column; background:var(--akari-card); height:100%; font:13px/1.4 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif; }
.akari-rough-canvas-header,.akari-rough-canvas-tools,.akari-rough-canvas-footer { display:flex; align-items:center; gap:6px; padding:8px; }
.akari-rough-canvas-header { border-bottom:1px solid var(--akari-line); cursor:move; }
.akari-rough-canvas-header strong { flex:1; }
.akari-rough-canvas-tools { flex-wrap:wrap; }
.akari-rough-canvas-paper { position:relative; flex:1; min-height:0; margin:0 8px; overflow:hidden; background:var(--akari-bg); }
.akari-rough-canvas-backdrop { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; opacity:.35; pointer-events:none; }
.akari-rough-canvas-ink { position:absolute; inset:0; }
.akari-rough-canvas-hint { position:absolute; left:8px; bottom:8px; pointer-events:none; background:var(--akari-card); color:var(--akari-ink); padding:3px 6px; }
.akari-rough-canvas-memo { margin:8px; width:calc(100% - 16px); background:var(--akari-bg); color:var(--akari-ink); border:1px solid var(--akari-line); padding:6px; }
.akari-rough-canvas-footer { border-top:1px solid var(--akari-line); }
.akari-rough-canvas-footer .grow { flex:1; }
.akari-rough-canvas-error { padding:0 8px; color:var(--akari-ink); }
.akari-rough-canvas-confirm { padding:6px 8px; background:var(--akari-bg); }
.akari-rough-canvas-resize { position:absolute; right:0; bottom:0; width:18px; height:18px; cursor:nwse-resize; border-right:3px solid var(--akari-accent); border-bottom:3px solid var(--akari-accent); }
`;
    document.head.appendChild(style);
}
