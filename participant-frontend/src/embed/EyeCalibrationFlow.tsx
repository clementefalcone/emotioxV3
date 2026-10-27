import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaPipeGaze } from '../hooks/useMediaPipeGaze';
import { BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS } from '../lib/eyeTracking';
import { RidgeGazePredictor } from '../lib/eyeTracking/gazePredictor';
import { DEFAULT_RIDGE_LAMBDA } from '../lib/eyeTracking/constants';
import { ConsentPhase } from '../components/renderers/eye-tracking/ConsentPhase';
import { FacePositionPhase } from '../components/renderers/eye-tracking/FacePositionPhase';
import { PreparingPhase } from '../components/renderers/eye-tracking/PreparingPhase';
import { CalibrationPhase } from '../components/renderers/eye-tracking/CalibrationPhase';
import { FACE_DISTANCE_RANGES_CM } from '../components/renderers/eye-tracking/facePosition';
import { getDeviceType } from '../components/renderers/eye-tracking/types';
import { CALIBRATION_POINT_MS, useCalibrationSequence } from '../components/renderers/eye-tracking/useCalibrationSequence';
import type { CalibratedGaze, CalibrationFlowOptions, StoredCalibration } from './eyeSession';
import { saveCalibration } from './eyeSession';

type EmbedPhase = 'restoring' | 'consent' | 'face' | 'preparing' | 'calibration' | 'done';

const PREPARING_MS = 2000;

const buildPredictor = (stored: StoredCalibration | null): RidgeGazePredictor => {
    const predictor = new RidgeGazePredictor(DEFAULT_RIDGE_LAMBDA, { rff: { D: 128, sigma: 'auto', seed: 42 } });
    stored?.samples.forEach(({ features, target }) => predictor.addCalibrationSample({ features }, target));
    return predictor;
};

interface EyeCalibrationFlowProps {
    options: CalibrationFlowOptions;
    storedCalibration: StoredCalibration | null;
}

export const EyeCalibrationFlow = ({ options, storedCalibration }: EyeCalibrationFlowProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const calibrationAreaRef = useRef<HTMLDivElement>(null);
    const predictor = useMemo(() => buildPredictor(storedCalibration), [storedCalibration]);
    const [phase, setPhase] = useState<EmbedPhase>(storedCalibration ? 'restoring' : 'consent');
    const gaze = useMediaPipeGaze(videoRef, { oneEuroMinCutoff: 1.2, oneEuroBeta: 0.05, predictor });
    const gazeStateRef = useRef(gaze.gazeState);
    useEffect(() => { gazeStateRef.current = gaze.gazeState; }, [gaze.gazeState]);

    const startCamera = useCallback(async (): Promise<boolean> => {
        const video = videoRef.current;
        if (!video) return false;
        if (video.srcObject) return true;
        try {
            video.srcObject = await navigator.mediaDevices.getUserMedia(BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS);
            await video.play();
            return true;
        } catch {
            options.onCameraDenied();
            return false;
        }
    }, [options]);

    const finishSession = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const calibratedGaze: CalibratedGaze = {
            video,
            readGaze: () => gaze.gazePosRef.current,
            isEyeOpen: () => gazeStateRef.current === 'open',
            readHeadPose: () => gaze.headPoseRef.current,
            readLandmarks: () => gaze.lastLandmarksRef.current,
            calibrationRmsePx: predictor.cvRmsePx,
        };
        setPhase('done');
        options.onReady(calibratedGaze);
    }, [gaze.gazePosRef, gaze.headPoseRef, gaze.lastLandmarksRef, predictor, options]);

    useEffect(() => {
        if (phase !== 'restoring' || !gaze.isLoaded) return;
        let isCancelled = false;
        void Promise.all([startCamera(), predictor.train()]).then(([isCameraOn]) => {
            if (isCancelled || !isCameraOn) return;
            gaze.start();
            finishSession();
        });
        return () => { isCancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gaze is an unstable object literal; start is stable
    }, [phase, gaze.isLoaded, startCamera, predictor, finishSession]);

    useEffect(() => {
        const video = videoRef.current;
        return () => {
            (video?.srcObject as MediaStream | null)?.getTracks().forEach(track => track.stop());
        };
    }, []);

    useEffect(() => {
        if (phase !== 'face') return;
        gaze.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gaze is an unstable object literal; start is stable
    }, [phase]);

    useEffect(() => {
        if (phase !== 'preparing') return;
        const timer = window.setTimeout(() => setPhase('calibration'), PREPARING_MS);
        return () => window.clearTimeout(timer);
    }, [phase]);

    const calibrationSequence = useCalibrationSequence({
        isActive: phase === 'calibration',
        calibrationAreaRef,
        gazeStateRef,
        collectCalibrationSamples: gaze.collectCalibrationSamples,
        onPointRecorded: () => undefined,
        onSequenceComplete: () => {
            void gaze.trainRidge().then(() => {
                saveCalibration(options.storageKey, { samples: predictor.calibrationSamples, savedAt: Date.now() });
                finishSession();
            });
        },
    });

    const handleConsentAccept = useCallback(async () => {
        const isCameraOn = await startCamera();
        if (isCameraOn) setPhase('face');
        return isCameraOn;
    }, [startCamera]);

    const overlays: Record<EmbedPhase, React.ReactNode> = {
        restoring: null,
        done: null,
        consent: (
            <ConsentPhase
                taskDescription=""
                hasEmotionRecognition={options.hasEmotionRecognition}
                isGazeModelLoaded={gaze.isLoaded}
                onAccept={handleConsentAccept}
                onDecline={options.onDecline}
            />
        ),
        face: (
            <FacePositionPhase
                cameraRef={videoRef}
                landmarksRef={gaze.lastLandmarksRef}
                headPoseRef={gaze.headPoseRef}
                distanceRange={FACE_DISTANCE_RANGES_CM[getDeviceType()]}
                onContinue={() => setPhase('preparing')}
            />
        ),
        preparing: <PreparingPhase />,
        calibration: (
            <CalibrationPhase
                calibrationIndex={calibrationSequence.calibrationIndex}
                dwellStartedAt={calibrationSequence.dwellStartedAt}
                dwellDurationMs={CALIBRATION_POINT_MS}
                cameraRef={videoRef}
                calibrationAreaRef={calibrationAreaRef}
                isFaceInZone={gaze.gazeState === 'open'}
                interruptionCount={calibrationSequence.interruptionCount}
            />
        ),
    };
    const overlay = overlays[phase];

    return (
        <>
            <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
            {overlay && <div className="fixed inset-0 overflow-y-auto bg-white text-gray-900">{overlay}</div>}
        </>
    );
};
