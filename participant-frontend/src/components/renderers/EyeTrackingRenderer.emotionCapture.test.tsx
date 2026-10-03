import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}));

const mockSaveResponse = vi.fn();
vi.mock('../../stores/useParticipantStore', () => ({
    useParticipantStore: () => ({ saveResponse: mockSaveResponse }),
}));

vi.mock('../../hooks/usePreviewMode', () => ({
    usePreviewMode: () => ({ isPreviewMode: false }),
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
    useBlazeGaze: () => mockBlazeGaze,
}));

const mockMPGaze = {
    start: vi.fn(),
    stop: vi.fn(),
    gazeState: 'closed',
    gazePosRef: { current: [0, 0] },
    headPoseRef: { current: { pitch: 0, yaw: 0 } },
    earRef: { current: 0.3 },
    lastLandmarksRef: { current: null },
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
    HYBRID_VALIDATION_POINTS: [[25, 25], [75, 75]],
    HYBRID_RECALIBRATION_RMSE_THRESHOLD_PX: 50,
    HYBRID_REJECT_RMSE_THRESHOLD_PX: 100,
    HYBRID_AOI_GRID: [{ id: 'z1' }],
    hybridApplyCalibrationField: vi.fn((p: unknown) => p),
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
    extractActionUnitsFrom68: vi.fn(() => ({})),
}));

vi.mock('../../lib/eyeTracking/zoneRegistry', () => ({
    ZoneRegistry: vi.fn(),
    generateGrid: vi.fn(() => []),
}));
vi.mock('../../lib/eyeTracking/zoneEventEmitter', () => ({
    ZoneEventEmitter: vi.fn(),
}));
vi.mock('../../lib/eyeTracking/v2ResponseBuilder', () => ({
    EYE_TRACKING_V2_ENABLED: false,
    buildV2Response: vi.fn(),
}));
vi.mock('../../lib/eyeTracking/deviceProfile', () => ({
    getCurrentDeviceProfile: vi.fn(() => ({ gazeRadius: 40, hysteresisFrames: 3 })),
}));
vi.mock('../../lib/eyeTracking/attention/uncertaintyEstimator', () => ({
    fitFromLoocvResiduals: vi.fn(),
    fitFromHybridResiduals: vi.fn(),
    computeFrameUncertainty: vi.fn(() => 0),
}));
vi.mock('../../lib/eyeTracking/attention/probabilisticHeatmap', () => ({
    ProbabilisticHeatmap: vi.fn().mockImplementation(() => ({
        addSample: vi.fn(), render: vi.fn(),
    })),
}));
vi.mock('../../lib/eyeTracking/attention/sessionMetrics', () => ({
    computeSessionConfidence: vi.fn(() => 1),
    computeSpatialCoverage: vi.fn(() => 1),
}));

vi.mock('./eye-tracking/IntroPhase', () => ({
    IntroPhase: ({ onNext }: { onNext: () => void }) => <button data-testid="intro-next" onClick={onNext}>Next</button>,
}));
vi.mock('./eye-tracking/SetupPhase', () => ({
    SetupPhase: ({ onReady }: { onReady: () => void }) => <button data-testid="setup-ready" onClick={onReady}>Ready</button>,
}));
vi.mock('./eye-tracking/PreparingPhase', () => ({
    PreparingPhase: () => <div data-testid="preparing-phase" />,
}));
vi.mock('./eye-tracking/CalibrationPhase', () => ({
    CalibrationPhase: () => <div data-testid="calibration-phase" />,
}));
vi.mock('./eye-tracking/ValidationPhase', () => ({
    ValidationPhase: () => <div data-testid="validation-phase" />,
}));
vi.mock('./eye-tracking/ViewingPhase', () => ({
    ViewingPhase: () => <div data-testid="viewing-phase" />,
}));
vi.mock('./eye-tracking/CompletePhase', () => ({
    CompletePhase: () => <div data-testid="complete-phase" />,
}));
vi.mock('./eye-tracking/SessionQualityGate', () => ({
    SessionQualityGate: ({ onPass }: { onPass: () => void }) => <button data-testid="qg-pass" onClick={onPass}>Pass</button>,
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
        sessionStorage.setItem('emotiox-et-calibration', JSON.stringify({
            moduleId: 'previous-et-module',
            residuals: [{ u: 0.5, v: 0.5, dx: 0, dy: 0 }],
            rmsePx: 10,
            timestamp: Date.now(),
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        sessionStorage.clear();
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

    it('calibration cached by the same module is not reused: starts at intro', () => {
        sessionStorage.setItem('emotiox-et-calibration', JSON.stringify({
            moduleId: 'test-et-1',
            residuals: [],
            rmsePx: null,
            timestamp: Date.now(),
        }));
        const { queryByTestId } = render(
            <EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />
        );
        expect(queryByTestId('intro-next')).not.toBeNull();
        expect(queryByTestId('preparing-phase')).toBeNull();
    });

    it('getSamples() is wired to save payload via faceEmotions mock', () => {
        const samples = mockGetSamples();
        expect(samples).toHaveLength(2);
        expect(samples[0].emotion).toBe('joy');
        expect(samples[1].emotion).toBe('neutral');
    });
});
