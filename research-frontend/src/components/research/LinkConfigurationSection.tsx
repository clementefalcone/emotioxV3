import { Input } from '../ui/Input';
import { useToast } from '../../hooks/useToast';

interface LinkConfigurationSectionProps {
    config: Record<string, unknown>;
    linkConfig: Record<string, boolean>;
    linkConfigEnabled: boolean;
    setLinkConfigEnabled: (enabled: boolean) => void;
    participantLimitEnabled: boolean;
    participantLimit: number;
    onChange: (config: Record<string, unknown>) => void;
}

export const LinkConfigurationSection = ({
    config,
    linkConfig,
    linkConfigEnabled,
    setLinkConfigEnabled,
    participantLimitEnabled,
    participantLimit,
    onChange,
}: LinkConfigurationSectionProps) => {
    const toast = useToast();

    const handleLinkConfigChange = (key: string, value: boolean) => {
        onChange({
            ...config,
            linkConfig: { ...linkConfig, [key]: value }
        });
    };

    const handleParticipantLimitEnabledChange = (enabled: boolean) => {
        onChange({
            ...config,
            participantLimit: { enabled, value: participantLimit }
        });
    };

    const handleParticipantLimitChange = (rawValue: string) => {
        const parsed = Number.parseInt(rawValue);
        if (Number.isNaN(parsed) || parsed < 1) {
            toast.warning('Limit must be a number greater than 0');
            return;
        }
        onChange({
            ...config,
            participantLimit: { enabled: participantLimitEnabled, value: parsed }
        });
    };

    return (
        <>
            {/* Link Configuration */}
            <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-900">Link configuration</h3>
                    <input
                        type="checkbox"
                        checked={linkConfigEnabled}
                        onChange={(e) => setLinkConfigEnabled(e.target.checked)}
                        className="rounded border-gray-300"
                        aria-label="Enable link configuration"
                    />
                </div>

                <div className="space-y-3 px-4">
                    <label className={`flex items-center gap-2 text-sm ${!linkConfigEnabled ? 'opacity-50' : ''}`}>
                        <input
                            type="checkbox"
                            checked={linkConfig.allowMobile || false}
                            onChange={(e) => handleLinkConfigChange('allowMobile', e.target.checked)}
                            disabled={!linkConfigEnabled}
                            className="rounded border-gray-300"
                            aria-label="Allow mobile devices"
                        />
                        <span>Allow respondents to take survey via mobile devices</span>
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${!linkConfigEnabled ? 'opacity-50' : ''}`}>
                        <input
                            type="checkbox"
                            checked={linkConfig.allowMultiple || false}
                            onChange={(e) => handleLinkConfigChange('allowMultiple', e.target.checked)}
                            disabled={!linkConfigEnabled}
                            className="rounded border-gray-300"
                            aria-label="Allow multiple responses per session"
                        />
                        <span>It can be taken multiple times within a single session</span>
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${!linkConfigEnabled ? 'opacity-50' : ''}`}>
                        <input
                            type="checkbox"
                            checked={linkConfig.allowLanguageSwitch || false}
                            onChange={(e) => handleLinkConfigChange('allowLanguageSwitch', e.target.checked)}
                            disabled={!linkConfigEnabled}
                            className="rounded border-gray-300"
                            aria-label="Allow respondents to switch language"
                        />
                        <span>Allow respondents to switch survey language</span>
                    </label>
                </div>
            </div>

            {/* Participant Limit */}
            <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-900">Limit number of participants</h3>
                    <input
                        type="checkbox"
                        checked={participantLimitEnabled}
                        onChange={(e) => handleParticipantLimitEnabledChange(e.target.checked)}
                        className="rounded border-gray-300"
                        aria-label="Enable participant limit"
                    />
                </div>

                <div className={`px-4 ${!participantLimitEnabled ? 'opacity-50' : ''}`}>
                    <p className="text-sm text-gray-600 mb-2">
                        Stop accepting responses after this number of participants.
                    </p>
                    <Input
                        type="number"
                        value={participantLimit}
                        onChange={(e) => handleParticipantLimitChange(e.target.value)}
                        className="w-24"
                        min={1}
                        disabled={!participantLimitEnabled}
                    />
                </div>
            </div>
        </>
    );
};
