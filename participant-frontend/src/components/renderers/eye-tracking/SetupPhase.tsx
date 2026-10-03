import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS } from './types';

interface SetupPhaseProps {
    isDesktop: boolean;
    checks: boolean[];
    allChecked: boolean;
    onToggleCheck: (index: number) => void;
    onReady: () => void;
    cameraRef?: React.RefObject<HTMLVideoElement | null>;
    hasEmotionRecognition?: boolean;
}

export const SetupPhase: React.FC<SetupPhaseProps> = ({ isDesktop, checks, allChecked, onToggleCheck, onReady, cameraRef, hasEmotionRecognition }) => {
    const { t } = useTranslation();
    const [streamReady, setStreamReady] = useState(false);
    const [faceDetected, setFaceDetected] = useState(false);
    const [cameraError, setCameraError] = useState(false);
    const [permissionBlocked, setPermissionBlocked] = useState(false);
    const previewRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const needsCamera = isDesktop || !!hasEmotionRecognition;

    const retryCamera = useCallback(async () => {
        if (!cameraRef?.current) return;
        try {
            setCameraError(false);
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
            if (cameraRef.current) {
                cameraRef.current.srcObject = stream;
                await cameraRef.current.play();
                setStreamReady(true);
            }
        } catch (err) {
            const name = err instanceof DOMException ? err.name : '';
            if (name === 'NotAllowedError') {
                setPermissionBlocked(true);
            }
            setCameraError(true);
        }
    }, [cameraRef]);

    useEffect(() => {
        if (!needsCamera || !cameraRef) return;
        let attempts = 0;
        const check = setInterval(() => {
            const stream = cameraRef.current?.srcObject as MediaStream | null;
            if (stream && stream.active) {
                setStreamReady(true);
                clearInterval(check);
            } else {
                attempts++;
                if (attempts > 25) { setCameraError(true); clearInterval(check); }
            }
        }, 200);
        return () => clearInterval(check);
    }, [needsCamera, cameraRef]);

    useEffect(() => {
        if (!streamReady || !previewRef.current || !canvasRef.current) return;
        const video = previewRef.current;
        video.srcObject = cameraRef?.current?.srcObject ?? null;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        let raf = 0;
        const detect = () => {
            if (video.readyState < 2) { raf = requestAnimationFrame(detect); return; }
            canvas.width = video.videoWidth || 320;
            canvas.height = video.videoHeight || 240;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const data = ctx.getImageData(
                Math.floor(canvas.width * 0.25), Math.floor(canvas.height * 0.15),
                Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.7)
            ).data;
            let bright = 0;
            for (let i = 0; i < data.length; i += 16) {
                const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                if (lum > 30 && lum < 230) bright++;
            }
            const ratio = bright / (data.length / 16);
            setFaceDetected(ratio > 0.3);
            raf = requestAnimationFrame(detect);
        };
        raf = requestAnimationFrame(detect);
        return () => cancelAnimationFrame(raf);
    }, [streamReady, cameraRef]);

    const checkLabelsDesktop = [
        t('eyeTracking.check1', 'I am seated and will not move.'),
        t('eyeTracking.check2', 'My device is stable and at face level.'),
        t('eyeTracking.check3', 'My face is well lit, no backlight.'),
        t('eyeTracking.check4', 'If wearing glasses, avoid direct light reflections on lenses.'),
    ];
    const checkLabelsMobile = [
        t('eyeTracking.checkMobile1', 'I am holding my device comfortably and it is stable.'),
        t('eyeTracking.checkMobile2', 'I will tap where my attention goes on the image.'),
        t('eyeTracking.checkMobile3', 'I am in a quiet environment without distractions.'),
        t('eyeTracking.checkMobile4', 'I understand my taps will be recorded.'),
    ];
    const checkLabels = isDesktop ? checkLabelsDesktop : checkLabelsMobile;

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] px-4 py-8">
            <StepProgressPill step={1} total={TOTAL_STEPS} percent={30} />

            <div className="w-full max-w-lg space-y-6 mt-8">
                <div className="flex flex-col items-center gap-2">
                    <div className={`w-36 h-36 rounded-full mx-auto flex items-center justify-center overflow-hidden border-4 transition-colors ${
                        streamReady && faceDetected ? 'border-green-500' : streamReady ? 'border-red-400' : 'border-gray-300'
                    } bg-gray-800`}>
                        {needsCamera && streamReady ? (
                            <video
                                ref={previewRef}
                                autoPlay
                                playsInline
                                muted
                                className="w-full h-full object-cover"
                                style={{ transform: 'scaleX(-1)' }}
                            />
                        ) : (
                            <svg className="w-12 h-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        )}
                    </div>
                    <canvas ref={canvasRef} className="hidden" />
                    {needsCamera && streamReady && (
                        <p className={`text-xs font-medium ${faceDetected ? 'text-green-600' : 'text-red-500'}`}>
                            {faceDetected
                                ? t('eyeTracking.faceDetected', 'Position correct')
                                : t('eyeTracking.faceNotDetected', 'Center your face on screen')}
                        </p>
                    )}
                    {cameraError && (
                        <div className="flex flex-col items-center gap-1">
                            <p className="text-xs text-red-500">
                                {permissionBlocked
                                    ? t('eyeTracking.cameraBlocked', 'Permiso de cámara denegado. Recarga la página para volver a intentarlo.')
                                    : t('eyeTracking.cameraError', 'Cámara no disponible. Verifica los permisos en la configuración del navegador.')}
                            </p>
                            {permissionBlocked
                                ? <button onClick={() => window.location.reload()} className="text-xs text-blue-600 underline">{t('eyeTracking.reloadPage', 'Recargar página')}</button>
                                : <button onClick={retryCamera} className="text-xs text-blue-600 underline">{t('eyeTracking.retryCamera', 'Reintentar')}</button>}
                        </div>
                    )}
                </div>

                <h2 className="text-xl font-bold text-gray-900">
                    {t('eyeTracking.setupTitle', 'To continue')}
                </h2>
                <p className="text-gray-500 text-sm">
                    {t('eyeTracking.setupSubtitle', 'Please confirm that you meet all of the requirements mentioned below by ticking each of the checkboxes.')}
                </p>

                {/* Checkboxes */}
                <div className="space-y-4">
                    {checkLabels.map((label, idx) => (
                        <label key={idx} className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={checks[idx]}
                                onChange={() => onToggleCheck(idx)}
                                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                            />
                            <span className="text-sm text-gray-700">{label}</span>
                        </label>
                    ))}
                </div>

                <button
                    onClick={onReady}
                    disabled={!allChecked}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {t('eyeTracking.ready', 'Ready')}
                </button>
            </div>
        </div>
    );
};
