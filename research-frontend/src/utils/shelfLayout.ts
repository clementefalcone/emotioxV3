export interface ShelfAoi {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function buildShelfColumns<T>(products: readonly T[], shelfItems: number, repetitions: number): T[] {
  const repeatedProducts = products.flatMap(product => Array.from({ length: Math.max(1, repetitions) }, () => product));
  if (repeatedProducts.length === 0) return [];
  return Array.from({ length: shelfItems }, (_, column) => repeatedProducts[column % repeatedProducts.length]);
}

export function buildShelfAois(productLabels: readonly string[], shelfItems: number, repetitions: number): ShelfAoi[] {
  const columnWidth = 100 / shelfItems;
  return buildShelfColumns(productLabels, shelfItems, repetitions).map((label, column) => ({
    id: `shelf-aoi-${column}`,
    label,
    x: column * columnWidth,
    y: 0,
    width: columnWidth,
    height: 100,
  }));
}
