import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// このファイルの場所（packages/akari-launcher/src/）から見て、モノレポの checkout
// なら 2 つ上がリポジトリルート。`skills/create-project/bin/create-project.mjs` と
// 同じ「スクリプト自身の位置からの相対解決」方式（cwd には依存しない — cwd は
// スキャフォールド先のプロジェクトルートであり、リポ checkout の位置とは無関係）。
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPO_ROOT_CANDIDATE = path.resolve(PACKAGE_ROOT, '..', '..');

const SKILLS_MARKER = path.join('skills', 'analyze-footage', 'SKILL.md');
const TEMPLATE_MARKER = path.join('templates', 'project-default', '.gitignore');
const SCHEMAS_MARKER = path.join('packages', 'schemas', 'analysis.schema.json');
const DOCTOR_SCRIPT_RELATIVE = path.join('skills', 'manage-connections', 'bin', 'doctor.mjs');

/**
 * このモノレポ checkout に同梱されているスキル正本・雛形・schemas を探す。
 * 見つからない場合（将来 npm 経由で単体配布された場合など）は該当フィールドが
 * null になり、呼び出し側はそれに応じて機能をスキップする。
 */
export function resolveRepoAssets(repoRoot = DEFAULT_REPO_ROOT_CANDIDATE) {
  const hasSkills = existsSync(path.join(repoRoot, SKILLS_MARKER));
  const hasTemplate = existsSync(path.join(repoRoot, TEMPLATE_MARKER));
  const hasSchemas = existsSync(path.join(repoRoot, SCHEMAS_MARKER));
  const doctorScript = path.join(repoRoot, DOCTOR_SCRIPT_RELATIVE);

  return {
    repoRoot,
    skillsSourceDir: hasSkills ? path.join(repoRoot, 'skills') : null,
    templateDir: hasTemplate ? path.join(repoRoot, 'templates', 'project-default') : null,
    schemasSourceDir: hasSchemas ? path.join(repoRoot, 'packages', 'schemas') : null,
    doctorScript: existsSync(doctorScript) ? doctorScript : null
  };
}
