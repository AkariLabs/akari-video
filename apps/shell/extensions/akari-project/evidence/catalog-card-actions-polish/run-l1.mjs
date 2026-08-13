import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , electronPath, appPath, workspacePath, profileRoot, evidenceDir] = process.argv;
const wrapperPath = fileURLToPath(new URL('./electron-wrapper', import.meta.url));
const configDir = path.join(profileRoot, 'config');
const localCatalog = path.join(profileRoot, 'local-catalog');

await mkdir(path.join(localCatalog, 'still', 'local-action-sample'), { recursive: true });
await mkdir(configDir, { recursive: true });
await writeFile(path.join(localCatalog, 'INDEX.md'), '# L1 local catalog\n');
await writeFile(path.join(localCatalog, 'still', 'local-action-sample', 'meta.json'), JSON.stringify({
  id: 'local-action-sample',
  category: 'still',
  title: 'アクション確認 ローカル素材',
  tags: ['l1'],
  remote: true,
  license: { spdx: 'CC0-1.0' },
  source: { url: 'https://example.com/local-action-sample' }
}, null, 2));
await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
  'akari.catalog.root': localCatalog
}, null, 2));

const server = http.createServer((request, response) => {
  if (request.url !== '/catalog.json') {
    response.writeHead(404).end();
    return;
  }
  const origin = `http://127.0.0.1:${server.address().port}`;
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({
    schema: 'akari-assets-catalog/v0',
    version: 'l1-card-actions',
    base: `${origin}/assets`,
    items: [
      {
        id: 'paid-card-2980',
        category: 'still',
        title: 'アクション確認 有料 2980',
        tags: ['l1', 'paid'],
        license: { spdx: 'CC-BY-4.0' },
        price: 2980,
        version: 1,
        files: []
      },
      {
        id: 'paid-card-12800',
        category: 'scene3d',
        title: 'アクション確認 有料 12800',
        tags: ['l1', 'paid'],
        license: { spdx: 'LicenseRef-AKARI-Commercial' },
        price: 12800,
        version: 1,
        files: []
      },
      {
        id: 'free-card',
        category: 'still',
        title: 'アクション確認 無料',
        tags: ['l1', 'free'],
        license: { spdx: 'CC0-1.0' },
        price: 0,
        version: 1,
        files: []
      }
    ]
  }));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const catalogUrl = `http://127.0.0.1:${server.address().port}/catalog.json`;
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
    AKARI_ASSETS_CATALOG: catalogUrl,
    AKARI_HOME: path.join(profileRoot, 'akari-home'),
    THEIA_CONFIG_DIR: configDir,
    AKARI_L1_EVIDENCE_DIR: path.resolve(evidenceDir)
  },
  stdio: 'inherit'
});

child.on('error', error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
child.on('exit', code => {
  server.close();
  process.exitCode = code ?? 1;
});
