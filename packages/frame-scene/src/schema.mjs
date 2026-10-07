import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../schemas/frame-scene.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strict: false });
const check = ajv.compile(schema);
const JOINTS = new Set('hips spine chest neck head leftUpperArm leftLowerArm leftHand rightUpperArm rightLowerArm rightHand leftUpperLeg leftLowerLeg leftFoot rightUpperLeg rightLowerLeg rightFoot'.split(' '));
const known = {
  '': schema.properties, '/world': schema.$defs.world.properties,
  '/objects/*': schema.$defs.object.properties, '/scenes/*': schema.$defs.scene.properties,
  '/scenes/*/camera': schema.$defs.camera.properties, '/scenes/*/camera_to': schema.$defs.camera.properties,
  '/scenes/*/world': schema.$defs.world.properties,
  '/scenes/*/set/*': schema.$defs.setObject.properties,
  '/scenes/*/annotations/*': schema.$defs.annotation.properties,
  '/scenes/*/annotations/*/anchor': schema.$defs.annotation.properties.anchor.properties,
  '/objects/*/pose': schema.$defs.pose.oneOf[1].properties,
  '/scenes/*/set/*/pose': schema.$defs.pose.oneOf[1].properties,
  '/objects/*/pose/joints/*': { x: true, y: true, z: true },
  '/scenes/*/set/*/pose/joints/*': { x: true, y: true, z: true },
  '/objects/*/screen': schema.$defs.object.properties.screen.properties,
  '/scenes/*/set/*/screen': schema.$defs.object.properties.screen.properties
};
const ptr = (base, key) => `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
const issue = (code, path, message) => ({ code, path, message });

export function validateFrameScene(doc, { strict = false, fileBytes } = {}) {
  const errors = [], warnings = [];
  if (doc && typeof doc === 'object' && Number.isInteger(doc.version) && doc.version > 0) {
    return { ok: false, errors: [issue('unsupported_version', '/version', `version ${doc.version} is unsupported`)], warnings };
  }
  if ((fileBytes ?? Buffer.byteLength(JSON.stringify(doc) ?? '')) > 512 * 1024) warnings.push(issue('limit.file', '', 'file exceeds 512KB'));
  if (!check(doc)) for (const e of check.errors ?? []) {
    const path = e.keyword === 'required' ? ptr(e.instancePath, e.params.missingProperty) : e.instancePath;
    errors.push(issue(e.keyword === 'minItems' && e.instancePath === '/scenes' ? 'scene.empty' : `schema.${e.keyword.toLowerCase()}`, path, e.message ?? e.keyword));
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errors, warnings };
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const scenes = Array.isArray(doc.scenes) ? doc.scenes : [];
  if (objects.length > 200) warnings.push(issue('limit.objects', '/objects', 'objects exceeds 200'));
  if (scenes.length > 50) warnings.push(issue('limit.scenes', '/scenes', 'scenes exceeds 50'));
  const ids = new Set(), sceneIds = new Set();
  const ref = (value, path, code = 'object.reference.unresolved') => {
    if (typeof value === 'string' && !ids.has(value)) errors.push(issue(code, path, `unknown object ${value}`));
  };
  for (const [i, o] of objects.entries()) {
    if (!o || typeof o !== 'object') continue;
    const p = `/objects/${i}`;
    if (typeof o.id === 'string') {
      if (!/^[a-z0-9_-]+$/.test(o.id)) errors.push(issue('object.id.invalid', `${p}/id`, 'id must use [a-z0-9_-]'));
      if (ids.has(o.id)) errors.push(issue('object.id.duplicate', `${p}/id`, 'duplicate object id'));
      ids.add(o.id);
    }
  }
  function inspectObject(o, p) {
    if (!o || typeof o !== 'object') return;
    if (o.facing !== undefined && (o.ry !== undefined || o.rot !== undefined)) errors.push(issue('object.rotation.exclusive', p, 'facing and ry/rot are exclusive'));
    if (o.ry !== undefined && o.rot !== undefined) errors.push(issue('object.rotation.exclusive', p, 'ry and rot are exclusive'));
    if (o.h !== undefined && o.scale !== undefined) errors.push(issue('object.size.exclusive', p, 'h and scale are exclusive'));
    if (o.pose !== undefined && o.kind !== 'human') errors.push(issue('pose.kind.invalid', `${p}/pose`, 'pose requires human'));
    if (o.on !== undefined) ref(o.on, `${p}/on`, 'on.unresolved');
    if (typeof o.facing === 'string' && o.facing !== 'camera') ref(o.facing, `${p}/facing`, 'facing.unresolved');
    if (o.screen_of !== undefined) ref(o.screen_of, `${p}/screen_of`);
    const pose = o.pose;
    if (pose && typeof pose === 'object' && !Array.isArray(pose)) {
      for (const joint of Object.keys(pose.joints ?? {})) if (!JOINTS.has(joint)) warnings.push(issue('pose.joint.unknown', `${p}/pose/joints/${joint}`, `unknown joint ${joint}`));
      for (const key of ['look', 'point_at']) if (typeof pose[key] === 'string') ref(pose[key], `${p}/pose/${key}`, 'pose.target.unresolved');
    }
  }
  objects.forEach((o, i) => inspectObject(o, `/objects/${i}`));
  for (const [i, scene] of scenes.entries()) {
    if (!scene || typeof scene !== 'object') continue;
    const p = `/scenes/${i}`;
    if (typeof scene.id === 'string') {
      if (!/^[a-z0-9_-]+$/.test(scene.id)) errors.push(issue('scene.id.invalid', `${p}/id`, 'invalid scene id'));
      if (sceneIds.has(scene.id)) errors.push(issue('scene.id.duplicate', `${p}/id`, 'duplicate scene id'));
      sceneIds.add(scene.id);
    }
    for (const key of ['camera', 'camera_to']) if (typeof scene[key]?.look === 'string') ref(scene[key].look, `${p}/${key}/look`, 'camera.look.unresolved');
    for (const [id, delta] of Object.entries(scene.set ?? {})) {
      if (!ids.has(id)) warnings.push(issue('set.unresolved', ptr(`${p}/set`, id), `unknown object ${id}`));
      else inspectObject({ ...objects.find(o => o?.id === id), ...delta }, ptr(`${p}/set`, id));
    }
    const annotations = Array.isArray(scene.annotations) ? scene.annotations : [];
    if (annotations.length > 100) warnings.push(issue('limit.annotations', `${p}/annotations`, 'annotations exceeds 100'));
    annotations.forEach((a, j) => {
      if (a?.anchor?.object !== undefined) ref(a.anchor.object, `${p}/annotations/${j}/anchor/object`, 'anchor.unresolved');
      if (a?.frame) for (const [key, value] of Object.entries(a.frame)) {
        if (['at', 'from', 'to'].includes(key) && Array.isArray(value)) value.forEach((n, k) => { if (typeof n !== 'number' || n < 0 || n > 1) errors.push(issue('annotation.coordinate.invalid', `${p}/annotations/${j}/frame/${key}/${k}`, 'coordinate must be 0..1')); });
        if (key === 'points' && Array.isArray(value)) value.flat().forEach((n, k) => { if (typeof n !== 'number' || n < 0 || n > 1) errors.push(issue('annotation.coordinate.invalid', `${p}/annotations/${j}/frame/points/${k}`, 'coordinate must be 0..1')); });
      }
    });
  }
  const walk = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}/${i}`)); return; }
    const normalized = path.replace(/\/\d+(?=\/|$)/g, '/*').replace(/\/set\/[^/]+/, '/set/*').replace(/\/joints\/[^/]+/, '/joints/*');
    const props = normalized.includes('/annotations/*') && !normalized.endsWith('/anchor') ? undefined : known[normalized];
    if (props) for (const key of Object.keys(value)) if (!(key in props)) (strict ? errors : warnings).push(issue('key.unknown', ptr(path, key), `unknown key ${key}`));
    for (const [key, v] of Object.entries(value)) walk(v, ptr(path, key));
  };
  walk(doc);
  return { ok: errors.length === 0, errors, warnings };
}
