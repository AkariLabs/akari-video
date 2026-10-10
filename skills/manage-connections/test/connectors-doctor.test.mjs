import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConnectorSummary } from '../bin/doctor.mjs';

test('doctor reads app connector settings and prints no credential value', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-doctor-'));
  try {
    const home = path.join(root, 'home');
    const akariHome = path.join(home, '.akari');
    const project = path.join(root, 'project');
    const temporary = path.join(root, 'tmp');
    fs.mkdirSync(akariHome, { recursive: true });
    fs.mkdirSync(project);
    fs.mkdirSync(temporary);
    const marker = 'fake-connect-doctor-secret';
    fs.writeFileSync(path.join(akariHome, 'connectors.json'), JSON.stringify({
      version: 1, enabled: { fal: false, runway: true }, generationOrder: ['runway', 'fal'],
      fallbackOnFailure: false, ignoredCredential: marker
    }));
    const env = { ...process.env, HOME: home, AKARI_HOME: akariHome,
      AKARI_CREDENTIALS_FILE: path.join(akariHome, 'credentials.env'), TMPDIR: temporary, TMP: temporary, TEMP: temporary };
    const summary = readConnectorSummary(env, home);
    assert.equal(summary.enabled.fal, false);
    assert.deepEqual(summary.generationOrder.slice(0, 2), ['runway', 'fal']);
    assert.equal(summary.fallbackOnFailure, false);
    assert.equal(JSON.stringify(summary).includes(marker), false);
    const connectionsPath = path.join(project, '.akari', 'connections.json');
    fs.mkdirSync(path.dirname(connectionsPath));
    fs.writeFileSync(connectionsPath, JSON.stringify({ providers: [], policy: { currency: 'JPY', monthly_budget: null, approval_threshold: null } }));
    const script = fileURLToPath(new URL('../bin/doctor.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [script, connectionsPath], { env, cwd: project, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /つなぐ（connectors.json）/);
    assert.match(child.stdout, /runway → fal/);
    assert.match(child.stdout, /akari connect list --json/);
    const report = fs.readFileSync(path.join(project, '.akari', 'reports', 'connections-report.html'), 'utf8');
    assert.match(report, /つなぐ（connectors.json）/);
    assert.equal(child.stdout.includes(marker), false);
    assert.equal(report.includes(marker), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
