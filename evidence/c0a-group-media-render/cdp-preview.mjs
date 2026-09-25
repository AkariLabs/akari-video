import { setTimeout as sleep } from 'node:timers/promises';

export class CDP {
  constructor(url) { this.url = url; this.next = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(pending.timer);
        msg.error ? pending.reject(new Error(JSON.stringify(msg.error))) : pending.resolve(msg.result);
      } else if (msg.method) for (const listener of this.listeners.get(msg.method) ?? []) listener(msg.params, msg.sessionId);
    });
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method, fn) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]); }
  close() { this.socket?.close(); }
}

export async function evaluate(cdp, expression, contextId, sessionId) {
  const result = await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

export class PreviewFinder {
  constructor(cdp) {
    this.cdp = cdp; this.sessions = new Map(); this.contexts = new Map();
    cdp.on('Runtime.executionContextCreated', (event, sessionId) => {
      if (!sessionId) return;
      const contexts = this.contexts.get(sessionId) ?? new Map();
      contexts.set(event.context.id, event.context); this.contexts.set(sessionId, contexts);
    });
    cdp.on('Runtime.executionContextDestroyed', (event, sessionId) => this.contexts.get(sessionId)?.delete(event.executionContextId));
    cdp.on('Target.detachedFromTarget', event => { this.sessions.delete(event.sessionId); this.contexts.delete(event.sessionId); });
  }
  async initialize() {
    this.cdp.on('Target.attachedToTarget', event => { void this.register(event.sessionId, event.targetInfo); });
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await this.refresh();
  }
  async register(sessionId, info) {
    if (String(info?.url ?? '').startsWith('devtools:')) return;
    this.sessions.set(sessionId, { sessionId, info }); this.contexts.set(sessionId, new Map());
    for (const [method, params] of [
      ['Runtime.enable', {}], ['Page.enable', {}],
      ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }]
    ]) await this.cdp.send(method, params, sessionId).catch(() => {});
  }
  async refresh() {
    const targets = await this.cdp.send('Target.getTargets');
    const live = new Set([...this.sessions.values()].map(x => x.info?.targetId));
    for (const info of targets.targetInfos ?? []) {
      if (!['page', 'iframe', 'webview', 'other'].includes(info.type) || live.has(info.targetId)) continue;
      try {
        const attached = await this.cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        await this.register(attached.sessionId, info);
      } catch { /* target may disappear */ }
    }
  }
  async find(timeout = 60000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      await this.refresh();
      for (const session of this.sessions.values()) for (const context of this.contexts.get(session.sessionId)?.values() ?? []) {
        try {
          const hit = await evaluate(this.cdp, `Boolean(document.getElementById('preview-stage') && document.getElementById('seek'))`, context.id, session.sessionId);
          if (hit) return { sessionId: session.sessionId, contextId: context.id };
        } catch { /* context expired */ }
      }
      await sleep(250);
    }
    throw new Error('preview execution context missing');
  }
}
