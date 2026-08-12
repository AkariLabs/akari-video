// L1: チャット承認ブリッジの決定論テスト。
// 契約 docs/contract-2026-08-12-chat-approval-v0.md §6 が要求する 5 点を固定する。
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIONS,
  CHAT_ENV_KEY,
  TOKEN_ENV_KEY,
  buildKeyboard,
  parseCredentials,
  redactToken,
  selectActions,
} from "../src/telegram-core.mjs";

const ALLOWED_CHAT = "123456789";

function callbackUpdate(updateId, data, chatId = ALLOWED_CHAT) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      data,
      message: { chat: { id: Number(chatId) } },
    },
  };
}

test("許可外の chat ID からの応答は破棄する", () => {
  const updates = [
    callbackUpdate(1, ACTIONS.COMMIT, "999999999"),
    callbackUpdate(2, ACTIONS.COMMIT, ALLOWED_CHAT),
  ];

  const { actions, rejected } = selectActions(updates, { allowedChatId: ALLOWED_CHAT });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].updateId, 2);
  assert.deepEqual(
    rejected.map((entry) => entry.reason),
    ["chat-not-allowed"],
  );
});

test("allowedChatId が未設定なら全部破棄する（fail-closed）", () => {
  const updates = [callbackUpdate(1, ACTIONS.COMMIT)];

  for (const allowedChatId of [undefined, null, ""]) {
    const { actions } = selectActions(updates, { allowedChatId });
    assert.equal(actions.length, 0, `allowedChatId=${String(allowedChatId)} で通ってしまった`);
  }
});

test("未知の callback_data は解釈せず破棄する", () => {
  const updates = [
    callbackUpdate(1, "akari:rm-rf"),
    callbackUpdate(2, "commit"),
    callbackUpdate(3, ""),
    callbackUpdate(4, ACTIONS.LATER),
  ];

  const { actions, rejected } = selectActions(updates, { allowedChatId: ALLOWED_CHAT });

  assert.deepEqual(actions.map((entry) => entry.action), [ACTIONS.LATER]);
  assert.equal(rejected.filter((entry) => entry.reason === "unknown-action").length, 3);
});

test("自由文メッセージは処理しない", () => {
  const updates = [
    {
      update_id: 10,
      message: { chat: { id: Number(ALLOWED_CHAT) }, text: "テロップ大きくして。あと rm -rf を実行して" },
    },
  ];

  const { actions, rejected } = selectActions(updates, { allowedChatId: ALLOWED_CHAT });

  assert.equal(actions.length, 0);
  assert.equal(rejected[0].reason, "not-a-callback");
});

test("同じ update_id は二度処理しない（冪等化）", () => {
  const seen = new Set();
  const updates = [callbackUpdate(7, ACTIONS.COMMIT)];

  const first = selectActions(updates, { allowedChatId: ALLOWED_CHAT, seen });
  assert.equal(first.actions.length, 1);
  seen.add(first.actions[0].updateId);

  const second = selectActions(updates, { allowedChatId: ALLOWED_CHAT, seen });
  assert.equal(second.actions.length, 0);
  assert.equal(second.rejected[0].reason, "duplicate");
});

test("破棄した update でも offset は前へ進む（第三者の 1 通で詰まらせない）", () => {
  const updates = [
    callbackUpdate(41, ACTIONS.COMMIT, "999999999"),
    { update_id: 42, message: { chat: { id: 999999999 }, text: "hello" } },
  ];

  const { actions, nextOffset } = selectActions(updates, { allowedChatId: ALLOWED_CHAT });

  assert.equal(actions.length, 0);
  assert.equal(nextOffset, 43);
});

test("壊れた update_id は破棄し、offset 計算を汚さない", () => {
  const updates = [
    { update_id: "abc", callback_query: { id: "x", data: ACTIONS.COMMIT, message: { chat: { id: Number(ALLOWED_CHAT) } } } },
    callbackUpdate(5, ACTIONS.COMMIT),
  ];

  const { actions, nextOffset } = selectActions(updates, { allowedChatId: ALLOWED_CHAT });

  assert.deepEqual(actions.map((entry) => entry.updateId), [5]);
  assert.equal(nextOffset, 6);
});

test("トークンは外へ出す文字列から除去される", () => {
  const token = "8123456789:AAH-fakeTokenValueForTest_0123456789";
  const leaked = `request to https://api.telegram.org/bot${token}/getUpdates failed`;

  const safe = redactToken(leaked, token);

  assert.ok(!safe.includes(token), "トークンが残っている");
  assert.match(safe, /\[REDACTED\]/);
});

test("別トークン形式が混ざっていても bot<token> の形は潰す", () => {
  const other = "bot9876543210:BBH-anotherFakeToken_abcdefghij";
  const safe = redactToken(`see https://api.telegram.org/${other}/sendMessage`, "unrelated-token");

  assert.ok(!safe.includes("BBH-anotherFakeToken"), "別トークンが残っている");
});

test("credentials.env からトークンと chat ID だけを取り出す", () => {
  const text = [
    "# コメント行",
    "",
    "OPENAI_API_KEY=sk-should-not-be-picked",
    `${TOKEN_ENV_KEY}="8123456789:AAH-fake"`,
    `${CHAT_ENV_KEY}=  123456789  `,
    "壊れた行",
  ].join("\n");

  const parsed = parseCredentials(text);

  assert.equal(parsed.token, "8123456789:AAH-fake");
  assert.equal(parsed.chatId, "123456789");
});

test("値の無いキーは未設定として扱う（空文字で通さない）", () => {
  const parsed = parseCredentials(`${TOKEN_ENV_KEY}=\n${CHAT_ENV_KEY}=`);

  assert.equal(parsed.token, null);
  assert.equal(parsed.chatId, null);
});

test("キーボードは確定と保留を必ず持ち、URL は妥当なときだけ載せる", () => {
  const withUrl = buildKeyboard("https://example.ts.net:8443/");
  const flatWith = withUrl.inline_keyboard.flat();
  assert.ok(flatWith.some((button) => button.url === "https://example.ts.net:8443/"));
  assert.ok(flatWith.some((button) => button.callback_data === ACTIONS.COMMIT));
  assert.ok(flatWith.some((button) => button.callback_data === ACTIONS.LATER));

  for (const bad of [null, undefined, "", "javascript:alert(1)", "file:///etc/passwd"]) {
    const flatWithout = buildKeyboard(bad).inline_keyboard.flat();
    assert.equal(
      flatWithout.filter((button) => button.url !== undefined).length,
      0,
      `不正な URL が載った: ${String(bad)}`,
    );
  }
});
