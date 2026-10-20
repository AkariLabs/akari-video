import { EPSILON, addFinding } from "./shared.mjs";
import { collectFragmentCssNames } from "./fragment-css.mjs";

/**
 * フラグメント CSS の衝突を、同時に表示されうるクリップ（時間が重なる）の間だけで調べる。
 * 同一ファイルの再利用は衝突ではないので identity が同じ組は飛ばす。
 */
export function validateFragmentCssCollisions(usages, findings) {
  const candidates = usages.filter((usage) =>
    usage.start >= 0
    && Number.isFinite(usage.start)
    && Number.isFinite(usage.duration)
    && usage.duration > 0);
  const namesByIdentity = new Map();
  const reported = new Set();
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      const a = candidates[first];
      const b = candidates[second];
      if (a.identity === b.identity) continue;
      if (!clipsOverlap(a, b)) continue;
      const namesA = namesFor(a, namesByIdentity);
      const namesB = namesFor(b, namesByIdentity);
      const pairKey = [a.identity, b.identity].sort().join("\u0000");
      for (const name of sharedNames(namesA.classes, namesB.classes)) {
        const key = `${pairKey}\u0000class\u0000${name}`;
        if (reported.has(key)) continue;
        reported.add(key);
        addFinding(findings, {
          severity: "warning",
          check: "overlays.fragment-css-collision",
          message: `overlay:${a.clipId} (${a.label}) and overlay:${b.clipId} (${b.label}) both define class ".${name}" in <style>; prefix the class in one fragment (for example ".${prefixFor(a.clipId)}-${name}") so its rules cannot style the other clip`,
          path: b.label,
        });
      }
      for (const name of sharedNames(namesA.keyframes, namesB.keyframes)) {
        const key = `${pairKey}\u0000keyframes\u0000${name}`;
        if (reported.has(key)) continue;
        reported.add(key);
        addFinding(findings, {
          severity: "warning",
          check: "overlays.fragment-css-collision",
          message: `overlay:${a.clipId} (${a.label}) and overlay:${b.clipId} (${b.label}) both define @keyframes "${name}"; prefix the keyframes name in one fragment (for example "${prefixFor(a.clipId)}-${name}") in both the @keyframes rule and its animation references`,
          path: b.label,
        });
      }
    }
  }
}

function clipsOverlap(a, b) {
  return a.start < b.start + b.duration - EPSILON
    && b.start < a.start + a.duration - EPSILON;
}

function namesFor(usage, cache) {
  let names = cache.get(usage.identity);
  if (names === undefined) {
    names = collectFragmentCssNames(usage.html);
    cache.set(usage.identity, names);
  }
  return names;
}

function sharedNames(first, second) {
  return [...first].filter((name) => second.has(name)).sort();
}

function prefixFor(clipId) {
  const sanitized = String(clipId).replace(/[^_a-zA-Z0-9-]/gu, "-");
  if (sanitized === "") return "fragment";
  return /^[0-9-]/u.test(sanitized) ? `f${sanitized}` : sanitized;
}
