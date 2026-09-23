/**
 * L1（ラッパー実走用）。必ず一時 HOME / AKARI_HOME / AKARI_CREATOR_ROOT /
 * THEIA_CONFIG_DIR / user-data-dir で Electron を起動し、実機の置き場は読まない。
 * cwd は apps/shell に固定する（開発配置の素材 resolver を見つけるため）。
 * task.md の受け入れ条件と観測点:
 * 1. まっさら: 道具 → 作業場 → 素材の DOM、説明文、実際の <作業場>/library を確認。
 *    「Finder で開く」はボタンと実在する対象フォルダを確認し、OS 側の表示を目視する。
 * 2. 従来素材あり: AKARI_HOME/assets に fixture を置き、件数・容量の文面と
 *    次へ後の library-location.json / 移動先ファイルを確認する。
 * 3. OneDrive: 作業場を OneDrive 配下に置き、pending の 3 択を確認。
 *    「今は移さない」では旧側が残り、別の場所では設定ファイルの root を確認する。
 * 4. 手持ちフォルダ: ボタンから OS フォルダ選択を経て取り込みシートが開くのを確認。
 * 5. 設定済み: marker / 作業場ポインタのある fixture では自動表示が無いことを確認。
 * 6. 後から変更: 設定・＋メニューの入口、移動後のライブラリ表示と参照プロジェクトの
 *    再表示・書き出しを隔離 fixture で確認する。
 * 7. 使用量: Lab / 素材サイト / 自分の 3 種を置き、設定の内訳と片づけ確認の
 *    一覧・合計を確認。ゴミ箱実行後は Lab だけ消え、他 2 種が残ることを確認する。
 * このスクリプトが自動で操作するのは 1 のステップ遷移と戻る・スキップ。
 * OS ダイアログ・Finder・書き出しを含む 2〜7 はラッパーの実機操作で観測する。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const require = createRequire(join(repo, 'package.json'));
const { chromium } = require('playwright-core');
const evidence = dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'akari-library-step-l1-'));
const home = join(scratch, 'home');
const creator = join(home, 'Akari');
const akariHome = join(scratch, 'akari-home');
const profile = join(scratch, 'profile');
const config = join(scratch, 'config');
for (const directory of [home, akariHome, profile, config]) await mkdir(directory, { recursive: true });
await writeFile(join(scratch, 'credentials.env'), '');
const port = 9473;
const env = { ...process.env, HOME: home, AKARI_HOME: akariHome, AKARI_CREATOR_ROOT: creator,
    THEIA_CONFIG_DIR: config,
    AKARI_CREDENTIALS_FILE: join(scratch, 'credentials.env') };
delete env.AKARI_LIBRARY_ROOT; // 置き場変更・同期判定を実際に検証し、親プロセスの設定を継承しない。
const child = spawn(join(repo, 'apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    [join(repo, 'apps/shell'), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: join(repo, 'apps/shell'), env, stdio: ['ignore', 'pipe', 'pipe'] });
const logs = [];
child.stdout.on('data', part => logs.push(String(part)));
child.stderr.on('data', part => logs.push(String(part)));
const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
let browser;
try {
    for (let attempt = 0; attempt < 90; attempt++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* booting */ }
        await sleep(1000);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    let page;
    for (let attempt = 0; attempt < 90; attempt++) {
        page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('index.html'));
        if (page) break;
        await sleep(1000);
    }
    if (!page) throw new Error(`画面を開けませんでした: ${logs.join('').slice(-2000)}`);
    await page.waitForSelector('[data-akari-first-run-step="tools"]', { timeout: 90000 });
    await page.click('[data-akari-setup-next-workspace]');
    await page.waitForSelector('[data-akari-first-run-step="workspace"]');
    await page.click('[data-akari-setup-create-workspace]');
    await page.waitForSelector('[data-akari-first-run-step="library"]', { timeout: 30000 });
    const content = await page.locator('[data-akari-setup-library]').innerText();
    if (!content.includes('素材はここに入ります') || !content.includes(creator)
        || !content.includes('手持ちの素材フォルダがあれば入れる')) {
        throw new Error(`素材ステップの内容が足りません: ${content}`);
    }
    await page.screenshot({ path: join(evidence, 'library-step.png') });
    await page.getByRole('button', { name: '戻る' }).click();
    await page.waitForSelector('[data-akari-first-run-step="workspace"]');
    await page.click('[data-akari-setup-create-workspace]');
    await page.waitForSelector('[data-akari-first-run-step="library"]');
    await page.getByRole('button', { name: '今はスキップ' }).click();
    await page.waitForSelector('[data-akari-first-run-step="connection"]');
    await page.getByRole('button', { name: '戻る' }).click();
    await page.waitForSelector('[data-akari-first-run-step="library"]');
    console.log(JSON.stringify({ result: 'PASS', path: creator, checks: ['step order', 'copy', 'back', 'skip', 'return'], screenshot: join(evidence, 'library-step.png') }));
} finally {
    await browser?.close().catch(() => undefined);
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* exited */ }
    await sleep(1500);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* exited */ }
    await rm(scratch, { recursive: true, force: true });
}
