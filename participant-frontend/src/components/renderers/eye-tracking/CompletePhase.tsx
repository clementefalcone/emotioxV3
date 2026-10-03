import React from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS } from './types';

interface CompletePhaseProps {
    finalPointCount: number;
}

export const CompletePhase: React.FC<CompletePhaseProps> = ({ finalPointCount }) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] px-4">
            <StepProgressPill step={3} total={TOTAL_STEPS} percent={100} />

            <div className="mt-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center mx-auto">
                    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <p className="text-lg font-medium text-gray-700">
                    {t('eyeTracking.complete', 'Test completed. Thank you!')}
                </p>
                <p className="text-sm text-gray-500">
                    {t('eyeTracking.gazePointsRecorded', '{{count}} gaze samples recorded.', { count: finalPointCount })}
                </p>
            </div>
        </div>
    );
};
