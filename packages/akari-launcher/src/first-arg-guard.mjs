const topLevelFlags = ['--help', '-h', '--version', '-v'];

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
export function suggestFirstArgument(firstArg, knownCommands) {
  if (!firstArg || topLevelFlags.includes(firstArg) || knownCommands.includes(firstArg)) return null;

  if (firstArg.startsWith('-')) {
    // -p などの短いフラグに加え、- は標準入力、-- は引数の区切りに使われる。
    // 長さ 2 文字以下は -h / -v に近くても候補を探さず、そのまま渡す。
    if (firstArg.length <= 2) return null;
    const near = topLevelFlags
      .map(candidate => ({ candidate, distance: editDistance(firstArg, candidate) }))
      .filter(({ distance }) => distance === 1)
      .sort((a, b) => b.candidate.length - a.candidate.length);
    if (near.length) return near[0].candidate;
    return topLevelFlags.find(candidate => firstArg.startsWith(candidate)) ?? null;
  }

  if (/\s/u.test(firstArg)) return null;
  const near = knownCommands
    .filter(command => command.length >= 4)
    .map(candidate => ({ candidate, distance: editDistance(firstArg, candidate) }))
    .filter(({ distance }) => distance >= 1 && distance <= 2)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  return near[0]?.candidate ?? null;
}
