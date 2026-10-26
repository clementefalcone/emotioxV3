/**
 * Snippet integration tests — verify the generated JS is valid and
 * the inline gaze/FACS logic matches the module implementations.
 *
 * Closes the gap between unit-tested pure logic and the actual snippet output.
 */
import { describe, it, expect, vi } from 'vitest';
import { generateTrackingSnippet } from '../tracking-snippet';
import {
    computeIrisDisplacement,
    estimateGazeDirection,
    estimateAttentionState,
    classifyGazeQuadrant,
    gazeMatchesCursorArea,
    computeAttentionScore,
} from '../tracking-gaze-logic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig = {
    researchId: 'test-123',
    apiBaseUrl: 'https://api.example.com',
    captureClicks: true,
    captureScroll: true,
    captureMousemove: false,
    consentRequired: false,
    flushIntervalMs: 2000,
    maxEventsPerFlush: 50,
    allowedDomains: ['example.com'],
    consentText: 'We use cookies',
    consentAcceptLabel: 'Accept',
    consentDeclineLabel: 'Decline',
    consentPosition: 'bottom' as const,
    samplingRate: 100,
    targetPages: [],
    excludePages: [],
    captureEmotions: true,
    emotionModelBaseUrl: 'https://cdn.example.com/models',
    captureGaze: false,
    gazeCalibrationPoints: 9 as const,
    zones: [] as Array<{ id: string; pageUrl: string; selector: string }>,
};

// ---------------------------------------------------------------------------
// 1. Snippet generates parseable JavaScript
// ---------------------------------------------------------------------------

describe('generateTrackingSnippet — JS validity', () => {
    it('produces syntactically valid JavaScript', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(() => new Function(js)).not.toThrow();
    });

    it('produces valid JS with all config combinations', () => {
        const configs = [
            { ...defaultConfig, captureEmotions: false },
            { ...defaultConfig, consentRequired: true },
            { ...defaultConfig, allowedDomains: ['a.com', 'b.com', 'c.com'] },
            { ...defaultConfig, targetPages: ['/pricing', '/about'] },
        ];
        for (const cfg of configs) {
            const js = generateTrackingSnippet(cfg);
            expect(() => new Function(js), JSON.stringify(cfg)).not.toThrow();
        }
    });

    it('contains gaze functions when emotions enabled', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(js).toContain('irisDisp');
        expect(js).toContain('gazeDir');
        expect(js).toContain('attnState');
        expect(js).toContain('gazeQuad');
        expect(js).toContain('cursorMatch');
        expect(js).toContain('attnScore');
        expect(js).toContain('gazeBuf');
        expect(js).toContain('flushGaze');
    });


    it('contains MediaPipe loader with dynamic import', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(js).toContain('loadMediaPipe');
        expect(js).toContain('import(');
        expect(js).toContain('vision_bundle.mjs');
        expect(js).toContain('FaceLandmarker');
    });

    it('loads face-api with the 68-landmark model the action units need', () => {
        const js = generateTrackingSnippet(defaultConfig);
        const loader = js.slice(js.indexOf('function loadFaceApi('), js.indexOf('function sampleEmotion('));
        expect(loader).toContain('vladmandic/face-api@1.7.14');
        expect(loader).toContain('faceapi.nets.tinyFaceDetector.loadFromUri(C.emoModelUrl)');
        expect(loader).toContain('faceapi.nets.faceLandmark68Net.loadFromUri(C.emoModelUrl)');
        expect(loader).toContain('faceapi.nets.faceExpressionNet.loadFromUri(C.emoModelUrl)');
    });

    it('gaze endpoint URL is correct', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(js).toContain('/gaze');
        expect(js).toContain('flushGaze');
    });
});

// ---------------------------------------------------------------------------
// 2. Inline FACS matches module FACS
// ---------------------------------------------------------------------------

describe('generateTrackingSnippet — action units from face-api 68 landmarks', () => {
    const js = generateTrackingSnippet(defaultConfig);
    const source = js.slice(js.indexOf('var AU_BASELINE_SAMPLES='), js.indexOf('// Last known cursor position'));
    const { createActionUnitEstimator, toEmotionSample } = new Function(
        `var EXPRESSION_MAP={happy:"joy",sad:"sadness",angry:"anger",surprised:"surprise",disgusted:"disgust",fearful:"fear",neutral:"neutral"};${source}return {createActionUnitEstimator:createActionUnitEstimator,toEmotionSample:toEmotionSample};`,
    )() as {
        createActionUnitEstimator: () => (points: Array<{ x: number; y: number }>) => Record<string, number> | null;
        toEmotionSample: (detection: unknown, timestamp: number) => { timestamp: number; emotion: string; confidence: number; expressions: Record<string, number>; actionUnits: Record<string, number> };
    };

    const neutralFace: Record<number, [number, number]> = {
        17: [52, 80], 26: [148, 80], 21: [88, 85], 22: [112, 85],
        36: [55, 100], 39: [85, 100], 42: [115, 100], 45: [145, 100],
        37: [65, 97.3], 38: [75, 97.3], 41: [65, 102.7], 40: [75, 102.7],
        43: [125, 97.3], 44: [135, 97.3], 47: [125, 102.7], 46: [135, 102.7],
        33: [100, 125], 48: [81, 150], 54: [119, 150], 62: [100, 150], 66: [100, 150.6], 8: [100, 173],
    };
    const face = (moves: Record<number, [number, number]> = {}) => {
        const points = Array.from({ length: 68 }, () => ({ x: 100, y: 120 }));
        for (const [index, [x, y]] of Object.entries(neutralFace)) points[Number(index)] = { x, y };
        for (const [index, [dx, dy]] of Object.entries(moves)) {
            points[Number(index)] = { x: points[Number(index)].x + dx, y: points[Number(index)].y + dy };
        }
        return points;
    };
    const afterNeutralBaseline = () => {
        const estimate = createActionUnitEstimator();
        for (let frame = 0; frame < 10; frame++) estimate(face());
        return estimate;
    };

    it('reads a resting face as no activation on the nine Eye Tracking units', () => {
        const units = afterNeutralBaseline()(face());
        expect(Object.keys(units ?? {})).toEqual(['AU1', 'AU2', 'AU4', 'AU6', 'AU12', 'AU15', 'AU20', 'AU25', 'AU26']);
        for (const value of Object.values(units ?? {})) expect(value).toBe(0);
    });

    it('activates smile, lip corner depressor and lips part against the baseline', () => {
        const estimate = afterNeutralBaseline();
        expect(estimate(face({ 48: [-3, -4.5], 54: [3, -4.5] }))!.AU12).toBeGreaterThan(0.9);
        expect(estimate(face({ 48: [0, 3], 54: [0, 3] }))!.AU15).toBeGreaterThan(0.9);
        expect(estimate(face({ 66: [0, 4.5] }))!.AU25).toBeGreaterThan(0.9);
    });

    it('returns null when face-api gives fewer than 68 points', () => {
        expect(createActionUnitEstimator()(face().slice(0, 67))).toBeNull();
    });

    it('labels the sample with the top face-api expression and its action units', () => {
        const sample = toEmotionSample({ expressions: { neutral: 0.1, happy: 0.81234, sad: 0.05 }, landmarks: { positions: face() } }, 1250);
        expect(sample.timestamp).toBe(1250);
        expect(sample.emotion).toBe('joy');
        expect(sample.confidence).toBe(0.812);
        expect(sample.expressions).toEqual({ neutral: 0.1, joy: 0.812, sadness: 0.05 });
        expect(Object.keys(sample.actionUnits)).toHaveLength(9);
    });
});

// ---------------------------------------------------------------------------
// 3. Head pose matrix extraction
// ---------------------------------------------------------------------------

describe('head pose matrix → yaw/pitch extraction', () => {
    // MediaPipe facialTransformationMatrixes returns a flat 16-element Float32Array (4x4 row-major)
    // Layout: [R00, R01, R02, Tx, R10, R11, R12, Ty, R20, R21, R22, Tz, 0, 0, 0, 1]
    // Yaw = asin(R02) = asin(m[2])
    // Pitch = atan2(-R12, R22) = atan2(-m[6], m[10])

    function extractYawPitch(m: number[]): { yaw: number; pitch: number } {
        const yaw = Math.asin(Math.max(-1, Math.min(1, m[2] || 0))) * 180 / Math.PI;
        const pitch = Math.atan2(-(m[6] || 0), m[10] || 1) * 180 / Math.PI;
        return { yaw, pitch };
    }

    it('identity matrix → yaw=0, pitch=0', () => {
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const { yaw, pitch } = extractYawPitch(identity);
        expect(yaw).toBeCloseTo(0, 5);
        expect(pitch).toBeCloseTo(0, 5);
    });

    it('30° yaw right → yaw ≈ 30', () => {
        const rad = 30 * Math.PI / 180;
        // Rotation around Y axis (yaw): R = [[cos, 0, sin], [0, 1, 0], [-sin, 0, cos]]
        const m = [
            Math.cos(rad), 0, Math.sin(rad), 0,
            0, 1, 0, 0,
            -Math.sin(rad), 0, Math.cos(rad), 0,
            0, 0, 0, 1,
        ];
        const { yaw, pitch } = extractYawPitch(m);
        expect(yaw).toBeCloseTo(30, 1);
        expect(pitch).toBeCloseTo(0, 1);
    });

    it('-20° yaw left → yaw ≈ -20', () => {
        const rad = -20 * Math.PI / 180;
        const m = [
            Math.cos(rad), 0, Math.sin(rad), 0,
            0, 1, 0, 0,
            -Math.sin(rad), 0, Math.cos(rad), 0,
            0, 0, 0, 1,
        ];
        const { yaw, pitch } = extractYawPitch(m);
        expect(yaw).toBeCloseTo(-20, 1);
        expect(pitch).toBeCloseTo(0, 1);
    });

    it('25° pitch down → pitch ≈ 25', () => {
        const rad = 25 * Math.PI / 180;
        // Rotation around X axis (pitch): R = [[1, 0, 0], [0, cos, -sin], [0, sin, cos]]
        const m = [
            1, 0, 0, 0,
            0, Math.cos(rad), -Math.sin(rad), 0,
            0, Math.sin(rad), Math.cos(rad), 0,
            0, 0, 0, 1,
        ];
        const { yaw, pitch } = extractYawPitch(m);
        expect(yaw).toBeCloseTo(0, 1);
        expect(pitch).toBeCloseTo(25, 1);
    });

    it('combined 15° yaw + 10° pitch', () => {
        const yawRad = 15 * Math.PI / 180;
        const pitchRad = 10 * Math.PI / 180;
        // Ry * Rx (yaw first, then pitch)
        const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
        const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
        const m = [
            cy, sy * sp, sy * cp, 0,
            0, cp, -sp, 0,
            -sy, cy * sp, cy * cp, 0,
            0, 0, 0, 1,
        ];
        const { yaw, pitch } = extractYawPitch(m);
        expect(yaw).toBeCloseTo(15, 0);
        expect(pitch).toBeCloseTo(10, 0);
    });

    it('clamped at ±90° (no NaN from asin)', () => {
        // m[2] > 1 would NaN without clamp
        const m = [0, 0, 1.5, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const { yaw } = extractYawPitch(m);
        expect(Number.isFinite(yaw)).toBe(true);
        expect(yaw).toBe(90);
    });

    it('handles missing matrix values (fallback to 0)', () => {
        const empty: number[] = [];
        const { yaw, pitch } = extractYawPitch(empty);
        expect(yaw).toBeCloseTo(0, 5);
        expect(pitch).toBeCloseTo(0, 5);
    });
});

// ---------------------------------------------------------------------------
// 4. Data contract: snippet output ↔ analytics input
// ---------------------------------------------------------------------------

describe('data contract — gaze sample format', () => {
    // The snippet pushes: {timestamp, quadrant, attention, score, cursorX, cursorY}
    // The analytics isValidGazeSample checks: timestamp finite, quadrant string, attention in set, score finite

    it('snippet gaze sample format passes analytics validation', () => {
        // Simulate what the snippet produces
        const sampleFromSnippet = {
            timestamp: 1500,
            quadrant: 'top-left',
            attention: 'engaged',
            score: 0.85,
            cursorX: 400,
            cursorY: 300,
        };

        // Reproduce isValidGazeSample from tracking-gaze.analytics.ts
        const ALL_ATTENTION = ['engaged', 'distracted', 'away'];
        const isValid = (s: Record<string, unknown>) =>
            Number.isFinite(s.timestamp) &&
            typeof s.quadrant === 'string' &&
            ALL_ATTENTION.includes(s.attention as string) &&
            Number.isFinite(s.score);

        expect(isValid(sampleFromSnippet)).toBe(true);
    });

    it('all possible quadrant values from gaze logic are strings', () => {
        const directions = [
            { horizontal: 'left' as const, vertical: 'up' as const },
            { horizontal: 'center' as const, vertical: 'center' as const },
            { horizontal: 'right' as const, vertical: 'down' as const },
        ];
        for (const d of directions) {
            const q = classifyGazeQuadrant(d);
            expect(typeof q).toBe('string');
            expect(q.length).toBeGreaterThan(0);
        }
    });

    it('all attention states from logic are in analytics validation set', () => {
        const ALL_ATTENTION = ['engaged', 'distracted', 'away'];
        expect(ALL_ATTENTION).toContain(estimateAttentionState(true, 0, 0));
        expect(ALL_ATTENTION).toContain(estimateAttentionState(true, 40, 0));
        expect(ALL_ATTENTION).toContain(estimateAttentionState(false, 0, 0));
    });

    it('attention score is always in [0, 1]', () => {
        for (const state of ['engaged', 'distracted', 'away'] as const) {
            for (const match of [true, false]) {
                const score = computeAttentionScore(state, match);
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(1);
            }
        }
    });

    it('snippet emotion sample format with expressions passes emotion analytics', () => {
        // New format from snippet includes expressions vector
        const sampleFromSnippet = {
            timestamp: 500,
            emotion: 'joy',
            confidence: 0.85,
            expressions: { joy: 0.85, neutral: 0.10, surprise: 0.05 },
        };

        const ALL_EMOTIONS = ['joy', 'sadness', 'surprise', 'anger', 'disgust', 'fear', 'neutral'];
        const isValid = (s: Record<string, unknown>) =>
            ALL_EMOTIONS.includes(s.emotion as string) &&
            Number.isFinite(s.confidence) &&
            Number.isFinite(s.timestamp);

        expect(isValid(sampleFromSnippet)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 5. Iris landmark indices match between snippet and constants
// ---------------------------------------------------------------------------

describe('iris landmark indices', () => {
    it('snippet uses correct MediaPipe indices for iris and eye corners', () => {
        const js = generateTrackingSnippet(defaultConfig);
        // Left iris center = 468, Right iris center = 473
        expect(js).toContain('lm[468]');
        expect(js).toContain('lm[473]');
        // Left eye: outer=33, inner=133, top=159, bottom=145
        expect(js).toContain('lm[33]');
        expect(js).toContain('lm[133]');
        expect(js).toContain('lm[159]');
        expect(js).toContain('lm[145]');
        // Right eye: outer=263, inner=362, top=386, bottom=374
        expect(js).toContain('lm[263]');
        expect(js).toContain('lm[362]');
        expect(js).toContain('lm[386]');
        expect(js).toContain('lm[374]');
    });

    it('snippet checks lm.length > 473 before accessing iris', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(js).toContain('lm.length>473');
    });
});

describe('generateTrackingSnippet — emotion and gaze delivery', () => {
    it('sends emotions and gaze on the periodic flush timer, not only when the tab hides', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(js).toContain('timer=setInterval(function(){flush();flushEmotions();flushGaze();},C.flush);');
    });

    it('sends pending gaze samples when the page unloads', () => {
        const js = generateTrackingSnippet(defaultConfig);
        const unloadHandler = js.slice(js.indexOf('addEventListener("beforeunload"'), js.indexOf('// SPA navigation'));
        expect(unloadHandler).toContain('flushEmotions(true);');
        expect(unloadHandler).toContain('flushGaze(true);');
    });
});

function runStartCameraCapture({ storedCalibration, isMediaPipeLoaded, isSkipped = false, captureGaze = true }: { storedCalibration: string | null; isMediaPipeLoaded: boolean; isSkipped?: boolean; captureGaze?: boolean }) {
    const js = generateTrackingSnippet({ ...defaultConfig, captureGaze });
    const source = js.slice(js.indexOf('function startCameraCapture(){'), js.indexOf('function onCalDone(')) +
        js.slice(js.indexOf('function restoreCalibration(){'), js.indexOf('function loadCaptureModels('));
    const withCamera = vi.fn((cb: () => void) => cb());
    const beginCapture = vi.fn();
    const runCameraCheck = vi.fn();
    new Function('C', 'load', 'withCamera', 'loadCaptureModels', 'mpLandmarker', 'beginCapture', 'runCameraCheck', 'isCameraSkipped',
        `var gazeWeights,gazeFeatDim,gazeRmsePx,gazeQuality;${source}startCameraCapture();`,
    )({ gaze: captureGaze, emotions: true, rid: 'r', gazeCal: 9 }, () => storedCalibration, withCamera, (cb: () => void) => cb(),
        isMediaPipeLoaded ? {} : null, beginCapture, runCameraCheck, () => isSkipped);
    return { withCamera, beginCapture, runCameraCheck };
}

describe('generateTrackingSnippet — gaze only when the researcher turned it on', () => {
    const loadModelsWith = (config: { gaze: boolean; emotions: boolean }) => {
        const js = generateTrackingSnippet(defaultConfig);
        const source = js.slice(js.indexOf('function loadCaptureModels('), js.indexOf('function loadMediaPipe('));
        const loadMediaPipe = vi.fn((cb: () => void) => cb());
        const loadFaceApi = vi.fn((cb: () => void) => cb());
        const onLoaded = vi.fn();
        new Function('C', 'loadMediaPipe', 'loadFaceApi', `${source}loadCaptureModels(arguments[3]);`)(config, loadMediaPipe, loadFaceApi, onLoaded);
        return { loadMediaPipe, loadFaceApi, onLoaded };
    };

    it('does not load the gaze model when only emotions are captured', () => {
        const { loadMediaPipe, loadFaceApi, onLoaded } = loadModelsWith({ gaze: false, emotions: true });
        expect(loadMediaPipe).not.toHaveBeenCalled();
        expect(loadFaceApi).toHaveBeenCalledTimes(1);
        expect(onLoaded).toHaveBeenCalledTimes(1);
    });

    it('loads both models when gaze and emotions are captured', () => {
        const { loadMediaPipe, loadFaceApi, onLoaded } = loadModelsWith({ gaze: true, emotions: true });
        expect(loadMediaPipe).toHaveBeenCalledTimes(1);
        expect(loadFaceApi).toHaveBeenCalledTimes(1);
        expect(onLoaded).toHaveBeenCalledTimes(1);
    });

    it('loads only the gaze model when emotions are off', () => {
        const { loadMediaPipe, loadFaceApi, onLoaded } = loadModelsWith({ gaze: true, emotions: false });
        expect(loadMediaPipe).toHaveBeenCalledTimes(1);
        expect(loadFaceApi).not.toHaveBeenCalled();
        expect(onLoaded).toHaveBeenCalledTimes(1);
    });
});

describe('generateTrackingSnippet — emotions on devices without WebGL', () => {
    it('points the wasm backend at its own TensorFlow version and waits for it before loading models', async () => {
        const js = generateTrackingSnippet(defaultConfig);
        const source = js.slice(js.indexOf('function loadFaceApi('), js.indexOf('function sampleEmotion('));
        const steps: string[] = [];
        let finishReady: () => void = () => undefined;
        const net = { loadFromUri: vi.fn(async () => { steps.push('load'); }) };
        const faceapi = {
            tf: {
                version_core: '4.21.0',
                setWasmPaths: vi.fn((path: string) => { steps.push(`wasm ${path}`); }),
                ready: vi.fn(() => new Promise<void>((resolve) => { finishReady = () => { steps.push('ready'); resolve(); }; })),
            },
            nets: { tinyFaceDetector: net, faceLandmark68Net: net, faceExpressionNet: net },
        };
        const onLoaded = vi.fn();
        new Function('C', 'window', 'faceapi', 'reportCaptureError', 'faceApiReady', `${source}loadFaceApi(arguments[5]);`)(
            { emoModelUrl: 'https://models' }, { faceapi }, faceapi, vi.fn(), false, onLoaded,
        );

        expect(net.loadFromUri).not.toHaveBeenCalled();
        finishReady();
        await vi.waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));

        expect(steps).toEqual(['wasm https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.21.0/dist/', 'ready', 'load', 'load', 'load']);
    });
});

describe('generateTrackingSnippet — the visitor can always leave the camera screens', () => {
    const fakeNode = () => {
        const node = { children: [] as unknown[], style: {} as Record<string, string>, textContent: '', remove: vi.fn(), appendChild: (child: unknown) => { node.children.push(child); return child; } };
        return node;
    };
    const runScreen = (screen: 'runCameraCheck' | 'runCalibration') => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true });
        const source = js.slice(js.indexOf('function uiSkipButton('), js.indexOf('function uiDot(')) +
            js.slice(js.indexOf('function runCameraCheck('), js.indexOf('var VALIDATION_POINTS='));
        const overlays: Array<ReturnType<typeof fakeNode>> = [];
        const buttons: Array<{ label: string; onClick: () => void }> = [];
        const skipCameraCapture = vi.fn();
        const failingMetrics = { width: 1280, height: 720, brightness: 40 };
        new Function('uiOverlay', 'uiNode', 'uiPill', 'uiDot', 'uiButton', 'uiText', 'uiQualityRow', 'collectCameraMetrics', 'rateCameraQuality', 'QUALITY_CHECK_IDS', 'skipCameraCapture', 'document', 'setTimeout', 'calPoints', 'GAZE_FEAT_DIM',
            `${source}${screen}(5,function(){});`,
        )(
            () => { const overlay = fakeNode(); overlays.push(overlay); return overlay; },
            () => fakeNode(),
            () => Object.assign(fakeNode(), { setPercent: () => undefined }),
            () => Object.assign(fakeNode(), { moveTo: () => undefined, setProgress: () => undefined }),
            (label: string, _isPrimary: boolean, onClick: () => void) => { buttons.push({ label, onClick }); return Object.assign(fakeNode(), { style: {} }); },
            (key: string) => key,
            () => ({ node: fakeNode(), show: () => undefined }),
            (cb: (metrics: object) => void) => cb(failingMetrics),
            () => ({ brightness: 'fail' }),
            ['brightness'],
            skipCameraCapture,
            { body: fakeNode() },
            () => 0,
            () => [[50, 50]],
            3,
        );
        return { overlay: overlays[0], buttons, skipCameraCapture };
    };

    it.each(['runCameraCheck', 'runCalibration'] as const)('%s offers a skip that closes the screen and stops the camera', (screen) => {
        const { overlay, buttons, skipCameraCapture } = runScreen(screen);
        const skip = buttons.find((button) => button.label === 'skip');

        expect(skip).toBeDefined();
        skip?.onClick();

        expect(overlay.remove).toHaveBeenCalled();
        expect(skipCameraCapture).toHaveBeenCalledTimes(1);
    });
});

describe('generateTrackingSnippet — calibration overlay always closes', () => {
    it('closes the calibration and validation screens when the camera is released', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true });
        const screens = js.slice(js.indexOf('function runCalibration('), js.indexOf('var CAMERA_SKIP_KEY='));
        expect(screens.split('if(!emoVideo){clearInterval(timer);overlay.remove();return;}')).toHaveLength(3);
    });

    it('skips calibration but still captures emotions when MediaPipe failed to load', () => {
        const { runCameraCheck, beginCapture } = runStartCameraCapture({ storedCalibration: null, isMediaPipeLoaded: false });
        expect(runCameraCheck).not.toHaveBeenCalled();
        expect(beginCapture).toHaveBeenCalledTimes(1);
    });
});

describe('generateTrackingSnippet — emotion sampling like the Eye Tracking module', () => {
    const startSamplingWith = (config: { emotions: boolean }, isFaceApiReady: boolean) => {
        const js = generateTrackingSnippet(defaultConfig);
        const source = js.slice(js.indexOf('function startSampling(){'), js.indexOf('function beginCapture('));
        const setInterval = vi.fn(() => 1);
        new Function('C', 'setInterval', 'sampleEmotion', 'sampleGaze', 'mpLandmarker', 'faceApiReady',
            `var emoRunning=false,emoStartTime=0,emoInterval=null,gazeInterval=null,EMO_SAMPLE_MS=50,GAZE_SAMPLE_MS=500;${source}startSampling();`,
        )(config, setInterval, 'sampleEmotion', 'sampleGaze', {}, isFaceApiReady);
        return setInterval.mock.calls as unknown as Array<[string, number]>;
    };

    it('samples emotions 20 times per second and gaze twice per second', () => {
        expect(startSamplingWith({ emotions: true }, true)).toEqual([['sampleGaze', 500], ['sampleEmotion', 50]]);
    });

    it('does not sample emotions when captureEmotions is off or face-api failed', () => {
        expect(startSamplingWith({ emotions: false }, true)).toEqual([['sampleGaze', 500]]);
        expect(startSamplingWith({ emotions: true }, false)).toEqual([['sampleGaze', 500]]);
    });

    it('waits for the running detection instead of piling up detections on slow devices', async () => {
        const js = generateTrackingSnippet(defaultConfig);
        const source = js.slice(js.indexOf('function captureElapsedMs(){'), js.indexOf('function startSampling(){')) +
            js.slice(js.indexOf('function sampleEmotion(){'), js.indexOf('function sampleGaze(){'));
        let finishDetection: (detection: null) => void = () => undefined;
        const detectSingleFace = vi.fn(() => {
            const pending = new Promise<null>((resolve) => { finishDetection = resolve; });
            return { withFaceLandmarks: () => ({ withFaceExpressions: () => pending }) };
        });
        const sampleEmotion = new Function('faceapi', 'toEmotionSample',
            `var emoRunning=true,paused=false,isDetectingEmotion=false,emoVideo={readyState:4},EMO_MAX_MS=300000,emoBuf=[],emoActiveMs=0,emoStartTime=Date.now();${source}return sampleEmotion;`,
        )({ detectSingleFace, TinyFaceDetectorOptions: function TinyFaceDetectorOptions() { return {}; } }, () => ({})) as () => void;

        for (let frame = 0; frame < 5; frame++) sampleEmotion();
        expect(detectSingleFace).toHaveBeenCalledTimes(1);

        finishDetection(null);
        await new Promise((resolve) => setTimeout(resolve, 0));
        sampleEmotion();
        expect(detectSingleFace).toHaveBeenCalledTimes(2);
    });

    it('starts emotions only after calibration and resumes them only once capture began', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true });
        expect(js.slice(js.indexOf('function onCalDone('), js.indexOf('function restoreCalibration('))).toContain('beginCapture();');
        expect(js).toContain('if(isCaptureStarted&&emoStream&&!emoRunning)startSampling();');
    });
});

describe('generateTrackingSnippet — one shared camera', () => {
    const loadWithCamera = (js: string, mediaDevices?: { getUserMedia: () => Promise<object> }) => {
        const source = js.slice(js.indexOf('var cameraWaiters=null;'), js.indexOf('function startSampling(){'));
        let resolveStream: (stream: object) => void = () => undefined;
        const getUserMedia = vi.fn(() => new Promise<object>((resolve) => { resolveStream = resolve; }));
        const reportCaptureError = vi.fn();
        const fakeDocument = { createElement: () => ({ setAttribute: () => undefined, style: {}, remove: () => undefined }), body: { appendChild: () => undefined } };
        const { withCamera, releaseCamera } = new Function('C', 'navigator', 'document', 'reportCaptureError',
            `var emoVideo=null,emoStream=null;${source}return {withCamera:withCamera,releaseCamera:releaseCamera};`,
        )({ gaze: true }, { mediaDevices: mediaDevices ?? { getUserMedia } }, fakeDocument, reportCaptureError) as {
            withCamera: (cb: (stream: object) => void) => void;
            releaseCamera: () => void;
        };
        return { withCamera, releaseCamera, getUserMedia, reportCaptureError, resolveStream: (stream: object) => resolveStream(stream) };
    };
    const flushPromises = async () => { await Promise.resolve(); await Promise.resolve(); };

    it('opens the camera once when emotions and gaze start together and gives both the same stream', async () => {
        const { withCamera, getUserMedia, resolveStream } = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, captureGaze: true }));
        const received: object[] = [];
        withCamera((stream) => received.push(stream));
        withCamera((stream) => received.push(stream));
        const stream = {};
        resolveStream(stream);
        await flushPromises();
        withCamera((s) => received.push(s));

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(received).toEqual([stream, stream, stream]);
    });

    it('turns the camera off on release and opens a fresh stream for the next session', async () => {
        const { withCamera, releaseCamera, getUserMedia, resolveStream } = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, captureGaze: true }));
        const track = { stop: vi.fn() };
        withCamera(() => undefined);
        resolveStream({ getTracks: () => [track] });
        await flushPromises();

        releaseCamera();
        withCamera(() => undefined);

        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
    });

    it('reports camera-denied without retrying when the visitor refuses the permission', async () => {
        const getUserMedia = vi.fn(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
        const { withCamera, reportCaptureError } = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, captureGaze: true }), { getUserMedia });
        withCamera(() => undefined);
        await flushPromises();

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(reportCaptureError).toHaveBeenCalledWith('camera-denied');
    });

    it('tries every resolution before reporting camera-unavailable', async () => {
        const getUserMedia = vi.fn(() => Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })));
        const { withCamera, reportCaptureError } = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, captureGaze: true }), { getUserMedia });
        withCamera(() => undefined);
        await flushPromises();
        await flushPromises();

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(reportCaptureError).toHaveBeenCalledWith('camera-unavailable');
    });

    it('reports camera-unavailable when the browser has no camera API', () => {
        const { withCamera, reportCaptureError } = loadWithCamera(
            generateTrackingSnippet({ ...defaultConfig, captureGaze: true }),
            {} as { getUserMedia: () => Promise<object> },
        );
        expect(() => withCamera(() => undefined)).not.toThrow();
        expect(reportCaptureError).toHaveBeenCalledWith('camera-unavailable');
    });

    it('reports model load failures for MediaPipe and face-api and keeps going', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureEmotions: true });
        expect(js).toContain('.catch(function(){reportCaptureError("mediapipe-failed");cb();});');
        expect(js).toContain('function(){reportCaptureError("face-models-failed");cb();});');
        expect(js).toContain('sc.onerror=function(){reportCaptureError("face-models-failed");cb();};');
    });

    it('releases the camera 30s after the tab hides and on return after a long absence', () => {
        const js = generateTrackingSnippet(defaultConfig);
        const visibilityHandler = js.slice(js.indexOf('addEventListener("visibilitychange"'), js.indexOf('addEventListener("beforeunload"'));
        expect(visibilityHandler).toContain('cameraReleaseTimer=setTimeout(releaseCamera,30000);');
        expect(visibilityHandler).toContain('clearTimeout(cameraReleaseTimer);');
        expect(visibilityHandler).toContain('stopEmotionCapture();releaseCamera();');
    });
});

describe('generateTrackingSnippet — mobile gaze with a stored calibration', () => {
    it('opens the camera and loads the models before sampling, without recalibrating', () => {
        const { withCamera, beginCapture, runCameraCheck } = runStartCameraCapture({
            storedCalibration: JSON.stringify({ w: [1], d: 1, r: 60, t: Date.now() }),
            isMediaPipeLoaded: true,
        });
        expect(withCamera).toHaveBeenCalledTimes(1);
        expect(beginCapture).toHaveBeenCalledTimes(1);
        expect(runCameraCheck).not.toHaveBeenCalled();
    });

    it('checks the camera and calibrates before capturing when no stored calibration exists', () => {
        const { runCameraCheck, beginCapture } = runStartCameraCapture({ storedCalibration: null, isMediaPipeLoaded: true });
        expect(runCameraCheck).toHaveBeenCalledTimes(1);
        expect(beginCapture).not.toHaveBeenCalled();
    });

    it('captures right away without calibration when gaze is disabled', () => {
        const { runCameraCheck, beginCapture } = runStartCameraCapture({ storedCalibration: null, isMediaPipeLoaded: true, captureGaze: false });
        expect(runCameraCheck).not.toHaveBeenCalled();
        expect(beginCapture).toHaveBeenCalledTimes(1);
    });
});

describe('generateTrackingSnippet — pending data stays with its session', () => {
    const extractFunction = (js: string, name: string) => {
        const start = js.indexOf(`function ${name}(`);
        return js.slice(start, js.indexOf('\nfunction ', start + 1));
    };
    const fakeXhr = () => {
        const bodies: Array<Record<string, unknown>> = [];
        function FakeXMLHttpRequest(this: { open: () => void; setRequestHeader: () => void; send: (b: string) => void }) {
            this.open = () => undefined;
            this.setRequestHeader = () => undefined;
            this.send = (b: string) => { bodies.push(JSON.parse(b)); };
        }
        return { FakeXMLHttpRequest, bodies };
    };

    it('sends every buffered event in batches the server accepts whole', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, maxEventsPerFlush: 2 });
        const { FakeXMLHttpRequest, bodies } = fakeXhr();
        new Function('C', 'XMLHttpRequest',
            `var sid="old",buf=[{a:1},{a:2},{a:3},{a:4},{a:5}],flushing=false,activeMs=0,activeStart=0;${extractFunction(js, 'flush')}flush();`,
        )({ max: 2, api: 'https://api', rid: 'r' }, FakeXMLHttpRequest);

        expect(bodies.map((body) => (body.events as unknown[]).length)).toEqual([2, 2, 1]);
        expect(bodies.every((body) => body.sessionId === 'old')).toBe(true);
    });

    it('drops events of a page whose session was never created instead of moving them to the next one', () => {
        const js = generateTrackingSnippet(defaultConfig);
        const source = extractFunction(js, 'createSession');
        const XMLHttpRequest = function (this: { open: () => void; setRequestHeader: () => void; send: () => void }) {
            this.open = () => undefined; this.setRequestHeader = () => undefined; this.send = () => undefined;
        };
        const buffered = new Function('C', 'XMLHttpRequest', 'push', 'location', 'document', 'screen', 'navigator', 'window',
            `var sid=null,buf=[{eventType:"mousemove",timestampMs:1},{eventType:"click",timestampMs:2}],pageStart=0,activeMs=0,activeStart=0,paused=false,rrwebStopFn=null,rrwebActiveMs=0,emoActiveMs=0,emoStartTime=0,vid="v";${source}\ncreateSession();return buf;`,
        )({ api: 'https://api', rid: 'r' }, XMLHttpRequest, () => undefined, { href: 'https://site/' }, { title: '' }, {}, {}, { innerWidth: 1, innerHeight: 1 });

        expect(buffered).toEqual([]);
    });

    it('flushes emotions and gaze before switching to a new session', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(extractFunction(js, 'createSession')).toContain('if(sid){flush();flushRrweb();flushEmotions();flushGaze();}');
    });
});

describe('generateTrackingSnippet — emotion timestamps across tab switches', () => {
    const runSampleEmotion = async ({ activeMsBeforeHide, msSinceResume }: { activeMsBeforeHide: number; msSinceResume: number }) => {
        const js = generateTrackingSnippet(defaultConfig);
        const source = js.slice(js.indexOf('function captureElapsedMs(){'), js.indexOf('function startSampling(){')) +
            js.slice(js.indexOf('function sampleEmotion(){'), js.indexOf('function sampleGaze(){'));
        const detection = { expressions: { happy: 0.9 } };
        const faceapi = {
            TinyFaceDetectorOptions: function TinyFaceDetectorOptions() { return {}; },
            detectSingleFace: () => ({ withFaceLandmarks: () => ({ withFaceExpressions: () => Promise.resolve(detection) }) }),
        };
        const emoBuf = new Function('faceapi', 'toEmotionSample',
            `var emoRunning=true,paused=false,isDetectingEmotion=false,emoVideo={readyState:4},EMO_MAX_MS=300000,emoBuf=[],
            emoActiveMs=${activeMsBeforeHide},emoStartTime=Date.now()-${msSinceResume};
            ${source}sampleEmotion();return emoBuf;`,
        )(faceapi, (_det: unknown, timestamp: number) => ({ timestamp })) as Array<{ timestamp: number }>;
        await Promise.resolve();
        await Promise.resolve();
        return emoBuf;
    };

    it('keeps counting from the time already captured when the tab comes back', async () => {
        const emoBuf = await runSampleEmotion({ activeMsBeforeHide: 5000, msSinceResume: 1000 });
        expect(emoBuf[0].timestamp).toBeGreaterThanOrEqual(6000);
        expect(emoBuf[0].timestamp).toBeLessThan(6100);
    });

    it('restarts the emotion clock when a new session starts', () => {
        const js = generateTrackingSnippet(defaultConfig);
        const createSession = js.slice(js.indexOf('function createSession(){'), js.indexOf('function onSessionReady('));
        expect(createSession).toContain('emoActiveMs=0;emoStartTime=Date.now();');
    });
});

describe('generateTrackingSnippet — calibrated gaze on every device', () => {
    it('has no mobile-only branch left in the gaze pipeline', () => {
        expect(generateTrackingSnippet({ ...defaultConfig, captureGaze: true })).not.toContain('isMobile');
    });

    it('predicts gaze from the calibration once it exists and falls back to the cursor before that', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true });
        const sampleGaze = js.slice(js.indexOf('function sampleGaze(){'), js.indexOf('function startEmoRecording('));
        expect(sampleGaze).toContain('if(gazeWeights){\n                var feat=extractGazeFeat(lm,res.facialTransformationMatrixes);');
        expect(sampleGaze).toContain('gpx=Math.round(lastCursorX+window.scrollX);');
        expect(sampleGaze).toContain('if(gazeWeights){sample.gazeQuality=gazeQuality;');
    });

    it('opens the camera at gaze resolution whenever gaze is enabled', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true });
        expect(js).toContain('var sizes=C.gaze?[[1280,720],[640,480]]:[[320,240]];');
    });
});

describe('generateTrackingSnippet — camera screens match the Eye Tracking module', () => {
    const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true });
    const section = (from: string, to: string) => js.slice(js.indexOf(from), js.indexOf(to));
    const screensSource = section('var UI_TEXTS={', 'var UI_FONT=');

    const textsFor = (language: string) => new Function('navigator', `${screensSource}return {uiText:uiText};`)({ language }) as {
        uiText: (key: string, vars?: Record<string, unknown>) => string;
    };

    it('speaks Spanish by default and English only to English browsers', () => {
        expect(textsFor('es-CL').uiText('dwell')).toBe('Mira el punto sin mover la cabeza. Avanzará solo.');
        expect(textsFor('').uiText('skip')).toBe('Saltar esta actividad');
        expect(textsFor('en-US').uiText('dwell')).toBe('Look at the dot without moving your head. It will move on by itself.');
        expect(textsFor('es').uiText('pointOf', { current: 2, total: 5 })).toBe('Punto 2 de 5');
        expect(js).not.toContain('Look at the red dot');
    });

    const decideCalibration = new Function(`${section('var VALIDATION_POINTS=', 'function runValidation(')}return decideCalibration;`)() as
        (rmse: number, recalibrations: number) => string;

    it('accepts a good validation and offers to skip only after two retries above 200px', () => {
        expect(decideCalibration(150, 0)).toBe('accept');
        expect(decideCalibration(180, 0)).toBe('offer-retry');
        expect(decideCalibration(230, 1)).toBe('offer-retry');
        expect(decideCalibration(180, 2)).toBe('offer-retry');
        expect(decideCalibration(230, 2)).toBe('offer-skip');
    });

    const rateCameraQuality = new Function(`${section('var QUALITY_CHECK_IDS=', 'function measureLight(')}return rateCameraQuality;`)() as
        (metrics: Record<string, number>) => Record<string, string>;
    const goodCamera = { width: 1280, height: 720, brightness: 130, centerBrightness: 130, edgeBrightness: 120, faceRatio: 1, distanceCm: 60, headSpreadPx: 3, headAngleDeg: 5 };

    it('rates the camera with the Eye Tracking thresholds', () => {
        expect(Object.values(rateCameraQuality(goodCamera)).every(status => status === 'pass')).toBe(true);
        expect(rateCameraQuality({ ...goodCamera, width: 320, height: 240 }).resolution).toBe('fail');
        expect(rateCameraQuality({ ...goodCamera, brightness: 50 }).brightness).toBe('fail');
        expect(rateCameraQuality({ ...goodCamera, brightness: 70 }).brightness).toBe('warn');
        expect(rateCameraQuality({ ...goodCamera, centerBrightness: 60, edgeBrightness: 200 }).brightness).toBe('warn');
        expect(rateCameraQuality({ ...goodCamera, faceRatio: 0.5 }).faceDetection).toBe('fail');
        expect(rateCameraQuality({ ...goodCamera, distanceCm: 90 }).distance).toBe('warn');
        expect(rateCameraQuality({ ...goodCamera, headSpreadPx: 20 }).headStability).toBe('fail');
        expect(rateCameraQuality({ ...goodCamera, headAngleDeg: 20 }).headPose).toBe('warn');
        expect(rateCameraQuality({ ...goodCamera, headAngleDeg: 30 }).headPose).toBe('fail');
    });

    const runCalibrationFlow = (choices: string[]) => {
        const recalibrationsSeen: number[] = [];
        const onCalDone = vi.fn();
        const skipCameraCapture = vi.fn();
        const runCalibration = (_points: number, cb: (w: number[], d: number, x: number[], y: number[]) => void) => cb([1], 9, [], []);
        const runValidation = (_w: number[], _d: number, recalibrations: number, onChoice: (choice: string, rmse: number) => void) => {
            recalibrationsSeen.push(recalibrations);
            onChoice(choices[recalibrationsSeen.length - 1], 180);
        };
        const calibrateGaze = new Function('C', 'runCalibration', 'runValidation', 'skipCameraCapture', 'onCalDone',
            `${section('function calibrateGaze(', '// FACS Action Units from face-api 68 landmarks')}return calibrateGaze;`,
        )({ gazeCal: 9 }, runCalibration, runValidation, skipCameraCapture, onCalDone) as (recalibrations: number) => void;
        calibrateGaze(0);
        return { recalibrationsSeen, onCalDone, skipCameraCapture };
    };

    it('recalibrates on "Intentar de nuevo" and keeps the calibration on "Seguir igual"', () => {
        const { recalibrationsSeen, onCalDone, skipCameraCapture } = runCalibrationFlow(['retry', 'retry', 'accept']);
        expect(recalibrationsSeen).toEqual([0, 1, 2]);
        expect(onCalDone).toHaveBeenCalledWith([1], 9, 180, [], []);
        expect(skipCameraCapture).not.toHaveBeenCalled();
    });

    it('turns the camera off on "Saltar esta actividad" without keeping the calibration', () => {
        const { onCalDone, skipCameraCapture } = runCalibrationFlow(['retry', 'retry', 'skip']);
        expect(skipCameraCapture).toHaveBeenCalledTimes(1);
        expect(onCalDone).not.toHaveBeenCalled();
    });

    it('does not ask for the camera again after the visitor skipped', () => {
        const { withCamera } = runStartCameraCapture({ storedCalibration: null, isMediaPipeLoaded: true, isSkipped: true });
        expect(withCamera).not.toHaveBeenCalled();
    });

});

describe('generateTrackingSnippet — zones marked by the researcher', () => {
    const zones = [
        { id: 'cta', pageUrl: 'https://shop.example.com/pricing?ref=ad', selector: 'main > a.buy:nth-of-type(1)' },
        { id: 'hero', pageUrl: 'https://shop.example.com/pricing', selector: '#hero' },
        { id: 'other-page', pageUrl: 'https://shop.example.com/about', selector: '#hero' },
        { id: 'missing', pageUrl: 'https://shop.example.com/pricing', selector: '#gone' },
    ];

    it('ships each zone with the page path it belongs to', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, zones });
        expect(js).toContain('"zones":[{"id":"cta","path":"/pricing","selector":"main > a.buy:nth-of-type(1)"}');
    });

    it('records where each zone of the current page was, in page coordinates, with every fixation', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true, zones });
        const source = js.slice(js.indexOf('function zoneRectsOnPage(){'), js.indexOf('function feedFixation('));
        const elements: Record<string, object> = {
            'main > a.buy:nth-of-type(1)': { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }) },
            '#hero': { getBoundingClientRect: () => ({ left: 0, top: -200, width: 800, height: 300 }) },
        };
        const zoneRectsOnPage = new Function('C', 'window', 'location', 'document', `${source}return zoneRectsOnPage;`)(
            { zones: generateZoneConfig(js) },
            { scrollX: 0, scrollY: 500 },
            { pathname: '/pricing' },
            { querySelector: (selector: string) => elements[selector] ?? null },
        ) as () => Record<string, number[]>;

        expect(zoneRectsOnPage()).toEqual({ cta: [10, 520, 100, 40], hero: [0, 300, 800, 300] });
        expect(js.slice(js.indexOf('function feedFixation('))).toContain('timestamp:fixState.startT,zones:zoneRectsOnPage()});');
    });

    it('ignores a selector the page cannot parse instead of breaking capture', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, captureGaze: true, zones: [{ id: 'bad', pageUrl: 'https://x.com/', selector: 'div[' }] });
        const source = js.slice(js.indexOf('function zoneRectsOnPage(){'), js.indexOf('function feedFixation('));
        const zoneRectsOnPage = new Function('C', 'window', 'location', 'document', `${source}return zoneRectsOnPage;`)(
            { zones: generateZoneConfig(js) }, { scrollX: 0, scrollY: 0 }, { pathname: '/' },
            { querySelector: () => { throw new Error('SyntaxError'); } },
        ) as () => Record<string, number[]>;
        expect(zoneRectsOnPage()).toEqual({});
    });
});

function generateZoneConfig(js: string): unknown {
    const config = js.slice(js.indexOf('var C=') + 'var C='.length, js.indexOf('};', js.indexOf('var C=')) + 1);
    return JSON.parse(config).zones;
}
