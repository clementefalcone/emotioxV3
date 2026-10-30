/**
 * Snippet integration tests — verify the generated JS is valid and
 * the inline gaze/FACS logic matches the module implementations.
 *
 * Closes the gap between unit-tested pure logic and the actual snippet output.
 */
import { describe, it, expect, vi } from 'vitest';
import { generateTrackingSnippet } from '../tracking-snippet';
import type { CameraFeatureMode } from '../tracking.service';
import {
    estimateAttentionState,
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
    emotionsMode: 'optional' as CameraFeatureMode,
    emotionModelBaseUrl: 'https://cdn.example.com/models',
    gazeMode: 'off' as CameraFeatureMode,
    eyeEmbedUrl: 'https://emotio.cx/participant/embed/eye.js',
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
            { ...defaultConfig, emotionsMode: 'off' as CameraFeatureMode },
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
        expect(js).toContain('attnState');
        expect(js).toContain('viewportQuadrant');
        expect(js).toContain('attnScore');
        expect(js).toContain('gazeBuf');
        expect(js).toContain('flushGaze');
    });


    it('loads the Eye Tracking module bundle from the participant site', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(js).toContain('"eyeUrl":"https://emotio.cx/participant/embed/eye.js"');
        expect(js).not.toContain('vision_bundle.mjs');
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

describe('generateTrackingSnippet — why a page has no camera data', () => {
    const runUnload = (isEyeFlowOpen: boolean) => {
        const js = generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional' });
        const unloadHandler = js.slice(js.indexOf('window.addEventListener("beforeunload"'), js.indexOf('// SPA navigation'));
        const reportCaptureError = vi.fn();
        const handlers: Array<() => void> = [];
        const noop = () => undefined;
        new Function('window', 'reportCaptureError', 'isEyeFlowOpen', 'flush', 'flushRrweb', 'stopEmotionCapture', 'flushEmotions', 'flushGaze', 'push',
            `var activeStart=0,activeMs=0,pageStart=0,paused=false;${unloadHandler}`,
        )({ addEventListener: (_: string, handler: () => void) => handlers.push(handler) }, reportCaptureError,
            isEyeFlowOpen, noop, noop, noop, noop, noop, noop);
        handlers[0]();
        return reportCaptureError;
    };

    it('reports calibration-abandoned when the visitor leaves while the camera screens are open', () => {
        expect(runUnload(true)).toHaveBeenCalledWith('calibration-abandoned', true);
    });

    it('reports nothing on unload when no camera screen is open', () => {
        expect(runUnload(false)).not.toHaveBeenCalled();
    });
});

interface FakeEyeOptions {
    lang: string;
    storageKey: string;
    hasEmotionRecognition: boolean;
    onReady: (session: object) => void;
    onDecline: () => void;
    onCameraDenied: () => void;
}

function runStartCameraCapture({ captureGaze = true, captureEmotions = true, isChosen = true, isCalibrationFresh = true, pageLang = 'es-CL' }: { captureGaze?: boolean; captureEmotions?: boolean; isChosen?: boolean; isCalibrationFresh?: boolean; pageLang?: string } = {}) {
    const js = generateTrackingSnippet({ ...defaultConfig, gazeMode: captureGaze ? 'optional' : 'off', emotionsMode: captureEmotions ? 'optional' : 'off' });
    const source = js.slice(js.indexOf('var eyeSession=null,isEyeFlowOpen=false;'), js.indexOf('function loadFaceApi(cb){'));
    const starts: FakeEyeOptions[] = [];
    const window = { EmotioxEye: { start: (options: FakeEyeOptions) => starts.push(options) } };
    const withCamera = vi.fn((cb: () => void) => cb());
    const beginCapture = vi.fn();
    const loadFaceApi = vi.fn((cb: () => void) => cb());
    const skipCameraCapture = vi.fn();
    const reportCaptureError = vi.fn();
    const markCameraOn = vi.fn();
    const store = vi.fn();
    const renderCameraTab = vi.fn();
    const api = new Function('C', 'window', 'document', 'navigator', 'withCamera', 'beginCapture', 'loadFaceApi', 'skipCameraCapture', 'reportCaptureError', 'isCameraChosen', 'hasCameraFeatures',
        'markCameraOn', 'hasFreshCalibration', 'store', 'renderCameraTab', 'EYE_CALIBRATION_KEY', 'CAMERA_CHOICE_KEY',
        `var emoVideo=null,emoStream=null;${source}return {startCameraCapture:startCameraCapture,state:function(){return {eyeSession:eyeSession,emoVideo:emoVideo,isEyeFlowOpen:isEyeFlowOpen};}};`,
    )({ gaze: captureGaze, emotions: captureEmotions, rid: 'r', eyeUrl: 'https://eye' }, window, { documentElement: { lang: pageLang } }, { language: 'en-US' },
        withCamera, beginCapture, loadFaceApi, skipCameraCapture, reportCaptureError, () => isChosen, () => captureGaze || captureEmotions,
        markCameraOn, () => isCalibrationFresh, store, renderCameraTab, '_ecx_eye_cal_r', '_ecx_cam_r') as {
        startCameraCapture: () => void;
        state: () => { eyeSession: object | null; emoVideo: object | null; isEyeFlowOpen: boolean };
    };
    return { ...api, starts, withCamera, beginCapture, loadFaceApi, skipCameraCapture, reportCaptureError, markCameraOn, store, renderCameraTab };
}

describe('generateTrackingSnippet — camera screens are the Eye Tracking module', () => {
    it('opens the Eye Tracking consent, face and calibration flow once, in the page language', () => {
        const { startCameraCapture, starts, withCamera, beginCapture } = runStartCameraCapture();
        startCameraCapture();
        startCameraCapture();

        expect(starts).toHaveLength(1);
        expect(starts[0]).toMatchObject({ lang: 'es', storageKey: '_ecx_eye_cal_r', hasEmotionRecognition: true });
        expect(withCamera).not.toHaveBeenCalled();
        expect(beginCapture).not.toHaveBeenCalled();
    });

    it('speaks English only on English pages', () => {
        const { startCameraCapture, starts } = runStartCameraCapture({ pageLang: 'en' });
        startCameraCapture();
        expect(starts[0].lang).toBe('en');
    });

    it('captures emotions and gaze on the calibrated session camera once calibration ends', () => {
        const { startCameraCapture, starts, beginCapture, loadFaceApi, state, markCameraOn } = runStartCameraCapture();
        startCameraCapture();
        expect(markCameraOn).not.toHaveBeenCalled();
        const video = { srcObject: { id: 'stream' } };
        starts[0].onReady({ video });
        expect(markCameraOn).toHaveBeenCalledTimes(1);

        expect(loadFaceApi).toHaveBeenCalledTimes(1);
        expect(beginCapture).toHaveBeenCalledTimes(1);
        expect(state()).toMatchObject({ emoVideo: video, isEyeFlowOpen: false });

        startCameraCapture();
        expect(starts).toHaveLength(1);
        expect(beginCapture).toHaveBeenCalledTimes(2);
    });

    it('skips camera capture when the visitor declines and reports a denied camera', () => {
        const { startCameraCapture, starts, skipCameraCapture, reportCaptureError, state } = runStartCameraCapture();
        startCameraCapture();
        starts[0].onCameraDenied();
        starts[0].onDecline();

        expect(reportCaptureError).toHaveBeenCalledWith('camera-denied');
        expect(skipCameraCapture).toHaveBeenCalledTimes(1);
        expect(state().isEyeFlowOpen).toBe(false);
    });

    it('captures emotions right away on a small camera when gaze is off', () => {
        const { startCameraCapture, starts, withCamera, beginCapture, markCameraOn } = runStartCameraCapture({ captureGaze: false });
        startCameraCapture();

        expect(markCameraOn).toHaveBeenCalledTimes(1);
        expect(starts).toHaveLength(0);
        expect(withCamera).toHaveBeenCalledTimes(1);
        expect(beginCapture).toHaveBeenCalledTimes(1);
    });

    it('resumes on the next page without screens only while the calibration is fresh', () => {
        const stale = runStartCameraCapture({ isCalibrationFresh: false });
        stale.startCameraCapture();
        expect(stale.starts).toHaveLength(0);
        expect(stale.store).toHaveBeenCalledWith('_ecx_cam_r', '0');
        expect(stale.renderCameraTab).toHaveBeenCalledTimes(1);

        const fresh = runStartCameraCapture({ isCalibrationFresh: true });
        fresh.startCameraCapture();
        expect(fresh.starts).toHaveLength(1);
    });

    it('does not open the camera until the visitor turns it on', () => {
        const { startCameraCapture, starts, withCamera } = runStartCameraCapture({ isChosen: false });
        startCameraCapture();
        expect(starts).toHaveLength(0);
        expect(withCamera).not.toHaveBeenCalled();
    });
});

interface FakeElement {
    id: string;
    type: string;
    textContent: string;
    style: Record<string, string>;
    children: FakeElement[];
    onclick: (() => void) | null;
    appendChild: (child: FakeElement) => void;
    remove: () => void;
}

function runCameraChoice({ stored = {}, captureGaze = true, captureEmotions = true }: { stored?: Record<string, string>; captureGaze?: boolean; captureEmotions?: boolean } = {}) {
    const js = generateTrackingSnippet({ ...defaultConfig, gazeMode: captureGaze ? 'optional' : 'off', emotionsMode: captureEmotions ? 'optional' : 'off' });
    const source = js.slice(js.indexOf('var CAMERA_CHOICE_KEY='), js.indexOf('// FACS Action Units'));
    const storage: Record<string, string> = { ...stored };
    const attached = new Map<string, FakeElement>();
    const createElement = (): FakeElement => {
        const element: FakeElement = {
            id: '', type: '', textContent: '', style: {}, children: [], onclick: null,
            appendChild: (child) => { element.children.push(child); },
            remove: () => { attached.delete(element.id); },
        };
        return element;
    };
    const document = {
        createElement,
        getElementById: (id: string) => attached.get(id) ?? null,
        body: { appendChild: (element: FakeElement) => { attached.set(element.id, element); } },
    };
    const openCameraCapture = vi.fn();
    const stopEmotionCapture = vi.fn();
    const releaseCamera = vi.fn();
    const reportCaptureError = vi.fn();
    const api = new Function('C', 'document', 'store', 'load', 'pageLanguage', 'openCameraCapture', 'stopEmotionCapture', 'releaseCamera', 'reportCaptureError', 'window',
        `${source}return {showCameraInvite:showCameraInvite,skipCameraCapture:skipCameraCapture,markCameraOn:markCameraOn,hasFreshCalibration:hasFreshCalibration};`,
    )({ gaze: captureGaze, emotions: captureEmotions, rid: 'r' }, document, (key: string, value: string) => { storage[key] = value; }, (key: string) => storage[key] ?? null, () => 'es',
        openCameraCapture, stopEmotionCapture, releaseCamera, reportCaptureError, { innerWidth: 1280 }) as { showCameraInvite: () => void; skipCameraCapture: () => void; markCameraOn: () => void; hasFreshCalibration: () => boolean };
    const invite = () => attached.get('_ecx_cam_invite');
    const inviteButton = (label: string) => invite()?.children[1].children.find((button) => button.textContent === label);
    return { ...api, storage, invite, inviteButton, tab: () => attached.get('_ecx_cam_tab'), openCameraCapture, stopEmotionCapture, releaseCamera, reportCaptureError };
}

describe('generateTrackingSnippet — camera only when the visitor turns it on', () => {
    it('invites first-time visitors in the footer, in Spanish, without opening the camera', () => {
        const { showCameraInvite, invite, tab, openCameraCapture } = runCameraChoice();
        showCameraInvite();
        expect(invite()?.children[0].textContent).toContain('Opcional: ayúdanos midiendo tu atención y emociones con la cámara');
        expect(tab()).toBeUndefined();
        expect(openCameraCapture).not.toHaveBeenCalled();
    });

    it('opens the camera screens from the footer and remembers the camera only once it is on', () => {
        const { showCameraInvite, inviteButton, invite, tab, storage, openCameraCapture, markCameraOn } = runCameraChoice();
        showCameraInvite();
        inviteButton('Activar cámara')?.onclick?.();
        expect(openCameraCapture).toHaveBeenCalledTimes(1);
        expect(storage).toEqual({ _ecx_cam_invite_r: '1' });
        expect(invite()).toBeUndefined();
        expect(tab()?.children[1].textContent).toBe('Ayúdanos con tu cámara');

        markCameraOn();
        expect(storage._ecx_cam_r).toBe('1');
        expect(tab()?.children[1].textContent).toBe('Cámara activa · desactivar');
    });

    it('treats a calibration saved in the last 10 minutes as fresh', () => {
        const recent = runCameraChoice({ stored: { _ecx_eye_cal_r: JSON.stringify({ savedAt: Date.now() - 60_000, samples: [] }) } });
        const old = runCameraChoice({ stored: { _ecx_eye_cal_r: JSON.stringify({ savedAt: Date.now() - 700_000, samples: [] }) } });
        const broken = runCameraChoice({ stored: { _ecx_eye_cal_r: '{' } });
        expect(recent.hasFreshCalibration()).toBe(true);
        expect(old.hasFreshCalibration()).toBe(false);
        expect(broken.hasFreshCalibration()).toBe(false);
        expect(runCameraChoice().hasFreshCalibration()).toBe(false);
    });

    it('leaves a side tab to turn it on later when the visitor dismisses the footer', () => {
        const { showCameraInvite, inviteButton, invite, tab, storage, openCameraCapture } = runCameraChoice();
        showCameraInvite();
        inviteButton('Entendido')?.onclick?.();
        expect(openCameraCapture).not.toHaveBeenCalled();
        expect(storage._ecx_cam_invite_r).toBe('1');
        expect(invite()).toBeUndefined();
        expect(tab()?.children[1].textContent).toBe('Ayúdanos con tu cámara');
        expect((tab()?.children[0] as unknown as { innerHTML: string }).innerHTML).toMatch(/^<svg [^>]*aria-hidden="true">/);
        tab()?.onclick?.();
        expect(openCameraCapture).toHaveBeenCalledTimes(1);
    });

    it('shows only the tab on later pages', () => {
        const { showCameraInvite, invite, tab } = runCameraChoice({ stored: { _ecx_cam_invite_r: '1' } });
        showCameraInvite();
        expect(invite()).toBeUndefined();
        expect(tab()?.children[1].textContent).toBe('Ayúdanos con tu cámara');
    });

    it('turns the camera off from the tab', () => {
        const { showCameraInvite, tab, storage, stopEmotionCapture, releaseCamera } = runCameraChoice({ stored: { _ecx_cam_r: '1' } });
        showCameraInvite();
        tab()?.onclick?.();
        expect(storage._ecx_cam_r).toBe('0');
        expect(stopEmotionCapture).toHaveBeenCalledTimes(1);
        expect(releaseCamera).toHaveBeenCalledTimes(1);
        expect(tab()?.children[1].textContent).toBe('Ayúdanos con tu cámara');
    });

    it('records camera-skipped and turns the camera off when the visitor declines the camera screens', () => {
        const { skipCameraCapture, storage, reportCaptureError, releaseCamera } = runCameraChoice({ stored: { _ecx_cam_r: '1' } });
        skipCameraCapture();
        expect(reportCaptureError).toHaveBeenCalledWith('camera-skipped');
        expect(storage._ecx_cam_r).toBe('0');
        expect(releaseCamera).toHaveBeenCalledTimes(1);
    });

    it('shows nothing when the study captures neither emotions nor gaze', () => {
        const { showCameraInvite, invite, tab } = runCameraChoice({ captureGaze: false, captureEmotions: false });
        showCameraInvite();
        expect(invite()).toBeUndefined();
        expect(tab()).toBeUndefined();
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

describe('generateTrackingSnippet — emotion sampling like the Eye Tracking module', () => {
    const startSamplingWith = (config: { emotions: boolean }, isFaceApiReady: boolean) => {
        const js = generateTrackingSnippet(defaultConfig);
        const source = js.slice(js.indexOf('function startSampling(){'), js.indexOf('function beginCapture('));
        const setInterval = vi.fn(() => 1);
        new Function('C', 'setInterval', 'sampleEmotion', 'sampleGaze', 'sampleFixation', 'eyeSession', 'faceApiReady',
            `var emoRunning=false,emoStartTime=0,emoInterval=null,gazeInterval=null,fixationInterval=null,EMO_SAMPLE_MS=50,GAZE_SAMPLE_MS=500,FIXATION_SAMPLE_MS=50;${source}startSampling();`,
        )(config, setInterval, 'sampleEmotion', 'sampleGaze', 'sampleFixation', {}, isFaceApiReady);
        return setInterval.mock.calls as unknown as Array<[string, number]>;
    };
    const gazeIntervals = [['sampleGaze', 500], ['sampleFixation', 50]];

    it('samples emotions 20 times per second, gaze twice per second and fixations 20 times per second', () => {
        expect(startSamplingWith({ emotions: true }, true)).toEqual([...gazeIntervals, ['sampleEmotion', 50]]);
    });

    it('does not sample emotions when captureEmotions is off or face-api failed', () => {
        expect(startSamplingWith({ emotions: false }, true)).toEqual(gazeIntervals);
        expect(startSamplingWith({ emotions: true }, false)).toEqual(gazeIntervals);
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

    it('resumes sampling after a tab switch only once capture began', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional' });
        expect(js).toContain('if(isCaptureStarted&&emoStream&&!emoRunning)startSampling();');
    });
});

describe('generateTrackingSnippet — one shared camera', () => {
    const loadWithCamera = (js: string, mediaDevices?: { getUserMedia: () => Promise<object> }, isCameraRequired = false) => {
        const source = js.slice(js.indexOf('var cameraWaiters=null;'), js.indexOf('function startSampling(){'));
        let resolveStream: (stream: object) => void = () => undefined;
        const getUserMedia = vi.fn(() => new Promise<object>((resolve) => { resolveStream = resolve; }));
        const reportCaptureError = vi.fn();
        const refuseRequiredCamera = vi.fn();
        const fakeDocument = { createElement: () => ({ setAttribute: () => undefined, style: {}, remove: () => undefined }), body: { appendChild: () => undefined } };
        const { withCamera, releaseCamera } = new Function('C', 'navigator', 'document', 'reportCaptureError', 'isCameraRequired', 'refuseRequiredCamera',
            `var emoVideo=null,emoStream=null,eyeSession=null;${source}return {withCamera:withCamera,releaseCamera:releaseCamera};`,
        )({ gaze: true }, { mediaDevices: mediaDevices ?? { getUserMedia } }, fakeDocument, reportCaptureError, () => isCameraRequired, refuseRequiredCamera) as {
            withCamera: (cb: (stream: object) => void) => void;
            releaseCamera: () => void;
        };
        return { withCamera, releaseCamera, getUserMedia, reportCaptureError, refuseRequiredCamera, resolveStream: (stream: object) => resolveStream(stream) };
    };
    const flushPromises = async () => { await Promise.resolve(); await Promise.resolve(); };

    it('opens the camera once when emotions and gaze start together and gives both the same stream', async () => {
        const { withCamera, getUserMedia, resolveStream } = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional' }));
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
        const { withCamera, releaseCamera, getUserMedia, resolveStream } = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional' }));
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
        const { withCamera, reportCaptureError } = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional' }), { getUserMedia });
        withCamera(() => undefined);
        await flushPromises();

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(reportCaptureError).toHaveBeenCalledWith('camera-denied');
    });

    it('leaves the visitor out of a camera-required study when the camera permission is refused', async () => {
        const getUserMedia = vi.fn(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
        const optional = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, emotionsMode: 'optional' }), { getUserMedia });
        const required = loadWithCamera(generateTrackingSnippet({ ...defaultConfig, emotionsMode: 'required' }), { getUserMedia }, true);
        optional.withCamera(() => undefined);
        required.withCamera(() => undefined);
        await flushPromises();

        expect(optional.refuseRequiredCamera).not.toHaveBeenCalled();
        expect(required.refuseRequiredCamera).toHaveBeenCalledTimes(1);
    });

    it('reports camera-unavailable when the browser has no camera API', () => {
        const { withCamera, reportCaptureError } = loadWithCamera(
            generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional' }),
            {} as { getUserMedia: () => Promise<object> },
        );
        expect(() => withCamera(() => undefined)).not.toThrow();
        expect(reportCaptureError).toHaveBeenCalledWith('camera-unavailable');
    });

    it('reports model load failures for the gaze bundle and face-api and keeps going', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, emotionsMode: 'optional' });
        expect(js).toContain('sc.onerror=function(){isEyeFlowOpen=false;reportCaptureError("mediapipe-failed");};');
        expect(js).toContain('function(){reportModelFailure(done);});');
        expect(js).toContain('sc.onerror=function(){reportModelFailure(done);};');
    });

    it('does not report face-api failures caused by leaving the page while models load', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, emotionsMode: 'optional' });
        const source = js.slice(js.indexOf('var isPageLeaving=false;'), js.indexOf('var cameraWaiters=null;'));
        const listeners: Record<string, () => void> = {};
        const window = { addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; } };
        const reportCaptureError = vi.fn();
        const reportModelFailure = new Function('window', 'reportCaptureError', `${source}return reportModelFailure;`)(window, reportCaptureError) as (cb: () => void) => void;
        const cb = vi.fn();

        reportModelFailure(cb);
        expect(reportCaptureError).toHaveBeenCalledTimes(1);

        listeners.pagehide();
        reportModelFailure(cb);
        expect(reportCaptureError).toHaveBeenCalledTimes(1);

        listeners.pageshow();
        reportModelFailure(cb);
        expect(reportCaptureError).toHaveBeenCalledTimes(2);
        expect(cb).toHaveBeenCalledTimes(3);
    });

    it('releases the camera 30s after the tab hides and on return after a long absence', () => {
        const js = generateTrackingSnippet(defaultConfig);
        const visibilityHandler = js.slice(js.indexOf('addEventListener("visibilitychange"'), js.indexOf('addEventListener("beforeunload"'));
        expect(visibilityHandler).toContain('cameraReleaseTimer=setTimeout(releaseCamera,30000);');
        expect(visibilityHandler).toContain('clearTimeout(cameraReleaseTimer);');
        expect(visibilityHandler).toContain('stopEmotionCapture();releaseCamera();');
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
            `var sid=null,buf=[{eventType:"mousemove",timestampMs:1},{eventType:"click",timestampMs:2}],pageStart=0,activeMs=0,activeStart=0,paused=false,rrwebStopFn=null,rrwebActiveMs=0,emoActiveMs=0,emoStartTime=0,vid="v",consented=true;${source}\ncreateSession();return buf;`,
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

describe('generateTrackingSnippet — gaze from the calibrated Eye Tracking session', () => {
    const runSampler = (sampler: 'sampleGaze' | 'sampleFixation', session: object) => {
        const js = generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional' });
        const source = js.slice(js.indexOf('var HEAD_DIST_DEG='), js.indexOf('// I-DT fixation detection')) +
            js.slice(js.indexOf('function captureElapsedMs(){'), js.indexOf('function startSampling(){')) +
            js.slice(js.indexOf('function rateGaze('), js.indexOf('function stopEmotionCapture(){'));
        const feedFixation = vi.fn();
        const gazeBuf = new Function('eyeSession', 'feedFixation', 'window',
            `var emoRunning=true,paused=false,EMO_MAX_MS=300000,gazeBuf=[],emoActiveMs=1000,emoStartTime=Date.now(),lastCursorX=5,lastCursorY=6;${source}${sampler}();return gazeBuf;`,
        )(session, feedFixation, { scrollX: 0, scrollY: 400, innerWidth: 1500, innerHeight: 900 }) as Array<Record<string, unknown>>;
        return { gazeBuf, feedFixation };
    };
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const sessionLookingAt = (x: number, y: number, isEyeOpen = true) => ({
        readLandmarks: () => landmarks,
        readGaze: () => ({ x, y }),
        readHeadPose: () => ({ pitch: 0, yaw: 0 }),
        isEyeOpen: () => isEyeOpen,
        calibrationRmsePx: isEyeOpen ? 70 : 200,
    });

    it('records the calibrated gaze point in page coordinates with its quality', () => {
        const { gazeBuf } = runSampler('sampleGaze', sessionLookingAt(300, 200));
        expect(gazeBuf).toHaveLength(1);
        expect(gazeBuf[0]).toMatchObject({ pageX: 300, pageY: 600, attention: 'engaged', score: 1, gazeQuality: 'good', gazeRmse: 70, cursorX: 5, cursorY: 6 });
    });

    it('takes the quadrant from the calibrated gaze on the viewport', () => {
        expect(runSampler('sampleGaze', sessionLookingAt(300, 200)).gazeBuf[0].quadrant).toBe('top-left');
        expect(runSampler('sampleGaze', sessionLookingAt(750, 450)).gazeBuf[0].quadrant).toBe('center');
        expect(runSampler('sampleGaze', sessionLookingAt(1400, 450)).gazeBuf[0].quadrant).toBe('center-right');
        expect(runSampler('sampleGaze', sessionLookingAt(750, 850)).gazeBuf[0].quadrant).toBe('bottom-center');
        expect(runSampler('sampleGaze', sessionLookingAt(300, 200)).gazeBuf[0]).not.toHaveProperty('quadrantProbs');
    });

    it('marks the visitor away when the session cannot see their eyes', () => {
        const { gazeBuf } = runSampler('sampleGaze', sessionLookingAt(300, 200, false));
        expect(gazeBuf[0]).toMatchObject({ attention: 'away', score: 0, gazeQuality: 'low' });
    });

    it('records nothing while the face is not detected', () => {
        const { gazeBuf } = runSampler('sampleGaze', { ...sessionLookingAt(300, 200), readLandmarks: () => null });
        expect(gazeBuf).toHaveLength(0);
    });

    it('feeds fixation detection with the calibrated gaze in page coordinates, only with open eyes', () => {
        expect(runSampler('sampleFixation', sessionLookingAt(300, 200)).feedFixation).toHaveBeenCalledWith(300, 600, expect.any(Number));
        expect(runSampler('sampleFixation', sessionLookingAt(300, 200, false)).feedFixation).not.toHaveBeenCalled();
        expect(runSampler('sampleGaze', sessionLookingAt(300, 200)).feedFixation).not.toHaveBeenCalled();
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
        const js = generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional', zones });
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
        const js = generateTrackingSnippet({ ...defaultConfig, gazeMode: 'optional', zones: [{ id: 'bad', pageUrl: 'https://x.com/', selector: 'div[' }] });
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

describe('generateTrackingSnippet — visitor sees and controls the recording', () => {
    function runRecordingPill() {
        const js = generateTrackingSnippet(defaultConfig);
        const source = js.slice(js.indexOf('var PILL_STYLE='), js.indexOf('// ─── Emotion + Gaze'));
        const attached = new Map<string, FakeElement & { setAttribute: () => void }>();
        const document = {
            createElement: () => {
                const element = {
                    id: '', type: '', textContent: '', style: {}, children: [] as FakeElement[], onclick: null as (() => void) | null,
                    setAttribute: () => undefined,
                    appendChild: (child: FakeElement) => { element.children.push(child); },
                    remove: () => { attached.delete(element.id); },
                };
                return element;
            },
            body: { appendChild: (element: FakeElement & { setAttribute: () => void }) => { attached.set(element.id, element); } },
        };
        const storage: Record<string, string> = {};
        const flushes = vi.fn();
        const rrwebStop = vi.fn();
        const stopCameraByChoice = vi.fn();
        const showNotice = vi.fn();
        const showConsent = vi.fn();
        const copy = { recording: 'Registrando tu navegación', stop: 'Detener', stopped: 'Dejamos de registrar tu navegación.', off: 'Registro desactivado', resume: 'Activar' };
        const api = new Function('C', 'document', 'store', 'flush', 'flushRrweb', 'flushEmotions', 'flushGaze', 'stopCameraByChoice', 'showNotice', 'visitorCopy', 'rrwebStopFn', 'showConsent', 'consented',
            `function removeElement(id){var el=attached(id);if(el)el.remove();}var attached=arguments[13];${source}return {renderRecordingPill:renderRecordingPill,isConsented:function(){return consented;},hasRrweb:function(){return rrwebStopFn!==null;}};`,
        )({ rid: 'r' }, document, (key: string, value: string) => { storage[key] = value; }, flushes, flushes, flushes, flushes, stopCameraByChoice, showNotice, () => copy, rrwebStop, showConsent, true,
            (id: string) => attached.get(id) ?? null) as { renderRecordingPill: () => void; isConsented: () => boolean; hasRrweb: () => boolean };
        return { ...api, pill: () => attached.get('_ecx_rec'), offPill: () => attached.get('_ecx_off'), storage, flushes, rrwebStop, stopCameraByChoice, showNotice, showConsent };
    }

    it('shows a recording pill whose stop button flushes, stops capture and remembers the choice', () => {
        const run = runRecordingPill();
        run.renderRecordingPill();
        expect(run.pill()?.children[0].textContent).toBe('● Registrando tu navegación');

        run.pill()?.children[1].onclick?.();
        expect(run.flushes).toHaveBeenCalledTimes(4);
        expect(run.isConsented()).toBe(false);
        expect(run.rrwebStop).toHaveBeenCalledTimes(1);
        expect(run.hasRrweb()).toBe(false);
        expect(run.stopCameraByChoice).toHaveBeenCalledTimes(1);
        expect(run.storage).toEqual({ _ecx_consent_r: '0' });
        expect(run.pill()).toBeUndefined();
        expect(run.showNotice).toHaveBeenCalledWith('Dejamos de registrar tu navegación.');

        expect(run.offPill()?.children[0].textContent).toBe('○ Registro desactivado');
        run.offPill()?.children[1].onclick?.();
        expect(run.offPill()).toBeUndefined();
        expect(run.showConsent).toHaveBeenCalledTimes(1);
    });

    it('tells the visitor exactly what the study saves and what it does not', () => {
        const describe = (config: Partial<typeof defaultConfig>, language: string) => {
            const js = generateTrackingSnippet({ ...defaultConfig, ...config });
            const source = js.slice(js.indexOf('var VISITOR_COPY='), js.indexOf('function isCameraChosen(){'));
            const C = { clicks: config.captureClicks ?? true, scroll: config.captureScroll ?? true, mouse: config.captureMousemove ?? false, emotions: (config.emotionsMode ?? 'optional') !== 'off', emotionsRequired: config.emotionsMode === 'required', gaze: (config.gazeMode ?? 'off') !== 'off', gazeRequired: config.gazeMode === 'required' };
            return new Function('C', 'pageLanguage', `${source}return describeConsent();`)(C, () => language) as string;
        };

        expect(describe({ captureMousemove: true }, 'es')).toBe(
            '<strong>Este sitio participa en un estudio de experiencia de usuario.</strong><br>'
            + 'Si aceptas, guardamos cómo usas la página: clics, scroll, movimiento del ratón y una grabación de la pantalla de este sitio. '
            + 'No guardamos lo que escribes en formularios, tu nombre ni tu IP. '
            + 'La cámara es aparte y opcional: solo se activa si la eliges, y sus imágenes no salen de tu dispositivo. '
            + 'Si rechazas no se guarda nada y el sitio funciona igual. Si aceptas, puedes detenerlo cuando quieras.',
        );
        expect(describe({ captureClicks: false, captureScroll: false, emotionsMode: 'off' }, 'en')).toBe(
            '<strong>This site is part of a user experience study.</strong><br>'
            + 'If you accept, we save how you use the page: a screen recording of this site. '
            + 'We do not save what you type in forms, your name or your IP. '
            + 'If you decline, nothing is saved and the site works the same. If you accept, you can stop it at any time.',
        );
    });

    it('says the camera is required, and calibration too when gaze is required', () => {
        const describeFor = (config: Partial<typeof defaultConfig>) => {
            const js = generateTrackingSnippet({ ...defaultConfig, ...config });
            const source = js.slice(js.indexOf('var VISITOR_COPY='), js.indexOf('function isCameraChosen(){'));
            const C = { clicks: true, scroll: true, mouse: false, emotions: config.emotionsMode !== 'off', emotionsRequired: config.emotionsMode === 'required', gaze: config.gazeMode !== 'off', gazeRequired: config.gazeMode === 'required' };
            return new Function('C', 'pageLanguage', `${source}return describeConsent();`)(C, () => 'es') as string;
        };

        expect(describeFor({ emotionsMode: 'required', gazeMode: 'off' })).toContain('Para participar es necesario activar la cámara; sus imágenes no salen de tu dispositivo.');
        expect(describeFor({ emotionsMode: 'optional', gazeMode: 'required' })).toContain('Para participar es necesario activar la cámara y calibrar la mirada;');
        expect(describeFor({ emotionsMode: 'optional', gazeMode: 'optional' })).toContain('La cámara es aparte y opcional');
    });

    it('starts nothing on later pages once the visitor declined or stopped, even without required consent', () => {
        const js = generateTrackingSnippet({ ...defaultConfig, consentRequired: false });
        const init = js.slice(js.indexOf('    loadRrweb(function(){'), js.indexOf('if(document.readyState'));
        expect(init).toContain('if(prev==="0"){renderResumePill();return;}');
        expect(init.indexOf('if(prev==="0")')).toBeLessThan(init.indexOf('startSession()'));
    });

    it('never creates a session, records rrweb or sends the snapshot after the visitor stops', () => {
        const js = generateTrackingSnippet(defaultConfig);
        expect(js).toContain('function createSession(){\n    if(!consented)return;');
        expect(js).toContain('if(!consented||!window.rrweb||!window.rrweb.record)return;');
        expect(js).toContain('setTimeout(function(){\n            if(!consented)return;');
    });
});
