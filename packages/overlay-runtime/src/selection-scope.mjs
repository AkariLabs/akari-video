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

// END selection-scope
export { nextCycleCandidate, resolveScopedSelection, enterScope, exitScope, lineage, descendantLeafIds, shouldHandleScopeEscape, lazyBagForScope, selectionAncestorIds };

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
