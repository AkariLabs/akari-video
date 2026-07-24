// edit.json の実データから、省略された timeline.tracks[] の下→上の既定順を返す。
// id は出力順に t1, t2, ... と採番するため、同一入力から常に同じ値を導出する。
export function deriveTracks(edit) {
  const derived = [];
  const append = (kind, ref) => {
    derived.push({
      id: `t${derived.length + 1}`,
      kind,
      ...(ref === undefined ? {} : { ref }),
    });
  };

  for (const kind of ["cuts", "layers", "overlays"]) {
    for (const track of collectTrackNumbers(edit?.[kind])) append(kind, track);
  }
  if (Array.isArray(edit?.captions) && edit.captions.length > 0) {
    append("captions");
  }
  if (Array.isArray(edit?.audio?.sfx) && edit.audio.sfx.length > 0) {
    append("audio", 0);
  }

  return derived;
}

function collectTrackNumbers(items) {
  if (!Array.isArray(items)) return [];
  const tracks = new Set();
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (!Object.hasOwn(item, "track")) {
      tracks.add(0);
    } else if (Number.isInteger(item.track) && item.track >= 0) {
      tracks.add(item.track);
    }
  }
  return [...tracks].sort((left, right) => left - right);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
