import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const faceApi = vi.hoisted(() => ({
    detection: null as unknown,
    slowDetection: null as Promise<unknown> | null,
    detectCalls: 0,
    loadFromUri: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vladmandic/face-api', () => {
    const net = { loadFromUri: (uri: string) => faceApi.loadFromUri(uri) };
    return {
        nets: { tinyFaceDetector: net, faceLandmark68Net: net, faceExpressionNet: net },
        TinyFaceDetectorOptions: class {},
        detectSingleFace: () => {
            faceApi.detectCalls++;
            return {
                withFaceLandmarks: () => ({
                    withFaceExpressions: () => faceApi.slowDetection ?? Promise.resolve(faceApi.detection),
                }),
            };
        },
    };
});

const LANDMARKS_68 = Array.from({ length: 68 }, (_, i) => ({ x: 100 + (i % 17) * 6, y: 100 + Math.floor(i / 17) * 20 }));

const faceWith = (expressions: Record<string, number>) => ({
    expressions,
    landmarks: { positions: LANDMARKS_68 },
});

let frameCallbacks: FrameRequestCallback[] = [];
let clockMs = 0;

const runFrame = async (advanceMs = 100) => {
    clockMs += advanceMs;
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    await act(async () => {
        callbacks.forEach(cb => cb(clockMs));
        await Promise.resolve();
        await Promise.resolve();
    });
};

const loadHook = async (enabled = true) => {
    const { useFaceApiEmotions } = await import('../useFaceApiEmotions');
    const videoRef = { current: { readyState: 4 } as HTMLVideoElement };
    return renderHook(() => useFaceApiEmotions({ videoRef, enabled, sampleIntervalMs: 50 }));
};

const flushModelLoad = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('useFaceApiEmotions', () => {
    beforeEach(() => {
        vi.resetModules();
        frameCallbacks = [];
        clockMs = 1000;
        faceApi.detection = faceWith({ neutral: 0.9, happy: 0.1 });
        faceApi.slowDetection = null;
        faceApi.detectCalls = 0;
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            frameCallbacks.push(cb);
            return frameCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => { frameCallbacks = []; });
        vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('does not load the face-api models when emotion recognition is disabled', async () => {
        const { result } = await loadHook(false);
        await flushModelLoad();

        expect(faceApi.loadFromUri).not.toHaveBeenCalled();
        expect(result.current.isLoaded).toBe(false);
    });

    it('records the strongest face-api expression mapped to its Ekman label with its score', async () => {
        faceApi.detection = faceWith({ neutral: 0.1, happy: 0.8, angry: 0.05, surprised: 0.05 });
        const { result } = await loadHook();
        await flushModelLoad();

        act(() => { result.current.start(); });
        await runFrame();

        const [sample] = result.current.getSamples();
        expect(sample.emotion).toBe('joy');
        expect(sample.confidence).toBe(0.8);
        expect(Object.keys(sample.actionUnits).sort()).toEqual(['AU1', 'AU12', 'AU15', 'AU2', 'AU20', 'AU25', 'AU26', 'AU4', 'AU6']);
    });

    it.each([
        ['sad', 'sadness'],
        ['angry', 'anger'],
        ['surprised', 'surprise'],
        ['disgusted', 'disgust'],
        ['fearful', 'fear'],
        ['neutral', 'neutral'],
    ])('maps face-api "%s" to "%s"', async (faceApiKey, ekman) => {
        faceApi.detection = faceWith({ [faceApiKey]: 0.7, happy: 0.1 });
        const { result } = await loadHook();
        await flushModelLoad();

        act(() => { result.current.start(); });
        await runFrame();

        expect(result.current.getSamples()[0].emotion).toBe(ekman);
    });

    it('starts sampling once the models finish loading when start() was called before', async () => {
        const { result } = await loadHook();

        act(() => { result.current.start(); });
        expect(result.current.isLoaded).toBe(false);
        expect(frameCallbacks).toHaveLength(0);

        await flushModelLoad();
        await runFrame();

        expect(result.current.isLoaded).toBe(true);
        expect(result.current.getSamples()).toHaveLength(1);
    });

    it('measures sample time from the start() call even when the models finish loading later', async () => {
        const { result } = await loadHook();

        clockMs = 50_000;
        act(() => { result.current.start(); });
        clockMs += 400;
        await flushModelLoad();
        await runFrame(100);

        expect(result.current.getSamples()[0].timestamp).toBe(500);
    });

    it('stamps samples with the time elapsed since start()', async () => {
        const { result } = await loadHook();
        await flushModelLoad();

        clockMs = 50_000;
        act(() => { result.current.start(); });
        await runFrame(100);
        await runFrame(250);

        expect(result.current.getSamples().map(s => s.timestamp)).toEqual([100, 350]);
    });

    it('adds no sample for frames without a detected face', async () => {
        const { result } = await loadHook();
        await flushModelLoad();

        act(() => { result.current.start(); });
        await runFrame();
        faceApi.detection = null;
        await runFrame();
        await runFrame();

        expect(result.current.getSamples()).toHaveLength(1);
    });

    it('skips frames closer together than the sampling interval', async () => {
        const { result } = await loadHook();
        await flushModelLoad();

        act(() => { result.current.start(); });
        await runFrame(100);
        await runFrame(20);
        await runFrame(20);
        await runFrame(20);

        expect(result.current.getSamples()).toHaveLength(2);
    });

    it('stops recording after stop() and keeps the collected samples', async () => {
        const { result } = await loadHook();
        await flushModelLoad();

        act(() => { result.current.start(); });
        await runFrame();
        await runFrame();
        act(() => { result.current.stop(); });
        await runFrame();

        expect(result.current.getSamples()).toHaveLength(2);
        expect(frameCallbacks).toHaveLength(0);
    });

    it('a new start() discards the samples of the previous run', async () => {
        const { result } = await loadHook();
        await flushModelLoad();

        act(() => { result.current.start(); });
        await runFrame();
        await runFrame();
        act(() => { result.current.stop(); });
        act(() => { result.current.start(); });
        await runFrame();

        expect(result.current.getSamples()).toHaveLength(1);
    });

    it('stop() before the models load cancels the pending start', async () => {
        const { result } = await loadHook();

        act(() => { result.current.start(); });
        act(() => { result.current.stop(); });
        await flushModelLoad();
        await runFrame();

        expect(result.current.getSamples()).toHaveLength(0);
    });

    it('waits for a slow detection to finish before starting the next one', async () => {
        const { result } = await loadHook();
        await flushModelLoad();
        let finishDetection: (value: unknown) => void = () => {};
        faceApi.slowDetection = new Promise(resolve => { finishDetection = resolve; });

        act(() => { result.current.start(); });
        for (let frame = 0; frame < 5; frame++) await runFrame(100);
        expect(faceApi.detectCalls).toBe(1);

        faceApi.slowDetection = null;
        await act(async () => { finishDetection(faceApi.detection); });
        await runFrame(100);

        expect(faceApi.detectCalls).toBe(2);
        expect(result.current.getSamples()).toHaveLength(2);
    });

    it('getSamples() returns a copy that later frames do not mutate', async () => {
        const { result } = await loadHook();
        await flushModelLoad();

        act(() => { result.current.start(); });
        await runFrame();
        const snapshot = result.current.getSamples();
        await runFrame();

        expect(snapshot).toHaveLength(1);
        expect(result.current.getSamples()).toHaveLength(2);
    });
});
