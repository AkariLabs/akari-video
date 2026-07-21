import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * カレントプロジェクトが AKARI Video プロジェクトとしてセットアップ済みかを判定する。
 * `.akari/connections.json` の有無を「セットアップ済み」の判定基準にする
 * （`create-project` / `project-scaffold` が必ずこのファイルを雛形から生成するため）。
 */
export function detectProjectState(projectRoot) {
  const akariDir = path.join(projectRoot, '.akari');
  const connectionsPath = path.join(akariDir, 'connections.json');
  const intakePath = path.join(akariDir, 'intake.json');

  const scaffolded = existsSync(connectionsPath);
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
