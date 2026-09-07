// Windows L1 tooling: build this checkout, optionally copying matching native artifacts
// from an existing checkout. Sources are read-only; no shared node_modules junctions.
import { cpSync, existsSync, readFileSync, realpathSync, mkdirSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shell = join(root, 'apps/shell');
const destination = join(shell, 'node_modules');
const source = process.argv[2];
if (source && source !== '--isolated') {
  const from = realpathSync(source);
  const copy = (src, dest) => {
    if (!relative(root, resolve(dest)).startsWith('..')) cpSync(src, dest, { recursive: true, dereference: true });
    else throw Error('Destination escaped this worktree');
  };
  for (const name of ['drivelist', 'native-keymap', 'keytar', 'node-pty', '@parcel/watcher', '@vscode/windows-ca-certs']) {
    const src = join(from, name); const dest = join(destination, name);
    if (!existsSync(join(src, 'package.json')) || !existsSync(join(dest, 'package.json'))) continue;
    if (JSON.parse(readFileSync(join(src, 'package.json'))).version !== JSON.parse(readFileSync(join(dest, 'package.json'))).version) continue;
    for (const folder of ['build/Release', 'prebuilds']) {
      if (existsSync(join(src, folder))) { mkdirSync(join(dest, folder), { recursive: true }); copy(join(src, folder), join(dest, folder)); }
    }
  }
  if (existsSync(join(from, 'playwright-core'))) copy(join(from, 'playwright-core'), join(destination, 'playwright-core'));
}
if (process.argv.includes('--isolated')) {
  const app = join(root, 'node_modules/.visual-thumbnail-app');
  mkdirSync(app, { recursive: true });
  for (const file of ['package.json', 'electron-entry.js', 'src-gen', 'resources', 'lib', 'esbuild.mjs',
    'gen-esbuild.browser.mjs', 'gen-esbuild.node.mjs', 'gen-esbuild.electron.mjs']) {
    cpSync(join(shell, file), join(app, file), { recursive: true });
  }
  if (!existsSync(join(app, 'node_modules'))) symlinkSync(destination, join(app, 'node_modules'), 'junction');
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['esbuild.mjs'], { cwd: app, windowsHide: true, stdio: 'inherit' });
    child.on('exit', resolve);
  });
  process.exit(code ?? 1);
}
const require = createRequire(join(shell, 'package.json'));
const { ApplicationPackageManager } = require('@theia/application-manager');
class L1Manager extends ApplicationPackageManager {
  async prepare() {
    // The existing Windows L1 procedure skips only the native ffmpeg license scanner.
    console.log('L1: skipping ffmpeg.node license scanner; production application code is unchanged');
  }
}
process.chdir(shell);
await new L1Manager({ projectPath: shell, appTarget: 'electron' }).build(['--mode', 'production'], { mode: 'production' });
