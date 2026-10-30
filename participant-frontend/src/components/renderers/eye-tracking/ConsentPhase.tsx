import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ConsentPhaseProps {
    taskDescription: string;
    hasEmotionRecognition: boolean;
    isGazeModelLoaded: boolean;
    onAccept: (consentText: string) => Promise<boolean>;
    onDecline: (consentText: string) => void;
}

export const ConsentPhase: React.FC<ConsentPhaseProps> = ({ taskDescription, hasEmotionRecognition, isGazeModelLoaded, onAccept, onDecline }) => {
    const { t } = useTranslation();
    const [isStartingCamera, setIsStartingCamera] = useState(false);
    const [hasCameraFailed, setHasCameraFailed] = useState(false);
    const [consentError, setConsentError] = useState<string | null>(null);
    const consentRef = useRef<HTMLDivElement>(null);
    const readConsentText = () => consentRef.current?.innerText ?? '';

    const handleAccept = async () => {
        setIsStartingCamera(true);
        setHasCameraFailed(false);
        setConsentError(null);
        try {
            const isCameraOn = await onAccept(readConsentText());
            setHasCameraFailed(!isCameraOn);
        } catch (err) {
            console.error(err);
            setConsentError(t('eyeTracking.consent.recordFailed', 'We could not save your consent. Check your connection and try again.'));
        } finally {
            setIsStartingCamera(false);
        }
    };

    const capturedItems = [
        ...(hasEmotionRecognition ? [t('eyeTracking.consent.capturedEmotions', 'Basic emotions and face movements, as numbers, several times per second.')] : []),
        t('eyeTracking.consent.capturedGaze', 'Where you look on the screen and for how long. First you will look at 9 dots to adjust it.'),
    ];
    const notCapturedItems = [
        t('eyeTracking.consent.notCapturedVideo', 'Video or photos of your face'),
        t('eyeTracking.consent.notCapturedAudio', 'Audio'),
    ];

    return (
        <div className="flex flex-col items-center px-4 py-8">
            <div ref={consentRef} className="w-full max-w-lg space-y-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                    {t('eyeTracking.consent.eyebrow', 'Consent')}
                </p>
                <h2 className="text-2xl font-bold text-gray-900">
                    {t('eyeTracking.consent.title', 'Camera and biometrics')}
                </h2>
                {taskDescription && <p className="text-gray-600">{taskDescription}</p>}
                <p className="text-gray-600">
                    {t('eyeTracking.consent.description', 'We need your permission. Everything is processed in your browser. Video of your face is not recorded or stored.')}
                </p>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-4 text-sm">
                    <div className="space-y-2">
                        <p className="font-semibold text-gray-900">{t('eyeTracking.consent.capturedTitle', 'If you accept, we save:')}</p>
                        <ul className="list-disc pl-5 space-y-1 text-gray-600">
                            {capturedItems.map(item => <li key={item}>{item}</li>)}
                        </ul>
                    </div>
                    <div className="space-y-2">
                        <p className="font-semibold text-gray-900">{t('eyeTracking.consent.notCapturedTitle', 'We do not save:')}</p>
                        <ul className="list-disc pl-5 space-y-1 text-gray-600">
                            {notCapturedItems.map(item => <li key={item}>{item}</li>)}
                        </ul>
                    </div>
                    <p className="text-xs text-gray-500">
                        {t('eyeTracking.consent.revoke', 'You can remove camera permission in your browser at any time.')}
                    </p>
                </div>

                {consentError && <p className="text-sm text-red-500">{consentError}</p>}
                {hasCameraFailed && (
                    <p className="text-sm text-red-500">
                        {t('eyeTracking.cameraBlocked', 'Camera permission denied. Reload the page to try again.')}
                    </p>
                )}

                <button
                    onClick={handleAccept}
                    disabled={!isGazeModelLoaded || isStartingCamera}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-full font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {isGazeModelLoaded
                        ? t('eyeTracking.consent.accept', 'I accept and turn on the camera')
                        : t('eyeTracking.loading', 'Loading...')}
                </button>
                <button
                    onClick={() => onDecline(readConsentText())}
                    className="w-full text-sm text-red-500 underline"
                >
                    {t('eyeTracking.consent.decline', 'I do not accept · Skip this activity')}
                </button>
            </div>
        </div>
    );
};
