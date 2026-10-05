/** npm 依存ゼロの launcher 用 semver 比較。build metadata は順序に影響しない。 */
export function compareVersions(a, b) {
  const parse = value => {
    const match = typeof value === 'string' ? value.trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/) : null;
    if (!match) return null;
    const pre = match[4]?.split('.') ?? null;
    if (pre?.some(id => /^0\d+$/.test(id))) return null;
    return { core: match.slice(1, 4).map(Number), pre };
  };
  const left = parse(a), right = parse(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i]);
  if (!left.pre || !right.pre) return left.pre === right.pre ? 0 : left.pre ? -1 : 1;
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Math.sign(BigInt(x) > BigInt(y) ? 1 : -1);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(left.pre.length - right.pre.length);
}
