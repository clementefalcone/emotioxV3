import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionStore } from '../../stores/useSessionStore';

// Turnstile temporarily disabled - will be re-enabled when TURNSTILE_SECRET_KEY is configured
const TURNSTILE_ENABLED = false;

interface WelcomeStepProps {
    title?: string;
    message?: string;
}

export const WelcomeStep: React.FC<WelcomeStepProps> = ({
    title,
    message
}) => {
    const { t } = useTranslation();
    const { setTurnstileToken, turnstileVerified } = useSessionStore();
    const resolvedTitle = title || t('welcome.defaultTitle');
    const resolvedMessage = message || t('welcome.defaultMessage');

    // Auto-verify when Turnstile is disabled
    useEffect(() => {
        if (!TURNSTILE_ENABLED && !turnstileVerified) {
            setTurnstileToken('disabled');
        }
    }, [turnstileVerified, setTurnstileToken]);

    return (
        <div className="flex flex-col items-center justify-center text-center space-y-6 px-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <svg
                    className="w-8 h-8 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                    />
                </svg>
            </div>

            <h1 className="text-3xl font-bold text-gray-900">
                {resolvedTitle}
            </h1>

            <p className="text-lg text-gray-600 max-w-2xl">
                {resolvedMessage}
            </p>
        </div>
    );
};
