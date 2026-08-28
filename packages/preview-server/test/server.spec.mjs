import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 3456;
const PROJECT = '/tmp/akari-preview-test';
const BASE = `http://localhost:${PORT}`;
let serverProc;

test.beforeAll(async () => {
  serverProc = spawn('node', [
    path.resolve('packages/preview-server/src/server.mjs'),
    PROJECT,
    '--port', String(PORT),
  ], { stdio: 'pipe', detached: false });

  // wait for server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout')), 8000);
    serverProc.stdout.on('data', (data) => {
      // 既定 host は 127.0.0.1（--host 指定時は任意）なので、起動行はポート番号で待つ
      if (data.toString().includes(`:${PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProc.stderr.on('data', (data) => {
      console.error('[server stderr]', data.toString());
    });
    serverProc.on('error', reject);
  });
});

test.afterAll(async () => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => serverProc.on('close', r)).catch(() => {});
  }
});

test.describe('Preview Server', () => {

  test('GET /api/timeline returns valid TimelineSpec', async ({ request }) => {
    const res = await request.get(`${BASE}/api/timeline`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body).toHaveProperty('fps', 30);
    expect(body).toHaveProperty('clips');
    expect(Array.isArray(body.clips)).toBeTruthy();
    expect(body.clips.length).toBe(2);

    const clip = body.clips[0];
    expect(clip).toHaveProperty('id');
    expect(clip).toHaveProperty('src');
    expect(clip).toHaveProperty('startFrame', 0);
    expect(clip).toHaveProperty('endFrame');
    expect(clip).toHaveProperty('sourceInUs');
    expect(clip).toHaveProperty('track');
  });

  test('GET /api/timeline has audio with narration', async ({ request }) => {
    const res = await request.get(`${BASE}/api/timeline`);
    const body = await res.json();

    expect(body.audio).toBeDefined();
    expect(body.audio.narration).toHaveLength(2);
    expect(body.audio.bgm).toEqual({ ducking: true });

    const n = body.audio.narration[0];
    expect(n.id).toBe('n-0001');
    expect(n.src).toContain('n-0001.mp3');
    expect(n.t).toBe(1);
  });

  test('GET /api/raw-edit.json returns raw edit.json', async ({ request }) => {
    const res = await request.get(`${BASE}/api/raw-edit.json`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.version).toBe(0);
    expect(body.source.path).toBe('source.mp4');
    expect(body.cuts).toHaveLength(2);
  });

  test('source media is served with accept-ranges', async ({ request }) => {
    const res = await request.get(`${BASE}/source.mp4`);
    expect(res.ok()).toBeTruthy();
    const headers = res.headers();
    expect(headers['accept-ranges']).toBe('bytes');
  });

  test('404 for missing file', async ({ request }) => {
    const res = await request.get(`${BASE}/nonexistent.txt`);
    expect(res.status()).toBe(404);
  });

  test('index.html loads with correct structure', async ({ page }) => {
    await page.goto(`${BASE}/?frameEngine=0`);
    await expect(page).toHaveTitle(/AKARI Video Preview/);
    await expect(page.locator('#preview-video')).toBeAttached();
    await expect(page.locator('#overlay-stage')).toBeAttached();
    await expect(page.locator('#play-toggle')).toBeVisible();
    await expect(page.locator('#seek')).toBeVisible();
    await expect(page.locator('#time-label')).toBeVisible();
  });

  test('transport controls have correct IDs', async ({ page }) => {
    await page.goto(`${BASE}/?frameEngine=0`);
    await expect(page.locator('#skip-back')).toBeAttached();
    await expect(page.locator('#frame-back')).toBeAttached();
    await expect(page.locator('#play-toggle')).toBeAttached();
    await expect(page.locator('#frame-forward')).toBeAttached();
    await expect(page.locator('#skip-forward')).toBeAttached();
    await expect(page.locator('#zoom-toggle')).toBeAttached();
    await expect(page.locator('#fullscreen-toggle')).toBeAttached();
  });

  test('WebSocket connects successfully', async ({ page }) => {
    await page.goto(`${BASE}/?frameEngine=0`);
    const connected = await page.evaluate(() => {
      return new Promise((resolve) => {
        const ws = new WebSocket(`ws://${location.host}`);
        ws.onopen = () => { ws.close(); resolve(true); };
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 3000);
      });
    });
    expect(connected).toBeTruthy();
  });
});
