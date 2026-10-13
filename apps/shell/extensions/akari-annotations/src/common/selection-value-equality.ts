export function sameSelectionValue(left: unknown, right: unknown, depth = 0): boolean {
    if (Object.is(left, right)) return true;
    if (depth >= 32 || left === null || right === null
        || typeof left !== 'object' || typeof right !== 'object') return false;
    const same = (a: unknown, b: unknown): boolean => sameSelectionValue(a, b, depth + 1);
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((value, index) => same(value, right[index]));
    }
    if (left instanceof Map || right instanceof Map) {
        if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
        const remaining = [...right.entries()];
        for (const [key, value] of left) {
            const match = remaining.findIndex(([otherKey, otherValue]) => same(key, otherKey) && same(value, otherValue));
            if (match < 0) return false;
            remaining.splice(match, 1);
        }
        return true;
    }
    if (left instanceof Set || right instanceof Set) {
        if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
        const remaining = [...right];
        for (const value of left) {
            const match = remaining.findIndex(other => same(value, other));
            if (match < 0) return false;
            remaining.splice(match, 1);
        }
        return true;
    }
    if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
    const prototype = Object.getPrototypeOf(left);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(left);
    const otherKeys = Reflect.ownKeys(right);
    return keys.length === otherKeys.length && keys.every(key => otherKeys.includes(key)
        && same((left as Record<PropertyKey, unknown>)[key], (right as Record<PropertyKey, unknown>)[key]));
}
