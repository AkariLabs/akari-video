import { createWriteStream } from 'node:fs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const port = Number(option('--port') ?? process.env.AKARI_CDP_PORT);
const output = option('--out') ?? process.env.AKARI_CDP_OUT;
const seconds = Number(option('--seconds') ?? process.env.AKARI_CDP_SECONDS ?? 90);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !output || !Number.isFinite(seconds) || seconds <= 0) {
    console.error('Usage: node observe.mjs --port <CDP port> --out <JSONL path> [--seconds 90]');
    process.exit(2);
}
const stream = createWriteStream(output, { flags: 'w' });
const started = Date.now();
const record = value => stream.write(JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - started, ...value }) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

let version;
for (let attempt = 0; attempt < 240; attempt++) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) { version = await response.json(); break; }
    } catch { /* The isolated app can start after the observer. */ }
    await pause(250);
}
if (!version?.webSocketDebuggerUrl) {
    record({ event: 'error', message: 'CDP endpoint unavailable' });
    stream.end();
    process.exit(1);
}
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const sessions = new Map();
const attached = new Set();
const send = (method, params = {}, sessionId) => new Promise(resolve => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: 'timeout' }); }, 8000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const boot = `(() => {
    if (window.top !== window || window.__akariResolveObserver) return;
    const state = window.__akariResolveObserver = { events: [], seen: new Set(), last: new Map(), notifications: new Set() };
    const note = value => state.events.push({ pageMs: Math.round(performance.now()), ...value });
    const findManager = () => {
        const bindings = window.theia?.container?._bindingDictionary?._map;
        if (!bindings) return;
        for (const [, group] of bindings) for (const binding of group) {
            const candidate = binding.cache;
            if (candidate && typeof candidate.getWidgets === 'function' && 'pendingWidgetPromises' in candidate) return candidate;
        }
    };
    setInterval(() => {
        const manager = findManager();
        if (manager) {
            let widgets = [];
            try { widgets = manager.getWidgets('plugin-webview'); } catch {}
            for (const widget of widgets) {
                const id = widget.identifier?.id;
                if (!id) continue;
                const viewId = widget.identifier?.viewId;
                if (!state.seen.has(id)) {
                    state.seen.add(id);
                    note({ event: 'webview-found', id, viewId });
                    const original = widget.setHTML.bind(widget);
                    widget.setHTML = html => {
                        note({ event: 'setHTML', id, viewId, htmlLength: html?.length ?? 0,
                            visible: widget.isVisible, attached: widget.isAttached, iframe: !!widget.element });
                        return original(html);
                    };
                    widget.onMessage(message => {
                        if (message?.type === 'ready') note({ event: 'ready', id, viewId });
                    });
                }
                const status = [widget.isVisible, widget.isAttached, !!widget.element].join('/');
                if (state.last.get(id) !== status) {
                    state.last.set(id, status);
                    note({ event: 'webview-state', id, viewId, visible: widget.isVisible,
                        attached: widget.isAttached, iframe: !!widget.element });
                }
            }
        }
        for (const element of document.querySelectorAll('.theia-notification-message')) {
            const message = element.textContent?.trim();
            if (message && !state.notifications.has(message)) {
                state.notifications.add(message);
                note({ event: 'notification', message });
            }
        }
    }, 50);
})()`;

async function attach(sessionId, info) {
    if (sessions.has(sessionId)) return;
    sessions.set(sessionId, info);
    record({ event: 'target', type: info.type, url: info.url });
    await send('Runtime.enable', {}, sessionId);
    if (info.type === 'page') {
        await send('Page.addScriptToEvaluateOnNewDocument', { source: boot }, sessionId);
        await send('Runtime.evaluate', { expression: boot }, sessionId);
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    }
}

socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
        return;
    }
    const data = message.params ?? {};
    if (message.method === 'Target.attachedToTarget') {
        attached.add(data.targetInfo.targetId);
        void attach(data.sessionId, data.targetInfo);
    } else if (message.method === 'Target.targetCreated') {
        const info = data.targetInfo;
        if (info.type === 'page' && !attached.has(info.targetId)) {
            attached.add(info.targetId);
            void send('Target.attachToTarget', { targetId: info.targetId, flatten: true }).then(reply => {
                if (reply.result?.sessionId) void attach(reply.result.sessionId, info);
            });
        }
    } else if (message.method === 'Target.detachedFromTarget') {
        sessions.delete(data.sessionId);
    }
};
record({ event: 'connected', browser: version.Browser });
await send('Target.setDiscoverTargets', { discover: true });
const until = Date.now() + seconds * 1000;
while (Date.now() < until) {
    for (const [sessionId, info] of sessions) {
        if (info.type !== 'page') continue;
        const reply = await send('Runtime.evaluate', {
            expression: `(() => { const s = window.__akariResolveObserver; return s ? s.events.splice(0) : []; })()`,
            returnByValue: true
        }, sessionId);
        for (const item of reply.result?.result?.value ?? []) record({ target: info.url, ...item });
    }
    await pause(100);
}
socket.close();
stream.end();
