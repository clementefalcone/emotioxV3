import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParticipantStore } from '../../stores/useParticipantStore';
import { mediaService } from '../../services/media.service';
import { useBlazeGaze } from '../../hooks/useBlazeGaze';
import { useMediaPipeGaze } from '../../hooks/useMediaPipeGaze';
import { useFaceApiEmotions } from '../../hooks/useFaceApiEmotions';
import { usePreviewMode } from '../../hooks/usePreviewMode';
import {
    BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS,
    HYBRID_CALIBRATION_FIELD_STRENGTH,
    HYBRID_IMAGE_CALIBRATION_POINTS,
    HYBRID_VALIDATION_POINTS,
    HYBRID_RECALIBRATION_RMSE_THRESHOLD_PX,
    // HYBRID_REJECT_RMSE_THRESHOLD_PX used in ValidationPhase component
    HYBRID_AOI_GRID,
    hybridApplyCalibrationField,
    hybridCalibrationRmsePx,
    hybridImagePercentToBlazeNorm,
    hybridPointToSoftZoneWeights,
    hybridCalibrationConfidenceWeightUv,
    expandGazeWithMinimumJerkGapFill,
    HYBRID_GAP_FILL_SYNTHETIC_WEIGHT,
    detectFixationsIDT,
    mapFixationsToImageCoords,
    MICRO_RECALIB_INTERVAL_MS,
    MICRO_RECALIB_SAMPLE_DURATION_MS,
    MICRO_RECALIB_SAMPLE_COUNT,
    MICRO_RECALIB_POSITIONS,
    computeMicroRecalibResidual,
    detectMicroExpressions,
    isBlazeGazeCaptureResolutionLow,
} from '../../lib/eyeTracking';
import type { HybridCalibrationResidual } from '../../lib/eyeTracking';

// V2 zone pipeline
import { ZoneRegistry, generateGrid } from '../../lib/eyeTracking/zoneRegistry';
import { ZoneEventEmitter } from '../../lib/eyeTracking/zoneEventEmitter';
import type { ZoneEvent } from '../../lib/eyeTracking/zoneEventEmitter';
import {
    EYE_TRACKING_V2_ENABLED,
    buildV2Response,
} from '../../lib/eyeTracking/v2ResponseBuilder';
import { getCurrentDeviceProfile } from '../../lib/eyeTracking/deviceProfile';

import type { EyeTrackingRendererProps, ETPhase, Fixation } from './eye-tracking/types';
import {
    EYE_TRACKING_ONE_EURO_MIN_CUTOFF,
    EYE_TRACKING_ONE_EURO_BETA,
    GAZE_POLL_MS,
    GAZE_ENGINE,
    V3_HEATMAP_ENABLED,
    getDeviceType,
    extractConfig,
} from './eye-tracking/types';

// V3 attention inference engine
import { fitFromLoocvResiduals, fitFromHybridResiduals, computeFrameUncertainty, type LoocvResidual } from '../../lib/eyeTracking/attention/uncertaintyEstimator';
import type { CalibrationEllipse } from '../../lib/eyeTracking/attention/types';
import { ProbabilisticHeatmap } from '../../lib/eyeTracking/attention/probabilisticHeatmap';
import { computeSessionConfidence, computeSpatialCoverage } from '../../lib/eyeTracking/attention/sessionMetrics';

import { IntroPhase } from './eye-tracking/IntroPhase';
import { SetupPhase } from './eye-tracking/SetupPhase';
import { PreparingPhase } from './eye-tracking/PreparingPhase';
import { CalibrationPhase } from './eye-tracking/CalibrationPhase';
import { ValidationPhase } from './eye-tracking/ValidationPhase';
import { ViewingPhase } from './eye-tracking/ViewingPhase';
import { CompletePhase } from './eye-tracking/CompletePhase';
import { SessionQualityGate } from './eye-tracking/SessionQualityGate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fisherYatesShuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const ET_CALIBRATION_KEY = 'emotiox-et-calibration';
const ET_CALIBRATION_TTL_MS = 120_000; // 2 minutes

function saveCalibrationToSession(moduleId: string, residuals: HybridCalibrationResidual[], rmsePx: number | null) {
    try {
        sessionStorage.setItem(ET_CALIBRATION_KEY, JSON.stringify({
            moduleId,
            residuals,
            rmsePx,
            timestamp: Date.now(),
        }));
    } catch { /* storage full or unavailable */ }
}

function loadCalibrationFromSession(moduleId: string): { residuals: HybridCalibrationResidual[]; rmsePx: number | null } | null {
    try {
        const raw = sessionStorage.getItem(ET_CALIBRATION_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.moduleId === moduleId) return null;
        if (Date.now() - data.timestamp > ET_CALIBRATION_TTL_MS) {
            sessionStorage.removeItem(ET_CALIBRATION_KEY);
            return null;
        }
        return { residuals: data.residuals, rmsePx: data.rmsePx };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EyeTrackingRenderer: React.FC<EyeTrackingRendererProps> = ({ module, onComplete }) => {
    const { t } = useTranslation();
    const { saveResponse } = useParticipantStore();
    const { isPreviewMode } = usePreviewMode();

    const deviceType = useMemo(() => getDeviceType(), []);
    const isDesktop = deviceType === 'desktop';

    const { stimulusUrl, stimulusUrls, taskDescription, viewingDuration, displayMode, shelfCount, shelfItems, shelfRepetitions, randomizeStimuli, shelfRotationInterval, hasEmotionRecognition, isVideo, hasUploadError } = useMemo(() => extractConfig(module), [module]);
    const isShelf = displayMode === 'shelf';

    // Skip intro/setup/calibration if a recent ET calibration exists (consecutive ET modules)
    const cachedCalibration = useMemo(() => loadCalibrationFromSession(module.id), [module.id]);
    const [phase, setPhase] = useState<ETPhase>(cachedCalibration ? 'preparing' : 'intro');
    const [resolvedUrl, setResolvedUrl] = useState<string>('');
    const [resolvedShelfUrls, setResolvedShelfUrls] = useState<string[]>([]);
    const [timeLeft, setTimeLeft] = useState(Math.ceil(viewingDuration / 1000));
    const imgRef = useRef<HTMLImageElement>(null);
    const stimulusVideoRef = useRef<HTMLVideoElement>(null);
    const videoEndedRef = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const shelfContainerRef = useRef<HTMLDivElement>(null);
    const calibrationAreaRef = useRef<HTMLDivElement>(null);
    const savedRef = useRef(false);
    const naturalSizeRef = useRef<{ w: number; h: number } | null>(null);
    const completeTimerRef = useRef<number | null>(null);
    /** Snapshot of image bounding rect captured during viewing phase (before complete hides the image). */
    const viewingRectRef = useRef<DOMRect | null>(null);
    const [finalPointCount, setFinalPointCount] = useState(0);

    // Setup checkboxes
    const [checks, setChecks] = useState([false, false, false, false]);
    const allChecked = checks.every(Boolean);

    /** 9-point calibration on stimulus image (3x3 grid) + IDW field. */
    const [calibrationIndex, setCalibrationIndex] = useState(0);
    const calibrationResidualsRef = useRef<HybridCalibrationResidual[]>(cachedCalibration?.residuals ?? []);
    const calibrationRmsePxRef = useRef<number | null>(cachedCalibration?.rmsePx ?? null);
    const gazePosRef = useRef<[number, number]>([0, 0]);
    /** Tracks how many times the participant has re-calibrated (validation failed). */
    const recalibrationCountRef = useRef(0);
    const [lowResWarning, setLowResWarning] = useState(false);
    /** Validation state for 5-point independent validation (Fase C). */
    const [validationIndex, setValidationIndex] = useState(0);
    const [validationPointErrors, setValidationPointErrors] = useState<number[]>([]);
    /** Average RMSE across all 5 validation points (null until all measured). */
    const [validationRmse, setValidationRmse] = useState<number | null>(null);

    // --- Gaze engines (both hooks always called — React rules — only active engine is started) ---
    const videoRef = useRef<HTMLVideoElement>(null);
    const useMP = GAZE_ENGINE === 'mediapipe';
    const blaze = useBlazeGaze(videoRef, {
        oneEuroMinCutoff: EYE_TRACKING_ONE_EURO_MIN_CUTOFF,
        oneEuroBeta: EYE_TRACKING_ONE_EURO_BETA,
    });
    const mpGaze = useMediaPipeGaze(videoRef, {
        oneEuroMinCutoff: 1.2,
        oneEuroBeta: 0.05,
        rff: { D: 128, sigma: 'auto', seed: 42 },
    });
    // Unified gaze interface — reads from whichever engine is active
    const gaze = useMP ? {
        isLoaded: mpGaze.isLoaded,
        gazePos: mpGaze.gazePos,
        gazePosRef: mpGaze.gazePosRef,
        rawGazePos: mpGaze.rawGazePos,
        rawScreenRef: mpGaze.rawScreenRef,
        gazeState: mpGaze.gazeState,
        start: mpGaze.start,
        stop: mpGaze.stop,
        calibrate: mpGaze.calibrate,
        trainRidge: mpGaze.trainRidge as () => Promise<void>,
        getFrameStats: mpGaze.getFrameStats,
        resetFrameStats: mpGaze.resetFrameStats,
        calibrationCount: mpGaze.calibrationCount,
    } : {
        isLoaded: blaze.isLoaded,
        gazePos: blaze.gazePos,
        gazePosRef: blaze.gazePosRef,
        rawGazePos: blaze.rawGazePos,
        rawScreenRef: blaze.rawScreenRef,
        gazeState: blaze.gazeState,
        start: blaze.start,
        stop: blaze.stop,
        calibrate: blaze.calibrate,
        trainRidge: undefined as (() => Promise<void>) | undefined,
        getFrameStats: blaze.getFrameStats,
        resetFrameStats: blaze.resetFrameStats,
        calibrationCount: blaze.calibrationCount,
    };
    const gazePointsRef = useRef<{ x: number; y: number; t: number; videoTime?: number }[]>([]);

    // --- V2 zone pipeline (connected AFTER IDW in viewing loop) ---
    const zoneRegistryRef = useRef<ZoneRegistry | null>(null);
    const zoneEmitterRef = useRef<ZoneEventEmitter | null>(null);
    const zoneEventsRef = useRef<ZoneEvent[]>([]);

    // --- V3 probabilistic heatmap (runs parallel to V2) ---
    const v3HeatmapRef = useRef<ProbabilisticHeatmap | null>(null);
    const v3EllipsesRef = useRef<CalibrationEllipse[]>([]);
    const v3LastTimeRef = useRef(0);
    const v3LastGazeRef = useRef<{ x: number; y: number } | null>(null);
    /** Initial stimulus rect when V3 heatmap was created — used to rescale gaze on resize. */
    const v3InitRectRef = useRef<{ width: number; height: number; left: number; top: number } | null>(null);
    const [v3DebugInfo, setV3DebugInfo] = useState<{
        mass: number; duration: number; sigma1: number; sigma2: number; theta: number;
    } | null>(null);

    const faceEmotions = useFaceApiEmotions({
        videoRef,
        enabled: hasEmotionRecognition,
        sampleIntervalMs: GAZE_POLL_MS,
    });

    // --- Micro-recalibration (drift correction during viewing) ---
    const [microDot, setMicroDot] = useState<{ u: number; v: number } | null>(null);
    const microProbeIndexRef = useRef(0);
    const microGazeSamplesRef = useRef<{ x: number; y: number }[]>([]);

    // Camera management
    const startCamera = useCallback(async () => {
        // Skip if camera is already running (prevents orphaned MediaStreams)
        if (videoRef.current?.srcObject) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia(BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        } catch (err) {
            console.error('[EyeTrackingRenderer] Camera error:', err);
        }
    }, []);

    const stopCamera = useCallback(() => {
        const video = videoRef.current;
        if (video?.srcObject) {
            (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            video.srcObject = null;
        }
    }, []);

    // Cleanup on unmount — release camera, stop BlazeGaze + face-api.
    // Critical for consecutive ET modules: without this, the 2nd module's
    // getUserMedia hangs because the previous stream is still active (Safari especially).
    const videoRefForCleanup = videoRef;
    useEffect(() => {
        const blazeRef = blaze;
        const faceRef = faceEmotions;
        const vidRef = videoRefForCleanup;
        return () => {
            const video = vidRef.current;
            if (video?.srcObject) {
                (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                video.srcObject = null;
            }
            blazeRef.stop();
            faceRef.stop();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Resolve stimulus URL(s)
    useEffect(() => {
        const urlsToResolve = isShelf ? stimulusUrls : (stimulusUrl ? [stimulusUrl] : []);
        if (urlsToResolve.length === 0) return;
        let cancelled = false;

        const resolveOne = async (url: string) => {
            try {
                if (url.startsWith('/') || (!url.startsWith('http') && !url.startsWith('blob'))) {
                    return await mediaService.getMediaUrl(url);
                }
                return url;
            } catch {
                return url;
            }
        };

        const resolveAll = async () => {
            const resolved = await Promise.all(urlsToResolve.map(resolveOne));
            if (cancelled) return;
            if (isShelf) {
                const final = randomizeStimuli ? fisherYatesShuffle(resolved) : resolved;
                setResolvedShelfUrls(final);
                setResolvedUrl(final[0] || '');
            } else {
                setResolvedUrl(resolved[0] || '');
            }
        };

        resolveAll();
        return () => { cancelled = true; };
    }, [stimulusUrl, stimulusUrls, isShelf, randomizeStimuli]);

    /** Keep latest smoothed gaze for hybrid calibration samples (desktop).
     *  Reads from gaze.gazePosRef (updated every frame, no re-render). */
    useEffect(() => {
        let raf = 0;
        const sync = () => {
            const pos = gaze.gazePosRef.current;
            if (pos) gazePosRef.current = [pos.x, pos.y];
            raf = requestAnimationFrame(sync);
        };
        raf = requestAnimationFrame(sync);
        return () => cancelAnimationFrame(raf);
    }, [gaze.gazePosRef]);

    // Gaze collection during viewing phase (desktop): RAF loop with 50ms throttle, IDW-corrected.
    // V2: feeds IDW-corrected coords into ZoneEventEmitter AFTER IDW correction.
    // Pipeline: BlazeGaze CNN → One-Euro → IDW field → ZoneClassifier → HysteresisEngine → ZoneEventEmitter
    useEffect(() => {
        if (phase !== 'viewing') return;

        // Start face-api.js emotion sampling alongside gaze
        if (hasEmotionRecognition) {
            faceEmotions.start();
        }

        // Start video playback if video stimulus
        if (isVideo && stimulusVideoRef.current) {
            stimulusVideoRef.current.currentTime = 0;
            void stimulusVideoRef.current.play();
        }

        // --- V2 zone pipeline initialization ---
        const profile = getCurrentDeviceProfile();
        const registry = new ZoneRegistry();
        const emitter = new ZoneEventEmitter({
            uncertaintyRadius: profile.uncertaintyRadius,
            switchThresholdMs: profile.hysteresisMs,
            minFixationMs: 150,
        });
        zoneRegistryRef.current = registry;
        zoneEmitterRef.current = emitter;
        zoneEventsRef.current = [];

        // Collect all zone events
        const eventTypes = ['zone_enter', 'zone_leave', 'fixation_start', 'fixation_end'] as const;
        eventTypes.forEach(type => {
            emitter.on(type, (event: ZoneEvent) => {
                zoneEventsRef.current.push(event);
            });
        });

        // Register 3×3 grid zones (matches HYBRID_AOI_GRID IDs)
        const initGrid = () => {
            const stimEl = getStimulusElement();
            const rect = stimEl?.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
                const zones = generateGrid(3, 3, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
                zones.forEach(z => registry.register(z.id, z.label, z.rect));
            }
        };
        // Delay slightly to ensure stimulus is laid out
        setTimeout(initGrid, 100);

        // --- V3 probabilistic heatmap initialization ---
        if (V3_HEATMAP_ENABLED) {
            const stimEl = getStimulusElement();
            const stimRect = stimEl?.getBoundingClientRect();
            if (stimRect && stimRect.width > 0) {
                const hm = new ProbabilisticHeatmap(stimRect.width, stimRect.height);
                v3HeatmapRef.current = hm;
                v3InitRectRef.current = { width: stimRect.width, height: stimRect.height, left: stimRect.left, top: stimRect.top };

                // Fit uncertainty ellipses — prefer LOOCV residuals from Ridge diagnostics
                const residuals = calibrationResidualsRef.current;
                const predictor = useMP ? mpGaze.predictorRef.current : null;
                const ridgeDiag = predictor?.diagnostics as {
                    perPoint: Array<{ targetX: number; targetY: number; residualX: number; residualY: number; errorPx: number; cvErrorPx: number | null }>;
                } | null;

                if (ridgeDiag?.perPoint && ridgeDiag.perPoint.length >= 3) {
                    // Build LOOCV residuals: scale in-sample direction to LOOCV magnitude per point
                    const loocvResiduals: LoocvResidual[] = [];
                    for (const pp of ridgeDiag.perPoint) {
                        if (pp.cvErrorPx === null) continue;
                        const inSampleMag = pp.errorPx || 1;
                        const scale = pp.cvErrorPx / inSampleMag;
                        const stimU = stimRect.width > 0 ? (pp.targetX - stimRect.left) / stimRect.width : 0.5;
                        const stimV = stimRect.height > 0 ? (pp.targetY - stimRect.top) / stimRect.height : 0.5;
                        loocvResiduals.push({
                            u: stimU, v: stimV,
                            dx: pp.residualX * scale,
                            dy: pp.residualY * scale,
                        });
                    }
                    v3EllipsesRef.current = loocvResiduals.length >= 3
                        ? fitFromLoocvResiduals(loocvResiduals, residuals)
                        : residuals.length >= 3
                            ? fitFromHybridResiduals(residuals)
                            : [];
                } else {
                    // Fallback: in-sample residuals (BlazeGaze or no diagnostics available)
                    v3EllipsesRef.current = residuals.length >= 3
                        ? fitFromHybridResiduals(residuals)
                        : [];
                }
            }
            v3LastTimeRef.current = Date.now();
            v3LastGazeRef.current = null;
        }

        let raf = 0;
        let lastCollect = 0;
        const loop = () => {
            const [gx, gy] = gazePosRef.current;
            const now = Date.now();
            const stimEl = getStimulusElement();
            const rect = stimEl?.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0 && gaze.gazeState === 'open' && now - lastCollect >= GAZE_POLL_MS) {
                // V1: IDW correction
                const corrected = hybridApplyCalibrationField(
                    gx, gy, rect,
                    calibrationResidualsRef.current,
                    HYBRID_CALIBRATION_FIELD_STRENGTH,
                );
                const videoTime = isVideo && stimulusVideoRef.current ? stimulusVideoRef.current.currentTime : undefined;
                gazePointsRef.current.push({ x: corrected.x, y: corrected.y, t: now, videoTime });

                // V2: feed corrected gaze into zone pipeline (AFTER IDW)
                if (EYE_TRACKING_V2_ENABLED) {
                    const zones = registry.getZones();
                    if (zones.length > 0) {
                        const emotion = undefined;
                        emitter.feed(corrected.x, corrected.y, now, zones, emotion);
                    }
                }

                // V3: feed into probabilistic heatmap (parallel to V2)
                if (V3_HEATMAP_ENABLED && v3HeatmapRef.current && v3EllipsesRef.current.length > 0 && rect) {
                    const dtS = (now - v3LastTimeRef.current) / 1000;
                    v3LastTimeRef.current = now;

                    // Compute velocity from last gaze position
                    const prev = v3LastGazeRef.current;
                    const velocity = prev
                        ? Math.sqrt((corrected.x - prev.x) ** 2 + (corrected.y - prev.y) ** 2)
                        : 0;
                    v3LastGazeRef.current = { x: corrected.x, y: corrected.y };

                    // Compute per-frame uncertainty ellipse
                    const unc = computeFrameUncertainty({
                        gazeX: corrected.x,
                        gazeY: corrected.y,
                        velocity,
                        pitch: useMP ? mpGaze.headPoseRef.current.pitch : 0,
                        yaw: useMP ? mpGaze.headPoseRef.current.yaw : 0,
                        ear: useMP ? mpGaze.earRef.current : 0.28,
                        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    }, v3EllipsesRef.current);

                    // Add sample with stimulus-relative coordinates, rescaled to initial grid dimensions on resize
                    const initRect = v3InitRectRef.current!;
                    const relX = (corrected.x - rect.left) / rect.width;
                    const relY = (corrected.y - rect.top) / rect.height;
                    const stimX = relX * initRect.width;
                    const stimY = relY * initRect.height;
                    if (dtS > 0 && dtS < 1) { // skip first frame (dtS=0) and outlier gaps
                        v3HeatmapRef.current.addSample(stimX, stimY, unc, dtS, undefined, undefined, videoTime);
                    }

                    // Debug info update (~4fps)
                    if (now % 250 < GAZE_POLL_MS) {
                        const grid = v3HeatmapRef.current.getDensityGrid();
                        const mass = grid.data.reduce((s: number, v: number) => s + v, 0);
                        setV3DebugInfo({
                            mass,
                            duration: v3HeatmapRef.current.totalDurationS,
                            sigma1: unc.sigma1,
                            sigma2: unc.sigma2,
                            theta: unc.theta,
                        });
                    }
                }

                lastCollect = now;
            }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        const videoEl = isVideo ? stimulusVideoRef.current : null;
        return () => {
            cancelAnimationFrame(raf);
            if (hasEmotionRecognition) faceEmotions.stop();
            if (videoEl) videoEl.pause();
            emitter.destroy();
            registry.destroy();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable RAF loop; live gaze.* reads via ref
    }, [phase, hasEmotionRecognition, isVideo]);

    // Micro-recalibration: periodic drift correction during viewing
    useEffect(() => {
        if (phase !== 'viewing') return;

        const probeTimer = setInterval(() => {
            // Pick next position from the pool (round-robin)
            const idx = microProbeIndexRef.current % MICRO_RECALIB_POSITIONS.length;
            microProbeIndexRef.current += 1;
            const [pctX, pctY] = MICRO_RECALIB_POSITIONS[idx];
            const u = pctX / 100;
            const v = pctY / 100;

            // Show micro-dot and start collecting gaze samples
            microGazeSamplesRef.current = [];
            setMicroDot({ u, v });

            // Collect gaze samples during the probe window
            let sampleRaf = 0;
            let samplesCollected = 0;
            const collectLoop = () => {
                if (samplesCollected >= MICRO_RECALIB_SAMPLE_COUNT) return;
                const [gx, gy] = gazePosRef.current;
                if (gaze.gazeState === 'open') {
                    microGazeSamplesRef.current.push({ x: gx, y: gy });
                    samplesCollected++;
                }
                sampleRaf = requestAnimationFrame(collectLoop);
            };
            sampleRaf = requestAnimationFrame(collectLoop);

            // After sample duration, compute drift and update correction field
            setTimeout(() => {
                cancelAnimationFrame(sampleRaf);
                setMicroDot(null);

                const samples = microGazeSamplesRef.current;
                if (samples.length < 3) return; // not enough data

                // Average gaze position during probe
                let sumX = 0, sumY = 0;
                for (const s of samples) { sumX += s.x; sumY += s.y; }
                const avgX = sumX / samples.length;
                const avgY = sumY / samples.length;

                // Get stimulus rect
                const stimEl = getStimulusElement();
                const rect = stimEl?.getBoundingClientRect();
                if (!rect || rect.width <= 0) return;

                const residual = computeMicroRecalibResidual(u, v, avgX, avgY, rect);
                if (residual) {
                    calibrationResidualsRef.current = [
                        ...calibrationResidualsRef.current,
                        residual,
                    ];
                }
            }, MICRO_RECALIB_SAMPLE_DURATION_MS);
        }, MICRO_RECALIB_INTERVAL_MS);

        return () => clearInterval(probeTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable timer; reads refs
    }, [phase, isVideo]);

    // Countdown timer during viewing phase
    useEffect(() => {
        if (phase !== 'viewing') return;

        const interval = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        const timeout = setTimeout(() => {
            // Snapshot stimulus rect before transitioning to complete (which hides the stimulus)
            const stimEl = getStimulusElement();
            if (stimEl) {
                viewingRectRef.current = stimEl.getBoundingClientRect();
            }
            setFinalPointCount(gazePointsRef.current.length);
            setPhase('complete');
        }, viewingDuration);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getStimulusElement reads refs only, stable
    }, [phase, viewingDuration]);

    useEffect(() => {
        if (phase !== 'setup') return;
        void startCamera();
    }, [phase, startCamera]);

    // "Preparing" phase: start camera + auto-advance
    // If cached calibration exists, skip to viewing; otherwise go to calibration.
    useEffect(() => {
        if (phase !== 'preparing') return;

        void startCamera();

        if (cachedCalibration) {
            gaze.start();
            const timer = setTimeout(() => {
                gazePointsRef.current = [];
                setTimeLeft(Math.ceil(viewingDuration / 1000));
                setPhase('viewing');
            }, 1500);
            return () => clearTimeout(timer);
        }

        const timer = setTimeout(() => {
            setCalibrationIndex(0);
            calibrationResidualsRef.current = [];
            calibrationRmsePxRef.current = null;
            setPhase('calibration');
        }, 2000);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gaze is unstable object literal; reads via ref
    }, [phase, startCamera, cachedCalibration, blaze, viewingDuration]);

    // Start BlazeGaze early in quality-gate so face detection check can use gazeState
    useEffect(() => {
        if (phase !== 'quality-gate') return;
        gaze.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gaze is unstable object literal; reads via ref
    }, [phase, blaze]);

    // Run gaze engine during calibration (gaze samples for IDW residuals) and through viewing
    useEffect(() => {
        if (phase !== 'calibration') return;
        gaze.start();

        // Check capture resolution after a short delay for frames to arrive
        const resCheckTimer = setTimeout(() => {
            const stats = gaze.getFrameStats();
            if (stats.captureWidthPx && stats.captureHeightPx) {
                if (isBlazeGazeCaptureResolutionLow(stats.captureWidthPx, stats.captureHeightPx)) {
                    setLowResWarning(true);
                }
            }
        }, 2000);
        return () => clearTimeout(resCheckTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gaze is unstable object literal; reads via ref
    }, [phase, blaze]);

    // Save results when complete
    useEffect(() => {
        if (phase === 'complete' && !savedRef.current) {
            savedRef.current = true;

            gaze.stop();
            faceEmotions.stop();
            stopCamera();

            // Compute zone-based heatmap (same approach as /eye-tracking-hybrid)
            const zoneMass: Record<string, number> = {};
            HYBRID_AOI_GRID.forEach(z => { zoneMass[z.id] = 0; });

            const stimEl = getStimulusElement();
            const liveRect = stimEl?.getBoundingClientRect();
            const rect = (liveRect && liveRect.width > 0) ? liveRect : viewingRectRef.current;
            const natW = isShelf
                ? (naturalSizeRef.current?.w || rect?.width || 1)
                : isVideo
                    ? (stimulusVideoRef.current?.videoWidth || 1)
                    : (naturalSizeRef.current?.w || imgRef.current?.naturalWidth || 1);
            const natH = isShelf
                ? (naturalSizeRef.current?.h || rect?.height || 1)
                : isVideo
                    ? (stimulusVideoRef.current?.videoHeight || 1)
                    : (naturalSizeRef.current?.h || imgRef.current?.naturalHeight || 1);

            const residuals = calibrationResidualsRef.current;
            const effectiveRect = rect ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);

            // Gap fill: interpolate missing gaze during blinks/drops (same as hybrid page)
            const expanded = expandGazeWithMinimumJerkGapFill(gazePointsRef.current);

            // Zone mass from expanded gaze points with calibration confidence
            for (const pt of expanded) {
                const u = effectiveRect.width > 0 ? (pt.x - effectiveRect.left) / effectiveRect.width : 0;
                const v = effectiveRect.height > 0 ? (pt.y - effectiveRect.top) / effectiveRect.height : 0;
                const baseConf = hybridCalibrationConfidenceWeightUv(u, v, residuals);
                const conf = pt.interpolated ? baseConf * HYBRID_GAP_FILL_SYNTHETIC_WEIGHT : baseConf;
                const soft = hybridPointToSoftZoneWeights(pt.x, pt.y, effectiveRect);
                for (const z of HYBRID_AOI_GRID) {
                    zoneMass[z.id] += soft[z.id] * conf;
                }
            }

            // I-DT fixations for backward compatibility
            const viewportFixations = detectFixationsIDT(gazePointsRef.current);
            const finalFixations: Fixation[] = effectiveRect.width > 0 && effectiveRect.height > 0
                ? mapFixationsToImageCoords(viewportFixations, effectiveRect, natW, natH)
                : viewportFixations;
            const calibrationQuality = `blazegaze-${gaze.calibrationCount}pt`;

            // --- Build response payload ---
            // V1 payload (backward compat, always included)
            const v1Payload = {
                fixations: finalFixations.map(f => ({
                    x: f.x,
                    y: f.y,
                    duration: f.duration,
                    timestamp: f.timestamp,
                })),
                zoneMass,
                calibrationQuality,
                integrityScore: Math.min(gazePointsRef.current.length / 100, 1.0),
                trackingMethod: useMP ? 'mediapipe-ridge' : 'blazegaze',
                deviceType,
                gazePointCount: gazePointsRef.current.length,
                fixationCount: finalFixations.length,
                fixationMethod: 'idt',
                gazePipeline: 'hybrid-zone-idt',
                calibrationRmsePx: calibrationRmsePxRef.current,
                validationRmsePx: validationRmse,
                emotions: hasEmotionRecognition ? faceEmotions.getSamples() : undefined,
                microExpressions: hasEmotionRecognition ? detectMicroExpressions(faceEmotions.getSamples()) : undefined,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                stimulusType: isShelf ? 'shelf' : isVideo ? 'video' : 'image',
                ...(isVideo && { videoEnded: videoEndedRef.current }),
                ...(isShelf && { displayMode, shelfCount, shelfItems, stimulusCount: resolvedShelfUrls.length }),
                gazeTimeline: isVideo ? gazePointsRef.current.map(p => ({
                    x: p.x, y: p.y, t: p.t, videoTime: p.videoTime,
                })) : undefined,
            };

            // V2 zone-event response (when enabled, alongside V1 for backward compat)
            let v2Payload = undefined;
            if (EYE_TRACKING_V2_ENABLED && zoneRegistryRef.current) {
                const profile = getCurrentDeviceProfile();
                const zones = zoneRegistryRef.current.getZones();
                v2Payload = buildV2Response({
                    events: zoneEventsRef.current,
                    zones,
                    calibration: {
                        method: 'dwell-13pt-idw',
                        rmsePx: calibrationRmsePxRef.current ?? 0,
                        pointCount: HYBRID_IMAGE_CALIBRATION_POINTS.length,
                        persistent: !!cachedCalibration,
                    },
                    metadata: {
                        trackingMethod: useMP ? 'mediapipe-ridge-v2' : 'blazegaze-v2',
                        deviceType,
                        uncertaintyRadius: profile.uncertaintyRadius,
                        hysteresisMs: profile.hysteresisMs,
                        gazeSampleCount: gazePointsRef.current.length,
                        pipeline: 'zone-event-v2',
                    },
                });
            }

            // V3 probabilistic heatmap payload (when enabled)
            let v3Payload = undefined;
            if (V3_HEATMAP_ENABLED && v3HeatmapRef.current) {
                const hm = v3HeatmapRef.current;
                const grid = hm.getDensityGrid();
                const aoiMetrics = hm.getAOIMetrics();
                const totalMass = grid.data.reduce((s: number, v: number) => s + v, 0);

                const confidence = computeSessionConfidence(
                    gazePointsRef.current.length > 0 ? 1.0 : 0, // ponytail: simplified valid ratio
                    calibrationRmsePxRef.current ?? null,
                    0, // ponytail: avg head rotation not tracked yet
                    hm.totalDurationS,
                );
                confidence.spatialCoverage = computeSpatialCoverage(grid);

                // Temporal grids (video only)
                const temporalData = hm.hasTemporalData ? {
                    firstAttentionBase64: btoa(String.fromCharCode(...new Uint8Array(hm.getFirstAttentionGrid().buffer))),
                    peakTimeBase64: btoa(String.fromCharCode(...new Uint8Array(hm.getPeakTimeGrid().buffer))),
                } : undefined;

                v3Payload = {
                    version: 3,
                    heatmap: {
                        cols: grid.cols,
                        rows: grid.rows,
                        cellW: grid.cellW,
                        cellH: grid.cellH,
                        // Encode density as base64 for compact JSON transport
                        densityBase64: btoa(String.fromCharCode(...new Uint8Array(grid.data.buffer))),
                        ...temporalData,
                    },
                    aoiMetrics,
                    totalMassS: totalMass,
                    totalDurationS: hm.totalDurationS,
                    massError: Math.abs(totalMass - hm.totalDurationS),
                    confidence,
                    ellipses: v3EllipsesRef.current.map(e => ({
                        u: e.u, v: e.v,
                        sigma1: Math.round(e.sigma1),
                        sigma2: Math.round(e.sigma2),
                        thetaDeg: Math.round(e.theta * 180 / Math.PI),
                    })),
                    pipeline: 'probabilistic-heatmap-v3',
                };
            }

            const responseValue = JSON.stringify({
                ...v1Payload,
                ...(v2Payload ? { v2: v2Payload } : {}),
                ...(v3Payload ? { v3: v3Payload } : {}),
            });
            saveResponse(module.id, 'eye-tracking-data', responseValue);

            completeTimerRef.current = window.setTimeout(() => {
                onComplete?.();
            }, 1200);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getStimulusElement/fixations.length read refs; additional props are stable at phase=complete
    }, [phase, module.id, saveResponse, onComplete, blaze, stopCamera, deviceType, displayMode, faceEmotions, hasEmotionRecognition, isShelf, isVideo, resolvedShelfUrls.length, shelfCount, shelfItems]);

    const handleImageLoad = useCallback(() => {
        if (imgRef.current) {
            const size = {
                w: imgRef.current.naturalWidth,
                h: imgRef.current.naturalHeight,
            };
            naturalSizeRef.current = size;
        }
    }, []);

    const handleVideoLoadedMetadata = useCallback(() => {
        if (stimulusVideoRef.current) {
            const v = stimulusVideoRef.current;
            naturalSizeRef.current = { w: v.videoWidth, h: v.videoHeight };
        }
    }, []);

    const handleVideoEnded = useCallback(() => {
        videoEndedRef.current = true;
    }, []);

    /** Returns the bounding-rect source element for the current mode. */
    const getStimulusElement = useCallback((): HTMLElement | null => {
        if (isShelf) return shelfContainerRef.current;
        if (isVideo) return stimulusVideoRef.current;
        return imgRef.current;
    }, [isShelf, isVideo]);

    const handleShelfAllLoaded = useCallback(() => {
        if (shelfContainerRef.current) {
            const rect = shelfContainerRef.current.getBoundingClientRect();
            const size = { w: Math.round(rect.width), h: Math.round(rect.height) };
            naturalSizeRef.current = size;
        }
    }, []);

    // --- Dwell-based calibration (Fase B) ---
    // Desktop: auto-advance after 1.5s of stable gaze near the calibration dot.
    // Collects gaze samples during the dwell and calls gaze.calibrate() multiple times.
    // Mobile: falls back to single click.

    /** Dwell detection threshold (ms) — dot disappears after this duration of stable fixation. */
    const DWELL_THRESHOLD_MS = 1000;
    /** Number of gaze.calibrate() calls per point (averaged gaze during dwell). */
    const CALIBRATE_CALLS_PER_POINT = 3;
    /** Max distance (px) from dot to accept gaze as "looking at dot".
     *  Generous: webcam jitter is ~80-120px, so 280px allows natural noise. */
    const DWELL_PROXIMITY_PX = 280;
    /** Grace period (ms) — gaze can leave proximity briefly without resetting dwell.
     *  Absorbs blink/jitter spikes that would otherwise break the dwell timer. */
    const DWELL_GRACE_MS = 250;

    const dwellStartRef = useRef<number | null>(null);
    const dwellSamplesRef = useRef<{ x: number; y: number }[]>([]);
    const dwellTimerRef = useRef(0);
    /** Timestamp when gaze last left proximity (null = currently inside). */
    const dwellExitTimeRef = useRef<number | null>(null);

    const getCalibrationDot = (idx: number) => {
        const rect = calibrationAreaRef.current?.getBoundingClientRect();
        const point = HYBRID_IMAGE_CALIBRATION_POINTS[idx];
        if (!rect || rect.width <= 0 || !point) return null;
        const [ipx, ipy] = point;
        return { rect, ipx, ipy, x: rect.left + (ipx / 100) * rect.width, y: rect.top + (ipy / 100) * rect.height };
    };

    const recordCalibrationPoint = (idx: number, avgX: number, avgY: number) => {
        const dot = getCalibrationDot(idx);
        if (!dot) return;
        calibrationResidualsRef.current.push({
            u: dot.ipx / 100,
            v: dot.ipy / 100,
            dx: dot.x - avgX,
            dy: dot.y - avgY,
        });

        if (useMP) {
            gaze.calibrate(dot.x, dot.y);
        } else {
            const [normX, normY] = hybridImagePercentToBlazeNorm(dot.rect, dot.ipx, dot.ipy, window.innerWidth, window.innerHeight);
            for (let c = 0; c < CALIBRATE_CALLS_PER_POINT; c++) {
                gaze.calibrate(normX, normY);
            }
        }

        if (idx + 1 < HYBRID_IMAGE_CALIBRATION_POINTS.length) {
            setCalibrationIndex(idx + 1);
            return;
        }

        const afterTrain = () => {
            calibrationRmsePxRef.current = hybridCalibrationRmsePx(calibrationResidualsRef.current);
            if (!isPreviewMode) {
                setTimeout(() => setPhase('validating'), 400);
                return;
            }
            saveCalibrationToSession(module.id, calibrationResidualsRef.current, calibrationRmsePxRef.current);
            gazePointsRef.current = [];
            setTimeLeft(Math.ceil(viewingDuration / 1000));
            setTimeout(() => setPhase('viewing'), 600);
        };
        if (useMP && gaze.trainRidge) {
            gaze.trainRidge().then(afterTrain);
        } else {
            afterTrain();
        }
    };

    // Dwell loop during calibration: auto-advance after stable gaze near the dot
    useEffect(() => {
        if (phase !== 'calibration') return;

        dwellStartRef.current = null;
        dwellSamplesRef.current = [];
        dwellExitTimeRef.current = null;

        const loop = () => {
            const dot = getCalibrationDot(calibrationIndex);
            if (!dot) { dwellTimerRef.current = requestAnimationFrame(loop); return; }

            const [gx, gy] = gazePosRef.current;
            const dist = Math.sqrt((gx - dot.x) ** 2 + (gy - dot.y) ** 2);
            const now = performance.now();

            if (dist <= DWELL_PROXIMITY_PX && gaze.gazeState === 'open') {
                dwellExitTimeRef.current = null;

                if (dwellStartRef.current === null) {
                    dwellStartRef.current = now;
                    dwellSamplesRef.current = [];
                }
                dwellSamplesRef.current.push({ x: gx, y: gy });

                if (now - dwellStartRef.current >= DWELL_THRESHOLD_MS) {
                    const samples = dwellSamplesRef.current;
                    const avgX = samples.reduce((sum, p) => sum + p.x, 0) / samples.length;
                    const avgY = samples.reduce((sum, p) => sum + p.y, 0) / samples.length;
                    dwellStartRef.current = null;
                    dwellSamplesRef.current = [];
                    recordCalibrationPoint(calibrationIndex, avgX, avgY);
                    return;
                }
            } else if (dwellStartRef.current !== null) {
                if (dwellExitTimeRef.current === null) {
                    dwellExitTimeRef.current = now;
                } else if (now - dwellExitTimeRef.current > DWELL_GRACE_MS) {
                    dwellStartRef.current = null;
                    dwellSamplesRef.current = [];
                    dwellExitTimeRef.current = null;
                }
            }

            dwellTimerRef.current = requestAnimationFrame(loop);
        };

        dwellTimerRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(dwellTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable RAF loop
    }, [phase, calibrationIndex, blaze, viewingDuration, isPreviewMode]);

    /** Tap/click on a calibration point trains the model with the current gaze, same as a completed dwell. */
    const handleCalibrationClick = () => {
        if (phase !== 'calibration' || gaze.gazeState !== 'open') return;
        cancelAnimationFrame(dwellTimerRef.current);
        const [gx, gy] = gazePosRef.current;
        recordCalibrationPoint(calibrationIndex, gx, gy);
    };

    // Toggle a setup checkbox
    const toggleCheck = useCallback((index: number) => {
        setChecks(prev => {
            const next = [...prev];
            next[index] = !next[index];
            return next;
        });
    }, []);

    // --- 5-point validation with dwell detection (Fase C) ---
    const VALIDATION_DWELL_MS = 800;
    const VALIDATION_PROXIMITY_PX = 280;
    const VALIDATION_GRACE_MS = 250;
    const validationDwellStartRef = useRef<number | null>(null);
    const validationDwellSamplesRef = useRef<{ x: number; y: number }[]>([]);
    const validationRafRef = useRef(0);
    const validationExitTimeRef = useRef<number | null>(null);

    // Desktop dwell loop for validation points
    useEffect(() => {
        if (phase !== 'validating') return;
        if (validationRmse !== null) return; // all points measured, showing result

        validationDwellStartRef.current = null;
        validationDwellSamplesRef.current = [];
        validationExitTimeRef.current = null;

        const loop = () => {
            const el = getStimulusElement();
            if (!el) { validationRafRef.current = requestAnimationFrame(loop); return; }
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0) { validationRafRef.current = requestAnimationFrame(loop); return; }

            const idx = validationIndex;
            if (idx >= HYBRID_VALIDATION_POINTS.length) return;

            const [vpx, vpy] = HYBRID_VALIDATION_POINTS[idx];
            const dotX = rect.left + (vpx / 100) * rect.width;
            const dotY = rect.top + (vpy / 100) * rect.height;
            const [gx, gy] = gazePosRef.current;
            const dist = Math.sqrt((gx - dotX) ** 2 + (gy - dotY) ** 2);
            const now = performance.now();

            if (dist <= VALIDATION_PROXIMITY_PX && gaze.gazeState === 'open') {
                validationExitTimeRef.current = null;

                if (validationDwellStartRef.current === null) {
                    validationDwellStartRef.current = now;
                    validationDwellSamplesRef.current = [];
                }
                validationDwellSamplesRef.current.push({ x: gx, y: gy });

                const elapsed = now - validationDwellStartRef.current;
                if (elapsed >= VALIDATION_DWELL_MS) {
                    // Dwell complete — measure error for this point
                    const samples = validationDwellSamplesRef.current;
                    let avgX = 0, avgY = 0;
                    for (const s of samples) { avgX += s.x; avgY += s.y; }
                    avgX /= samples.length;
                    avgY /= samples.length;

                    const errorPx = Math.round(Math.sqrt((dotX - avgX) ** 2 + (dotY - avgY) ** 2));
                    const newErrors = [...validationPointErrors, errorPx];
                    setValidationPointErrors(newErrors);

                    validationDwellStartRef.current = null;
                    validationDwellSamplesRef.current = [];
                    validationExitTimeRef.current = null;

                    if (idx + 1 >= HYBRID_VALIDATION_POINTS.length) {
                        // All 5 points measured — compute average RMSE
                        const sumSq = newErrors.reduce((s, e) => s + e * e, 0);
                        const rmse = Math.round(Math.sqrt(sumSq / newErrors.length));
                        setValidationRmse(rmse);

                        if (rmse <= HYBRID_RECALIBRATION_RMSE_THRESHOLD_PX) {
                            // Passed — auto-proceed to viewing
                            saveCalibrationToSession(module.id, calibrationResidualsRef.current, calibrationRmsePxRef.current);
                            if (blaze) gaze.resetFrameStats();
                            gazePointsRef.current = [];
                            setTimeLeft(Math.ceil(viewingDuration / 1000));
                            setTimeout(() => setPhase('viewing'), 800);
                        }
                        // else: UI will show recalibrate/reject options
                    } else {
                        setValidationIndex(idx + 1);
                    }
                    return;
                }
            } else {
                // Grace period — don't reset instantly on jitter
                if (validationDwellStartRef.current !== null) {
                    if (validationExitTimeRef.current === null) {
                        validationExitTimeRef.current = now;
                    } else if (now - validationExitTimeRef.current > VALIDATION_GRACE_MS) {
                        validationDwellStartRef.current = null;
                        validationDwellSamplesRef.current = [];
                        validationExitTimeRef.current = null;
                    }
                }
            }

            validationRafRef.current = requestAnimationFrame(loop);
        };

        validationRafRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(validationRafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable RAF loop
    }, [phase, validationIndex, validationRmse, blaze, viewingDuration, validationPointErrors]);

    const handleValidationDwellComplete = useCallback(() => {
        if (phase !== 'validating') return;
        const newErrors = [...validationPointErrors, 0];
        setValidationPointErrors(newErrors);
        if (validationIndex + 1 >= HYBRID_VALIDATION_POINTS.length) {
            setValidationRmse(0);
            saveCalibrationToSession(module.id, calibrationResidualsRef.current, calibrationRmsePxRef.current);
            gazePointsRef.current = [];
            setTimeLeft(Math.ceil(viewingDuration / 1000));
            setTimeout(() => setPhase('viewing'), 600);
        } else {
            setValidationIndex(validationIndex + 1);
        }
    }, [phase, validationIndex, validationPointErrors, viewingDuration, module.id]);

    /** Re-calibrate: reset residuals and go back to calibration phase.
     *  Increments recalibrationCount so auto-retry offer stops after 2 attempts. */
    const handleRecalibrate = useCallback(() => {
        recalibrationCountRef.current += 1;
        calibrationResidualsRef.current = [];
        calibrationRmsePxRef.current = null;
        setCalibrationIndex(0);
        setValidationIndex(0);
        setValidationPointErrors([]);
        setValidationRmse(null);
        setPhase('calibration');
    }, []);

    /** Skip validation and proceed to viewing (user chose to continue despite poor accuracy). */
    const handleSkipValidation = useCallback(() => {
        saveCalibrationToSession(module.id, calibrationResidualsRef.current, calibrationRmsePxRef.current);
        if (blaze) gaze.resetFrameStats();
        gazePointsRef.current = [];
        setTimeLeft(Math.ceil(viewingDuration / 1000));
        setValidationIndex(0);
        setValidationPointErrors([]);
        setValidationRmse(null);
        setTimeout(() => setPhase('viewing'), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gaze is unstable object literal
    }, [blaze, viewingDuration]);

    /** Reject session — session quality too low after max attempts. */
    const handleRejectSession = useCallback(() => {
        gaze.stop();
        faceEmotions.stop();
        stopCamera();
        onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gaze/faceEmotions are unstable object literals
    }, [blaze, stopCamera, onComplete]);

    // -----------------------------------------------------------------------
    // Unconfigured
    // -----------------------------------------------------------------------

    if (!stimulusUrl && resolvedShelfUrls.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] px-4">
                {hasUploadError ? (
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
                            <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                        </div>
                        <p className="text-gray-500 text-center text-sm">
                            {t('eyeTracking.uploadError', 'The stimulus image could not be loaded. Please contact the researcher.')}
                        </p>
                    </div>
                ) : (
                    <p className="text-gray-400 text-center">
                        {t('eyeTracking.notConfigured', 'This eye tracking test has not been configured yet.')}
                    </p>
                )}
            </div>
        );
    }

    // -----------------------------------------------------------------------
    // Main render — persistent <video> + phase content
    // -----------------------------------------------------------------------

    const shelfConfig = isShelf && resolvedShelfUrls.length > 0
        ? { shelfCount, shelfItems, repetitions: shelfRepetitions, urls: resolvedShelfUrls, containerRef: shelfContainerRef, onAllLoaded: handleShelfAllLoaded, rotationInterval: randomizeStimuli ? shelfRotationInterval : 0 }
        : null;

    let phaseContent: React.ReactNode = null;

    if (phase === 'intro') {
        phaseContent = (
            <IntroPhase
                taskDescription={taskDescription}
                isBlazeLoaded={gaze.isLoaded}
                onNext={() => setPhase('setup')}
            />
        );
    } else if (phase === 'setup') {
        phaseContent = (
            <SetupPhase
                checks={checks}
                allChecked={allChecked}
                onToggleCheck={toggleCheck}
                onReady={() => setPhase('quality-gate')}
                cameraRef={videoRef}
            />
        );
    } else if (phase === 'quality-gate') {
        phaseContent = (
            <SessionQualityGate
                cameraRef={videoRef}
                gazeActive={gaze.gazeState === 'open'}
                faceConfidence={mpGaze.lastLandmarksRef.current ? (mpGaze.gazeState === 'open' ? 1.0 : 0.85) : 0}
                headPoseRef={mpGaze.headPoseRef}
                earRef={mpGaze.earRef}
                landmarksRef={mpGaze.lastLandmarksRef}
                frameStatsGetter={mpGaze.getFrameStats}
                onPass={() => setPhase('preparing')}
                onReject={() => setPhase('preparing')}
            />
        );
    } else if (phase === 'preparing') {
        phaseContent = (
            <PreparingPhase />
        );
    } else if (phase === 'calibration') {
        phaseContent = (
            <>
                {lowResWarning && (
                    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2 rounded-lg shadow-md">
                        Low camera resolution detected — accuracy may be reduced
                    </div>
                )}
                <CalibrationPhase
                    calibrationIndex={calibrationIndex}
                    isDesktop={isDesktop}
                    resolvedUrl={resolvedUrl}
                    imgRef={imgRef}
                    onCalibrationClick={handleCalibrationClick}
                    onImageLoad={handleImageLoad}
                    shelfConfig={shelfConfig}
                    cameraRef={videoRef}
                    calibrationAreaRef={calibrationAreaRef}
                />
            </>
        );
    } else if (phase === 'validating') {
        phaseContent = (
            <ValidationPhase
                validationIndex={validationIndex}
                validationRmse={validationRmse}
                pointErrors={validationPointErrors}
                recalibrationCount={recalibrationCountRef.current}
                resolvedUrl={resolvedUrl}
                imgRef={imgRef}
                onValidationDwellComplete={handleValidationDwellComplete}
                onRecalibrate={handleRecalibrate}
                onSkipValidation={handleSkipValidation}
                onRejectSession={handleRejectSession}
                onImageLoad={handleImageLoad}
                shelfConfig={shelfConfig}
            />
        );
    } else if (phase === 'viewing') {
        phaseContent = (
            <>
            <ViewingPhase
                isVideo={isVideo}
                resolvedUrl={resolvedUrl}
                viewingDuration={viewingDuration}
                timeLeft={timeLeft}
                microDot={microDot}
                imgRef={imgRef}
                stimulusVideoRef={stimulusVideoRef}
                containerRef={containerRef}
                onImageLoad={handleImageLoad}
                onVideoLoadedMetadata={handleVideoLoadedMetadata}
                onVideoEnded={handleVideoEnded}
                shelfConfig={shelfConfig}
            />
            {/* V3 debug overlay */}
            {V3_HEATMAP_ENABLED && v3DebugInfo && (
                <div className="fixed bottom-4 left-4 z-50 bg-black/80 text-white text-[10px] font-mono rounded-lg p-2 flex flex-col gap-0.5 pointer-events-none">
                    <span>V3 heatmap</span>
                    <span>mass: <strong className={Math.abs(v3DebugInfo.mass - v3DebugInfo.duration) < v3DebugInfo.duration * 0.05 ? 'text-green-400' : 'text-red-400'}>{v3DebugInfo.mass.toFixed(2)}s</strong> / {v3DebugInfo.duration.toFixed(2)}s</span>
                    <span>σ: {v3DebugInfo.sigma1.toFixed(0)}×{v3DebugInfo.sigma2.toFixed(0)}px θ={Math.round(v3DebugInfo.theta * 180 / Math.PI)}°</span>
                    <span>err: {Math.abs(v3DebugInfo.mass - v3DebugInfo.duration).toFixed(3)}s ({v3DebugInfo.duration > 0 ? (Math.abs(v3DebugInfo.mass - v3DebugInfo.duration) / v3DebugInfo.duration * 100).toFixed(1) : 0}%)</span>
                </div>
            )}
            </>
        );
    } else if (phase === 'complete') {
        phaseContent = (
            <CompletePhase
                finalPointCount={finalPointCount}
            />
        );
    }

    return (
        <>
            {/* Persistent hidden video — never unmounts across phases */}
            <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
            {phaseContent}
        </>
    );
};
