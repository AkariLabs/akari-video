// raw edit.json と Web UI の読み書き model を snake_case に統一する。
// 両方が残る汚染 cut では、UI で最後に明示された camelCase 側を優先する。
export function normalizeLegacyCutTransitions(edit) {
  if (!Array.isArray(edit?.cuts)) return edit;
  for (const cut of edit.cuts) {
    if (!cut || typeof cut !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(cut, 'transitionOut')) {
      console.warn('[preview] legacy transitionOut was absorbed into transition_out');
      cut.transition_out = cut.transitionOut;
      delete cut.transitionOut;
    }
    if (Object.prototype.hasOwnProperty.call(cut, 'transitionIn')) {
      console.warn('[preview] unsupported transitionIn was removed');
      delete cut.transitionIn;
    }
  }
  return edit;
}

export function editForPut(edit) {
  return normalizeLegacyCutTransitions(edit);
}
