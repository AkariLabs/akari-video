import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , electronPath, appPath, workspacePath, profileRoot, evidenceDir] = process.argv;
const wrapperPath = fileURLToPath(new URL('./electron-wrapper', import.meta.url));
const child = spawn(electronPath, [
  wrapperPath,
  `--user-data-dir=${path.join(profileRoot, 'user-data')}`,
  '--no-sandbox',
  '--window-size=1200,850'
], {
  cwd: wrapperPath,
  env: {
    ...process.env,
    AKARI_L1_APP_PATH: appPath,
    AKARI_L1_WORKSPACE_PATH: workspacePath,
    AKARI_ASSETS_CATALOG: 'http://127.0.0.1:9/catalog.json',
    AKARI_HOME: path.join(profileRoot, 'akari-home'),
    THEIA_CONFIG_DIR: path.join(profileRoot, 'config'),
    AKARI_L1_EVIDENCE_DIR: path.resolve(evidenceDir)
  },
  stdio: 'inherit'
});

child.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
