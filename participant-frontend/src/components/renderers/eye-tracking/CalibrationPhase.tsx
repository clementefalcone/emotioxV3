import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS, HYBRID_CALIB_POINT_COUNT } from './types';
import { HYBRID_IMAGE_CALIBRATION_POINTS } from '../../../lib/eyeTracking';
import { DwellRing } from './DwellRing';

interface CalibrationPhaseProps {
    calibrationIndex: number;
    dwellStartedAt: number | null;
    dwellDurationMs: number;
    onCalibrationClick: () => void;
    cameraRef?: React.RefObject<HTMLVideoElement | null>;
    calibrationAreaRef?: React.RefObject<HTMLDivElement | null>;
}

export const CalibrationPhase: React.FC<CalibrationPhaseProps> = ({
    calibrationIndex,
    dwellStartedAt,
    dwellDurationMs,
    onCalibrationClick,
    cameraRef,
    calibrationAreaRef,
}) => {
    const { t } = useTranslation();
    const previewRef = useRef<HTMLVideoElement>(null);
    const [streamReady, setStreamReady] = useState(false);

    const calibrationPercent = Math.round(30 + (calibrationIndex / HYBRID_CALIB_POINT_COUNT) * 35);
    const calDotImagePct = HYBRID_IMAGE_CALIBRATION_POINTS[calibrationIndex];

    useEffect(() => {
        if (!cameraRef) return;
        const check = setInterval(() => {
            const stream = cameraRef.current?.srcObject as MediaStream | null;
            if (stream && stream.active) {
                setStreamReady(true);
                if (previewRef.current && previewRef.current.srcObject !== stream) {
                    previewRef.current.srcObject = stream;
                }
                clearInterval(check);
            }
        }, 200);
        return () => clearInterval(check);
    }, [cameraRef]);

    const lastAdvanceRef = useRef(0);

    const advance = () => {
        const now = Date.now();
        if (now - lastAdvanceRef.current < 300) return;
        lastAdvanceRef.current = now;
        onCalibrationClick();
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        advance();
    };

    const handleTouch = (e: React.TouchEvent) => {
        e.stopPropagation();
        advance();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col bg-white"
            onClickCapture={handleClick}
            onTouchEnd={handleTouch}
        >
            <div className="flex flex-col items-center gap-2" style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))' }}>
                <StepProgressPill step={2} total={TOTAL_STEPS} percent={calibrationPercent} />
                <h2 className="text-lg font-bold text-gray-900 mt-2">
                    {t('eyeTracking.dwellInstruction', 'Keep looking at the dot until it moves on by itself')}
                </h2>
                <p className="text-sm text-gray-500">
                    {t('eyeTracking.pointOf', 'Punto {{current}} de {{total}}', {
                        current: calibrationIndex + 1,
                        total: HYBRID_CALIB_POINT_COUNT,
                    })}
                    {' — '}
                    {t('eyeTracking.dwellTapFallback', 'if it does not move, tap or click the screen')}
                </p>
            </div>

            <div ref={calibrationAreaRef} className="flex-1 relative">
                {calDotImagePct && (
                    <div
                        className="absolute z-10 w-10 h-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-500 shadow-lg shadow-green-500/30 cursor-pointer"
                        style={{ left: `${calDotImagePct[0]}%`, top: `${calDotImagePct[1]}%` }}
                    >
                        <div className="absolute inset-0 rounded-full border-2 border-green-300 animate-ping opacity-75" />
                        <DwellRing startedAt={dwellStartedAt} durationMs={dwellDurationMs} colorClassName="text-green-600" />
                    </div>
                )}
            </div>

            {streamReady && (
                <div className="flex justify-center pb-4">
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-gray-200">
                        <video
                            ref={previewRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                            style={{ transform: 'scaleX(-1)' }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
