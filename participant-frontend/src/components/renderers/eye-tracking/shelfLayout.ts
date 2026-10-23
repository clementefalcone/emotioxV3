export function buildShelfColumns(urls: readonly string[], shelfItems: number, repetitions: number): string[] {
    const repeatedUrls = urls.flatMap(url => Array.from({ length: Math.max(1, repetitions) }, () => url));
    if (repeatedUrls.length === 0) return [];
    return Array.from({ length: shelfItems }, (_, column) => repeatedUrls[column % repeatedUrls.length]);
}

export function orderShelfColumns(columns: readonly string[], columnOrder: readonly number[]): string[] {
    return columnOrder.map(column => columns[column]);
}
