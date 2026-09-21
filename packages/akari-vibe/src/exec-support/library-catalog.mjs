const visualCategories = new Set(['overlay', 'still', 'scene3d']);

export function libraryFromCatalog(catalogJson) {
    let catalog;
    try {
        catalog = typeof catalogJson === 'string' ? JSON.parse(catalogJson) : catalogJson;
    } catch (error) {
        throw new TypeError(`Invalid library catalog JSON: ${error.message}`);
    }
    if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.items)) {
        throw new TypeError('Invalid library catalog: items must be an array');
    }

    const ids = new Set(), out = [];
    for (const [index, item] of catalog.items.entries()) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length === 0) {
            throw new TypeError(`Invalid library catalog: item ${index} is missing id`);
        }
        if (ids.has(item.id)) throw new Error(`Duplicate library catalog id: ${item.id}`);
        ids.add(item.id);
        if (!visualCategories.has(item.category)) continue;
        out.push({
            id:item.id,
            category:item.category,
            title:item.title,
            tags:Array.isArray(item.tags) ? [...item.tags] : item.tags,
            price:item.price,
            ...(Object.hasOwn(item, 'state') ? { state:item.state } : {}),
            directory:null,
        });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
