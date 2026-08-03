import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// このファイルの場所（packages/akari-launcher/src/）から見て、モノレポの checkout
// なら 2 つ上がリポジトリルート。`skills/create-project/bin/create-project.mjs` と
// 同じ「スクリプト自身の位置からの相対解決」方式（cwd には依存しない — cwd は
// スキャフォールド先のプロジェクトルートであり、リポ checkout の位置とは無関係）。
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPO_ROOT_CANDIDATE = path.resolve(PACKAGE_ROOT, '..', '..');

// npm 配布時は prepack（scripts/prepack.mjs）がモノレポ同梱物を同一レイアウトで
// vendor/ に焼き込む。checkout に見えない場合はこちらを「リポジトリルート」として使う。
const DEFAULT_VENDOR_ROOT = path.join(PACKAGE_ROOT, 'vendor');

const SKILLS_MARKER = path.join('skills', 'analyze-footage', 'SKILL.md');
// 雛形マーカーに .gitignore を使わない: npm は tarball 生成時に .gitignore という名前の
// ファイルを無条件に除外するため、vendor 同梱（npm 配布時）では存在し得ない。
// 雛形側の .gitignore 実体は project-scaffold の writeFallbackTemplate が補完する。
const TEMPLATE_MARKER = path.join('templates', 'project-default', 'CLAUDE.md');
const SCHEMAS_MARKER = path.join('packages', 'schemas', 'analysis.schema.json');
const DOCTOR_SCRIPT_RELATIVE = path.join('skills', 'manage-connections', 'bin', 'doctor.mjs');
const SCAFFOLD_MODULE_RELATIVE = path.join('packages', 'project-scaffold', 'src', 'index.mjs');
// 作業場（creator-root）モジュール。① Wave（packages/creator-root）の成果物で、本パッケージ
// からは読み取り専用（動的 import のみ）。scaffoldModulePath と同型の解決方式。
const CREATOR_ROOT_MODULE_RELATIVE = path.join('packages', 'creator-root', 'src', 'index.mjs');
// 公式音源ライブラリ（AKARI Sounds）の一括取得スクリプト。初回動線（sounds-setup.mjs）と
// `akari sounds` が子プロセスとして起動する。未同梱なら null（機能スキップ）。
const AUDIO_FETCH_SCRIPT_RELATIVE = path.join('packages', 'audio-library-setup', 'bin', 'fetch-akari-sounds.mjs');

/**
 * 指定ルート配下に同梱されているスキル正本・雛形・schemas・scaffold 実装・creator-root
 * 実装を探す。見つからないフィールドは null になり、呼び出し側はそれに応じて機能をスキップする。
 */
export function resolveRepoAssets(repoRoot = DEFAULT_REPO_ROOT_CANDIDATE) {
  const hasSkills = existsSync(path.join(repoRoot, SKILLS_MARKER));
  const hasTemplate = existsSync(path.join(repoRoot, TEMPLATE_MARKER));
  const hasSchemas = existsSync(path.join(repoRoot, SCHEMAS_MARKER));
  const doctorScript = path.join(repoRoot, DOCTOR_SCRIPT_RELATIVE);
  const scaffoldModulePath = path.join(repoRoot, SCAFFOLD_MODULE_RELATIVE);
  const creatorRootModulePath = path.join(repoRoot, CREATOR_ROOT_MODULE_RELATIVE);
  const audioFetchScriptPath = path.join(repoRoot, AUDIO_FETCH_SCRIPT_RELATIVE);

  return {
    repoRoot,
    skillsSourceDir: hasSkills ? path.join(repoRoot, 'skills') : null,
    templateDir: hasTemplate ? path.join(repoRoot, 'templates', 'project-default') : null,
    schemasSourceDir: hasSchemas ? path.join(repoRoot, 'packages', 'schemas') : null,
    doctorScript: existsSync(doctorScript) ? doctorScript : null,
    scaffoldModulePath: existsSync(scaffoldModulePath) ? scaffoldModulePath : null,
    creatorRootModulePath: existsSync(creatorRootModulePath) ? creatorRootModulePath : null,
    audioFetchScriptPath: existsSync(audioFetchScriptPath) ? audioFetchScriptPath : null
  };
}

/**
 * ランチャー実行時の同梱物解決: モノレポ checkout（開発時）→ vendor/（npm 配布時）の
 * 順で探し、最初に何かしら見つかったルートを採用する。テストからは candidateRoot /
 * vendorRoot を注入して両分岐を実ディレクトリ無しで検証できる。
 */
export function resolveLauncherAssets({
  candidateRoot = DEFAULT_REPO_ROOT_CANDIDATE,
  vendorRoot = DEFAULT_VENDOR_ROOT
} = {}) {
  const checkout = resolveRepoAssets(candidateRoot);
  const found = checkout.skillsSourceDir || checkout.templateDir || checkout.schemasSourceDir
    || checkout.doctorScript || checkout.scaffoldModulePath || checkout.creatorRootModulePath;
  return found ? checkout : resolveRepoAssets(vendorRoot);
}
