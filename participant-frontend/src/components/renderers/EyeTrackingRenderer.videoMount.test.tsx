import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../stores/useParticipantStore', () => ({
    useParticipantStore: () => ({ saveResponse: vi.fn() }),
}));
vi.mock('../../hooks/useConsentRecorder', () => ({
    useConsentRecorder: () => vi.fn().mockResolvedValue(undefined),
}));


vi.mock('../../services/media.service', () => ({
    mediaService: { resolveUrl: (u: string) => u },
}));

const mockBlazeGaze = { start: vi.fn(), stop: vi.fn(), gazePosRef: { current: [0, 0] } };
vi.mock('../../hooks/useBlazeGaze', () => ({
    useBlazeGaze: () => mockBlazeGaze,
}));

const mockMPGaze = { start: vi.fn(), stop: vi.fn(), collectCalibrationSamples: vi.fn(), gazePosRef: { current: [0, 0] } };
vi.mock('../../hooks/useMediaPipeGaze', () => ({
    useMediaPipeGaze: () => mockMPGaze,
}));

const mockFaceEmotions = { start: vi.fn(), stop: vi.fn(), warmUp: vi.fn(() => Promise.resolve()), samples: [] };
vi.mock('../../hooks/useFaceApiEmotions', () => ({
    useFaceApiEmotions: () => mockFaceEmotions,
}));

vi.mock('../../lib/eyeTracking', () => ({
    BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS: { video: true },
    HYBRID_CALIBRATION_FIELD_STRENGTH: 0.5,
    HYBRID_IMAGE_CALIBRATION_POINTS: [],
    HYBRID_AOI_GRID: { cols: 3, rows: 3 },
    hybridApplyCalibrationField: vi.fn((p: unknown) => p),
    hybridCalibrationRmsePx: vi.fn(() => 0),
    hybridImagePercentToBlazeNorm: vi.fn(),
    hybridPointToSoftZoneWeights: vi.fn(() => []),
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
        addSample: vi.fn(),
        render: vi.fn(),
    })),
}));

vi.mock('../../lib/eyeTracking/attention/sessionMetrics', () => ({
    computeSessionConfidence: vi.fn(() => 1),
    computeSpatialCoverage: vi.fn(() => 1),
}));

vi.mock('./eye-tracking/PreparingPhase', () => ({
    PreparingPhase: () => <div data-testid="preparing-phase" />,
}));
vi.mock('./eye-tracking/CalibrationPhase', () => ({
    CalibrationPhase: () => <div data-testid="calibration-phase" />,
}));
vi.mock('./eye-tracking/ViewingPhase', () => ({
    ViewingPhase: () => <div data-testid="viewing-phase" />,
}));
vi.mock('./eye-tracking/CompletePhase', () => ({
    CompletePhase: () => <div data-testid="complete-phase" />,
}));

let mockDeviceType = 'desktop';
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
                { id: 'priming-time', type: 'text', value: '10' },
            ],
        },
    };
}

describe('EyeTrackingRenderer video element mount', () => {
    beforeEach(() => {
        mockDeviceType = 'desktop';
    });

    it('mounts hidden video on desktop regardless of emotion recognition', () => {
        mockDeviceType = 'desktop';
        const { container } = render(
            <EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />
        );
        const video = container.querySelector('video');
        expect(video).not.toBeNull();
    });

    it('mounts hidden video on mobile without emotion recognition (gaze tracking needs the camera)', () => {
        mockDeviceType = 'mobile';
        const { container } = render(
            <EyeTrackingRenderer module={makeModule('false')} onComplete={vi.fn()} />
        );
        const video = container.querySelector('video');
        expect(video).not.toBeNull();
    });
});
