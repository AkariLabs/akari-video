#!/usr/bin/env node
const mode = process.env.AKARI_EAR_FAKE_MODE ?? 'normal';
const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
if (mode === 'crash') {
  write({ type: 'ready', locale: 'ja-JP' });
  process.exitCode = 3;
} else if (mode === 'hold') {
  write({ type: 'ready', locale: 'ja-JP' });
  setInterval(() => {}, 1000);
} else {
  write({ type: 'ready', locale: 'ja-JP' });
  write({ type: 'stt', t: 0.1, final: false, text: 'もう' });
  write({ type: 'stt', t: 0.2, final: true, text: 'もう1枚' });
  write({ type: 'level', t: 0.25, rms: 0.4 });
}
