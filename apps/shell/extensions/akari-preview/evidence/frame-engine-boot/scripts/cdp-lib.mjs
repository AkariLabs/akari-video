import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_TIMEOUT_MS = 20000;

export class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method && this.handlers.has(message.method)) {
        for (const handler of this.handlers.get(message.method)) handler(message.params);
      }
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    return Promise.race([
      response,
      sleep(timeoutMs).then(() => { throw new Error(`CDP ${method} timed out after ${timeoutMs}ms`); })
    ]);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

export async function evalOn(cdp, expression, contextId) {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (contextId !== undefined) params.contextId = contextId;
  const response = await cdp.send('Runtime.evaluate', params);
  if (response.exceptionDetails) {
    throw new Error(`evaluate failed: ${JSON.stringify(response.exceptionDetails).slice(0, 1200)}`);
  }
  return response.result.value;
}

export async function waitFor(label, predicate, timeout = 60000, interval = 200) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`timed out: ${label}${lastError ? ` / ${lastError.message}` : ''}`);
}

export { sleep };
