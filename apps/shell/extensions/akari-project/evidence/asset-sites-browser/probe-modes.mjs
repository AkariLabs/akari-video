import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const shell = resolve(import.meta.dirname, '../../../..');
const electron = join(resolve(shell, '../..'), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const observations = { measuredAt: new Date().toISOString() };
for (const mode of ['a', 'b', 'c']) {
  const dir = await mkdtemp(join(tmpdir(), `akari-site-probe-${mode}-`));
  try {
    const result = await new Promise((done, reject) => {
      const child = spawn(electron, [resolve(import.meta.dirname, 'probe-electron.cjs'), mode,
        `--user-data-dir=${dir}`, '--no-sandbox'], { cwd: shell, env: { ...process.env,
          AKARI_HOME: join(dir, 'home'), AKARI_LIBRARY_ROOT: join(dir, 'library'), AKARI_CREATOR_ROOT: join(dir, 'creator') } });
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      child.on('error', reject); child.on('exit', (code, signal) => done({ code, signal, output: output.trim(), errors: errors.slice(-500) }));
      setTimeout(() => child.kill(), 20000).unref();
    });
    console.log(JSON.stringify({ mode, ...result }));
    try {
      const lastLine = result.output.split('\n').filter(Boolean).at(-1);
      observations[mode === 'a' ? 'aStandalone' : mode] = result.code === 0 ? JSON.parse(lastLine) : { failure: result };
    } catch (error) { observations[mode === 'a' ? 'aStandalone' : mode] = { failure: String(error), result }; process.exitCode = 1; }
    if (result.code !== 0) process.exitCode = 1;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
await writeFile(join(import.meta.dirname, 'modes-observations.json'), JSON.stringify(observations, null, 2) + '\n');
