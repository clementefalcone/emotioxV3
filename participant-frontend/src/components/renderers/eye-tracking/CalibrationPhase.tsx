import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS, HYBRID_CALIB_POINT_COUNT } from './types';
import { HYBRID_IMAGE_CALIBRATION_POINTS } from '../../../lib/eyeTracking';
import { DwellRing } from './DwellRing';

interface CalibrationPhaseProps {
    calibrationIndex: number;
    dwellStartedAt: number | null;
    dwellDurationMs: number;
    cameraRef?: React.RefObject<HTMLVideoElement | null>;
    calibrationAreaRef?: React.RefObject<HTMLDivElement | null>;
    isFaceInZone: boolean;
    interruptionCount: number;
}

export const CalibrationPhase: React.FC<CalibrationPhaseProps> = ({
    calibrationIndex,
    dwellStartedAt,
    dwellDurationMs,
    cameraRef,
    calibrationAreaRef,
    isFaceInZone,
    interruptionCount,
}) => {
    const { t } = useTranslation();
    const previewRef = useRef<HTMLVideoElement>(null);

    const calibrationPercent = Math.round(25 + (calibrationIndex / HYBRID_CALIB_POINT_COUNT) * 35);
    const calDotImagePct = HYBRID_IMAGE_CALIBRATION_POINTS[calibrationIndex];
    const isHeaderAtBottom = calDotImagePct !== undefined && calDotImagePct[1] < 50;

    useEffect(() => {
        if (!cameraRef) return;
        const check = setInterval(() => {
            const stream = cameraRef.current?.srcObject as MediaStream | null;
            if (stream && stream.active && previewRef.current) {
                previewRef.current.srcObject = stream;
                clearInterval(check);
            }
        }, 200);
        return () => clearInterval(check);
    }, [cameraRef]);

    return (
        <div className="fixed inset-0 z-50 bg-white">
            <video
                ref={previewRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ transform: 'scaleX(-1)' }}
            />

            <div ref={calibrationAreaRef} data-testid="calibration-area" className="absolute inset-0">
                {calDotImagePct && (
                    <div
                        className="absolute z-10 w-10 h-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-500 shadow-lg shadow-green-500/30"
                        style={{ left: `${calDotImagePct[0]}%`, top: `${calDotImagePct[1]}%` }}
                    >
                        <div className="absolute inset-0 rounded-full border-2 border-green-300 animate-ping opacity-75" />
                        <DwellRing startedAt={dwellStartedAt} durationMs={dwellDurationMs} colorClassName="text-green-600" />
                    </div>
                )}
            </div>

            <div
                data-testid="calibration-header"
                className={`absolute inset-x-0 flex flex-col items-center gap-2 px-6 text-center bg-white/90 backdrop-blur-sm shadow-sm ${isHeaderAtBottom ? 'bottom-0 pt-3' : 'top-0 pb-3'}`}
                style={isHeaderAtBottom ? { paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' } : { paddingTop: 'max(16px, env(safe-area-inset-top, 16px))' }}
            >
                <StepProgressPill step={2} total={TOTAL_STEPS} percent={calibrationPercent} />
                <h2 className="text-lg font-bold text-gray-900 mt-2">
                    {t('eyeTracking.dwellInstruction', 'Look at the dot without moving your head. It will move on by itself.')}
                </h2>
                <p className="text-sm text-gray-600">
                    {t('eyeTracking.pointOf', 'Punto {{current}} de {{total}}', {
                        current: calibrationIndex + 1,
                        total: HYBRID_CALIB_POINT_COUNT,
                    })}
                </p>
                <div className="flex items-center gap-4 text-xs text-gray-600">
                    <span>
                        {t('eyeTracking.calib.interruptions', 'Interruptions')} <strong className="text-gray-900">{interruptionCount}</strong>
                    </span>
                    <span className={`flex items-center gap-1.5 font-medium ${isFaceInZone ? 'text-green-600' : 'text-red-500'}`}>
                        <span className={`w-2 h-2 rounded-full ${isFaceInZone ? 'bg-green-500' : 'bg-red-500'}`} />
                        {isFaceInZone
                            ? t('eyeTracking.calib.inZone', 'In zone')
                            : t('eyeTracking.calib.outOfZone', 'We cannot see your eyes · open them and look at the dot')}
                    </span>
                </div>
            </div>
        </div>
    );
};
