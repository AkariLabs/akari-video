import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const commandPath = resolve(import.meta.dirname, "../../../plugin/commands/akari.md");

test("/akari keeps canonical status routing and restores CreatorRoot consent guidance", async () => {
  const command = await readFile(commandPath, "utf8");
  assert.match(command, /session-start\.mjs" --status-json/u);
  assert.match(command, /工程判定の正本/u);
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
    /「新しいプロジェクトを作りたい」「作業場を作って」と明示されたとき、\*\*または\*\*[\s\S]*`project\.scaffolded: false`/u,
  );
  assert.match(command, /明示要求は現在のフォルダーが既存プロジェクトでも/u);
  assert.match(command, /<AKARI_HOME>\/creator-root\.json/u);
  assert.match(command, /\.akari\/root\.json/u);
  assert.match(command, /creator-root\/v1/u);
  const consent = command.indexOf("利用者の同意なしに作成しない");
  const initialization = command.indexOf("`akari init`");
  assert.ok(consent >= 0 && initialization > consent, "consent must precede init/write guidance");
  assert.match(command, /既存ファイルを一切上書きしない/u);
  assert.match(command, /root\.json` は最後に書く/u);
});
