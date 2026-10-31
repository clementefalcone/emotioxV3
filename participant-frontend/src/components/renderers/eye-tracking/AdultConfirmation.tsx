import React from 'react';
import { useTranslation } from 'react-i18next';

interface AdultConfirmationProps {
    isConfirmed: boolean;
    onChange: (isConfirmed: boolean) => void;
}

export const AdultConfirmation: React.FC<AdultConfirmationProps> = ({ isConfirmed, onChange }) => {
    const { t } = useTranslation();
    return (
        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input
                type="checkbox"
                checked={isConfirmed}
                onChange={(event) => onChange(event.target.checked)}
                className="mt-0.5 rounded border-gray-300"
            />
            <span>{t('eyeTracking.consent.adult', 'I confirm I am 18 or older.')}</span>
        </label>
    );
};
