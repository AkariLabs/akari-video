import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = join(root, 'apps/shell/extensions/akari-annotations/evidence/visual-thumbnails');
const env = { ...process.env,
  NODE_PATH: join(root, 'apps/shell/node_modules/.visual-test-tools/node_modules'),
  ...(process.argv[2] ? { CHROME_PATH: resolve(process.argv[2]) } : {})
};
const focused = process.argv.includes('--focused');
for (const extension of ['akari-annotations', 'akari-preview']) {
  const stream = createWriteStream(join(evidence, `${extension}-${focused ? 'visual' : 'regression'}.log`));
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', focused ? 'test/visual-thumbnail*.test.mjs' : 'test/*.test.mjs'], {
      cwd: join(root, 'apps/shell/extensions', extension), windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.pipe(stream); child.stderr.pipe(stream); child.on('exit', resolve);
  });
  stream.end(); console.log(`${extension}: exit ${code}`);
  if (code) process.exitCode = 1;
}
