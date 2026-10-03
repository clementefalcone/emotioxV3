import React from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS } from './types';

export const PreparingPhase: React.FC = () => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] px-4">
            <StepProgressPill step={1} total={TOTAL_STEPS} percent={30} />

            <div className="mt-12 text-center space-y-4">
                <h2 className="text-xl font-bold text-gray-900">
                    {t('eyeTracking.preparingCamera', 'Starting camera...')}
                </h2>
                <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
        </div>
    );
};
