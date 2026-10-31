import React from 'react';
import { useTranslation } from 'react-i18next';
import { useParticipantStore } from '../../../stores/useParticipantStore';

export const ConsentDisclosure: React.FC = () => {
    const { t } = useTranslation();
    const privacyNotice = useParticipantStore((state) => state.privacyNotice);
    const controller = [privacyNotice?.controllerName, privacyNotice?.contactEmail].filter(Boolean).join(' · ');

    return (
        <div className="space-y-1 text-xs text-gray-500">
            <p>{t('eyeTracking.consent.purpose', 'Purpose: user experience research.')}</p>
            <p>{t('eyeTracking.consent.sensitive', 'Emotions and gaze are biometric data, considered sensitive.')}</p>
            {privacyNotice && (
                <p>{t('eyeTracking.consent.retention', { months: privacyNotice.biometricRetentionMonths, defaultValue: 'Data is kept {{months}} months and then deleted.' })}</p>
            )}
            {controller && <p>{t('eyeTracking.consent.controller', { controller, defaultValue: 'Controller: {{controller}}' })}</p>}
            <p>{t('eyeTracking.consent.rights', 'You can request access to or deletion of your data and withdraw your consent at any time.')}</p>
            {privacyNotice?.policyUrl && (
                <a href={privacyNotice.policyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    {t('eyeTracking.consent.policy', 'Privacy policy')}
                </a>
            )}
        </div>
    );
};
