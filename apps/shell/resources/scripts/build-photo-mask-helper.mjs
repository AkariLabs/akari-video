import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(shellRoot, 'native/photo-mask-helper.swift');
const output = path.join(shellRoot, 'native/bin/akari-photo-mask');
mkdirSync(path.dirname(output), { recursive: true });
if (process.platform !== 'darwin') process.exit(0);
const result = spawnSync('swiftc', ['-O', '-parse-as-library', '-swift-version', '5', source,
  path.join(shellRoot, 'native/photo-mask-instances.swift'),
  path.join(shellRoot, 'native/photo-sam-server.swift'), '-o', output], { stdio: 'inherit' });
if (result.error || result.status !== 0 || !existsSync(output)) {
  throw new Error(`photo mask helper build failed: ${result.error?.message ?? result.status}`);
}
