// Pure canonical implementation. interaction.js carries this marked body as a
// classic-script copy; selection-scope.test.mjs checks exact body equality.
// BEGIN selection-scope
function lineage(tree, id) {
  const nodes = new Map(tree.map(node => [node.id, node]));
  const result = [], visited = new Set();
  while (id != null && nodes.has(id) && !visited.has(id)) {
    visited.add(id);
    result.unshift(id);
    id = nodes.get(id).parentId;
  }
  return result;
}

function resolveScopedSelection(tree, scopeId, hitLeafId, { deep = false } = {}) {
  const path = lineage(tree, hitLeafId);
  if (!path.length) return { selectId: hitLeafId, scopeId };
  if (deep) return { selectId: hitLeafId, scopeId: path.at(-2) ?? null };
  // Keep the nearest enclosing scope that also contains this hit.
  const scopes = lineage(tree, scopeId);
  while (scopeId !== null && (!path.includes(scopeId) || scopeId === hitLeafId)) {
    scopes.pop();
    scopeId = scopes.at(-1) ?? null;
  }
  return { selectId: path[path.indexOf(scopeId) + 1], scopeId };
}

function enterScope(tree, selectedId, hitLeafId) {
  const node = tree.find(candidate => candidate.id === selectedId);
  if (!node || node.kind === "leaf") {
    return { selectId: selectedId, scopeId: node?.parentId ?? null };
  }
  const path = lineage(tree, hitLeafId);
  const selectId = path.includes(selectedId) && hitLeafId !== selectedId
    ? path[path.indexOf(selectedId) + 1]
    : tree.find(candidate => candidate.parentId === selectedId)?.id ?? null;
  return { selectId, scopeId: selectedId };
}

function exitScope(tree, selectedId, scopeId, floorScopeId = null) {
  if (scopeId === floorScopeId || scopeId === null) {
    return { selectId: null, scopeId: floorScopeId };
  }
  const path = lineage(tree, scopeId);
  if (floorScopeId !== null && !path.includes(floorScopeId)) {
    return { selectId: null, scopeId: floorScopeId };
  }
  return { selectId: scopeId, scopeId: path.at(-2) ?? floorScopeId };
}

function descendantLeafIds(tree, id) {
  return tree.filter(node => node.kind === "leaf" && lineage(tree, node.id).includes(id))
    .map(node => node.id);
}
function shouldHandleScopeEscape(selectedId, scopeId, floorScopeId) {
  return selectedId !== null || scopeId !== floorScopeId;
}

function lazyBagForScope(tree, scopeId) {
  const node = tree.find(candidate => candidate.id === scopeId);
  return node?.kind === "bag" && node.lazy === true ? node.id : null;
}

function nextCycleCandidate(candidates, currentId) {
  if (!candidates.length) return null;
  return candidates[(candidates.indexOf(currentId) + 1) % candidates.length];
}

// Toggle only immediate siblings in the current scope; preserve insertion order.
function toggleScopedSelection(tree, selectedIds, scopeId, next) {
  const sibling = id => tree.some(node => node.id === id && node.parentId === scopeId);
  const additive = next.scopeId === scopeId && sibling(next.selectId) && selectedIds.every(sibling);
  const ids = additive
    ? selectedIds.includes(next.selectId) ? selectedIds.filter(id => id !== next.selectId) : [...selectedIds, next.selectId]
    : next.selectId === null ? [] : [next.selectId];
  return { selectedIds: ids, selectId: ids.at(-1) ?? null, scopeId: next.scopeId };
}

// Client-space AABBs. Touching an edge counts as a hit.
function marqueeHits(candidates, rect) {
  if (!rect) return [];
  return candidates.filter(({ bounds }) => bounds
    && bounds.left <= rect.right && bounds.right >= rect.left
    && bounds.top <= rect.bottom && bounds.bottom >= rect.top).map(({ id }) => id);
}

// END selection-scope
export { toggleScopedSelection, marqueeHits, nextCycleCandidate, resolveScopedSelection, enterScope, exitScope, lineage, descendantLeafIds, shouldHandleScopeEscape, lazyBagForScope, selectionAncestorIds, worldDelta, applyWorldDelta };

// World-space similarity transform. Coordinates are relative to the stage centre.
// BEGIN world-delta
function worldDelta(oldPose, newPose) {
  const scale = (newPose.scale ?? 1) / (oldPose.scale ?? 1);
  const rotate = (newPose.rotate ?? 0) - (oldPose.rotate ?? 0);
  const radians = rotate * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const oldX = oldPose.x ?? 0, oldY = oldPose.y ?? 0;
  return { scale, rotate,
    x: (newPose.x ?? 0) - scale * (cosine * oldX - sine * oldY),
    y: (newPose.y ?? 0) - scale * (sine * oldX + cosine * oldY) };
}

function applyWorldDelta(delta, childWorld) {
  const radians = delta.rotate * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const x = childWorld.x ?? 0, y = childWorld.y ?? 0;
  return { ...childWorld,
    x: delta.x + delta.scale * (cosine * x - sine * y),
    y: delta.y + delta.scale * (sine * x + cosine * y),
    scale: (childWorld.scale ?? 1) * delta.scale,
    ...(childWorld.scaleX === undefined ? {} : { scaleX: childWorld.scaleX * delta.scale }),
    ...(childWorld.scaleY === undefined ? {} : { scaleY: childWorld.scaleY * delta.scale }),
    rotate: (childWorld.rotate ?? 0) + delta.rotate };
}
// END world-delta

// Pure counterpart of the widget helper; a source equality test keeps the copy
// in sync without importing the Electron widget into Node.
function selectionAncestorIds(rows, id) {
    const nodes = new Map(rows.map(row => [row.id, row]));
    const ancestors = [];
    const visited = new Set([id]);
    let parentId = nodes.get(id)?.parentId;
    while (parentId && nodes.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        ancestors.unshift(parentId);
        parentId = nodes.get(parentId)?.parentId;
    }
    return ancestors;
}
