import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMediaPipeGaze } from '../useMediaPipeGaze';
import { EYE_LOOK_BLENDSHAPES } from '../../lib/eyeTracking/constants';

const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
const eyes: Record<number, [number, number]> = {
    33: [0.40, 0.45], 133: [0.46, 0.45], 159: [0.43, 0.435], 145: [0.43, 0.465], 468: [0.43, 0.45],
    362: [0.54, 0.45], 263: [0.60, 0.45], 386: [0.57, 0.435], 374: [0.57, 0.465], 473: [0.57, 0.45],
};
for (const [index, [x, y]] of Object.entries(eyes)) face[Number(index)] = { x, y, z: 0 };

vi.mock('../../lib/eyeTracking/faceLandmarker', () => ({
    createFaceLandmarker: vi.fn(async () => ({
        detectForVideo: () => ({ faceLandmarks: [face], facialTransformationMatrixes: [], faceBlendshapes: [{ categories: EYE_LOOK_BLENDSHAPES.map((categoryName, index) => ({ categoryName, score: 0, index, displayName: '' })) }] }),
        close: vi.fn(),
    })),
}));

let frameCallbacks: FrameRequestCallback[] = [];
const runFrames = (count: number) => {
    for (let frame = 0; frame < count; frame++) {
        const pending = frameCallbacks;
        frameCallbacks = [];
        pending.forEach(callback => callback(performance.now()));
    }
};

describe('useMediaPipeGaze calibration sampling', () => {
    beforeEach(() => {
        frameCallbacks = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frameCallbacks.push(callback); return frameCallbacks.length; });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });
    afterEach(() => vi.unstubAllGlobals());

    it('adds one calibration sample per tracked frame while a target is set', async () => {
        const videoRef = { current: { readyState: 4, videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement };
        const { result } = renderHook(() => useMediaPipeGaze(videoRef));
        await waitFor(() => expect(result.current.isLoaded).toBe(true));
        act(() => result.current.start());

        act(() => runFrames(3));
        expect(result.current.predictorRef.current.sampleCount).toBe(0);

        act(() => { result.current.collectCalibrationSamples([100, 200]); runFrames(5); });
        expect(result.current.predictorRef.current.sampleCount).toBe(5);

        act(() => { result.current.collectCalibrationSamples(null); runFrames(4); });
        expect(result.current.predictorRef.current.sampleCount).toBe(5);
    });
});
