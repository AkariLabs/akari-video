import { accessSync, constants } from 'node:fs';

export function getCapabilities({ platform = process.platform, darwinMajor = 0, helperPath, env = process.env, transcribe } = {}) {
  let helperExecutable = false;
  try { if (helperPath) { accessSync(helperPath, constants.X_OK); helperExecutable = true; } } catch { /* unavailable */ }
  const supported = platform === 'darwin' && Number(darwinMajor) >= 25;
  const forced = env?.AKARI_EAR_FORCE_FALLBACK === '1';
  const liveReason = !supported ? 'この Mac / この PC はライブの文字起こしに未対応です'
    : !helperExecutable ? '聞き取りヘルパーが見つかりません'
      : forced ? '検証用設定によりライブの文字起こしを無効にしています' : undefined;
  return { engines: [
    { id: 'speechanalyzer-live', available: !liveReason, ...(liveReason ? { reason: liveReason } : {}) },
    { id: 'record-then-transcribe', available: typeof transcribe === 'function',
      ...(typeof transcribe === 'function' ? {} : { reason: '録音後の文字起こしを利用できません' }) }
  ] };
}

export function pickEngine(requested, caps) {
  const engines = caps?.engines ?? [];
  if (requested && engines.some(engine => engine.id === requested && engine.available)) return requested;
  return engines.find(engine => engine.available)?.id ?? null;
}
