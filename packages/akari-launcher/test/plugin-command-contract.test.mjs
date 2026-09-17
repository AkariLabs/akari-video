import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const commandPath = resolve(import.meta.dirname, "../../../plugin/commands/akari.md");
const entrySkillPath = resolve(import.meta.dirname, "../../../skills/akari/SKILL.md");

test("/akari keeps canonical status routing and delegates CreatorRoot consent guidance to the entry skill", async () => {
  const command = await readFile(commandPath, "utf8");
  const entrySkill = await readFile(entrySkillPath, "utf8");
  assert.match(command, /session-start\.mjs" --status-json/u);
  assert.match(command, /状態の正本である/u);
  // `Bash(akari:*)` の全面許可は禁止 — `akari` は未知引数を claude へ丸ごと転送するため、
  // `akari -y` 一発で「acceptEdits の入れ子セッション起動」となり外側の確認ゲートを迂回できる。
  // 本文が使うサブコマンド（status / capability / init）だけを許可する。
  assert.doesNotMatch(command, /Bash\(akari:\*\)/u);
  assert.match(
    command,
    /allowed-tools:.*Bash\(akari status:\*\).*Bash\(akari capability:\*\).*Bash\(akari init:\*\).*Bash\(mkdir:\*\).*Write/u,
  );
  assert.match(command, /作業場（CreatorRoot）の検出・作成・案内/u);
  assert.match(
    command,
    /`project\.scaffolded: false`:[\s\S]*`akari` 入口スキルを案内する/u,
  );
  assert.match(command, /手順は `skills\/akari\/SKILL\.md` に委譲する/u);
  assert.match(command, /`\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/akari\/SKILL\.md` をパスで直接読み/u);
  assert.match(entrySkill, /新規作成を明示された場合/u);
  assert.match(entrySkill, /<AKARI_HOME>\/creator-root\.json/u);
  assert.match(entrySkill, /\.akari\/root\.json/u);
  assert.match(entrySkill, /creator-root\/v1/u);
  const consent = entrySkill.indexOf("利用者の同意なしに作成しない");
  const initialization = entrySkill.indexOf("`akari init`");
  assert.ok(consent >= 0 && initialization > consent, "consent must precede init/write guidance");
  assert.match(entrySkill, /既存ファイルを一切上書きしない/u);
  assert.match(entrySkill, /root\.json` は最後に書く/u);
});
