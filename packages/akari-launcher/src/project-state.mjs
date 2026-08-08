import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * カレントプロジェクトが AKARI Video プロジェクトとしてセットアップ済みかを判定する。
 * `.akari/connections.json` の有無を「セットアップ済み」の判定基準にする
 * （`create-project` / `project-scaffold` が必ずこのファイルを雛形から生成するため）。
 *
 * 例外: `.akari/root.json`（作業場マニフェスト）を持つディレクトリは作業場ルートであって
 * プロジェクトではない。作業場層 `.akari/connections.json`（`packages/creator-root` の
 * `createCreatorRoot()` が既定レジストリを書き出す）が存在しても、それはプロジェクトの
 * セットアップ済みマーカーとして扱わない（さもないと作業場ルート自体が既存プロジェクトと
 * 誤判定され、`(b) 作業場の中だがプロジェクトではない cwd` の新規プロジェクト作成分岐
 * [`first-run.mjs`] が壊れる）。
 */
export function detectProjectState(projectRoot) {
  const akariDir = path.join(projectRoot, '.akari');
  const connectionsPath = path.join(akariDir, 'connections.json');
  const intakePath = path.join(akariDir, 'intake.json');
  const rootManifestPath = path.join(akariDir, 'root.json');

  const isWorkspaceRoot = existsSync(rootManifestPath);
  const scaffolded = !isWorkspaceRoot && existsSync(connectionsPath);
  let intake = null;
  if (existsSync(intakePath)) {
    try {
      intake = JSON.parse(readFileSync(intakePath, 'utf8'));
    } catch {
      intake = null;
    }
  }

  return { projectRoot, scaffolded, intake, connectionsPath, intakePath };
}
