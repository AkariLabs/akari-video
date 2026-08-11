// O1 — akari.sh / templates/project-default/akari.sh の行き止まり撤去を検証する。
//
// 実ネットワーク・実 ~/.akari には一切触れない: HOME を一時ディレクトリへ隔離し、
// インストーラは AKARI_SELF_HEAL_INSTALLER フック経由でモック（ローカルのシェル
// スニペット）に差し替える。対話 Y/n の分岐は `read -rp ... </dev/tty` が制御端末を
// 直接読むため、stdin パイプでは再現できない。scripts/test/support/pty-run.py で
// 疑似端末 (pty) を割り当てて決定論的に検証する。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, '..', '..');
const rootAkariSh = join(repoRoot, 'akari.sh');
const templateAkariSh = join(repoRoot, 'templates', 'project-default', 'akari.sh');
const ptyRunner = join(testDir, 'support', 'pty-run.py');

const FORBIDDEN_WORDS = ['Node', 'monorepo', 'PATH'];

function assertNoJargon(text) {
  for (const word of FORBIDDEN_WORDS) {
    assert.ok(!text.includes(word), `出力に専門語 "${word}" が含まれてはいけない:\n${text}`);
  }
}

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-self-heal-test-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// 一時 HOME 配下に、既にセットアップ済みの `~/.akari/app` を模したダミー本体を置く。
// akari.mjs は本物を起動する代わりに、渡された引数を marker ファイルへ書くだけ。
async function createDummyApp(installDir, markerPath) {
  const binDir = join(installDir, 'packages', 'akari-launcher', 'bin');
  await mkdir(binDir, { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    join(binDir, 'akari.mjs'),
    [
      "import { writeFileSync } from 'node:fs';",
      `const marker = ${JSON.stringify(markerPath)};`,
      'writeFileSync(marker, JSON.stringify({ args: process.argv.slice(2) }));'
    ].join('\n'),
    'utf8'
  );
}

// テスト対象の akari.sh を「プロジェクトフォルダ単体」を模した隔離ディレクトリへ
// コピーする。上方探索でリポ本体（本物の packages/akari-launcher）を拾ってしまわない
// よう、コピー先はリポ外の一時ディレクトリでなければならない。
async function setupProjectCopy(scratchRoot, sourcePath) {
  const projectDir = join(scratchRoot, 'project');
  await mkdir(projectDir, { recursive: true });
  const dest = join(projectDir, 'akari.sh');
  await copyFile(sourcePath, dest);
  await chmod(dest, 0o755);
  return dest;
}

function runNonInteractive(scriptPath, { env }) {
  // detached: true で新セッションへ切り離す（setsid 相当）。呼び出し元がどんな
  // 端末で実行されていても、子プロセスは常に制御端末を持たない = 非対話になる。
  return spawnSync('bash', [scriptPath], {
    env,
    encoding: 'utf8',
    timeout: 20_000,
    detached: true
  });
}

function runInteractive(scriptPath, { env, input }) {
  const result = spawnSync('python3', [ptyRunner, input, '--', 'bash', scriptPath], {
    env,
    encoding: 'utf8',
    timeout: 45_000
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error };
}

test('L0: bash -n akari.sh — 構文チェック green', () => {
  const result = spawnSync('bash', ['-n', rootAkariSh], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('L0: bash -n templates/project-default/akari.sh — 構文チェック green', () => {
  const result = spawnSync('bash', ['-n', templateAkariSh], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('同期テスト: ルートと雛形の akari.sh が同一内容', async () => {
  const [rootContent, templateContent] = await Promise.all([
    readFile(rootAkariSh, 'utf8'),
    readFile(templateAkariSh, 'utf8')
  ]);
  assert.equal(templateContent, rootContent);
});

test('app 有り環境: ~/.akari/app フォールバックで見つけて exec する（プロジェクトフォルダ単体）', async () => {
  await withScratchRoot(async (scratchRoot) => {
    const home = join(scratchRoot, 'home');
    await mkdir(home, { recursive: true });
    const installDir = join(home, '.akari', 'app');
    const marker = join(scratchRoot, 'launched.json');
    await createDummyApp(installDir, marker);

    const scriptPath = await setupProjectCopy(scratchRoot, templateAkariSh);

    const result = spawnSync('bash', [scriptPath], {
      env: { PATH: process.env.PATH, HOME: home },
      encoding: 'utf8',
      timeout: 20_000
    });

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const launched = JSON.parse(await readFile(marker, 'utf8'));
    assert.deepEqual(launched.args, []);
    assertNoJargon(result.stdout + result.stderr);
  });
});

test('app 無し + 非対話（tty 無し）: プロンプトを出さず案内 1 行 + exit 1', async () => {
  await withScratchRoot(async (scratchRoot) => {
    const home = join(scratchRoot, 'home');
    await mkdir(home, { recursive: true });
    const scriptPath = await setupProjectCopy(scratchRoot, templateAkariSh);

    const result = runNonInteractive(scriptPath, {
      env: { PATH: process.env.PATH, HOME: home }
    });

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes('いまセットアップしますか'),
      '非対話では同意プロンプト自体が出てはいけない'
    );
    assert.ok(combined.includes('install.sh'), '案内 1 行にインストールコマンドが含まれること');
    assertNoJargon(combined);
  });
});

test('app 無し + 対話 n: 案内 1 行 + exit 1（インストーラは呼ばれない）', async () => {
  await withScratchRoot(async (scratchRoot) => {
    const home = join(scratchRoot, 'home');
    await mkdir(home, { recursive: true });
    const scriptPath = await setupProjectCopy(scratchRoot, templateAkariSh);
    const installerMarker = join(scratchRoot, 'installer-ran.marker');

    const result = runInteractive(scriptPath, {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        AKARI_SELF_HEAL_INSTALLER: `: > ${JSON.stringify(installerMarker)}`
      },
      input: 'n\n'
    });

    assert.equal(result.status, 1, `stdout+stderr:\n${result.stdout}`);
    assert.ok(result.stdout.includes('いまセットアップしますか'), '対話時は同意プロンプトが出ること');
    assert.ok(result.stdout.includes('install.sh'), '案内 1 行にインストールコマンドが含まれること');
    assert.ok(!existsSync(installerMarker), 'n と答えたらインストーラは呼ばれない');
    assertNoJargon(result.stdout);
  });
});

test('app 無し + 対話 Y: インストーラ（モック）が呼ばれ、成功後に re-exec される', async () => {
  await withScratchRoot(async (scratchRoot) => {
    const home = join(scratchRoot, 'home');
    await mkdir(home, { recursive: true });
    const scriptPath = await setupProjectCopy(scratchRoot, templateAkariSh);
    const installerMarker = join(scratchRoot, 'installer-ran.marker');
    const launchMarker = join(scratchRoot, 'launched.json');

    // モックインストーラ: 実ネットワークに触れず、$HOME/.akari/app にダミー本体を
    // 作るだけ（install.sh の「Node 込み全部やる」を模す）。
    const mockInstaller = [
      'set -euo pipefail',
      `: > ${JSON.stringify(installerMarker)}`,
      'mkdir -p "$HOME/.akari/app/packages/akari-launcher/bin"',
      `cat > "$HOME/.akari/app/packages/akari-launcher/bin/akari.mjs" <<'JSEOF'`,
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(launchMarker)}, JSON.stringify({ args: process.argv.slice(2), healed: true }));`,
      'JSEOF'
    ].join('\n');

    const result = runInteractive(scriptPath, {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        AKARI_SELF_HEAL_INSTALLER: mockInstaller
      },
      input: 'Y\n'
    });

    assert.equal(result.status, 0, `stdout+stderr:\n${result.stdout}`);
    assert.ok(existsSync(installerMarker), 'Y と答えたらインストーラ（モック）が呼ばれること');
    const launched = JSON.parse(await readFile(launchMarker, 'utf8'));
    assert.equal(launched.healed, true, '成功後に元のコマンドが re-exec で続行されること');
    assertNoJargon(result.stdout);
  });
});

test('app 無し + 対話（既定 Y、空 Enter）: インストーラが呼ばれ、成功後に re-exec される', async () => {
  await withScratchRoot(async (scratchRoot) => {
    const home = join(scratchRoot, 'home');
    await mkdir(home, { recursive: true });
    const scriptPath = await setupProjectCopy(scratchRoot, templateAkariSh);
    const installerMarker = join(scratchRoot, 'installer-ran.marker');
    const launchMarker = join(scratchRoot, 'launched.json');

    const mockInstaller = [
      'set -euo pipefail',
      `: > ${JSON.stringify(installerMarker)}`,
      'mkdir -p "$HOME/.akari/app/packages/akari-launcher/bin"',
      `cat > "$HOME/.akari/app/packages/akari-launcher/bin/akari.mjs" <<'JSEOF'`,
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(launchMarker)}, JSON.stringify({ args: process.argv.slice(2), healed: true }));`,
      'JSEOF'
    ].join('\n');

    const result = runInteractive(scriptPath, {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        AKARI_SELF_HEAL_INSTALLER: mockInstaller
      },
      input: '\n' // 既定値 = Y
    });

    assert.equal(result.status, 0, `stdout+stderr:\n${result.stdout}`);
    assert.ok(existsSync(installerMarker));
    const launched = JSON.parse(await readFile(launchMarker, 'utf8'));
    assert.equal(launched.healed, true);
  });
});
