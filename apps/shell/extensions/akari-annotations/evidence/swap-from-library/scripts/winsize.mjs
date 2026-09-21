// Resize the Electron window through the browser-level CDP target: node winsize.mjs <width> <height>
import { CDP, listTargets } from './cdp-lib.mjs';
const port = Number(process.env.CDP_PORT || 9395);
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const page = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(version.webSocketDebuggerUrl); await cdp.connect();
const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget', { targetId: page.id });
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: +process.argv[2], height: +process.argv[3] } });
console.log(JSON.stringify({ before: bounds, after: (await cdp.send('Browser.getWindowBounds', { windowId })).bounds })); process.exit(0);
