const DEFAULT_ASSET_MAP = Object.freeze({ smartphone: 'scene3d/smartphone-mockup', phonePro: 'scene3d/phone-pro-titanium', laptop: 'scene3d/laptop-slim-aluminum' });
const cm = values => values?.map(n => n * 100);
const mapped = (name, assetMap) => assetMap[name] ?? DEFAULT_ASSET_MAP[name];

export function importCanvas3d(json, { assetMap = {} } = {}) {
  if (json?.schema !== 'akari.canvas3d.v0') throw new TypeError('expected akari.canvas3d.v0');
  const warnings = [];
  const objects = [];
  for (const source of json.objects ?? []) {
    if (source.kind === 'camera') { warnings.push({ code: 'import.camera.omitted', path: source.id, message: 'camera object is represented by shot' }); continue; }
    const kind = source.kind === 'shape' && source.shape === 'person' ? 'human' : source.kind;
    const height = source.sizeM?.[1];
    if (height === undefined) warnings.push({ code: 'import.size.unknown', path: source.id, message: 'sizeM missing; ground requires review' });
    const at = cm([source.position?.[0] ?? 0, (source.position?.[1] ?? 0) - (height ?? 0) / 2, source.position?.[2] ?? 0]);
    const o = { id: source.id, kind, name: source.name ?? source.id, at, rot: source.rotationDeg ?? [0, 0, 0], hidden: source.visible === false };
    // sizeM is the measured world-space box, after the prototype's scale and rotation.
    // A height target retains that final extent without applying the scale a second time.
    if (kind === 'shape') o.scale = source.scale ?? [1, 1, 1];
    else if (height !== undefined) o.h = height * 100;
    if (kind === 'shape') { o.shape = source.shape; o.size = cm(source.sizeM ?? [1, 1, 1]).map((n, i) => n / (o.scale[i] || 1)); if (source.color) o.color = source.color; }
    if (kind === 'human') { o.pose = 'stand'; }
    if (kind === 'model') {
      const asset = mapped(source.model, assetMap);
      if (asset) o.asset = asset;
      else warnings.push({ code: 'import.model.unmapped', path: source.id, message: `unmapped model ${source.model}` });
      if (source.screenAssetId) {
        o.screen = { src: `assets/${source.screenAssetId}` };
        warnings.push({ code: 'import.media.relink', path: `${source.id}/screen`, message: 'screen asset id needs a project file path' });
      }
    }
    if (kind === 'image' || kind === 'video') {
      o.src = `assets/${source.fileName ?? source.assetId ?? source.id}`;
      warnings.push({ code: 'import.media.relink', path: source.id, message: 'media filename needs a project file path' });
      o.w = (source.sizeM?.[0] ?? 1) * 100;
      if (kind === 'video') o.time = source.time ?? 0;
    }
    objects.push(o);
  }
  const sw = json.world ?? {};
  const preset = sw.env === 'studio-gray' ? 'gray' : sw.env === 'black' ? 'black' : 'white';
  const world = { preset, bg: sw.background ?? '#ffffff', light: sw.light ?? 'soft', shadows: sw.shadows ?? true, rot: sw.envRotationDeg ?? 0, exposure: sw.envExposure ?? 1, show: sw.envBackground !== 'color', floor: sw.envGround === false ? 'plain' : 'world' };
  if (sw.envAssetId || sw.envFileName) world.hdri = sw.envAssetId ?? `assets/${sw.envFileName}`;
  else if (sw.env === 'room') world.hdri = 'scene3d/hdri-lebombo';
  else if (['outdoor', 'sunset'].includes(sw.env)) warnings.push({ code: 'import.env.unmapped', path: '/world/env', message: `no contracted asset id for ${sw.env}` });
  const shot = json.shot ?? {};
  const annotations = (json.annotations ?? []).map(a => {
    const out = { id: a.id, type: a.type };
    for (const key of ['name', 'color', 'text']) if (a[key] !== undefined) out[key] = a[key];
    if (a.frame) out.frame = structuredClone(a.frame);
    if (a.frame?.at) [out.x, out.y] = a.frame.at;
    else if (typeof a.x === 'number' && typeof a.y === 'number') [out.x, out.y] = [a.x, a.y];
    return out;
  });
  const doc = { schema: 'akari.frame-scene', version: 0, aspect: shot.frame ?? '16:9', world, objects, scenes: [{ id: 's1', note: json.page?.note ?? '', camera: { pos: cm(shot.position ?? [0, 1.4, 3]), look: cm(shot.lookAt ?? [0, 1, 0]), focal_mm: shot.focalLengthMm ?? 35, roll: shot.rollDeg ?? 0 }, annotations }] };
  return { doc, warnings };
}
