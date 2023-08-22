export function areMapsEqual<K, V>(a: Map<K, V>, b: Map<K, V>, areValuesEqual?: (a: V, b: V) => boolean): boolean {
	if (a.size !== b.size) return false;
	areValuesEqual ??= (a, b) => a === b;
	for (const [k, v] of a.entries()) {
		if (!(b.has(k) && areValuesEqual(v, b.get(k)!))) {
			return false;
		}
	}
	return true;
}
