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
    readonly intensityPointCount?: number;
}

export const OVERLAY_DIM_FACTORS: Record<HeatmapVisualProfile, number> = {
    lab: 0.08,
    precise: 0.15,
    balanced: 0.16,
    smooth: 0.35,
};

export const HEATMAP_GRADIENTS: Record<HeatmapVisualProfile, Record<number, string>> = {
    lab:      { 0.15: '#00ff00', 0.35: '#88ff00', 0.5: '#ffff00', 0.7: '#ff8800', 0.85: '#ff0000', 1.0: '#ff0000' },
    precise:  { 0.20: '#00ff00', 0.40: '#88ff00', 0.55: '#ffff00', 0.72: '#ff8800', 0.88: '#ff0000', 1.0: '#ff0000' },
    balanced: { 0.15: '#00ff00', 0.35: '#88ff00', 0.5: '#ffff00', 0.7: '#ff8800', 0.85: '#ff0000', 1.0: '#ff0000' },
    smooth:   { 0.10: '#00cc00', 0.30: '#66ff00', 0.45: '#ccff00', 0.6: '#ffcc00', 0.75: '#ff6600', 0.9: '#ff0000', 1.0: '#ff0000' },
};

export const paintHeatmap = (ctx: CanvasRenderingContext2D, heatCanvas: HTMLCanvasElement, options: HeatmapPaintOptions): void => {
    const { data, radius: radiusProp, blur: blurProp, opacity: opacityProp, threshold: thresholdProp, darkOverlay = 0, granularity, visualProfile, coordSystem } = options;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const dimFactor = OVERLAY_DIM_FACTORS[visualProfile];
    const profileDimOpacity = opacityProp != null ? (opacityProp / 100) * dimFactor : dimFactor * 0.5;
    const overlayOpacity = Math.min(1, profileDimOpacity + darkOverlay / 100);
    ctx.fillStyle = `rgba(0, 0, 0, ${overlayOpacity})`;
    ctx.fillRect(0, 0, w, h);

    if (heatCanvas.width !== w || heatCanvas.height !== h) {
        heatCanvas.width = w;
        heatCanvas.height = h;
    }
    heatCanvas.getContext('2d', { willReadFrequently: true })?.clearRect(0, 0, w, h);

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

    const intensityPointCount = options.intensityPointCount ?? points.length;
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
    ctx.globalAlpha = heatAlpha;
    ctx.drawImage(heatCanvas, 0, 0);
    ctx.globalAlpha = 1;
};
