import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function loadPuppeteer() {
  const roots = [resolve(HERE, "../../render-cut")];
  const gitFile = resolve(HERE, "../../../.git");
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitDir = readFileSync(gitFile, "utf8").trim().replace(/^gitdir:\s*/, "");
    const marker = `${join(".git", "worktrees")}/`;
    const markerIndex = gitDir.indexOf(marker);
    if (markerIndex >= 0) roots.push(join(gitDir.slice(0, markerIndex), "packages/render-cut"));
  }
  for (const root of roots) {
    try {
      return createRequire(`${root}/`)("puppeteer-core");
    } catch {
      // 依存の無い worktree では git common dir からメイン checkout を試す。
    }
  }
  throw new Error("puppeteer-core を解決できません");
}

function findChrome() {
  const cacheRoot = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  const cached = [];
  if (existsSync(cacheRoot)) {
    const directories = (path) => readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const build of directories(cacheRoot).sort().reverse()) {
      for (const platform of directories(join(cacheRoot, build))) {
        cached.push(join(cacheRoot, build, platform, "chrome-headless-shell"));
      }
    }
  }
  const candidates = [
    process.env.CHROME_PATH,
    ...cached,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}


export async function launchBrowser() {
  // 既定は従来どおり単一プロセス（CI 等）。実ブラウザ計測時だけ明示的に解除する。
  const multiProcess = process.env.AKARI_TEST_BROWSER_MULTI_PROCESS === '1';
  const args = ['--disable-gpu','--use-angle=swiftshader','--allow-file-access-from-files'];
  if (!multiProcess) args.unshift('--single-process','--no-zygote');
  return loadPuppeteer().launch({executablePath:findChrome(), headless:"shell", pipe:true, args});
}
