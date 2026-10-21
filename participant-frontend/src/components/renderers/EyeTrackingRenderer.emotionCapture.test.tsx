import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GazePredictor } from '../../lib/eyeTracking/gazePredictor';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}));

const mockSaveResponse = vi.fn();
vi.mock('../../stores/useParticipantStore', () => ({
    useParticipantStore: () => ({ saveResponse: mockSaveResponse }),
}));


vi.mock('../../services/media.service', () => ({
    mediaService: { resolveUrl: (u: string) => u },
}));

const mockBlazeGaze = {
    start: vi.fn(),
    stop: vi.fn(),
    isLoaded: true,
    gazeState: 'closed',
    calibrationCount: 0,
    gazePosRef: { current: [0, 0] },
    getFrameStats: () => ({ validGazeFrames: 0, noValidGazeFrames: 0, captureWidthPx: 1280, captureHeightPx: 720 }),
    calibrate: vi.fn(),
    trainRidge: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../hooks/useBlazeGaze', () => ({
    useBlazeGaze: () => ({ ...mockBlazeGaze }),
}));

const mockMPGaze = {
    start: vi.fn(),
    stop: vi.fn(),
    gazeState: 'closed',
    gazePosRef: { current: [0, 0] },
    headPoseRef: { current: { pitch: 0, yaw: 0 } },
    earRef: { current: 0.3 },
    lastLandmarksRef: { current: null },
    predictorRef: { current: null },
    calibrate: vi.fn(),
    resetFrameStats: vi.fn(),
    getFrameStats: () => ({ validGazeFrames: 0, noValidGazeFrames: 0, captureWidthPx: null, captureHeightPx: null }),
};
vi.mock('../../hooks/useMediaPipeGaze', () => ({
    useMediaPipeGaze: () => mockMPGaze,
}));

const mockEmotionSamples = [
    { timestamp: 100, emotion: 'joy', confidence: 0.9, actionUnits: {} },
    { timestamp: 200, emotion: 'neutral', confidence: 0.7, actionUnits: {} },
];

const mockFaceStart = vi.fn();
const mockFaceStop = vi.fn();
const mockGetSamples = vi.fn(() => [...mockEmotionSamples]);
vi.mock('../../hooks/useFaceApiEmotions', () => ({
    useFaceApiEmotions: () => ({
        start: mockFaceStart,
        stop: mockFaceStop,
        getSamples: mockGetSamples,
        samples: mockEmotionSamples,
        isLoaded: true,
    }),
}));

vi.mock('../../lib/eyeTracking', () => ({
    BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS: { video: true },
    HYBRID_CALIBRATION_FIELD_STRENGTH: 0.5,
    HYBRID_IMAGE_CALIBRATION_POINTS: [[10, 10], [50, 50], [90, 90]],
    HYBRID_AOI_GRID: [{ id: 'z1' }],
    hybridApplyCalibrationField: vi.fn((x: number, y: number) => ({ x, y })),
    hybridResidualsFromTrainedPoints: (points: unknown[]) => points.map(() => ({ u: 0.5, v: 0.5, dx: 3, dy: 4 })),
    hybridCalibrationRmsePx: vi.fn(() => 10),
    hybridImagePercentToBlazeNorm: vi.fn(() => [0, 0]),
    hybridPointToSoftZoneWeights: vi.fn(() => ({ z1: 1 })),
    hybridCalibrationConfidenceWeightUv: vi.fn(() => 1),
    expandGazeWithMinimumJerkGapFill: vi.fn((a: unknown) => a),
    HYBRID_GAP_FILL_SYNTHETIC_WEIGHT: 0.5,
    detectFixationsIDT: vi.fn(() => []),
    mapFixationsToImageCoords: vi.fn(() => []),
    MICRO_RECALIB_INTERVAL_MS: 45000,
    MICRO_RECALIB_SAMPLE_DURATION_MS: 2000,
    MICRO_RECALIB_SAMPLE_COUNT: 10,
    MICRO_RECALIB_POSITIONS: [],
    computeMicroRecalibResidual: vi.fn(),
    detectMicroExpressions: vi.fn(() => []),
    isBlazeGazeCaptureResolutionLow: vi.fn(() => false),
}));

vi.mock('../../lib/eyeTracking/zoneRegistry', () => ({
    ZoneRegistry: vi.fn().mockImplementation(function () { return { register: vi.fn(), getZones: vi.fn(() => []), destroy: vi.fn() }; }),
    generateGrid: vi.fn(() => []),
}));
vi.mock('../../lib/eyeTracking/zoneEventEmitter', () => ({
    ZoneEventEmitter: vi.fn().mockImplementation(function () { return { on: vi.fn(), feed: vi.fn(), destroy: vi.fn() }; }),
}));
vi.mock('../../lib/eyeTracking/v2ResponseBuilder', () => ({
    EYE_TRACKING_V2_ENABLED: false,
    buildV2Response: vi.fn(),
}));
vi.mock('../../lib/eyeTracking/deviceProfile', () => ({
    getCurrentDeviceProfile: vi.fn(() => ({ gazeRadius: 40, hysteresisFrames: 3 })),
}));
vi.mock('../../lib/eyeTracking/attention/uncertaintyEstimator', () => ({
    fitFromLoocvResiduals: vi.fn(() => []),
    fitFromHybridResiduals: vi.fn(() => []),
    computeFrameUncertainty: vi.fn(() => 0),
}));
vi.mock('../../lib/eyeTracking/attention/probabilisticHeatmap', () => ({
    ProbabilisticHeatmap: vi.fn().mockImplementation(function () {
        const grid = { data: new Float32Array(1), cols: 1, rows: 1, cellW: 1, cellH: 1 };
        return {
            addSample: vi.fn(), render: vi.fn(), totalDurationS: 0,
            getDensityGrid: vi.fn(() => grid), getAOIMetrics: vi.fn(() => []),
            getFirstAttentionGrid: vi.fn(() => grid), getPeakTimeGrid: vi.fn(() => grid), hasTemporalData: vi.fn(() => false),
        };
    }),
}));
vi.mock('../../lib/eyeTracking/attention/sessionMetrics', () => ({
    computeSessionConfidence: vi.fn(() => ({})),
    computeSpatialCoverage: vi.fn(() => 1),
}));

vi.mock('./eye-tracking/ConsentPhase', () => ({
    ConsentPhase: ({ onAccept, onDecline }: { onAccept: () => Promise<boolean>; onDecline: () => void }) => (
        <>
            <button data-testid="consent-accept" onClick={() => { void onAccept(); }}>Accept</button>
            <button data-testid="consent-decline" onClick={onDecline}>Decline</button>
        </>
    ),
}));
vi.mock('./eye-tracking/FacePositionPhase', () => ({
    FacePositionPhase: ({ onContinue }: { onContinue: () => void }) => <button data-testid="face-continue" onClick={onContinue}>Continue</button>,
}));
vi.mock('./eye-tracking/PreparingPhase', () => ({
    PreparingPhase: () => <div data-testid="preparing-phase" />,
}));
vi.mock('./eye-tracking/CalibrationPhase', () => ({
    CalibrationPhase: ({ calibrationAreaRef, dwellStartedAt, interruptionCount }: { calibrationAreaRef: React.RefObject<HTMLDivElement>; dwellStartedAt: number | null; interruptionCount: number }) => (
        <div data-testid="calibration-phase" data-dwelling={String(dwellStartedAt !== null)} data-interruptions={interruptionCount} ref={calibrationAreaRef} />
    ),
}));
vi.mock('./eye-tracking/ViewingPhase', () => ({
    ViewingPhase: ({ imgRef }: { imgRef: React.RefObject<HTMLImageElement> }) => <img data-testid="viewing-phase" ref={imgRef} alt="" />,
}));
vi.mock('./eye-tracking/CompletePhase', () => ({
    CompletePhase: () => <div data-testid="complete-phase" />,
}));

let mockDeviceType = 'mobile';
vi.mock('./eye-tracking/types', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('./eye-tracking/types');
    return {
        ...actual,
        getDeviceType: () => mockDeviceType,
    };
});

import { EyeTrackingRenderer } from './EyeTrackingRenderer';
import { rememberCalibration } from './eye-tracking/calibrationCache';
import { detectMicroExpressions, detectFixationsIDT, mapFixationsToImageCoords } from '../../lib/eyeTracking';

const mockGetUserMedia = vi.fn();
const trainedPredictor = { isReady: () => true } as unknown as GazePredictor;
const STIMULUS_RECT = { left: 0, top: 0, width: 400, height: 300, x: 0, y: 0, right: 400, bottom: 300, toJSON: () => ({}) } as DOMRect;

function makeModule(emotionRecognition: string) {
    return {
        id: 'test-et-1',
        name: 'Eye Tracking Test',
        module_type: 'eye_tracking',
        structure: {
            components: [
                { id: 'stimuli', type: 'file-upload', value: JSON.stringify([{ s3Key: 'test.jpg' }]) },
                { id: 'emotion-recognition', type: 'toggle', value: emotionRecognition },
                { id: 'priming-time', type: 'text', value: '5' },
            ],
        },
    };
}

describe('EyeTrackingRenderer emotion capture pipeline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDeviceType = 'mobile';
        vi.useFakeTimers({ shouldAdvanceTime: true });
        rememberCalibration('previous-et-module', { residuals: [{ u: 0.5, v: 0.5, dx: 0, dy: 0 }], rmsePx: 10, predictor: trainedPredictor });
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mockGetUserMedia } });
        mockGetUserMedia.mockResolvedValue({ getTracks: () => [] });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        mockMPGaze.gazeState = 'closed';
        mockMPGaze.gazePosRef = { current: [0, 0] } as unknown as typeof mockMPGaze.gazePosRef;
    });

    it('mobile + emotion recognition: faceEmotions.start() called when phase reaches viewing', async () => {
        mockDeviceType = 'mobile';
        render(
            <EyeTrackingRenderer module={makeModule('true')} onComplete={vi.fn()} />
        );

        await act(async () => { vi.advanceTimersByTime(2000); });

        expect(mockFaceStart).toHaveBeenCalled();
    });

    it('mobile + emotion recognition: faceEmotions.stop() called on cleanup from viewing', async () => {
        mockDeviceType = 'mobile';
        const { unmount } = render(
            <EyeTrackingRenderer module={makeModule('true')} onComplete={vi.fn()} />
        );

        await act(async () => { vi.advanceTimersByTime(2000); });

        mockFaceStop.mockClear();
        unmount();

        expect(mockFaceStop).toHaveBeenCalled();
    });

    it('mobile WITHOUT emotion recognition: faceEmotions.start() never called', async () => {
        mockDeviceType = 'mobile';
        render(
            <EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />
        );

        await act(async () => { vi.advanceTimersByTime(2000); });

        expect(mockFaceStart).not.toHaveBeenCalled();
    });

    it('mobile + emotion recognition: video element is mounted (stream target exists)', () => {
        mockDeviceType = 'mobile';
        const { container } = render(
            <EyeTrackingRenderer module={makeModule('true')} onComplete={vi.fn()} />
        );
        expect(container.querySelector('video')).not.toBeNull();
    });

    it('calibration cached by the same module is not reused: starts at consent without asking for the camera', () => {
        rememberCalibration('test-et-1', { residuals: [], rmsePx: null, predictor: trainedPredictor });
        const { queryByTestId } = render(
            <EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />
        );
        expect(queryByTestId('consent-accept')).not.toBeNull();
        expect(queryByTestId('preparing-phase')).toBeNull();
        expect(mockGetUserMedia).not.toHaveBeenCalled();
    });

    it('accepting consent turns on the camera and shows the face guide', async () => {
        rememberCalibration('test-et-1', { residuals: [], rmsePx: null, predictor: trainedPredictor });
        const { getByTestId, queryByTestId } = render(<EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />);

        await act(async () => { fireEvent.click(getByTestId('consent-accept')); });

        expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
        expect(queryByTestId('face-continue')).not.toBeNull();
    });

    it('stays on consent when camera permission is denied', async () => {
        rememberCalibration('test-et-1', { residuals: [], rmsePx: null, predictor: trainedPredictor });
        mockGetUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { getByTestId, queryByTestId } = render(<EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />);

        await act(async () => { fireEvent.click(getByTestId('consent-accept')); });

        expect(queryByTestId('consent-accept')).not.toBeNull();
        expect(queryByTestId('face-continue')).toBeNull();
    });

    it('declining consent skips the activity without camera or saved response', async () => {
        rememberCalibration('test-et-1', { residuals: [], rmsePx: null, predictor: trainedPredictor });
        const onComplete = vi.fn();
        const { getByTestId } = render(<EyeTrackingRenderer module={makeModule('false')} onComplete={onComplete} />);

        fireEvent.click(getByTestId('consent-decline'));
        await act(async () => { vi.advanceTimersByTime(3000); });

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(mockGetUserMedia).not.toHaveBeenCalled();
        expect(mockSaveResponse).not.toHaveBeenCalled();
    });

    it('mobile records camera gaze during viewing without taps', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        mockMPGaze.gazeState = 'open';
        mockMPGaze.gazePosRef = { current: { x: 120, y: 80 } } as unknown as typeof mockMPGaze.gazePosRef;

        render(<EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />);
        await act(async () => { vi.advanceTimersByTime(1600); });
        await act(async () => { vi.advanceTimersByTime(5500); });

        const saved = JSON.parse(mockSaveResponse.mock.calls[0][2]);
        expect(mockMPGaze.start).toHaveBeenCalled();
        expect(saved.trackingMethod).toBe('mediapipe-ridge');
        expect(saved.gazePointCount).toBeGreaterThan(0);
    });

    it('consecutive module records gaze when the face is detected after viewing starts', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        mockMPGaze.gazePosRef = { current: { x: 120, y: 80 } } as unknown as typeof mockMPGaze.gazePosRef;
        const module = makeModule('false');
        const onComplete = vi.fn();

        const { rerender } = render(<EyeTrackingRenderer module={module} onComplete={onComplete} />);
        await act(async () => { vi.advanceTimersByTime(1600); });
        mockMPGaze.gazeState = 'open';
        rerender(<EyeTrackingRenderer module={module} onComplete={onComplete} />);
        await act(async () => { vi.advanceTimersByTime(5500); });

        const saved = JSON.parse(mockSaveResponse.mock.calls[0][2]);
        expect(saved.gazePointCount).toBeGreaterThan(0);
    });

    it('goes from the last calibration point straight to viewing and saves the trained model error and face distance', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        const trainedPoint = { targetX: 40, targetY: 30, predX: 37, predY: 26 };
        mockMPGaze.predictorRef = { current: { cvRmsePx: 85, diagnostics: { perPoint: [trainedPoint, trainedPoint, trainedPoint] } } } as unknown as typeof mockMPGaze.predictorRef;
        const irisWidth = 640 / Math.tan(Math.PI / 6) * 1.17 / 50 / 1280;
        const faceAt50Cm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
        for (const [inner, outer] of [[469, 471], [474, 476]]) {
            faceAt50Cm[inner] = { x: 0.5 - irisWidth / 2, y: 0.45 };
            faceAt50Cm[outer] = { x: 0.5 + irisWidth / 2, y: 0.45 };
        }
        mockMPGaze.lastLandmarksRef = { current: faceAt50Cm } as unknown as typeof mockMPGaze.lastLandmarksRef;
        vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280);
        vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720);
        rememberCalibration('test-et-1', { residuals: [], rmsePx: null, predictor: trainedPredictor });
        mockMPGaze.gazeState = 'open';
        mockMPGaze.gazePosRef = { current: { x: 120, y: 80 } } as unknown as typeof mockMPGaze.gazePosRef;

        const { getByTestId, queryByTestId } = render(<EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />);
        await act(async () => { fireEvent.click(getByTestId('consent-accept')); });
        fireEvent.click(getByTestId('face-continue'));
        await act(async () => { vi.advanceTimersByTime(2100); });
        for (let point = 0; point < 3; point++) {
            await act(async () => { vi.advanceTimersByTime(2500); });
        }
        await act(async () => { vi.advanceTimersByTime(700); });

        expect(queryByTestId('viewing-phase')).not.toBeNull();
        await act(async () => { vi.advanceTimersByTime(5500); });
        const saved = JSON.parse(mockSaveResponse.mock.calls[0][2]);
        expect(mockMPGaze.calibrate).toHaveBeenCalledTimes(3);
        expect(saved).not.toHaveProperty('validationRmsePx');
        expect(saved.calibrationRmsePx).toBe(85);
        expect(saved.calibrationQuality).toBe('mediapipe-3pt');
        expect(saved.faceDistanceCm).toBe(50);
        mockMPGaze.predictorRef = { current: null };
        mockMPGaze.lastLandmarksRef = { current: null };
    });

    it('leaves "Starting camera" for calibration while gaze updates re-render every 200ms', async () => {
        rememberCalibration('test-et-1', { residuals: [], rmsePx: null, predictor: trainedPredictor });
        const module = makeModule('false');
        const onComplete = vi.fn();
        const { getByTestId, queryByTestId, rerender } = render(<EyeTrackingRenderer module={module} onComplete={onComplete} />);
        await act(async () => { fireEvent.click(getByTestId('consent-accept')); });
        fireEvent.click(getByTestId('face-continue'));

        for (let elapsedMs = 0; elapsedMs < 2400; elapsedMs += 200) {
            rerender(<EyeTrackingRenderer module={module} onComplete={onComplete} />);
            await act(async () => { vi.advanceTimersByTime(200); });
        }

        expect(queryByTestId('preparing-phase')).toBeNull();
        expect(queryByTestId('calibration-phase')).not.toBeNull();
    });

    const reachCalibration = async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        rememberCalibration('test-et-1', { residuals: [], rmsePx: null, predictor: trainedPredictor });
        const module = makeModule('false');
        const onComplete = vi.fn();
        const rendered = render(<EyeTrackingRenderer module={module} onComplete={onComplete} />);
        await act(async () => { fireEvent.click(rendered.getByTestId('consent-accept')); });
        fireEvent.click(rendered.getByTestId('face-continue'));
        await act(async () => { vi.advanceTimersByTime(2100); });
        const rerenderEvery200ms = async (durationMs: number) => {
            for (let elapsedMs = 0; elapsedMs < durationMs; elapsedMs += 200) {
                rendered.rerender(<EyeTrackingRenderer module={module} onComplete={onComplete} />);
                await act(async () => { vi.advanceTimersByTime(200); });
            }
        };
        return { ...rendered, rerenderEvery200ms };
    };

    it('records a calibration point after 2.5 s with no tap, wherever the uncalibrated gaze points', async () => {
        mockMPGaze.gazeState = 'open';
        mockMPGaze.gazePosRef = { current: { x: 2000, y: 2000 } } as unknown as typeof mockMPGaze.gazePosRef;
        const { getByTestId, rerenderEvery200ms } = await reachCalibration();
        expect(getByTestId('calibration-phase').getAttribute('data-dwelling')).toBe('true');

        await rerenderEvery200ms(2400);
        expect(mockMPGaze.calibrate).not.toHaveBeenCalled();

        await rerenderEvery200ms(200);
        expect(mockMPGaze.calibrate).toHaveBeenCalledTimes(1);
    });

    it('keeps the calibration point and counts an interruption each time the face is not detected', async () => {
        mockMPGaze.gazeState = 'closed';
        const { getByTestId, rerenderEvery200ms } = await reachCalibration();

        await rerenderEvery200ms(5200);

        expect(mockMPGaze.calibrate).not.toHaveBeenCalled();
        expect(getByTestId('calibration-phase').getAttribute('data-interruptions')).toBe('2');
    });

    it('saves the captured emotion samples and their micro-expressions in the response', async () => {
        const microExpressions = [{ emotion: 'joy', startTimestamp: 100, endTimestamp: 200, durationMs: 100, peakConfidence: 0.9, category: 'brief' }];
        vi.mocked(detectMicroExpressions).mockReturnValue(microExpressions as unknown as ReturnType<typeof detectMicroExpressions>);
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        mockMPGaze.gazeState = 'open';
        mockMPGaze.gazePosRef = { current: { x: 120, y: 80 } } as unknown as typeof mockMPGaze.gazePosRef;

        render(<EyeTrackingRenderer module={makeModule('true')} onComplete={vi.fn()} />);
        await act(async () => { vi.advanceTimersByTime(1600); });
        await act(async () => { vi.advanceTimersByTime(5500); });

        const [moduleId, componentId, value] = mockSaveResponse.mock.calls[0];
        const saved = JSON.parse(value);
        expect(moduleId).toBe('test-et-1');
        expect(componentId).toBe('eye-tracking-data');
        expect(saved.emotions).toEqual(mockEmotionSamples);
        expect(detectMicroExpressions).toHaveBeenCalledWith(mockEmotionSamples);
        expect(saved.microExpressions).toEqual(microExpressions);
        expect(mockFaceStop).toHaveBeenCalled();
    });

    it('saves fixation timestamps from the start of viewing, the same origin as emotion samples', async () => {
        vi.mocked(detectFixationsIDT).mockImplementation(((points: { x: number; y: number; t: number }[]) =>
            points.length ? [{ x: points[0].x, y: points[0].y, duration: 200, timestamp: points[0].t, pointCount: 2 }] : []) as unknown as typeof detectFixationsIDT);
        vi.mocked(mapFixationsToImageCoords).mockImplementation(((fixations: unknown[]) => fixations) as unknown as typeof mapFixationsToImageCoords);
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        mockMPGaze.gazeState = 'open';
        mockMPGaze.gazePosRef = { current: { x: 120, y: 80 } } as unknown as typeof mockMPGaze.gazePosRef;

        render(<EyeTrackingRenderer module={makeModule('true')} onComplete={vi.fn()} />);
        await act(async () => { vi.advanceTimersByTime(1600); });
        await act(async () => { vi.advanceTimersByTime(5500); });

        const saved = JSON.parse(mockSaveResponse.mock.calls[0][2]);
        expect(saved.fixations).toHaveLength(1);
        expect(saved.fixations[0].timestamp).toBeGreaterThanOrEqual(0);
        expect(saved.fixations[0].timestamp).toBeLessThan(1000);
    });

    it('saves no emotion data when emotion recognition is off', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        mockMPGaze.gazeState = 'open';
        mockMPGaze.gazePosRef = { current: { x: 120, y: 80 } } as unknown as typeof mockMPGaze.gazePosRef;

        render(<EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />);
        await act(async () => { vi.advanceTimersByTime(1600); });
        await act(async () => { vi.advanceTimersByTime(5500); });

        const saved = JSON.parse(mockSaveResponse.mock.calls[0][2]);
        expect(saved).not.toHaveProperty('emotions');
        expect(saved).not.toHaveProperty('microExpressions');
        expect(mockGetSamples).not.toHaveBeenCalled();
    });

    it('starts emotion sampling once per viewing and saves the response once', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(STIMULUS_RECT);
        mockMPGaze.gazeState = 'open';
        mockMPGaze.gazePosRef = { current: { x: 120, y: 80 } } as unknown as typeof mockMPGaze.gazePosRef;

        render(<EyeTrackingRenderer module={makeModule('true')} onComplete={vi.fn()} />);
        await act(async () => { vi.advanceTimersByTime(1600); });
        await act(async () => { vi.advanceTimersByTime(5500); });
        await act(async () => { vi.advanceTimersByTime(3000); });

        expect(mockFaceStart).toHaveBeenCalledTimes(1);
        expect(mockSaveResponse).toHaveBeenCalledTimes(1);
    });
});
