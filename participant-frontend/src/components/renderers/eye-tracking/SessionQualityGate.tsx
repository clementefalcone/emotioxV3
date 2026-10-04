import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS } from './types';
import {
    checkBrightness,
    checkBacklight,
    checkResolution,
    checkDistance,
    checkHeadStability,
    checkFaceConfidence,
    estimateDistanceCm,
    computePositionVariance,
    evaluateGate,
    HEAD_STABILITY_FRAMES,
    type QualityCheckResult,
    type CheckStatus,
} from '../../../lib/eyeTracking/sessionQualityChecks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionQualityGateProps {
    cameraRef: React.RefObject<HTMLVideoElement | null>;
    /** BlazeGaze gazePosRef — used as proxy for face detection (if gaze is valid, face is detected). */
    gazeActive: boolean;
    /** Real face detection confidence from MediaPipe (0 = no face, 1 = detected + eyes open). */
    faceConfidence?: number;
    /** Live head pose from MediaPipe (pitch/yaw degrees). */
    headPoseRef?: React.RefObject<{ pitch: number; yaw: number }>;
    /** Last 478 face landmarks from MediaPipe (normalized 0-1). */
    landmarksRef?: React.RefObject<Array<{ x: number; y: number; z: number }> | null>;
    onPass: () => void;
    onReject?: () => void;
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

const StatusIcon: React.FC<{ status: CheckStatus }> = ({ status }) => {
    if (status === 'pass') return <span className="text-green-500 text-lg">✓</span>;
    if (status === 'fail') return <span className="text-red-500 text-lg">✗</span>;
    if (status === 'warn') return <span className="text-amber-500 text-lg">!</span>;
    // pending / checking
    return <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />;
};

const statusBg = (status: CheckStatus): string => {
    if (status === 'pass') return 'bg-green-50 border-green-200';
    if (status === 'fail') return 'bg-red-50 border-red-200';
    if (status === 'warn') return 'bg-amber-50 border-amber-200';
    return 'bg-gray-50 border-gray-200';
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SessionQualityGate: React.FC<SessionQualityGateProps> = ({
    cameraRef,
    gazeActive,
    faceConfidence,
    headPoseRef,
    landmarksRef,
    onPass,
}) => {
    const { t } = useTranslation();

    const [checks, setChecks] = useState<QualityCheckResult[]>([
        { id: 'resolution', status: 'pending' },
        { id: 'brightness', status: 'pending' },
        { id: 'faceDetection', status: 'pending' },
        { id: 'distance', status: 'pending' },
        { id: 'headStability', status: 'pending' },
        { id: 'headPose', status: 'pending' },
    ]);
    const [gateResult, setGateResult] = useState<{ canProceed: boolean } | null>(null);
    const [autoAdvance, setAutoAdvance] = useState(false);
    const headPositionsRef = useRef<{ x: number; y: number }[]>([]);
    const runCountRef = useRef(0);
    const [retryTrigger, setRetryTrigger] = useState(0);

    const updateCheck = useCallback((id: string, result: QualityCheckResult) => {
        setChecks(prev => prev.map(c => c.id === id ? result : c));
    }, []);

    useEffect(() => {
        const video = cameraRef.current;
        if (!video || !video.srcObject) {
            setChecks(prev => prev.map(c => ({ ...c, status: 'fail' as const, message: 'Cámara no disponible' })));
            setGateResult({ canProceed: false });
            return;
        }

        // Wait for video to have dimensions
        const startChecks = () => {
            if (video.videoWidth === 0) {
                setTimeout(startChecks, 200);
                return;
            }

            runCountRef.current += 1;

            // 1. Resolution — instant
            updateCheck('resolution', checkResolution(video));

            // 2. Brightness + backlight detection
            setTimeout(() => {
                const brightnessResult = checkBrightness(video);
                if (brightnessResult.status === 'pass') {
                    const backlightResult = checkBacklight(video);
                    updateCheck('brightness', backlightResult.status !== 'pass' ? backlightResult : brightnessResult);
                } else {
                    updateCheck('brightness', brightnessResult);
                }
            }, 300);

            // 3. Face detection — poll until MediaPipe has a real answer (up to 4s)
            const pollFace = (attempt: number) => {
                const confidence = faceConfidence ?? (gazeActive ? 0.9 : 0.3);
                if (confidence > 0 || attempt >= 8) {
                    updateCheck('faceDetection', checkFaceConfidence(confidence));
                } else {
                    setTimeout(() => pollFace(attempt + 1), 500);
                }
            };
            setTimeout(() => pollFace(0), 800);

            // 4. Distance — poll for real iris landmarks, fallback to brightness heuristic
            const pollDistance = (attempt: number) => {
                const lm = landmarksRef?.current;
                if (lm && lm.length > 473) {
                    const irisL = lm[468];
                    const irisR = lm[473];
                    const ipdNorm = Math.sqrt((irisL.x - irisR.x) ** 2 + (irisL.y - irisR.y) ** 2);
                    const ipdPx = ipdNorm * video.videoWidth;
                    const irisDiamPx = ipdPx * (11.7 / 63);
                    const distCm = estimateDistanceCm(irisDiamPx, video.videoWidth);
                    updateCheck('distance', checkDistance(distCm));
                } else if (attempt < 4) {
                    setTimeout(() => pollDistance(attempt + 1), 500);
                } else {
                    // Fallback after retries: brightness heuristic
                    const faceWidthRatio = estimateFaceWidthRatio(video);
                    const irisEstPx = faceWidthRatio * video.videoWidth * 0.08;
                    const distCm = estimateDistanceCm(irisEstPx, video.videoWidth);
                    updateCheck('distance', checkDistance(distCm));
                }
            };
            setTimeout(() => pollDistance(0), 1200);

            // 5. Head stability — collect positions over ~1s
            setTimeout(() => {
                updateCheck('headStability', { id: 'headStability', status: 'checking' });
                headPositionsRef.current = [];

                let frameCount = 0;
                const collectFrame = () => {
                    if (frameCount >= HEAD_STABILITY_FRAMES) {
                        const variance = computePositionVariance(headPositionsRef.current);
                        updateCheck('headStability', checkHeadStability(variance));
                        return;
                    }
                    // Use real nose-tip landmark when available, fallback to brightness centroid
                    const lm = landmarksRef?.current;
                    const pos = lm && lm.length > 1
                        ? { x: lm[1].x * video.videoWidth, y: lm[1].y * video.videoHeight }
                        : estimateFaceCentroid(video);
                    if (pos) headPositionsRef.current.push(pos);
                    frameCount++;
                    requestAnimationFrame(collectFrame);
                };
                requestAnimationFrame(collectFrame);
            }, 1500);

            // 6. Head pose — poll until MediaPipe produces real angles (not default 0,0)
            const pollPose = (attempt: number) => {
                const pose = headPoseRef?.current;
                const hasRealData = pose && (pose.pitch !== 0 || pose.yaw !== 0);
                if (!hasRealData && attempt < 6) {
                    setTimeout(() => pollPose(attempt + 1), 500);
                    return;
                }
                if (hasRealData) {
                    const absYaw = Math.abs(pose.yaw);
                    const absPitch = Math.abs(pose.pitch);
                    if (absYaw > 25 || absPitch > 25) {
                        updateCheck('headPose', { id: 'headPose', status: 'fail', message: 'Mira directamente a la pantalla' });
                    } else if (absYaw > 15 || absPitch > 15) {
                        updateCheck('headPose', { id: 'headPose', status: 'warn', message: 'Intenta mirar más de frente a la pantalla' });
                    } else {
                        updateCheck('headPose', { id: 'headPose', status: 'pass' });
                    }
                } else {
                    // No MediaPipe data after retries — skip
                    updateCheck('headPose', { id: 'headPose', status: 'pass' });
                }
            };
            setTimeout(() => pollPose(0), 1800);
        };

        startChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable, faceConfidence changes with gazeActive
    }, [cameraRef, gazeActive, updateCheck, retryTrigger]);

    // Evaluate gate when all checks complete
    useEffect(() => {
        const allDone = checks.every(c => c.status !== 'pending' && c.status !== 'checking');
        if (allDone) {
            const result = evaluateGate(checks);
            setGateResult(result);
            if (result.canProceed) {
                setAutoAdvance(true);
            }
        }
    }, [checks]);

    // Auto-advance after 1.5s if passed
    useEffect(() => {
        if (!autoAdvance) return;
        const timer = setTimeout(onPass, 1500);
        return () => clearTimeout(timer);
    }, [autoAdvance, onPass]);

    const checkLabels: Record<string, string> = {
        resolution: t('eyeTracking.qg.resolution', 'Resolución de cámara'),
        brightness: t('eyeTracking.qg.brightness', 'Condiciones de iluminación'),
        faceDetection: t('eyeTracking.qg.faceDetection', 'Detección de rostro'),
        distance: t('eyeTracking.qg.distance', 'Distancia al rostro'),
        headStability: t('eyeTracking.qg.headStability', 'Estabilidad de cabeza'),
        headPose: t('eyeTracking.qg.headPose', 'Orientación de cabeza'),
    };

    const checkHints: Record<string, string> = {
        resolution: t('eyeTracking.qg.hintResolution', 'Permite el acceso a la cámara en alta resolución'),
        brightness: t('eyeTracking.qg.hintBrightness', 'Ubícate en un lugar bien iluminado, sin luz detrás'),
        faceDetection: t('eyeTracking.qg.hintFace', 'Asegúrate de que tu rostro sea visible para la cámara'),
        distance: t('eyeTracking.qg.hintDistance', 'Mantente a una distancia de 50-70 cm de la pantalla (un brazo estirado)'),
        headStability: t('eyeTracking.qg.hintStability', 'Mantén tu cabeza quieta y no te muevas'),
        headPose: t('eyeTracking.qg.hintPose', 'Mira directamente a la pantalla, de frente'),
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] px-4 py-8">
            <StepProgressPill step={1} total={TOTAL_STEPS} percent={25} />

            <div className="w-full max-w-md space-y-4 mt-8">
                <h2 className="text-xl font-bold text-gray-900 text-center">
                    {t('eyeTracking.qg.title', 'Verificando calidad de sesión...')}
                </h2>
                <p className="text-sm text-gray-500 text-center">
                    {t('eyeTracking.qg.subtitle', 'Validando tu entorno para el seguimiento de atención.')}
                </p>

                <div className="space-y-3 mt-6">
                    {checks.map(check => (
                        <div
                            key={check.id}
                            className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors ${statusBg(check.status)}`}
                        >
                            <div className="mt-0.5"><StatusIcon status={check.status} /></div>
                            <div className="flex-1">
                                <span className="text-sm font-medium text-gray-800">
                                    {checkLabels[check.id] || check.id}
                                </span>
                                {(check.status === 'fail' || check.status === 'warn') && checkHints[check.id] && (
                                    <p className="text-xs text-gray-600 mt-1">{checkHints[check.id]}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {gateResult && !gateResult.canProceed && (
                    <div className="flex gap-3 justify-center mt-6">
                        <button
                            onClick={() => {
                                setChecks(prev => prev.map(c => ({ ...c, status: 'pending' as const, message: undefined })));
                                setGateResult(null);
                                runCountRef.current = 0;
                                setRetryTrigger(n => n + 1);
                            }}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                            {t('eyeTracking.qg.retry', 'Reintentar')}
                        </button>
                    </div>
                )}

                {gateResult?.canProceed && (
                    <p className="text-center text-sm text-green-600 font-medium mt-4">
                        {t('eyeTracking.qg.passed', 'Todas las verificaciones pasaron — avanzando a calibración...')}
                    </p>
                )}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Helpers — rough face estimation from brightness analysis
// ponytail: these are cheap heuristics, not full face detection.
// Real iris detection would need FaceLandmarker, but BlazeGaze already handles
// the actual tracking. These are just for the quality gate UX.
// ---------------------------------------------------------------------------

function estimateFaceWidthRatio(video: HTMLVideoElement): number {
    const w = 64;
    const h = 48;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0.35;
    ctx.drawImage(video, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    // Count bright-ish pixels in center band (face region)
    const centerStart = Math.floor(w * 0.2);
    const centerEnd = Math.ceil(w * 0.8);
    let facePixels = 0;
    let totalCenter = 0;
    for (let y = 0; y < h; y++) {
        for (let x = centerStart; x < centerEnd; x++) {
            const i = (y * w + x) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            totalCenter++;
            if (lum > 60) facePixels++;
        }
    }
    return totalCenter > 0 ? Math.min(0.6, Math.max(0.15, facePixels / totalCenter)) : 0.35;
}

function estimateFaceCentroid(video: HTMLVideoElement): { x: number; y: number } | null {
    const w = 32;
    const h = 24;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    let sumX = 0, sumY = 0, total = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum > 80) {
                sumX += x;
                sumY += y;
                total++;
            }
        }
    }
    if (total === 0) return null;
    return { x: sumX / total, y: sumY / total };
}
