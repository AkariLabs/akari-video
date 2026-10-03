// 1 文字の挿入・削除・置換・隣接する文字の入れ替えを 1 回の編集として数える。
// フラグとサブコマンドの候補判定に同じ距離を使う。
function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) rows[i][0] = i;
  for (let j = 0; j <= right.length; j++) rows[0][j] = j;
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

/** 第 1 引数の候補を返す。候補が無ければ null を返す。 */
export function suggestFirstArgument(firstArg, { flags, commands }) {
  if (!firstArg) return null;
  const argument = firstArg.trim();
  if (!argument) return null;
  if (flags.includes(argument) || commands.includes(argument)) {
    return argument === firstArg ? null : argument;
  }
  if (/\s/u.test(argument)) return null;

  if (argument.startsWith('-')) {
    // 短いフラグや区切り・標準入力を表す引数は候補を探さず、そのまま渡す。
    if (argument.length <= 2) return null;
    const near = flags
      .map(candidate => ({ candidate, distance: editDistance(argument, candidate) }))
      .filter(({ distance }) => distance === 1)
      .sort((a, b) => b.candidate.length - a.candidate.length || a.candidate.localeCompare(b.candidate));
    if (near.length) return near[0].candidate;
    return flags.filter(candidate => argument.startsWith(candidate))
      .sort((a, b) => b.length - a.length || a.localeCompare(b))[0] ?? null;
  }

  // 短いコマンドで距離 2 まで許すと、普通の 1 語も多数止まってしまう。
  // プロジェクト内から AI エージェントへ渡す短い依頼を保つため、
  // 4〜5 文字は距離 1、6 文字以上だけ距離 2 まで候補にする。
  const near = commands
    .filter(command => command.length >= 4)
    .map(candidate => ({ candidate, distance: editDistance(argument, candidate) }))
    .filter(({ candidate, distance }) => distance >= 1 && distance <= (candidate.length >= 6 ? 2 : 1))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  return near[0]?.candidate ?? null;
}
