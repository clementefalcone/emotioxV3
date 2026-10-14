import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS } from './types';
import type { ShelfConfig } from './types';
import {
    HYBRID_VALIDATION_POINTS,
    HYBRID_RECALIBRATION_RMSE_THRESHOLD_PX,
    HYBRID_REJECT_RMSE_THRESHOLD_PX,
} from '../../../lib/eyeTracking';
import { ShelfGrid } from './ShelfGrid';
import { DwellRing } from './DwellRing';

interface ValidationPhaseProps {
    /** Current validation point index (0-4). */
    validationIndex: number;
    /** Average RMSE across all 5 points (null until all measured). */
    validationRmse: number | null;
    dwellStartedAt: number | null;
    dwellDurationMs: number;
    /** How many recalibration attempts so far. */
    recalibrationCount: number;
    resolvedUrl: string;
    imgRef: React.RefObject<HTMLImageElement | null>;
    onValidationDwellComplete: () => void;
    onRecalibrate: () => void;
    onSkipValidation: () => void;
    onRejectSession: () => void;
    onImageLoad: () => void;
    shelfConfig: ShelfConfig | null;
}

export const ValidationPhase: React.FC<ValidationPhaseProps> = ({
    validationIndex,
    validationRmse,
    dwellStartedAt,
    dwellDurationMs,
    recalibrationCount,
    resolvedUrl,
    imgRef,
    onValidationDwellComplete,
    onRecalibrate,
    onSkipValidation,
    onRejectSession,
    onImageLoad,
    shelfConfig,
}) => {
    const { t } = useTranslation();

    const allMeasured = validationRmse !== null;
    const showRecalibrateOption = allMeasured && validationRmse > HYBRID_RECALIBRATION_RMSE_THRESHOLD_PX;
    const showRejectOption = showRecalibrateOption && recalibrationCount >= 2 && validationRmse > HYBRID_REJECT_RMSE_THRESHOLD_PX;

    const currentPoint = !allMeasured ? HYBRID_VALIDATION_POINTS[validationIndex] : null;
    const validationPercent = allMeasured ? 70 : Math.round(60 + (validationIndex / HYBRID_VALIDATION_POINTS.length) * 10);

    const lastAdvanceRef = useRef(0);

    const advance = () => {
        if (allMeasured) return;
        const now = Date.now();
        if (now - lastAdvanceRef.current < 300) return;
        lastAdvanceRef.current = now;
        onValidationDwellComplete();
    };

    const handleClick = !allMeasured ? (e: React.MouseEvent) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        advance();
    } : undefined;

    const handleTouch = !allMeasured ? (e: React.TouchEvent) => {
        e.stopPropagation();
        advance();
    } : undefined;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black"
            onClickCapture={handleClick}
            onTouchEnd={handleTouch}
            style={{ cursor: !allMeasured ? 'crosshair' : 'default' }}
        >
            <div className="pointer-events-none absolute left-1/2 z-[70] -translate-x-1/2" style={{ top: 'max(16px, env(safe-area-inset-top, 16px))' }}>
                <StepProgressPill step={3} total={TOTAL_STEPS} percent={validationPercent} />
            </div>

            <div className="pointer-events-none absolute left-1/2 z-[70] max-w-lg -translate-x-1/2 px-4 text-center" style={{ top: 'max(80px, calc(env(safe-area-inset-top, 16px) + 64px))' }}>
                {!allMeasured ? (
                    <>
                        <p className="text-sm text-white/80">
                            {t('eyeTracking.dwellInstruction', 'Look at the dot without moving your head. It will move on by itself.')}
                        </p>
                        <p className="mt-1 text-xs text-white/50">
                            {t('eyeTracking.pointOf', 'Point {{current}} of {{total}}', {
                                current: validationIndex + 1,
                                total: HYBRID_VALIDATION_POINTS.length,
                            })}
                            {' — '}
                            {t('eyeTracking.dwellTapFallback', 'if it does not move, tap or click the screen')}
                        </p>
                    </>
                ) : showRejectOption ? (
                    <div className="space-y-3">
                        <p className="text-sm text-white font-medium">
                            {t('eyeTracking.validationRejected', 'After several tries we could not adjust to your gaze. You can continue anyway or skip this activity.')}
                        </p>
                        <div className="pointer-events-auto flex gap-3 justify-center">
                            <button
                                onClick={onSkipValidation}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                            >
                                {t('eyeTracking.continueAnyway', 'Continue anyway')}
                            </button>
                            <button
                                onClick={onRejectSession}
                                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm font-medium hover:bg-white/30 transition-colors"
                            >
                                {t('eyeTracking.endSession', 'Skip this activity')}
                            </button>
                        </div>
                    </div>
                ) : showRecalibrateOption ? (
                    <div className="space-y-3">
                        <p className="text-sm text-white font-medium">
                            {t('eyeTracking.validationFailedMulti', 'We could not adjust to your gaze well. Next time, move only your eyes, not your head. Shall we try again?')}
                        </p>
                        <div className="pointer-events-auto flex gap-3 justify-center">
                            <button
                                onClick={onRecalibrate}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                            >
                                {t('eyeTracking.recalibrate', 'Try again')}
                            </button>
                            <button
                                onClick={onSkipValidation}
                                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm font-medium hover:bg-white/30 transition-colors"
                            >
                                {t('eyeTracking.continueAnyway', 'Continue anyway')}
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>

            {(resolvedUrl || shelfConfig) && (
                <div className="relative">
                    {shelfConfig ? (
                        <ShelfGrid
                            urls={shelfConfig.urls}
                            shelfCount={shelfConfig.shelfCount}
                            shelfItems={shelfConfig.shelfItems}
                            blur
                            opacity={0.6}
                            containerRef={shelfConfig.containerRef}
                            onAllLoaded={shelfConfig.onAllLoaded}
                        />
                    ) : (
                        <img
                            ref={imgRef}
                            src={resolvedUrl}
                            alt="Validation"
                            className="max-w-[100vw] max-h-[100vh] object-contain"
                            style={{ filter: 'blur(12px)', opacity: 0.6 }}
                            draggable={false}
                            onLoad={onImageLoad}
                        />
                    )}
                    {currentPoint && !allMeasured && (
                        <div
                            className="pointer-events-none absolute z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-400 shadow-lg shadow-yellow-400/50"
                            style={{ left: `${currentPoint[0]}%`, top: `${currentPoint[1]}%` }}
                        >
                            <div className="absolute inset-0 rounded-full border-2 border-yellow-300 animate-ping opacity-75" />
                            <DwellRing startedAt={dwellStartedAt} durationMs={dwellDurationMs} colorClassName="text-yellow-300" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
