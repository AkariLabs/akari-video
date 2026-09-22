(() => { window.__lrisStarts = []; if (!window.__lrisStartHook) { window.__lrisStartHook = 1; const o = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__lrisStarts.push({ dur: this.buffer && this.buffer.duration, ch: this.buffer && this.buffer.numberOfChannels, args: a, peak: (() => { try { const d = this.buffer.getChannelData(0); let m = 0; for (let i = 0; i < d.length; i += 50) m = Math.max(m, Math.abs(d[i])); return m; } catch { return null; } })() }); return o.apply(this, a); }; }
  const res0 = performance.getEntriesByType('resource').length;
  const click = t => { const b = [...document.querySelectorAll('button')].find(b => (b.title || b.getAttribute('aria-label')) === t); if (b) b.click(); return !!b; };
  click('10秒戻る'); setTimeout(() => click('再生'), 400);
  return { ok: true, res0 };
})()
