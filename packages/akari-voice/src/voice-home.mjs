import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

export const VOICE_MISSING_MESSAGE = '話者を分けるには準備が要ります（akari tools install voice か、アプリの『字幕を作る』から）';
export const VOICE_ENGINE_VERSION = 'akari.voice/1';
const models = ['wespeaker_en_voxceleb_resnet34_LM.onnx', 'pyannote-segmentation-3.0.onnx', 'silero_vad.onnx'];

export function resolveVoiceHome({ env = process.env, homeDir = os.homedir() } = {}) {
  return path.resolve(env.AKARI_VOICE_HOME || path.join(env.AKARI_HOME || path.join(homeDir, '.akari'), 'tools', 'voice'));
}

export function voiceRuntimeKey(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  if (!['win32-x64', 'darwin-arm64', 'darwin-x64'].includes(key)) return null;
  return key;
}

export function voiceEngineVersion(manifest) {
  const parts = [VOICE_ENGINE_VERSION,
    ...(manifest?.runtime?.packages || []).map(({ name, version }) => `${name}@${version}`).sort(),
    ...(manifest?.models || []).map(({ file, sha256 }) => `${file}:${sha256}`).sort()];
  return `${VOICE_ENGINE_VERSION}:${createHash('sha256').update(parts.join('\n')).digest('hex')}`;
}

export function voiceEngineStatus({ home = resolveVoiceHome(), platform = process.platform, arch = process.arch } = {}) {
  const key = voiceRuntimeKey(platform, arch);
  const runtimeDir = key ? path.join(home, 'runtime', key) : null;
  const modelsDir = path.join(home, 'models');
  if (!key) return { status: 'unsupported', home, runtimeDir, modelsDir, missing: [], manifest: null };
  const nativeName = key === 'win32-x64' ? 'sherpa-onnx-win-x64' : `sherpa-onnx-${key}`;
  const required = ['manifest.json', ...['sherpa-onnx-node', nativeName, 'onnxruntime-node', 'onnxruntime-common']
    .map(name => path.join('runtime', key, 'node_modules', name, 'package.json')),
  ...models.map(file => path.join('models', file))];
  const missing = required.filter(file => !fs.existsSync(path.join(home, file))).map(file => file.replaceAll('\\', '/'));
  let manifest = null;
  if (!missing.includes('manifest.json')) {
    try { manifest = JSON.parse(fs.readFileSync(path.join(home, 'manifest.json'), 'utf8')); }
    catch { missing.push('manifest.json'); }
  }
  return { status: missing.length ? 'missing' : 'ready', home, runtimeDir, modelsDir, missing, manifest };
}

export function loadVoiceRuntime(status) {
  if (status.status !== 'ready') throw new Error(VOICE_MISSING_MESSAGE);
  const require = createRequire(path.join(status.runtimeDir, 'node_modules', 'akari-voice-runtime.cjs'));
  // Windows では共有 DLL を先に確定させる。
  const ort = require('onnxruntime-node');
  const sherpa = require('sherpa-onnx-node');
  return { ort, sherpa };
}
