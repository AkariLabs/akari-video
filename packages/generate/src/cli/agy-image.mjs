import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { resolveFfmpeg } from '../../../media-bin/src/index.mjs';

const KEY_NAMES = ['FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY'];
const exists = path => access(path).then(() => true, () => false);
const cleanEnv = env => {
  const result = { ...env };
  for (const name of KEY_NAMES) delete result[name];
  return result;
};
const concise = output => output.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).slice(-2).join(' / ').slice(0, 500);

function run(command, args, { cwd, env, spawnProcess, timeoutMs, onChild }) {
  return new Promise(resolvePromise => {
    let child;
    let output = '';
    let finished = false;
    const finish = (code, timedOut = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolvePromise({ code, timedOut, output });
    };
    const timer = setTimeout(() => { child?.kill('SIGKILL'); finish(null, true); }, timeoutMs);
    try {
      child = spawnProcess(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      onChild?.(child);
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
        output = (output + String(chunk)).slice(-8192);
      });
      child.once('error', error => { output += `\n${error.message}`; finish(null); });
      child.once('close', code => finish(code));
    } catch (error) { output += `\n${error.message ?? error}`; finish(null); }
  });
}

async function normalizePng(output, { cwd, env, spawnProcess, onChild, timeoutMs }) {
  let source = output;
  if (!await exists(source)) {
    source = [output.replace(/\.png$/iu, '.jpg'), output.replace(/\.png$/iu, '.jpeg')]
      .find(candidate => candidate !== output && candidate);
    if (!source || !await exists(source)) {
      const jpeg = output.replace(/\.png$/iu, '.jpeg');
      if (!await exists(jpeg)) throw new Error('指定の PNG がありません');
      source = jpeg;
    }
  }
  const signature = (await readFile(source)).subarray(0, 4);
  if (signature.subarray(1, 4).toString('ascii') === 'PNG') {
    if (source !== output) await rename(source, output);
    return;
  }
  if (!(signature[0] === 0xff && signature[1] === 0xd8)) throw new Error('生成物が PNG/JPEG ではありません');
  const converted = `${output}.converted.png`;
  const ffmpeg = resolveFfmpeg({ env });
  const result = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-frames:v', '1', converted],
    { cwd, env, spawnProcess, timeoutMs: Math.min(60_000, timeoutMs), onChild });
  if (result.code !== 0 || !await exists(converted)) throw new Error(`JPEG を PNG に変換できません: ${concise(result.output)}`);
  await rename(converted, output);
  if (source !== output) await rm(source, { force: true });
}

/** Shared file contract for the two subscription CLI routes. */
export async function generateCliImage({ route, projectDir, item, aspect, env = process.env,
  spawnProcess = spawn, onChild, timeoutMs = 600_000 }) {
  const root = resolve(projectDir);
  const output = resolve(root, item.path);
  if (!output.startsWith(`${root}${sep}`)) return { id: item.id, ok: false, error: '出力先がプロジェクト外です' };
  const safeEnv = cleanEnv(env);
  const prefix = route === 'grok' ? `${item.prompt}\n\nimage_gen の aspect_ratio に ${aspect} を渡してください。` : item.prompt;
  const instruction = `${prefix}\n\n画像をちょうど 1 枚生成し、絶対パス ${output} に PNG で保存してください。他のファイルを作成・変更せず、git を実行しないでください。返答は保存先だけにしてください。`;
  const command = route === 'antigravity' ? safeEnv.AKARI_AGY_BIN ?? 'agy' : safeEnv.AKARI_GROK_BIN ?? 'grok';
  const args = route === 'antigravity'
    ? ['-p', instruction, '--dangerously-skip-permissions', '--disable-slash-commands', '--print-timeout', '8m']
    : ['-p', instruction, '--always-approve', '--output-format', 'streaming-json', '--cwd', root];
  const started = Date.now();
  try {
    await mkdir(dirname(output), { recursive: true });
    const result = await run(command, args, { cwd: root, env: safeEnv, spawnProcess, timeoutMs, onChild });
    if (result.timedOut) throw new Error('10 分で打ち切りました');
    if (result.code !== 0) throw new Error(concise(result.output) || `${route} exit ${result.code}`);
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw new Error('10 分で打ち切りました');
    try { await normalizePng(output, { cwd: root, env: safeEnv, spawnProcess, onChild, timeoutMs: remaining }); }
    catch (error) { throw new Error(`${error.message}。${concise(result.output)}`); }
    return { id: item.id, ok: true, elapsed_s: (Date.now() - started) / 1000 };
  } catch (error) {
    return { id: item.id, ok: false, error: error.message ?? String(error) };
  }
}

export async function generateAgyImage(options) {
  return generateCliImage({ ...options, route: 'antigravity' });
}
