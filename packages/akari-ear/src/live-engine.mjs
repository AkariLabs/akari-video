import { spawn as defaultSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export function createLiveEngine({ helperPath, spawn = defaultSpawn, now = Date.now }) {
  const events = new EventEmitter();
  events.on('error', () => {});
  let child;
  let stopped = false;
  let startedAt;

  function start() {
    if (child || stopped) return;
    startedAt = now();
    try {
      child = spawn(helperPath, [], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch (error) {
      events.emit('error', error);
      return;
    }
    let pending = '';
    const consume = line => {
      let value;
      try { value = JSON.parse(line); } catch { return; }
      if (!value || typeof value !== 'object') return;
      if (value.type === 'ready') events.emit('status', { state: 'listening', locale: value.locale });
      else if (value.type === 'status') events.emit('status', { state: 'listening', message: value.message, t: value.t });
      else if (value.type === 'error') events.emit('error', new Error(String(value.message ?? '聞き取りに失敗しました')));
      else if (value.type === 'level' && Number.isFinite(value.rms)) events.emit('level', value.rms);
      else if (value.type === 'stt' && typeof value.text === 'string') {
        events.emit(value.final === true ? 'final' : 'partial', {
          text: value.text, final: value.final === true,
          t: Number.isFinite(value.t) ? value.t : (now() - startedAt) / 1000,
          ...(Number.isFinite(value.confidence) ? { confidence: value.confidence } : {})
        });
      }
    };
    child.stdout?.on('data', chunk => {
      pending += chunk.toString();
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        consume(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    });
    child.on('error', error => { if (!stopped) events.emit('error', error); });
    child.on('close', code => {
      if (pending.trim()) consume(pending);
      if (!stopped && code !== 0) events.emit('error', new Error(`聞き取りヘルパーが異常終了しました (${code})`));
      child = undefined;
    });
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    child?.kill();
  }

  return { on: events.on.bind(events), start, stop };
}
