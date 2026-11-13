import type { ManualAOI } from '../types/attentionPrediction.types';
import type { AiAnalysisResult } from '../types/aiAnalysis.types';

const MIN_AOI_SIZE = 2;

type PercentAoi = Pick<ManualAOI, 'x' | 'y' | 'width' | 'height'>;
type AutoAoi = AiAnalysisResult['autoAois'][number];

/** Max display height for stimulus images/heatmaps in Attention Prediction card */
export const STIMULUS_VIEWPORT_MAX_HEIGHT_CLASS = 'max-h-[calc(100vh-280px)]';

/** Default media fit — shrink-wraps to image aspect ratio for aligned overlays */
export const STIMULUS_MEDIA_FIT_CLASS =
    'block max-w-full max-h-[calc(100vh-280px)] w-auto h-auto object-contain';

/** Media fit inside a flex viewport — scales down only, never causes page scroll */
export const STIMULUS_MEDIA_FIT_FLEX_CLASS =
    'block max-h-full max-w-full w-auto h-auto object-contain';

/** Gaze Paths — extra chrome for route toolbar (~80px) */
export const STIMULUS_GAZE_MEDIA_FIT_CLASS =
    'block max-w-full max-h-[calc(100vh-360px)] w-auto h-auto object-contain';

/** Heatmap tab — layer bar + preset sliders (~60px extra) */
export const STIMULUS_HEATMAP_MEDIA_FIT_CLASS =
    'block max-w-full max-h-[calc(100vh-340px)] w-auto h-auto object-contain';

/** AOI Editor — workflow bar + toolbar + layer bar (~120px extra) */
export const STIMULUS_AOI_MEDIA_FIT_CLASS =
    'block max-w-full max-h-[calc(100vh-420px)] w-auto h-auto object-contain';

export type HeatmapMapMode = 'classic' | 'spotlight' | 'cold';

export interface SpotlightSettings {
    blur: number;
    reveal: number;
    dim: number;
}

/** Default spotlight tuning for Attention Prediction */
export const DEFAULT_SPOTLIGHT_SETTINGS: SpotlightSettings = {
    blur: 16,
    reveal: 35,
    dim: 45,
};

export interface ColdMapSettings {
    intensity: number;
    blur: number;
    threshold: number;
}

/** Default cold-map tuning for Attention Prediction */
export const DEFAULT_COLD_MAP_SETTINGS: ColdMapSettings = {
    intensity: 55,
    blur: 14,
    threshold: 28,
};

export interface HeatmapViewSummaryInput {
    mapMode: HeatmapMapMode;
    settings: {
        blur: number;
        opacity: number;
        threshold: number;
        preset: string;
    };
    spotlight: SpotlightSettings;
    cold: ColdMapSettings;
}

/**
 * Formats a compact heatmap settings summary for the toolbar.
 * @param input - Active map mode and tuning values
 * @returns Human-readable one-line summary
 */
export function formatHeatmapViewSummary(input: HeatmapViewSummaryInput): string {
    if (input.mapMode === 'spotlight') {
        return `Spotlight · blur ${input.spotlight.blur} · reveal ${input.spotlight.reveal}% · umbral ${input.settings.threshold}`;
    }
    if (input.mapMode === 'cold') {
        return `Cold · intensidad ${input.cold.intensity}% · blur ${input.cold.blur} · umbral ${input.cold.threshold}`;
    }
    return `${input.settings.preset} · blur ${input.settings.blur} · opacidad ${input.settings.opacity}% · umbral ${input.settings.threshold}`;
}

/** Map modes available in the heatmap layer */
export const ACTIVE_HEATMAP_MAP_MODES: HeatmapMapMode[] = ['classic', 'spotlight', 'cold'];

/**
 * Returns true when map mode renders a full-frame canvas overlay (video/image).
 * @param mode - Map visualization mode
 * @returns Whether the mode replaces the base media with a composite canvas
 */
export function isFullFrameMapMode(mode: HeatmapMapMode): boolean {
    return mode === 'spotlight' || mode === 'cold';
}

/**
 * Returns the display label for a heatmap map mode.
 * @param mode - Map visualization mode
 * @returns Human-readable label
 */
export function getHeatmapMapModeLabel(mode: HeatmapMapMode): string {
    switch (mode) {
        case 'classic': return 'Classic';
        case 'spotlight': return 'Spotlight';
        case 'cold': return 'Cold';
    }
}

export type HeatmapVisualProfile = 'lab' | 'precise' | 'balanced' | 'smooth' | 'gaze';

/** Point count above which heatmapData is treated as pre-v0.79 dense export */
export const LEGACY_HEATMAP_POINT_THRESHOLD = 600;

/**
 * Returns true when heatmap points likely came from legacy dense extraction.
 * @param pointCount - Number of heatmap data points
 * @returns Whether regeneration is recommended for fine hotspots
 */
export function isLegacyDenseHeatmap(pointCount: number): boolean {
    return pointCount > LEGACY_HEATMAP_POINT_THRESHOLD;
}

/**
 * Maps UI preset name to render profile for HeatmapRenderer.
 * @param preset - Active detail preset label
 * @returns Visual profile used for canvas tuning
 */
export function resolveHeatmapVisualProfile(preset: string): HeatmapVisualProfile {
    if (preset === 'Lab') return 'lab';
    if (preset === 'Smooth') return 'smooth';
    if (preset === 'Balanced') return 'balanced';
    return 'precise';
}

/**
 * Returns true when preset uses precise spot rendering (Lab or Precise).
 * @param profile - Heatmap visual profile
 * @returns Whether precise granularity applies
 */
export function isPreciseHeatmapProfile(profile: HeatmapVisualProfile): boolean {
    return profile === 'lab' || profile === 'precise' || profile === 'balanced';
}

/** Acceptance criterion: single hotspot footprint must not exceed 15% of frame area */
export const MAX_HOTSPOT_FRAME_COVERAGE = 0.15;

/**
 * Returns the max simpleheat radius (px) so one spot stays within frame coverage limit.
 * @param width - Frame width in pixels
 * @param height - Frame height in pixels
 * @returns Maximum hotspot radius in pixels
 */
export function maxHotspotRadiusPx(width: number, height: number): number {
    const maxArea = MAX_HOTSPOT_FRAME_COVERAGE * width * height;
    return Math.floor(Math.sqrt(maxArea / Math.PI));
}

export interface HeatmapRadiusParams {
    width: number;
    height: number;
    visualProfile: HeatmapVisualProfile;
    granularity: 'precise' | 'smooth';
    isDense: boolean;
    isLegacyDense: boolean;
    radiusOverride?: number;
}

/**
 * Resolves simpleheat spot radius for Classic mode presets.
 * @param params - Frame size, profile, and density flags
 * @returns Hotspot radius in pixels (capped for Lab/Precise)
 */
export function resolveHeatmapRadiusPx(params: HeatmapRadiusParams): number {
    const {
        width,
        height,
        visualProfile,
        isDense,
        isLegacyDense,
        radiusOverride,
    } = params;

    if (radiusOverride != null) {
        return radiusOverride;
    }

    const isRefined = isPreciseHeatmapProfile(visualProfile);
    const minDim = Math.min(width, height);

    const radiusScale = visualProfile === 'lab'
        ? (isLegacyDense ? 0.038 : 0.032)
        : visualProfile === 'balanced'
            ? (isDense ? 0.044 : 0.038)
            : isRefined
                ? (isDense ? 0.05 : 0.042)
                : isDense ? 0.12 : 0.035;
    const radiusMin = visualProfile === 'lab'
        ? 10
        : visualProfile === 'balanced'
            ? 12
            : isRefined
                ? 14
                : isDense
                    ? 40
                    : 12;
    let radius = Math.max(radiusMin, Math.round(minDim * radiusScale));

    if (isRefined) {
        radius = Math.min(radius, maxHotspotRadiusPx(width, height));
    }

    return radius;
}

/**
 * Returns nominal radius scale for preset ordering QA (Smooth > Balanced > Lab).
 * @param preset - Detail preset label
 * @returns Relative radius scale factor
 */
export function getPresetRadiusScale(preset: string): number {
    const profile = resolveHeatmapVisualProfile(preset);
    if (profile === 'smooth') {
        return 0.12;
    }
    if (profile === 'balanced') {
        return 0.04;
    }
    if (profile === 'lab') {
        return 0.032;
    }
    return 0.042;
}

/**
 * Counts saliency points eligible for Spotlight reveal at a given threshold.
 * @param points - Heatmap data points
 * @param threshold - Saliency threshold on 0-100 scale
 * @returns Number of reveal zones
 */
export function countSpotlightRevealZones(
    points: Array<{ value?: number }>,
    threshold: number,
): number {
    const minVal = threshold / 100;
    return points.filter((point) => (point.value ?? 1) >= minVal).length;
}

export type StimulusMediaTab = 'original' | 'heatmap' | 'gaze-paths' | 'aoi-editor';

/** Viewport chrome subtracted from 100vh per tab (px) */
const STIMULUS_TAB_HEIGHT_OFFSET: Record<StimulusMediaTab, number> = {
    original: 280,
    heatmap: 340,
    'gaze-paths': 360,
    'aoi-editor': 420,
};

export interface StimulusDisplaySize {
    width: number;
    height: number;
}

/**
 * Computes display dimensions fitting natural size inside max bounds without upscaling.
 * @param naturalWidth - Source image width in pixels
 * @param naturalHeight - Source image height in pixels
 * @param maxWidth - Available container width in pixels
 * @param maxHeight - Available max height in pixels
 * @returns Scaled width and height for on-screen display
 */
export function computeStimulusDisplaySize(
    naturalWidth: number,
    naturalHeight: number,
    maxWidth: number,
    maxHeight: number,
): StimulusDisplaySize {
    if (naturalWidth <= 0 || naturalHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
        return { width: 0, height: 0 };
    }
    const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
    return {
        width: Math.round(naturalWidth * scale),
        height: Math.round(naturalHeight * scale),
    };
}

/**
 * Returns max display height in pixels for the active Attention Prediction tab.
 * @param tab - Active viewer tab
 * @returns Max height available for stimulus media
 */
export function getStimulusMaxHeightPx(tab: StimulusMediaTab): number {
    const offset = STIMULUS_TAB_HEIGHT_OFFSET[tab];
    if (typeof window === 'undefined') {
        return 600;
    }
    return Math.max(200, window.innerHeight - offset);
}

/**
 * Returns media fit classes for the active Attention Prediction tab.
 * Uses max-w-full + w-auto so images never upscale beyond natural size.
 * @param tab - Active viewer tab
 * @returns Tailwind class string for stimulus media sizing
 */
export function resolveStimulusMediaFitClass(tab: StimulusMediaTab): string {
    switch (tab) {
        case 'gaze-paths':
            return STIMULUS_GAZE_MEDIA_FIT_CLASS;
        case 'aoi-editor':
            return STIMULUS_AOI_MEDIA_FIT_CLASS;
        case 'heatmap':
            return STIMULUS_HEATMAP_MEDIA_FIT_CLASS;
        default:
            return STIMULUS_MEDIA_FIT_CLASS;
    }
}

/**
 * Clamps AOI bounds to valid percentage coordinates (0-100).
 * @param aoi - AOI to clamp
 * @returns AOI with normalized bounds
 */
export function clampAoiBounds(aoi: ManualAOI): ManualAOI {
    const width = Math.max(MIN_AOI_SIZE, Math.min(100, aoi.width));
    const height = Math.max(MIN_AOI_SIZE, Math.min(100, aoi.height));
    const x = Math.max(0, Math.min(100 - width, aoi.x));
    const y = Math.max(0, Math.min(100 - height, aoi.y));
    return { ...aoi, x, y, width, height };
}

/**
 * Returns true when predict/analyze gate is satisfied (D-07).
 * @param aoiCount - Number of manual AOIs defined
 * @param aoiSkipped - User confirmed continuing without zones
 * @returns Whether prediction may run
 */
export function canRunPredictionGate(aoiCount: number, aoiSkipped: boolean): boolean {
    return aoiCount >= 1 || aoiSkipped;
}

/**
 * Returns true when AI analysis may run.
 * @param heatmapPointCount - Points in TranSalNet heatmapData
 * @param aoiCount - Manual AOI count
 * @param aoiSkipped - Skip-AOI flag
 * @returns Whether analysis may run
 */
export function canRunAnalysisGate(
    heatmapPointCount: number,
    aoiCount: number,
    aoiSkipped: boolean,
    hasHeatmapVideo = false,
): boolean {
    return (heatmapPointCount > 0 || hasHeatmapVideo) && canRunPredictionGate(aoiCount, aoiSkipped);
}

/**
 * Detects a newly uploaded stimulus without prediction or analysis.
 * @param processedAt - Backend predict timestamp
 * @param hasAiAnalysis - Whether LLM analysis exists
 * @returns True for new stimuli that should open AOI Editor first
 */
export function isNewAttentionStimulus(
    processedAt: string | undefined,
    hasAiAnalysis: boolean,
): boolean {
    return !processedAt && !hasAiAnalysis;
}

/**
 * Detects stimuli analyzed under the pre-AOI-first pipeline (bulk auto-analyze).
 * @param processedAt - TranSalNet predict timestamp
 * @param heatmapPointCount - Points in heatmapData
 * @param hasAiAnalysis - Whether LLM analysis exists
 * @param manualAoiCount - Researcher-defined AOI count
 * @param aoiSkipped - User opted out of AOI definition
 * @returns True when results should be treated as legacy until re-run
 */
export function isLegacyAttentionStimulus(
    processedAt: string | undefined,
    heatmapPointCount: number,
    hasAiAnalysis: boolean,
    manualAoiCount: number,
    aoiSkipped: boolean,
    hasHeatmapVideo = false,
): boolean {
    if (!hasAiAnalysis) {
        return false;
    }
    if ((heatmapPointCount === 0 && !hasHeatmapVideo) || !processedAt) {
        return true;
    }
    return manualAoiCount === 0 && !aoiSkipped;
}

export type AttentionPredictionTabId = 'original' | 'heatmap' | 'gaze-paths' | 'aoi-editor';

export interface AttentionLayerState {
    heatmap: boolean;
    aiAois: boolean;
    manualAois: boolean;
    gaze: boolean;
}

export interface AttentionLayerContext {
    hasHeatmap: boolean;
    hasGazeRoutes: boolean;
    hasManualAois: boolean;
    hasAutoAois: boolean;
}

/**
 * Returns true when the DOM node accepts keyboard text editing.
 * @param target - Event target from a keyboard event
 * @returns Whether Delete/Backspace should edit text instead of deleting an AOI
 */
export function isEditableDomTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
    }
    return target.isContentEditable === true;
}

export interface AoiKeyboardDeleteGuardContext {
    showNameModal: boolean;
    editingLabelId: string | null;
    criteriaDrawerOpen: boolean;
    target: EventTarget | null;
}

/**
 * Returns true when Delete/Backspace must not remove the selected AOI.
 * @param context - Modal state, inline label edit, criteria drawer, and event target
 * @returns Whether AOI keyboard delete should be suppressed
 */
export function shouldBlockAoiKeyboardDelete(context: AoiKeyboardDeleteGuardContext): boolean {
    if (context.criteriaDrawerOpen) {
        return true;
    }
    if (context.showNameModal) {
        return true;
    }
    if (context.editingLabelId) {
        return true;
    }
    return isEditableDomTarget(context.target);
}

/**
 * Builds composable layer visibility for an Attention Prediction tab.
 * Original and Gaze Paths enable every available overlay (composite view).
 * @param tabId - Active stimulus tab
 * @param context - Which overlays have data to show
 * @returns Layer toggle state for the tab
 */
export function buildAttentionLayerPreset(
    tabId: AttentionPredictionTabId,
    context: AttentionLayerContext,
): AttentionLayerState {
    switch (tabId) {
        case 'heatmap':
            return {
                heatmap: context.hasHeatmap,
                aiAois: false,
                manualAois: false,
                gaze: false,
            };
        case 'aoi-editor':
            return {
                heatmap: context.hasHeatmap,
                aiAois: false,
                manualAois: true,
                gaze: false,
            };
        case 'original':
            return {
                heatmap: false,
                aiAois: false,
                manualAois: false,
                gaze: false,
            };
        case 'gaze-paths':
        default:
            return {
                heatmap: context.hasHeatmap,
                aiAois: context.hasAutoAois,
                manualAois: context.hasManualAois,
                gaze: context.hasGazeRoutes,
            };
    }
}

export interface HeatmapPoint {
    x: number;
    y: number;
    value: number;
}

/**
 * Normalizes heatmap point coordinates to percentage space (0-100).
 * @param point - Heatmap data point
 * @returns x/y in percent
 */
export function heatmapPointToPercent(point: HeatmapPoint): { px: number; py: number } {
    return {
        px: point.x > 1 ? point.x : point.x * 100,
        py: point.y > 1 ? point.y : point.y * 100,
    };
}

/**
 * Returns true when a percent point lies inside an AOI bounding box.
 * @param px - X in percent
 * @param py - Y in percent
 * @param aoi - AOI bounds in percent
 * @returns Whether the point is inside the AOI
 */
export function pointInsidePercentAoi(
    px: number,
    py: number,
    aoi: PercentAoi,
): boolean {
    return px >= aoi.x && px <= aoi.x + aoi.width
        && py >= aoi.y && py <= aoi.y + aoi.height;
}

/**
 * Computes attention share for an AOI as weighted saliency inside bbox vs global sum.
 * @param aoi - AOI bounds in percent
 * @param heatmapData - TranSalNet heatmap points
 * @returns Attention share 0-100
 */
export function computeAoiAttentionShare(
    aoi: PercentAoi,
    heatmapData: HeatmapPoint[],
): number {
    if (heatmapData.length === 0) {
        return 0;
    }

    let inBboxSum = 0;
    let totalSum = 0;

    for (const point of heatmapData) {
        const { px, py } = heatmapPointToPercent(point);
        const val = Number(point.value) || 0;
        totalSum += val;
        if (pointInsidePercentAoi(px, py, aoi)) {
            inBboxSum += val;
        }
    }

    if (totalSum <= 0) {
        return 0;
    }
    if (inBboxSum > 0) {
        return Math.round((inBboxSum / totalSum) * 100);
    }

    const cx = aoi.x + aoi.width / 2;
    const cy = aoi.y + aoi.height / 2;
    let nearestVal = 0;
    let nearestDist = Infinity;

    for (const point of heatmapData) {
        const { px, py } = heatmapPointToPercent(point);
        const dist = Math.hypot(px - cx, py - cy);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearestVal = Number(point.value) || 0;
        }
    }

    const reach = Math.max(aoi.width, aoi.height) * 0.6;
    if (nearestDist <= reach) {
        return Math.round((nearestVal / totalSum) * 100);
    }

    return 0;
}

/**
 * Maps an AOI attention-share percentage (0-100) to an estimated exposure time.
 * Based on typical 3-5s total viewing window for product/packaging stimuli.
 * Formula: linear interpolation where 100% share → 3.0s and 0% → 0.1s.
 */
export function estimateExposureTime(sharePercent: number, totalViewTimeS = 3.0): string {
    const clamped = Math.max(0, Math.min(100, sharePercent));
    const seconds = 0.1 + (clamped / 100) * (totalViewTimeS - 0.1);
    return seconds < 1 ? `${Math.round(seconds * 1000)}ms` : `${seconds.toFixed(1)}s`;
}

/**
 * Clamps AI-detected AOI bounds to valid percentage coordinates.
 * @param aoi - Raw auto-AOI from LLM output
 * @returns Sanitized AOI with optional lowConfidence flag
 */
export function sanitizeAutoAoiBounds<T extends {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    attentionLevel: string;
    description: string;
    lowConfidence?: boolean;
}>(aoi: T): T & { lowConfidence: boolean } {
    const width = Math.max(MIN_AOI_SIZE, Math.min(100, Number(aoi.width) || MIN_AOI_SIZE));
    const height = Math.max(MIN_AOI_SIZE, Math.min(100, Number(aoi.height) || MIN_AOI_SIZE));
    const x = Math.max(0, Math.min(100 - width, Number(aoi.x) || 0));
    const y = Math.max(0, Math.min(100 - height, Number(aoi.y) || 0));
    const area = width * height;
    const lowConfidence = Boolean(aoi.lowConfidence) || area < 36 || width < 3 || height < 3;

    return {
        ...aoi,
        label: String(aoi.label || 'Zona sin nombre').slice(0, 80),
        x,
        y,
        width,
        height,
        lowConfidence,
    };
}

/**
 * Normalizes legacy AOI records loaded from settings.
 * @param raw - Stored AOI array
 * @returns Typed manual AOIs with default source
 */
export function normalizeManualAois(raw: unknown): ManualAOI[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => ({
            id: String(item.id ?? `aoi_${crypto.randomUUID()}`),
            label: String(item.label ?? 'Zona sin nombre'),
            x: Number(item.x) || 0,
            y: Number(item.y) || 0,
            width: Number(item.width) || MIN_AOI_SIZE,
            height: Number(item.height) || MIN_AOI_SIZE,
            source: (item.source as ManualAOI['source']) ?? 'manual',
        }))
        .map(clampAoiBounds);
}

/**
 * Normalizes an AOI label for fuzzy comparison.
 * @param label - Raw label string
 * @returns Lowercase trimmed label
 */
function normalizeAoiLabel(label: string): string {
    return label.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Returns true when two AOI labels refer to the same region.
 * @param a - First label
 * @param b - Second label
 * @returns Whether labels are similar enough to treat as the same AOI
 */
function aoiLabelsSimilar(a: string, b: string): boolean {
    const na = normalizeAoiLabel(a);
    const nb = normalizeAoiLabel(b);
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;

    const tokensA = new Set(na.split(/\s+/).filter((w) => w.length > 2));
    const tokensB = new Set(nb.split(/\s+/).filter((w) => w.length > 2));
    if (tokensA.size === 0 || tokensB.size === 0) return false;

    let shared = 0;
    for (const token of tokensA) {
        if (tokensB.has(token)) shared += 1;
    }
    const unionSize = new Set([...tokensA, ...tokensB]).size;
    return shared / unionSize >= 0.5;
}

/**
 * Reconciles AI-detected AOIs with manual zones.
 * Matching labels snap to manual bounding boxes. All auto AOIs are kept visible.
 * @param manualAois - User-defined AOIs
 * @param autoAois - AI-detected AOIs from analysis
 * @returns Corrected auto AOIs
 */
export function reconcileAutoAoisWithManual<T extends AutoAoi>(
    manualAois: ManualAOI[],
    autoAois: T[],
): T[] {
    if (!manualAois.length || !autoAois.length) return autoAois;

    return autoAois.map((auto) => {
        // If a manual AOI has a similar label, snap auto to manual geometry
        for (const manual of manualAois) {
            if (aoiLabelsSimilar(auto.label, manual.label)) {
                return sanitizeAutoAoiBounds({
                    ...auto,
                    x: manual.x,
                    y: manual.y,
                    width: manual.width,
                    height: manual.height,
                });
            }
        }
        return sanitizeAutoAoiBounds(auto);
    });
}

type GazeFixation = AiAnalysisResult['gazePath'][number];

const GAZE_SNAP_RADIUS_PCT = 14;
const GAZE_SNAP_BLEND = 0.72;
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/**
 * Clamps a percentage coordinate to the 0–100 range.
 * @param value - Raw coordinate
 * @returns Clamped percentage
 */
function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

/**
 * Returns a small deterministic offset to break symmetric LLM coordinates.
 * @param order - Fixation order in path
 * @returns X/Y jitter in percentage points
 */
function deterministicGazeJitter(order: number): { dx: number; dy: number } {
    const seed = order * GOLDEN_RATIO_CONJUGATE;
    const dx = (Math.sin(seed * 11.3) * 2.2);
    const dy = (Math.cos(seed * 7.7) * 2.2);
    return { dx, dy };
}

/**
 * Finds the nearest salient heatmap point within a radius.
 * @param x - Fixation X in percent
 * @param y - Fixation Y in percent
 * @param heatmapData - TranSalNet heatmap points
 * @param maxRadiusPct - Maximum snap distance in percent
 * @returns Nearest hotspot or null when none within radius
 */
function findNearestHeatmapHotspot(
    x: number,
    y: number,
    heatmapData: HeatmapPoint[],
    maxRadiusPct: number,
): HeatmapPoint | null {
    let best: HeatmapPoint | null = null;
    let bestScore = -Infinity;

    for (const point of heatmapData) {
        const dx = point.x - x;
        const dy = point.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxRadiusPct) continue;

        const proximity = 1 - dist / maxRadiusPct;
        const score = (point.value ?? 0) * 0.7 + proximity * 0.3;
        if (score > bestScore) {
            bestScore = score;
            best = point;
        }
    }

    return best;
}

/**
 * Snaps gaze fixations to heatmap hotspots and adds light jitter to reduce template symmetry.
 * @param fixations - LLM-predicted gaze path
 * @param heatmapData - TranSalNet heatmap points
 * @returns Anchored fixations with same order and labels
 */
export function anchorGazePathToHeatmap(
    fixations: GazeFixation[],
    heatmapData: HeatmapPoint[],
): GazeFixation[] {
    if (!fixations.length) return fixations;

    return fixations.map((fix) => {
        const hotspot = heatmapData.length > 0
            ? findNearestHeatmapHotspot(fix.x, fix.y, heatmapData, GAZE_SNAP_RADIUS_PCT)
            : null;

        if (hotspot) {
            const jitter = deterministicGazeJitter(fix.order);
            return {
                ...fix,
                x: clampPercent(hotspot.x * GAZE_SNAP_BLEND + fix.x * (1 - GAZE_SNAP_BLEND) + jitter.dx * 0.35),
                y: clampPercent(hotspot.y * GAZE_SNAP_BLEND + fix.y * (1 - GAZE_SNAP_BLEND) + jitter.dy * 0.35),
            };
        }

        const jitter = deterministicGazeJitter(fix.order);
        return {
            ...fix,
            x: clampPercent(fix.x + jitter.dx),
            y: clampPercent(fix.y + jitter.dy),
        };
    });
}

/**
 * Anchors all gaze path routes to heatmap hotspots.
 * @param routes - LLM gaze path routes
 * @param heatmapData - TranSalNet heatmap points
 * @returns Routes with anchored fixations
 */
export function anchorGazeRoutesToHeatmap(
    routes: NonNullable<AiAnalysisResult['gazePathRoutes']>,
    heatmapData: HeatmapPoint[],
): NonNullable<AiAnalysisResult['gazePathRoutes']> {
    return routes.map((route) => ({
        ...route,
        fixations: anchorGazePathToHeatmap(route.fixations, heatmapData),
    }));
}
