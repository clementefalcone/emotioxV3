import simpleheat from 'simpleheat';
import {
    isPreciseHeatmapProfile,
    resolveHeatmapRadiusPx,
    type HeatmapVisualProfile,
} from '../../../../utils/attentionPrediction.utils';

export interface HeatmapPoint {
    x: number;
    y: number;
    value?: number;
    isCorrect?: boolean;
    timestamp?: number;
}

export type HeatmapGranularity = 'precise' | 'smooth';

export type HeatmapCoordSystem = 'pixel' | 'percent' | 'normalized';

export interface HeatmapPaintOptions {
    readonly data: readonly HeatmapPoint[];
    readonly radius?: number;
    readonly blur?: number;
    readonly opacity?: number;
    readonly threshold?: number;
    readonly darkOverlay?: number;
    readonly granularity: HeatmapGranularity;
    readonly visualProfile: HeatmapVisualProfile;
    readonly coordSystem?: HeatmapCoordSystem;
    readonly referenceData?: readonly HeatmapPoint[];
}

export const OVERLAY_DIM_FACTORS: Record<HeatmapVisualProfile, number> = {
    lab: 0.08,
    precise: 0.15,
    balanced: 0.16,
    smooth: 0.35,
    gaze: 0.15,
};

export const HEATMAP_GRADIENTS: Record<HeatmapVisualProfile, Record<number, string>> = {
    lab:      { 0.15: '#00ff00', 0.35: '#88ff00', 0.5: '#ffff00', 0.7: '#ff8800', 0.85: '#ff0000', 1.0: '#ff0000' },
    precise:  { 0.20: '#00ff00', 0.40: '#88ff00', 0.55: '#ffff00', 0.72: '#ff8800', 0.88: '#ff0000', 1.0: '#ff0000' },
    balanced: { 0.15: '#00ff00', 0.35: '#88ff00', 0.5: '#ffff00', 0.7: '#ff8800', 0.85: '#ff0000', 1.0: '#ff0000' },
    smooth:   { 0.10: '#00cc00', 0.30: '#66ff00', 0.45: '#ccff00', 0.6: '#ffcc00', 0.75: '#ff6600', 0.9: '#ff0000', 1.0: '#ff0000' },
    gaze:     { 0.01: '#00c8ff', 0.25: '#00e0ff', 0.45: '#00ff66', 0.62: '#ffff00', 0.8: '#ff8800', 0.95: '#ff0000', 1.0: '#ff0000' },
};

const dimLayerByHeatCanvas = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

const buildDimLayer = (heatCanvas: HTMLCanvasElement, overlayOpacity: number): HTMLCanvasElement => {
    const dimLayer = dimLayerByHeatCanvas.get(heatCanvas) ?? document.createElement('canvas');
    dimLayerByHeatCanvas.set(heatCanvas, dimLayer);
    dimLayer.width = heatCanvas.width;
    dimLayer.height = heatCanvas.height;
    const dimCtx = dimLayer.getContext('2d');
    if (!dimCtx) return dimLayer;
    dimCtx.fillStyle = `rgba(0, 0, 0, ${overlayOpacity})`;
    dimCtx.fillRect(0, 0, dimLayer.width, dimLayer.height);
    dimCtx.globalCompositeOperation = 'destination-out';
    dimCtx.drawImage(heatCanvas, 0, 0);
    dimCtx.globalCompositeOperation = 'source-over';
    return dimLayer;
};

const compositeHeat = (ctx: CanvasRenderingContext2D, heatCanvas: HTMLCanvasElement, overlayOpacity: number, heatAlpha: number): void => {
    ctx.drawImage(buildDimLayer(heatCanvas, overlayOpacity), 0, 0);
    ctx.globalAlpha = heatAlpha;
    ctx.drawImage(heatCanvas, 0, 0);
    ctx.globalAlpha = 1;
};

export const GAZE_DEFAULT_SPREAD = 12;
export const GAZE_DEFAULT_EXPOSURE = 35;
const GAZE_SIGMA_PER_SPREAD = 0.0025;
const GAZE_GRID_CELL_PX = 4;
const GAZE_VISIBLE_DENSITY = 0.03;
const GAZE_ALPHA_GAIN = 2.5;

const buildGazePalette = (): Uint8ClampedArray => {
    const paletteCanvas = document.createElement('canvas');
    paletteCanvas.width = 256;
    paletteCanvas.height = 1;
    const paletteCtx = paletteCanvas.getContext('2d');
    if (!paletteCtx) return new Uint8ClampedArray(256 * 4);
    const gradient = paletteCtx.createLinearGradient(0, 0, 256, 0);
    for (const [stop, color] of Object.entries(HEATMAP_GRADIENTS.gaze)) gradient.addColorStop(Number(stop), color);
    paletteCtx.fillStyle = gradient;
    paletteCtx.fillRect(0, 0, 256, 1);
    return paletteCtx.getImageData(0, 0, 256, 1).data;
};

const accumulateGazeDensity = (points: ReadonlyArray<[number, number, number]>, cols: number, rows: number, sigmaCells: number): Float32Array => {
    const density = new Float32Array(cols * rows);
    const reach = Math.ceil(sigmaCells * 3);
    const twoSigmaSquared = 2 * sigmaCells * sigmaCells;
    const colWeights = new Float32Array(2 * reach + 2);
    for (const [x, y, value] of points) {
        const centerCol = x / GAZE_GRID_CELL_PX;
        const centerRow = y / GAZE_GRID_CELL_PX;
        const firstCol = Math.max(0, Math.floor(centerCol - reach));
        const lastCol = Math.min(cols - 1, Math.ceil(centerCol + reach));
        for (let col = firstCol; col <= lastCol; col++) colWeights[col - firstCol] = Math.exp(-((col - centerCol) ** 2) / twoSigmaSquared);
        for (let row = Math.max(0, Math.floor(centerRow - reach)); row <= Math.min(rows - 1, Math.ceil(centerRow + reach)); row++) {
            const rowWeight = value * Math.exp(-((row - centerRow) ** 2) / twoSigmaSquared);
            const rowOffset = row * cols;
            for (let col = firstCol; col <= lastCol; col++) density[rowOffset + col] += rowWeight * colWeights[col - firstCol];
        }
    }
    return density;
};

const measureGazeDensity = (width: number, height: number, points: ReadonlyArray<[number, number, number]>, spread: number) => {
    const cols = Math.ceil(width / GAZE_GRID_CELL_PX);
    const rows = Math.ceil(height / GAZE_GRID_CELL_PX);
    const sigmaCells = Math.max(2, (Math.min(width, height) * GAZE_SIGMA_PER_SPREAD * spread) / GAZE_GRID_CELL_PX);
    const density = accumulateGazeDensity(points, cols, rows, sigmaCells);
    return { cols, rows, density, peak: density.reduce((max, cell) => Math.max(max, cell), 0) };
};

export const drawGazeHeat = (
    heatCanvas: HTMLCanvasElement,
    points: ReadonlyArray<[number, number, number]>,
    { spread, exposure, referencePeak }: { spread: number; exposure: number; referencePeak?: number },
): void => {
    const heatCtx = heatCanvas.getContext('2d', { willReadFrequently: true });
    if (!heatCtx || points.length === 0) return;
    const { cols, rows, density, peak: framePeak } = measureGazeDensity(heatCanvas.width, heatCanvas.height, points, spread);
    const peak = Math.max(referencePeak ?? 0, framePeak);
    if (peak <= 0) return;
    const gamma = 1.4 - exposure / 100;
    const palette = buildGazePalette();
    const grid = new ImageData(cols, rows);
    density.forEach((cell, index) => {
        const intensity = Math.pow(cell / peak, gamma);
        if (intensity < GAZE_VISIBLE_DENSITY) return;
        const paletteIndex = Math.min(255, Math.round(intensity * 255)) * 4;
        grid.data.set([palette[paletteIndex], palette[paletteIndex + 1], palette[paletteIndex + 2], Math.min(255, intensity * GAZE_ALPHA_GAIN * 255)], index * 4);
    });
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = cols;
    gridCanvas.height = rows;
    gridCanvas.getContext('2d')?.putImageData(grid, 0, 0);
    heatCtx.imageSmoothingEnabled = true;
    heatCtx.drawImage(gridCanvas, 0, 0, cols * GAZE_GRID_CELL_PX, rows * GAZE_GRID_CELL_PX);
};

interface GazeHeatKey {
    readonly data: readonly HeatmapPoint[];
    readonly referenceData: readonly HeatmapPoint[] | undefined;
    readonly width: number;
    readonly height: number;
    readonly spread: number;
    readonly exposure: number;
}

const gazeHeatKeys = new WeakMap<HTMLCanvasElement, GazeHeatKey>();
const referencePeaks = new WeakMap<readonly HeatmapPoint[], { readonly key: string; readonly peak: number }>();

const resolveReferencePeak = (referenceData: readonly HeatmapPoint[], width: number, height: number, spread: number, toPixel: (point: HeatmapPoint) => [number, number, number]): number => {
    const key = `${width}x${height}:${spread}`;
    const cached = referencePeaks.get(referenceData);
    if (cached?.key === key) return cached.peak;
    const { peak } = measureGazeDensity(width, height, referenceData.map(toPixel), spread);
    referencePeaks.set(referenceData, { key, peak });
    return peak;
};

const isSameGazeHeat = (cached: GazeHeatKey | undefined, next: GazeHeatKey): boolean =>
    cached !== undefined && cached.data === next.data && cached.referenceData === next.referenceData && cached.width === next.width && cached.height === next.height
    && cached.spread === next.spread && cached.exposure === next.exposure;

export const paintHeatmap = (ctx: CanvasRenderingContext2D, heatCanvas: HTMLCanvasElement, options: HeatmapPaintOptions): void => {
    const { data, radius: radiusProp, blur: blurProp, opacity: opacityProp, threshold: thresholdProp, darkOverlay = 0, granularity, visualProfile, coordSystem } = options;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const dimFactor = OVERLAY_DIM_FACTORS[visualProfile];
    const profileDimOpacity = opacityProp != null ? (opacityProp / 100) * dimFactor : dimFactor * 0.5;
    const overlayOpacity = Math.min(1, profileDimOpacity + darkOverlay / 100);

    if (heatCanvas.width !== w || heatCanvas.height !== h) {
        heatCanvas.width = w;
        heatCanvas.height = h;
    }
    const gazeKey: GazeHeatKey | null = visualProfile === 'gaze'
        ? { data, referenceData: options.referenceData, width: w, height: h, spread: blurProp ?? GAZE_DEFAULT_SPREAD, exposure: thresholdProp ?? GAZE_DEFAULT_EXPOSURE }
        : null;
    const isGazeHeatCached = gazeKey !== null && isSameGazeHeat(gazeHeatKeys.get(heatCanvas), gazeKey);
    if (!isGazeHeatCached) {
        gazeHeatKeys.delete(heatCanvas);
        heatCanvas.getContext('2d', { willReadFrequently: true })?.clearRect(0, 0, w, h);
    }

    const heat = simpleheat(heatCanvas);
    const isPrecise = granularity === 'precise';
    const isRefinedProfile = isPreciseHeatmapProfile(visualProfile);
    const isDenseSaliency = data.length > 100 && data.some(p => p.value != null && p.value < 1);
    const isLegacyDense = data.length > 120;

    const r = radiusProp ?? resolveHeatmapRadiusPx({
        width: w,
        height: h,
        visualProfile,
        granularity,
        isDense: isDenseSaliency,
        isLegacyDense,
    });

    const blurFraction = blurProp != null
        ? (isPrecise
            ? Math.min(0.45, Math.max(0.2, blurProp / 24))
            : Math.max(isDenseSaliency ? 0.5 : 0.3, blurProp / 20))
        : (isPrecise ? (visualProfile === 'lab' ? 0.28 : 0.35) : (isDenseSaliency ? 1.2 : 0.8));
    heat.radius(r, Math.round(r * blurFraction));

    heat.gradient(HEATMAP_GRADIENTS[visualProfile]);

    const toPixel = (point: HeatmapPoint): [number, number, number] => {
        let x = point.x;
        let y = point.y;
        if (coordSystem === 'pixel') { /* already pixels */ }
        else if (coordSystem === 'percent') { x = (x / 100) * w; y = (y / 100) * h; }
        else if (coordSystem === 'normalized') { x *= w; y *= h; }
        else if (x <= 1 && y <= 1) { x *= w; y *= h; }
        else if (x <= 100 && y <= 100) { x = (x / 100) * w; y = (y / 100) * h; }
        return [x, y, point.value ?? 1];
    };

    if (gazeKey) {
        if (!isGazeHeatCached) {
            const referencePeak = options.referenceData ? resolveReferencePeak(options.referenceData, w, h, gazeKey.spread, toPixel) : undefined;
            drawGazeHeat(heatCanvas, data.map(toPixel), { spread: gazeKey.spread, exposure: gazeKey.exposure, referencePeak });
            gazeHeatKeys.set(heatCanvas, gazeKey);
        }
        compositeHeat(ctx, heatCanvas, overlayOpacity, 0.35 + ((opacityProp ?? 72) / 100) * 0.6);
        return;
    }

    let points: Array<[number, number, number]>;

    if (isDenseSaliency) {
        const gridCols = isPrecise ? 36 : 32;
        const gridRows = Math.round(gridCols * (h / w));
        const cellW = w / gridCols;
        const cellH = h / gridRows;
        const grid = new Map<string, { sumX: number; sumY: number; sumVal: number; maxVal: number }>();

        for (const point of data) {
            const [px, py, val] = toPixel(point);
            const col = Math.min(gridCols - 1, Math.floor(px / cellW));
            const row = Math.min(gridRows - 1, Math.floor(py / cellH));
            const key = `${col},${row}`;
            const cell = grid.get(key);
            if (cell) {
                cell.sumX += px * val;
                cell.sumY += py * val;
                cell.sumVal += val;
                cell.maxVal = Math.max(cell.maxVal, val);
            } else {
                grid.set(key, { sumX: px * val, sumY: py * val, sumVal: val, maxVal: val });
            }
        }

        const cellThreshold = isRefinedProfile
            ? (thresholdProp != null
                ? Math.max(thresholdProp / 100, isLegacyDense ? 0.58 : 0.52)
                : (isLegacyDense ? 0.58 : 0.52))
            : (thresholdProp != null ? thresholdProp / 100 : 0.4);
        points = [];
        for (const cell of grid.values()) {
            if (cell.maxVal < cellThreshold) continue;
            points.push([cell.sumX / cell.sumVal, cell.sumY / cell.sumVal, cell.maxVal]);
        }
    } else {
        points = data.map(toPixel);
    }

    const intensityPointCount = points.length;
    heat.data(points);
    heat.max(isPrecise
        ? Math.max(2, Math.ceil(intensityPointCount * (visualProfile === 'lab' ? 0.06 : 0.08)))
        : isDenseSaliency
            ? Math.max(1, intensityPointCount * 0.04)
            : Math.max(3, Math.ceil(intensityPointCount * 0.05)));
    const minOpacity = isRefinedProfile
        ? (thresholdProp != null
            ? Math.max(thresholdProp / 100, visualProfile === 'lab' ? 0.22 : 0.12)
            : (visualProfile === 'lab' ? 0.22 : 0.12))
        : isDenseSaliency ? 0.03 : (thresholdProp != null ? thresholdProp / 100 : 0.05);
    heat.draw(minOpacity);

    const heatAlphaBase = visualProfile === 'lab' ? 0.32 : isRefinedProfile ? 0.38 : 0.45;
    const heatAlphaSpan = visualProfile === 'lab' ? 0.38 : isRefinedProfile ? 0.42 : 0.45;
    const heatAlpha = opacityProp != null
        ? heatAlphaBase + (opacityProp / 100) * heatAlphaSpan
        : heatAlphaBase + heatAlphaSpan * 0.5;
    compositeHeat(ctx, heatCanvas, overlayOpacity, heatAlpha);
};
