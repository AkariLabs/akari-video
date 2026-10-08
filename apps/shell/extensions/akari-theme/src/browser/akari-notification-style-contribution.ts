import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';

const CSS = `
.theia-notifications-overlay .theia-notifications-container { width:min(336px,calc(100vw - 20px)); right:10px; bottom:38px; color:var(--akari-ink); font-family:var(--theia-ui-font-family); }
.theia-notifications-overlay .theia-notification-toasts .theia-notification-list { display:flex; flex-direction:column; gap:8px; }
.theia-notifications-overlay .akari-notification-row { --akari-notification-kind:var(--akari-accent); box-sizing:border-box; border:1px solid var(--akari-line); border-radius:14px; background:var(--akari-toast-surface); box-shadow:var(--akari-toast-shadow); -webkit-backdrop-filter:blur(16px) saturate(1.3); backdrop-filter:blur(16px) saturate(1.3); color:var(--akari-ink); overflow:hidden; will-change:transform; }
.theia-notifications-overlay .theia-notification-toasts .theia-notification-list-item-container.akari-notification-row { border-radius:14px; }
.theia-notifications-overlay .akari-notification-row[data-kind="warning"] { --akari-notification-kind:var(--akari-warning); }
.theia-notifications-overlay .akari-notification-row[data-kind="error"] { --akari-notification-kind:var(--akari-danger); }
.theia-notifications-overlay .akari-notification-row[data-kind="progress"] { --akari-notification-kind:var(--akari-accent); }
.theia-notifications-overlay .theia-notification-toasts .akari-notification-row { margin:0; animation:akari-toast-in .28s cubic-bezier(.2,.9,.3,1.15); }
@keyframes akari-toast-in { from { opacity:0; transform:translateY(14px) scale(.96); } to { opacity:1; transform:none; } }
.theia-notifications-overlay .akari-notification-row .theia-notification-list-item { box-shadow:none; border:0; border-radius:inherit; background:transparent; cursor:default; overflow:hidden; }
.theia-notifications-overlay .theia-notification-toasts .theia-notification-list-item-container.akari-notification-row .theia-notification-list-item { border-radius:inherit; overflow:hidden; }
.theia-notifications-overlay .akari-notification-row .theia-notification-list-item-content { margin:0; padding:10px 8px 10px 12px; }
.theia-notifications-overlay .akari-notification-row .theia-notification-list-item-content-main { display:grid; grid-template-columns:26px minmax(0,1fr) auto; column-gap:10px; align-items:start; padding:0; }
.theia-notifications-overlay .akari-notification-row .theia-notification-icon { box-sizing:border-box; width:26px; height:26px; margin:0; display:grid; place-items:center; border-radius:50%; background:color-mix(in srgb,var(--akari-notification-kind) 16%,transparent); color:var(--akari-notification-kind); }
.theia-notifications-overlay .akari-notification-row .theia-notification-icon:before { color:inherit; font-size:14px; }
.theia-notifications-overlay .akari-notification-row .theia-notification-message { min-width:0; margin:3px 0 0; font-size:13px; line-height:1.5; font-weight:700; overflow-wrap:anywhere; white-space:normal; }
.theia-notifications-overlay .akari-notification-row .theia-notification-message a { color:var(--akari-accent-light); }
.theia-notifications-overlay .akari-notification-row .theia-notification-source { display:block; margin-top:1px; padding:0; font-size:11px; font-weight:400; line-height:1.5; color:var(--akari-muted); }
.theia-notifications-overlay .akari-notification-row .theia-notification-buttons { display:flex; justify-content:flex-start; flex-wrap:wrap; gap:6px; margin-top:8px; }
.theia-notifications-overlay .akari-notification-button { box-sizing:border-box; max-width:100%; margin:0; padding:3px 11px; border:1px solid var(--akari-line); border-radius:999px; background:transparent; color:var(--akari-ink); font:700 12px/1.5 var(--theia-ui-font-family); cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.theia-notifications-overlay .akari-notification-button:hover { background:var(--akari-elevated); }
.theia-notifications-overlay .akari-notification-button.primary { background:var(--akari-accent); border-color:var(--akari-accent); color:var(--akari-bg); }
.theia-notifications-overlay .akari-notification-actions { display:flex; align-items:flex-start; }
.theia-notifications-overlay .akari-notification-close, .theia-notifications-overlay .akari-notification-expand { position:relative; width:26px; height:26px; padding:0; display:grid; place-items:center; border:0; border-radius:50%; background:transparent; color:var(--akari-faint); font:18px/1 var(--theia-ui-font-family); cursor:pointer; }
.theia-notifications-overlay .akari-notification-close:hover, .theia-notifications-overlay .akari-notification-expand:hover { color:var(--akari-ink); }
.theia-notifications-overlay .akari-notification-close > span { position:relative; z-index:1; font-size:17px; line-height:1; }
.theia-notifications-overlay .akari-notification-ring { position:absolute; inset:2px; width:22px; height:22px; transform:rotate(-90deg); pointer-events:none; }
.theia-notifications-overlay .akari-notification-ring circle { fill:none; stroke-width:1.6; }
.theia-notifications-overlay .akari-ring-bg { stroke:var(--akari-line); }
.theia-notifications-overlay .akari-ring-fg { stroke:var(--akari-notification-kind); stroke-dasharray:56.55; stroke-linecap:round; }
.theia-notifications-overlay .akari-notification-row[data-exit="absorbing"] { background:color-mix(in srgb,var(--akari-notification-kind) 60%,var(--akari-card)); border-color:var(--akari-notification-kind); transition:background .28s,border-color .28s; }
.theia-notifications-overlay .akari-notification-row[data-exit="absorbing"] > * { opacity:0; transition:opacity .13s; }
.theia-notifications-overlay .theia-notification-center { width:min(336px,calc(100vw - 16px)); right:8px; max-height:calc(100vh - 86px); border:1px solid var(--akari-line); border-radius:14px; background:var(--akari-toast-surface); box-shadow:var(--akari-toast-shadow); -webkit-backdrop-filter:blur(16px) saturate(1.3); backdrop-filter:blur(16px) saturate(1.3); overflow:hidden; transform-origin:calc(100% - 18px) 100%; }
.theia-notifications-overlay .theia-notification-center.open { animation:akari-center-in .18s cubic-bezier(.2,.9,.3,1.1); }
@keyframes akari-center-in { from { opacity:0; transform:scale(.94); } to { opacity:1; transform:none; } }
.theia-notifications-overlay .theia-notification-center-header { display:flex; align-items:center; justify-content:space-between; min-height:0; padding:9px 10px 9px 14px; border-bottom:1px solid var(--akari-line-inner); background:transparent; color:var(--akari-ink); }
.theia-notifications-overlay .theia-notification-center-header-title { margin:0; font-size:12.5px; font-weight:700; }
.theia-notifications-overlay .theia-notification-center-header-actions { display:flex; align-items:center; gap:2px; margin:0; }
.theia-notifications-overlay .akari-notification-clear, .theia-notifications-overlay .akari-notification-hide { border:0; border-radius:999px; background:transparent; color:var(--akari-muted); cursor:pointer; }
.theia-notifications-overlay .akari-notification-clear { padding:2px 8px; font-size:11.5px; }
.theia-notifications-overlay .akari-notification-hide { width:22px; height:22px; }
.theia-notifications-overlay .akari-notification-clear:hover, .theia-notifications-overlay .akari-notification-hide:hover { background:var(--akari-elevated); color:var(--akari-ink); }
.theia-notifications-overlay .theia-notification-list-scroll-container { max-height:300px; overflow:auto; }
.theia-notifications-overlay .theia-notification-center .theia-notification-list { display:block; }
.theia-notifications-overlay .theia-notification-center .akari-notification-row { border:0; border-radius:10px; background:transparent; box-shadow:none; -webkit-backdrop-filter:none; backdrop-filter:none; }
.theia-notifications-overlay .theia-notification-center .akari-notification-row:hover { background:var(--akari-elevated); }
.theia-notifications-overlay .theia-notification-center .akari-notification-row .theia-notification-list-item-content { padding:8px; }
.theia-notifications-overlay .theia-notification-center .akari-notification-row .theia-notification-message { font-size:13px; font-weight:700; line-height:1.5; }
.theia-notifications-overlay .theia-notification-center .akari-notification-row .theia-notification-actions { display:flex; align-items:flex-start; gap:2px; white-space:nowrap; }
.theia-notifications-overlay .theia-notification-center .akari-notification-time { display:block; padding-top:5px; color:var(--akari-faint); font:10.5px/1.5 ui-monospace,monospace; }
.theia-notifications-overlay .theia-notification-center .akari-notification-close { width:18px; height:18px; margin-top:1px; font-size:14px; }
.theia-notifications-overlay .akari-notification-empty { padding:26px 12px; text-align:center; color:var(--akari-faint); font-size:12.5px; }
.theia-notifications-overlay .theia-notification-center .theia-notification-list:has(.akari-update-history) .akari-notification-empty { display:none; }
.theia-notifications-overlay .theia-notification-center .akari-update-history { border:0; border-radius:10px; }
#status-bar-theia-notification-center { position:relative; box-sizing:border-box; min-width:32px; width:32px; height:24px; margin:0 2px; padding:0; display:grid; place-items:center; overflow:visible; }
#status-bar-theia-notification-center .codicon { font-size:15px; }
#status-bar-theia-notification-center .akari-notification-badge { position:absolute; top:-3px; right:0; min-width:14px; height:14px; box-sizing:border-box; padding:0 3px; border-radius:7px; background:var(--akari-accent); color:var(--akari-bg); font:500 9.5px/14px ui-monospace,monospace; text-align:center; pointer-events:none; }
#status-bar-theia-notification-center[data-unread-error="true"] .akari-notification-badge { background:var(--akari-danger); }
#status-bar-theia-notification-center .akari-bell-ripple { position:absolute; left:50%; top:50%; width:10px; height:10px; margin:-5px 0 0 -5px; border:1.5px solid var(--akari-accent); border-radius:50%; opacity:0; pointer-events:none; }
#status-bar-theia-notification-center.akari-bell-ring .codicon { animation:akari-bell-ring .62s cubic-bezier(.3,.7,.3,1); }
#status-bar-theia-notification-center.akari-bell-ring .akari-bell-ripple { animation:akari-bell-ripple .62s ease-out; }
#status-bar-theia-notification-center.akari-bell-ring .akari-notification-badge { animation:akari-badge-pop .36s cubic-bezier(.2,.9,.3,1.6); }
@keyframes akari-bell-ring { 0% { transform:rotate(0); } 20% { transform:rotate(16deg) scale(1.18); } 45% { transform:rotate(-12deg) scale(1.1); } 70% { transform:rotate(6deg); } 100% { transform:rotate(0); } }
@keyframes akari-bell-ripple { 0% { opacity:.9; transform:scale(.6); } 100% { opacity:0; transform:scale(4.2); } }
@keyframes akari-badge-pop { from { transform:scale(.4); } to { transform:scale(1); } }
@media (prefers-reduced-motion:reduce) { .theia-notifications-overlay .theia-notification-toasts .akari-notification-row, .theia-notifications-overlay .theia-notification-center.open, #status-bar-theia-notification-center.akari-bell-ring .codicon, #status-bar-theia-notification-center.akari-bell-ring .akari-bell-ripple, #status-bar-theia-notification-center.akari-bell-ring .akari-notification-badge { animation:none; } }
`;

@injectable()
export class AkariNotificationStyleContribution implements FrontendApplicationContribution {
    onStart(): void {
        const style = document.createElement('style');
        style.id = 'akari-notification-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }
}
