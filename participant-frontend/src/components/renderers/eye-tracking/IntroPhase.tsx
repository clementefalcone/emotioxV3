import React from 'react';
import { useTranslation } from 'react-i18next';

interface IntroPhaseProps {
    taskDescription: string;
    isBlazeLoaded: boolean;
    onNext: () => void;
}

export const IntroPhase: React.FC<IntroPhaseProps> = ({ taskDescription, isBlazeLoaded, onNext }) => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] px-4 py-8">
            <div className="w-full max-w-lg space-y-6">
                <h2 className="text-xl font-bold text-gray-900">
                    {t('eyeTracking.introTitle', 'In this section')}
                </h2>
                {taskDescription && (
                    <p className="text-gray-600">{taskDescription}</p>
                )}
                <p className="text-gray-600">
                    {t('eyeTracking.introDescriptionUnified', 'You will be presented with images. Your eye movements will be tracked to understand what catches your attention.')}
                </p>
                <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>{t('eyeTracking.webcamRequired', 'Webcam access will be required')}</span>
                </div>
                {!isBlazeLoaded && (
                    <p className="text-amber-600 text-xs">{t('eyeTracking.loadingModel', 'Loading gaze model...')}</p>
                )}
                <button
                    onClick={onNext}
                    disabled={!isBlazeLoaded}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {!isBlazeLoaded
                        ? t('eyeTracking.loading', 'Loading...')
                        : t('eyeTracking.next', 'Next')}
                </button>
            </div>
        </div>
    );
};
