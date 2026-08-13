import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , electronPath, appPath, workspacePath, profileRoot, evidenceDir, scenario] = process.argv;
const scenarios = new Set(['revoked', 'no-credentials', 'network-error']);
if (!scenarios.has(scenario)) {
  throw new Error('scenario must be one of: revoked, no-credentials, network-error');
}
const wrapperPath = fileURLToPath(new URL('./electron-wrapper', import.meta.url));
const configDir = path.join(profileRoot, 'config');
const akariHome = path.join(profileRoot, 'akari-home');
const localCatalog = path.join(profileRoot, 'local-catalog');
const mockRequestLog = path.join(profileRoot, 'mock-entitlements-requests.jsonl');
const entitlementsResponse = scenario === 'revoked'
  ? { status: 401, body: { error: 'token_revoked' } }
  : { status: 500, body: { error: 'mock_network_error' } };

await mkdir(configDir, { recursive: true });
await mkdir(akariHome, { recursive: true });
await mkdir(localCatalog, { recursive: true });
await mkdir(evidenceDir, { recursive: true });
const scenarioScreenshots = {
  revoked: ['01-home-reconnect-required.png', '02-catalog-reconnect-guidance.png'],
  'no-credentials': ['03-no-credentials-home.png', '03-no-credentials-catalog.png'],
  'network-error': ['04-network-error-catalog.png']
};
await Promise.all([
  ...scenarioScreenshots[scenario],
  `run-log-${scenario}.json`,
  `server-log-${scenario}.json`
].map(name => rm(path.join(evidenceDir, name), { force: true })));
await rm(mockRequestLog, { force: true });
await writeFile(path.join(localCatalog, 'INDEX.md'), '# L1 local catalog\n');
await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
  'akari.catalog.root': localCatalog
}, null, 2));

let catalogRequests = 0;
let entitlementsRequests = 0;
const catalogDocument = origin => ({
  schema: 'akari-assets-catalog/v0',
  version: 'l1-entitlements-visibility',
  base: `${origin}/assets`,
  items: [
    {
      id: 'paid-revoked-sample',
      category: 'still',
      title: '接続失効確認 有料素材',
      tags: ['l1', 'paid'],
      license: { spdx: 'LicenseRef-AKARI-Commercial' },
      price: 2980,
      version: 1,
      files: []
    }
  ]
});
const server = http.createServer((request, response) => {
  if (request.url === '/catalog.json') {
    catalogRequests++;
    const origin = `http://127.0.0.1:${server.address().port}`;
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(catalogDocument(origin)));
    return;
  }
  if (request.url === '/api/store/v1/entitlements') {
    entitlementsRequests++;
    response.writeHead(entitlementsResponse.status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(entitlementsResponse.body));
    return;
  }
  response.writeHead(404).end();
});

let serverStarted = false;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  serverStarted = true;
} catch (error) {
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
  console.warn('[entitlements-visibility-l1] loopback listen unavailable; using fetch preload fallback');
}

const origin = serverStarted ? `http://127.0.0.1:${server.address().port}` : 'https://entitlements.invalid';
const catalogSource = serverStarted ? `${origin}/catalog.json` : path.join(profileRoot, 'catalog.json');
if (!serverStarted) {
  await writeFile(catalogSource, `${JSON.stringify(catalogDocument(origin), null, 2)}\n`);
}
const credentialsPath = path.join(akariHome, 'store-credentials.json');
if (scenario === 'no-credentials') {
  await rm(credentialsPath, { force: true });
} else {
  await writeFile(credentialsPath, `${JSON.stringify({
    url: `${origin}/api/store`,
    token: scenario === 'revoked' ? 'akst_l1_revoked' : 'akst_l1_network_error',
    email: `${scenario}@example.test`
  }, null, 2)}\n`);
}

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
    AKARI_ASSETS_CATALOG: catalogSource,
    AKARI_HOME: akariHome,
    THEIA_CONFIG_DIR: configDir,
    AKARI_L1_EVIDENCE_DIR: path.resolve(evidenceDir),
    AKARI_L1_ENTITLEMENTS_SCENARIO: scenario,
    AKARI_L1_ENTITLEMENTS_MOCK_MODE: serverStarted ? 'local-http' : 'fetch-preload',
    AKARI_L1_MOCK_REQUEST_LOG: mockRequestLog,
    NODE_OPTIONS: serverStarted
      ? process.env.NODE_OPTIONS
      : [process.env.NODE_OPTIONS, `--import=${fileURLToPath(new URL('./mock-entitlements-fetch.mjs', import.meta.url))}`]
          .filter(Boolean)
          .join(' ')
  },
  stdio: 'inherit'
});

child.on('error', error => {
  console.error(error);
  if (serverStarted) server.close();
  process.exitCode = 1;
});
child.on('exit', async code => {
  if (!serverStarted) {
    const lines = await readFile(mockRequestLog, 'utf8').catch(() => '');
    entitlementsRequests = lines.split('\n').filter(Boolean).length;
  }
  const requestExpectationMet = scenario === 'no-credentials'
    ? entitlementsRequests === 0
    : entitlementsRequests > 0;
  await writeFile(path.join(evidenceDir, `server-log-${scenario}.json`), `${JSON.stringify({
    scenario,
    catalogRequests,
    entitlementsRequests,
    transport: serverStarted ? 'local-http' : 'fetch-preload',
    entitlementsResponse,
    requestExpectationMet
  }, null, 2)}\n`);
  if (serverStarted) server.close();
  process.exitCode = code === 0 && requestExpectationMet ? 0 : 1;
});
