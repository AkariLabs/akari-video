// チャット承認ブリッジの純粋ロジック。
// ネットワーク・ファイル I/O を持たないため、決定論のテストで挙動を固定できる。
// 契約: docs/contract-2026-08-12-chat-approval-v0.md

/**
 * 受け付ける callback_data の閉じた集合（契約 §2）。
 * ここに無い値は「解釈しようとせず捨てる」。自由文も同様に処理しない。
 */
export const ACTIONS = Object.freeze({
  COMMIT: "akari:commit",
  LATER: "akari:later",
});

const ALLOWED_ACTIONS = Object.freeze(new Set(Object.values(ACTIONS)));

export const TOKEN_ENV_KEY = "AKARI_TELEGRAM_BOT_TOKEN";
export const CHAT_ENV_KEY = "AKARI_TELEGRAM_CHAT_ID";

/**
 * credentials.env（KEY=VALUE 形式）から必要な値だけを取り出す。
 * 値そのものは戻り値以外のどこにも出さない（ログ・例外メッセージに載せない）。
 */
export function parseCredentials(text) {
  const values = new Map();

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    // 素朴なクォート外し（KEY="value" / KEY='value'）
    if (value.length >= 2) {
      const head = value[0];
      const tail = value[value.length - 1];
      if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) {
        value = value.slice(1, -1);
      }
    }

    if (value !== "") values.set(key, value);
  }

  return {
    token: values.get(TOKEN_ENV_KEY) ?? null,
    chatId: values.get(CHAT_ENV_KEY) ?? null,
  };
}

/**
 * トークンは Bot API の URL に含まれる。エラー本文をそのまま出すと漏れるため、
 * 外に出す文字列は必ずこれを通す（契約 §3-1）。
 */
export function redactToken(text, token) {
  const source = String(text ?? "");
  if (typeof token !== "string" || token.length < 8) return source;

  let output = source.split(token).join("[REDACTED]");

  // `bot<token>` の形（URL 経路）は token が別値でも念のため潰す
  output = output.replace(/bot\d{6,}:[A-Za-z0-9_-]{10,}/g, "bot[REDACTED]");
  return output;
}

function chatIdOf(update) {
  const fromCallback = update?.callback_query?.message?.chat?.id;
  if (fromCallback !== undefined && fromCallback !== null) return String(fromCallback);

  const fromMessage = update?.message?.chat?.id;
  if (fromMessage !== undefined && fromMessage !== null) return String(fromMessage);

  return null;
}

/**
 * getUpdates の結果から「実行してよい操作」だけを抜き出す。
 *
 * 破棄しても **offset は必ず前へ進める**。進めないと、第三者が bot に 1 通送っただけで
 * 同じ update が永久に再配信され、承認が二度と通らなくなる（可用性の穴）。
 *
 * @param {Array} updates getUpdates の result
 * @param {{ allowedChatId: string, seen?: Set<number> }} options
 */
export function selectActions(updates, { allowedChatId, seen } = {}) {
  const seenIds = seen instanceof Set ? seen : new Set();
  const actions = [];
  const rejected = [];
  let maxUpdateId = null;

  for (const update of Array.isArray(updates) ? updates : []) {
    const updateId = update?.update_id;
    if (!Number.isSafeInteger(updateId)) {
      rejected.push({ updateId: null, reason: "malformed-update-id" });
      continue;
    }

    if (maxUpdateId === null || updateId > maxUpdateId) maxUpdateId = updateId;

    if (seenIds.has(updateId)) {
      rejected.push({ updateId, reason: "duplicate" });
      continue;
    }

    const chatId = chatIdOf(update);
    if (chatId === null || String(allowedChatId ?? "") === "" || chatId !== String(allowedChatId)) {
      // 契約 §3-2: 登録済み chat ID 以外は無条件に破棄する
      rejected.push({ updateId, reason: "chat-not-allowed" });
      continue;
    }

    const callback = update.callback_query;
    if (callback === undefined || callback === null) {
      // 自由文メッセージなどは処理しない（契約 §2）
      rejected.push({ updateId, reason: "not-a-callback" });
      continue;
    }

    const data = callback.data;
    if (typeof data !== "string" || !ALLOWED_ACTIONS.has(data)) {
      rejected.push({ updateId, reason: "unknown-action" });
      continue;
    }

    actions.push({
      updateId,
      action: data,
      callbackQueryId: typeof callback.id === "string" ? callback.id : null,
      chatId,
    });
  }

  return {
    actions,
    rejected,
    nextOffset: maxUpdateId === null ? null : maxUpdateId + 1,
  };
}

/**
 * 承認メッセージに添えるインラインキーボード。
 * URL ボタンは tailnet 限定 URL を指すため Telegram 側からは到達できない（プレビューも出ない）。
 */
export function buildKeyboard(reportUrl) {
  const firstRow = [];
  if (typeof reportUrl === "string" && /^https?:\/\//.test(reportUrl)) {
    firstRow.push({ text: "レポートを開く", url: reportUrl });
  }

  return {
    inline_keyboard: [
      ...(firstRow.length > 0 ? [firstRow] : []),
      [
        { text: "おまかせで確定", callback_data: ACTIONS.COMMIT },
        { text: "あとで", callback_data: ACTIONS.LATER },
      ],
    ],
  };
}
