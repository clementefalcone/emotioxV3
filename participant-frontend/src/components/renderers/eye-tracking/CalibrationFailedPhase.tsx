import React from 'react';
import { useTranslation } from 'react-i18next';

interface CalibrationFailedPhaseProps {
    remainingAttempts: number;
    onRetry: () => void;
}

export const CalibrationFailedPhase: React.FC<CalibrationFailedPhaseProps> = ({ remainingAttempts, onRetry }) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] px-4">
            <div className="max-w-sm w-full text-center space-y-4">
                <h2 className="text-xl font-bold text-gray-900">
                    {t('eyeTracking.calibrationInaccurateTitle', 'We could not adjust your gaze')}
                </h2>
                <p className="text-sm text-gray-500">
                    {t('eyeTracking.calibrationInaccurateHint', {
                        count: remainingAttempts,
                        defaultValue: 'Keep your head still and follow each dot with your eyes. Attempts left: {{count}}',
                    })}
                </p>
                <button
                    onClick={onRetry}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-full font-medium hover:bg-blue-700 transition-colors"
                >
                    {t('eyeTracking.calibrationRetry', 'Try again')}
                </button>
            </div>
        </div>
    );
};
