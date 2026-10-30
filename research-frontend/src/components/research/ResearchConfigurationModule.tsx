import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { QRCodeModal } from '../ui/QRCodeModal';
import { ExternalLink, QrCode, Copy } from 'lucide-react';
import { PanelParticipantsSection } from './PanelParticipantsSection';
import { useUrlValidation } from '../../hooks/useUrlValidation';
import { mapModalConfigToBackend } from '../../utils/demographicsMapper';
import { useToast } from '../../hooks/useToast';
import { BacklinkInput } from './BacklinkInput';
import { DemographicsSection } from './DemographicsSection';
import { ScreeningQuestionsSection } from './ScreeningQuestionsSection';
import { StudyLogoSection } from './StudyLogoSection';
import { BiometricRetentionSection } from './BiometricRetentionSection';
import { LinkConfigurationSection } from './LinkConfigurationSection';
import { DemographicModals } from './DemographicModals';
import {
    asDemoConfig,
    DEMOGRAPHIC_QUOTA_FIELD,
    type DemographicsConfig,
    type DemographicConfigValue,
    type ParticipationMode,
    type ResearchConfigurationProps,
} from './researchConfigurationHelpers';

/**
 * Research Configuration Module Component
 * Renders the recruitment and configuration settings for a research
 */
export const ResearchConfigurationModule = ({ config, researchStatus, researchName, onChange }: ResearchConfigurationProps) => {
    const { id: researchId } = useParams<{ id: string }>();
    const [participationMode, setParticipationMode] = useState<ParticipationMode>(
        () => (config.participationMode as ParticipationMode) || 'panel'
    );
    useEffect(() => {
        const mode = (config.participationMode as ParticipationMode) || 'panel';
        setParticipationMode(mode);
    }, [config.participationMode]);
    const isResearchActive = researchStatus === 'active';
    const isKiosk = participationMode === 'kiosk';
    const [demographicEnabled, setDemographicEnabled] = useState(true);
    const [linkConfigEnabled, setLinkConfigEnabled] = useState(true);
    const savedParticipantLimit = config.participantLimit as { enabled: boolean; value: number } | number | undefined;
    const participantLimitEnabled = (() => {
        if (typeof savedParticipantLimit === 'object' && savedParticipantLimit !== null) {
            return savedParticipantLimit.enabled;
        }
        return typeof savedParticipantLimit === 'number';
    })();
    const [showQRModal, setShowQRModal] = useState(false);
    const [urlErrors, setUrlErrors] = useState<Record<string, string>>({});

    const { validateUrl } = useUrlValidation();
    const toast = useToast();
    const backlinkValidationTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const demographics = useMemo(() => (config.demographics || {}) as DemographicsConfig, [config.demographics]);
    const linkConfig = (config.linkConfig || {}) as Record<string, boolean>;
    const backlinks = useMemo(() => (config.backlinks || {}) as Record<string, string>, [config.backlinks]);
    const participantLimit = typeof savedParticipantLimit === 'object' && savedParticipantLimit !== null
        ? savedParticipantLimit.value
        : (typeof savedParticipantLimit === 'number' ? savedParticipantLimit : 50);
    const [activeConfigModal, setActiveConfigModal] = useState<string | null>(null);
    const [quotasEnabledState, setQuotasEnabledState] = useState<Record<string, boolean>>({});
    const pendingQuotasRef = useRef<{ key: string; quotas: object[] } | null>(null);
    const pendingLabelRef = useRef<{ key: string; label: string } | null>(null);
    const [runtimeParticipantBaseUrl, setRuntimeParticipantBaseUrl] = useState<string | null>(null);
    const [runtimeConfigLoaded, setRuntimeConfigLoaded] = useState(false);

    /**
     * Loads participant base URL from /runtime-config.json when deployed (CloudFront).
     */
    useEffect(() => {
        const host = window.location.hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1';
        if (isLocal) {
            setRuntimeParticipantBaseUrl(null);
            setRuntimeConfigLoaded(true);
            return;
        }

        const isRuntimeConfigWithParticipant = (value: unknown): value is { participantBaseUrl: string } => {
            if (typeof value !== 'object' || value === null) return false;
            const record = value as Record<string, unknown>;
            return typeof record.participantBaseUrl === 'string' && record.participantBaseUrl.trim().length > 0;
        };

        let cancelled = false;
        void (async (): Promise<void> => {
            try {
                const configPath = `${import.meta.env.BASE_URL}runtime-config.json`;
                const response = await fetch(configPath, { cache: 'no-store' });
                if (!response.ok) {
                    console.warn('[ResearchConfigurationModule] Failed to fetch runtime-config.json:', response.status, response.statusText);
                    setRuntimeConfigLoaded(true);
                    return;
                }
                const data = (await response.json()) as unknown;
                if (!cancelled && isRuntimeConfigWithParticipant(data)) {
                    const participantUrl = data.participantBaseUrl.replace(/\/+$/, '');
                    // Ensure URL has protocol
                    const normalizedUrl = participantUrl.startsWith('http://') || participantUrl.startsWith('https://')
                        ? participantUrl
                        : `https://${participantUrl}`;
                    setRuntimeParticipantBaseUrl(normalizedUrl);
                    setRuntimeConfigLoaded(true);
                    console.log('[ResearchConfigurationModule] Loaded participantBaseUrl from runtime-config.json:', normalizedUrl);
                } else if (!cancelled) {
                    console.warn('[ResearchConfigurationModule] runtime-config.json does not contain valid participantBaseUrl');
                    setRuntimeConfigLoaded(true);
                }
            } catch (error) {
                console.warn('[ResearchConfigurationModule] Error loading runtime-config.json, falling back to env config:', error);
                setRuntimeConfigLoaded(true);
                // Fallback handled in participantShareUrl useMemo
            }
        })();

        return (): void => {
            cancelled = true;
        };
    }, []);

    /**
     * Memoized participant share URL that updates when dependencies change.
     * Inlined to satisfy exhaustive-deps — all reactive values are in the dep array.
     */
    const participantShareUrl = useMemo(() => {
        // Resolve participant base URL (inlined from resolveParticipantBaseUrl)
        const host = window.location.hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1';
        let baseUrl = '';

        if (isLocal) {
            baseUrl = 'http://localhost:12600';
        } else if (runtimeConfigLoaded && runtimeParticipantBaseUrl && runtimeParticipantBaseUrl.trim().length > 0) {
            const url = runtimeParticipantBaseUrl.trim();
            baseUrl = (url.startsWith('http://') || url.startsWith('https://')) ? url : `https://${url}`;
        } else {
            const envUrl = import.meta.env.VITE_PARTICIPANT_FRONTEND_URL;
            if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
                const url = envUrl.trim();
                baseUrl = (url.startsWith('http://') || url.startsWith('https://')) ? url : `https://${url}`;
            } else if (host === 'emotio.cx' || host.includes('emotio.cx')) {
                baseUrl = 'https://emotio.cx/participant';
            } else if (host === 'research.emotiox.org' || host.includes('emotiox.org')) {
                baseUrl = 'https://participant.emotiox.org';
            }
        }

        if (!baseUrl || !researchId) return '';

        try {
            const base = new URL(baseUrl);
            if (base.protocol !== 'https:' && base.hostname !== 'localhost' && !base.hostname.includes('127.0.0.1')) {
                base.protocol = 'https:';
            }
        } catch {
            return '';
        }

        return `${baseUrl}/research/${researchId}`;
    }, [runtimeParticipantBaseUrl, runtimeConfigLoaded, researchId]);

    /**
     * Opens the participant-facing URL in preview mode in a new tab.
     * @returns void
     */
    const handleLinkPreview = (): void => {
        const url = participantShareUrl ? `${participantShareUrl}?preview=true` : '';
        if (!url || url.trim().length === 0) {
            toast.error('Failed to generate URL. Verify that the participant domain is configured correctly.');
            console.error('[ResearchConfigurationModule] Cannot open preview: URL is empty or invalid');
            return;
        }

        try {
            // Validate URL before opening
            new URL(url);
            const opened = window.open(url, '_blank', 'noopener,noreferrer');
            if (!opened) {
                toast.error('Failed to open window. Verify that pop-ups are not blocked.');
                console.error('[ResearchConfigurationModule] window.open was blocked by browser');
            }
        } catch (error) {
            toast.error('Generated URL is not valid. Verify the configuration.');
            console.error('[ResearchConfigurationModule] Invalid URL generated:', url, error);
        }
    };

    const handleDemographicChange = (key: string, value: DemographicConfigValue) => {
        onChange({
            ...config,
            demographics: { ...demographics, [key]: value }
        });
    };

    // Helper to get safe boolean enabled state
    const isDemographicEnabled = (key: string): boolean => {
        const val = demographics[key];
        if (typeof val === 'boolean') return val;
        if (typeof val === 'object' && val !== null) return val.enabled === true;
        return false;
    };

    const handleSaveDemographicConfig = (newConfig: Record<string, unknown>) => {
        if (!activeConfigModal) return;

        const backendConfig = mapModalConfigToBackend(activeConfigModal, newConfig);

        // Preserve questionLabel (custom label override for any demographic)
        if (typeof newConfig.questionLabel === 'string') {
            backendConfig.questionLabel = newConfig.questionLabel;
        } else if (pendingLabelRef.current?.key === activeConfigModal && pendingLabelRef.current.label) {
            backendConfig.questionLabel = pendingLabelRef.current.label;
        }

        // Only preserve old quotas when this save payload did not include quota data (legacy modals
        // that still rely on onQuotasSave + flush). If newConfig.quotas is present (including []),
        // the mapper already reflects the intended state — do not overwrite with stale data.
        const currentDemographic = asDemoConfig(demographics[activeConfigModal]);
        const newHasQuotasKey = Object.prototype.hasOwnProperty.call(newConfig, 'quotas');
        if (
            !newHasQuotasKey &&
            Array.isArray(currentDemographic.quotas) &&
            currentDemographic.quotas.length > 0
        ) {
            backendConfig.quotas = currentDemographic.quotas as typeof backendConfig.quotas;
        }

        const newDemographics = {
            ...demographics,
            [activeConfigModal]: backendConfig
        };

        // When saving country config, also manage demographics.city entry
        if (activeConfigModal === 'country') {
            const cityEntries = (newConfig.cities as Array<{ name: string; isDisqualifying: boolean; country?: string }>) || [];
            const gran = (newConfig.granularity as string) || 'countryOnly';
            if (gran === 'countryCity' && cityEntries.length > 0) {
                const allCityNames = cityEntries.map(c => c.name);
                const disqualifyingCities = cityEntries.filter(c => c.isDisqualifying);
                newDemographics.city = {
                    ...asDemoConfig(demographics.city),
                    enabled: true,
                    validValues: allCityNames,
                    disqualifications: disqualifyingCities.length > 0
                        ? disqualifyingCities.map(c => ({
                            id: `city-disq-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                            value: c.name,
                            limit: 0,
                            enabled: true
                        }))
                        : undefined
                };
                // Persist city entries with country association for round-trip
                backendConfig.cities = cityEntries.map(c => ({
                    name: c.name,
                    ...(c.country ? { country: c.country } : {})
                }));
            } else if (newDemographics.city) {
                newDemographics.city = { enabled: false, validValues: [] };
                backendConfig.cities = undefined;
            }
        }

        onChange({
            ...config,
            demographics: newDemographics
        });
    };

    const handleQuotasSave = (_demographicKey: string, quotas: object[]) => {
        // Store pending quotas — they'll be flushed when the modal closes
        // to avoid a race condition with handleSaveDemographicConfig
        pendingQuotasRef.current = { key: _demographicKey, quotas };
    };

    // Keep fresh refs for the quota-flush effect so it never reads stale closures
    const configRef = useRef(config);
    const demographicsRef = useRef(demographics);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        configRef.current = config;
        demographicsRef.current = demographics;
        onChangeRef.current = onChange;
    });

    // Flush pending quotas after the modal closes (activeConfigModal becomes null)
    // At this point React has already processed the onChange from handleSaveDemographicConfig,
    // so demographics contains the updated config and we can safely merge quotas.
    useEffect(() => {
        if (activeConfigModal !== null || !pendingQuotasRef.current) return;

        const { key, quotas } = pendingQuotasRef.current;
        pendingQuotasRef.current = null;

        // Convert modal-format quotas to backend format using field mapping
        const fieldName = DEMOGRAPHIC_QUOTA_FIELD[key] || (key.startsWith('customQuestion_') ? 'optionValue' : key);
        const backendQuotas = quotas.map((q) => {
            const r = q as Record<string, unknown>;
            return {
                id: String(r.id ?? ''),
                value: String(r[fieldName] ?? ''),
                limit: Number(r.quota ?? 0),
                enabled: Boolean(r.isActive),
                enforcementMode: 'immediate',
                quotaType: 'percentage'
            };
        });

        const currentDemographics = demographicsRef.current;
        const current = asDemoConfig(currentDemographics[key]);
        onChangeRef.current({
            ...configRef.current,
            demographics: {
                ...currentDemographics,
                [key]: { ...current, quotas: backendQuotas }
            }
        });
    }, [activeConfigModal]);

    // Flush pending label after modal closes — merges the edited label into demographics config.
    useEffect(() => {
        if (activeConfigModal !== null || !pendingLabelRef.current) return;

        const { key, label } = pendingLabelRef.current;
        pendingLabelRef.current = null;

        const currentDemographics = demographicsRef.current;
        const current = asDemoConfig(currentDemographics[key]);
        // Only persist if the label is non-empty (empty = use default)
        const updatedLabel = label.trim() || undefined;
        if (updatedLabel !== current.questionLabel) {
            onChangeRef.current({
                ...configRef.current,
                demographics: {
                    ...currentDemographics,
                    [key]: { ...current, questionLabel: updatedLabel }
                }
            });
        }
    }, [activeConfigModal]);

    /** Returns the editable label input JSX for a demographic modal */
    const renderLabelEditor = (demographicKey: string, defaultLabel: string) => {
        return (
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Question label</label>
                <input
                    type="text"
                    defaultValue={asDemoConfig(demographics[demographicKey]).questionLabel || ''}
                    onChange={(e) => {
                        pendingLabelRef.current = { key: demographicKey, label: e.target.value };
                    }}
                    placeholder={defaultLabel}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="mt-1 text-xs text-gray-500">
                    Customize the label shown to participants. Leave empty to use the default.
                </p>
            </div>
        );
    };

    const handleQuotasToggle = (demographicKey: string, enabled: boolean) => {
        setQuotasEnabledState(prev => ({ ...prev, [demographicKey]: enabled }));
    };

    const handleBacklinkChange = useCallback((key: string, value: string) => {
        let normalizedValue = value.trim();
        if (normalizedValue && !normalizedValue.startsWith('http://') && !normalizedValue.startsWith('https://')) {
            normalizedValue = `https://${normalizedValue}`;
        }

        // Debounce URL validation (300ms) — update value immediately
        const timerKey = `backlink-${key}`;
        if (backlinkValidationTimers.current[timerKey]) {
            clearTimeout(backlinkValidationTimers.current[timerKey]);
        }
        backlinkValidationTimers.current[timerKey] = setTimeout(() => {
            if (normalizedValue) {
                const { isValid, error } = validateUrl(normalizedValue);
                setUrlErrors(prev => ({
                    ...prev,
                    [timerKey]: isValid ? '' : (error || 'Invalid URL'),
                }));
            } else {
                setUrlErrors(prev => ({ ...prev, [timerKey]: '' }));
            }
        }, 300);

        onChange({
            ...config,
            backlinks: { ...backlinks, [key]: normalizedValue }
        });
    }, [config, backlinks, validateUrl, onChange]);

    const handleParticipationModeChange = (mode: ParticipationMode) => {
        if (isResearchActive) return;
        setParticipationMode(mode);
        onChange({ ...config, participationMode: mode });
    };

    const [configTab, setConfigTab] = useState<'setup' | 'links' | 'settings' | 'participants'>('setup');

    const configTabs = [
        { id: 'setup' as const, label: 'Setup' },
        { id: 'links' as const, label: 'Links & QR' },
        { id: 'settings' as const, label: 'Settings' },
        ...(!isKiosk ? [{ id: 'participants' as const, label: 'Participants' }] : []),
    ];

    return (
        <div>
            {/* Tab bar */}
            <div className="flex gap-1 border-b border-gray-200 mb-4">
                {configTabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setConfigTab(tab.id)}
                        className={`px-3 py-2 text-sm border-b-2 transition-colors ${
                            configTab === tab.id
                                ? 'border-blue-600 text-blue-600 font-medium'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Setup tab */}
            {configTab === 'setup' && (
            <div className="flex gap-8">
                {/* Left: Mode + Logo */}
                <div className="flex-1 space-y-5">
                    {/* Participation Mode Selector */}
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <h3 className="text-sm font-medium text-gray-900 mb-3">Participation mode</h3>
                        {isResearchActive && (
                            <p className="text-xs text-amber-600 mb-3">
                                Mode cannot be changed while research is active.
                            </p>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => handleParticipationModeChange('kiosk')}
                                disabled={isResearchActive}
                                className={`p-3 rounded-lg border-2 text-left transition-colors ${
                                    isKiosk
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                } ${isResearchActive ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                                <span className="block text-sm font-medium text-gray-900">Kiosk</span>
                                <span className="block text-xs text-gray-500 mt-1">
                                    Shared device, anonymous participants, auto-reset
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleParticipationModeChange('panel')}
                                disabled={isResearchActive}
                                className={`p-3 rounded-lg border-2 text-left transition-colors ${
                                    !isKiosk
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                } ${isResearchActive ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                                <span className="block text-sm font-medium text-gray-900">Panel</span>
                                <span className="block text-xs text-gray-500 mt-1">
                                    Individual links, identified participants, demographics
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Custom Screening Questions — hidden in kiosk mode */}
                    {!isKiosk && demographicEnabled && (
                        <ScreeningQuestionsSection
                            demographics={demographics}
                            config={config}
                            onChange={onChange}
                            handleDemographicChange={handleDemographicChange}
                            setActiveConfigModal={setActiveConfigModal}
                        />
                    )}

                    {/* Study Logo */}
                    <StudyLogoSection
                        config={config}
                        researchId={researchId}
                        onChange={onChange}
                    />
                </div>

                {/* Right: Demographics */}
                {!isKiosk && (
                    <div className="w-[345px] flex-shrink-0">
                        <DemographicsSection
                            demographics={demographics}
                            demographicEnabled={demographicEnabled}
                            setDemographicEnabled={setDemographicEnabled}
                            handleDemographicChange={handleDemographicChange}
                            isDemographicEnabled={isDemographicEnabled}
                            setActiveConfigModal={setActiveConfigModal}
                        />
                    </div>
                )}
            </div>
            )}

            {/* Settings tab */}
            {configTab === 'settings' && (
            <div className="max-w-xl space-y-6">
                <LinkConfigurationSection
                    config={config}
                    linkConfig={linkConfig}
                    linkConfigEnabled={linkConfigEnabled}
                    setLinkConfigEnabled={setLinkConfigEnabled}
                    participantLimitEnabled={participantLimitEnabled}
                    participantLimit={participantLimit}
                    onChange={onChange}
                />
                {researchId && <BiometricRetentionSection researchId={researchId} />}
            </div>
            )}

            {/* Links tab */}
            {configTab === 'links' && (
            <div className="flex gap-8">
                {/* A. Backlinks */}
                <div className="flex-1 space-y-4">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">A. Backlinks</h3>
                        <p className="text-xs text-gray-500 mb-4">
                            Please use @id parameters to transmit respondents ID&apos;s into your system
                        </p>
                    </div>

                    <BacklinkInput
                        label="Link for complete interviews"
                        value={backlinks.complete}
                        onChange={(value) => handleBacklinkChange('complete', value)}
                        error={urlErrors['backlink-complete']}
                    />

                    {!isKiosk && (
                    <>
                    <BacklinkInput
                        label="Link for disqualified interviews"
                        value={backlinks.disqualified}
                        onChange={(value) => handleBacklinkChange('disqualified', value)}
                        error={urlErrors['backlink-disqualified']}
                    />

                    <BacklinkInput
                        label="Link for overquota interviews"
                        value={backlinks.overquota}
                        onChange={(value) => handleBacklinkChange('overquota', value)}
                        error={urlErrors['backlink-overquota']}
                    />
                    </>
                    )}
                </div>

                {/* B. Research Link */}
                <div className="flex-1 space-y-4">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">B. Research&apos;s link to share</h3>
                        <p className="text-xs text-gray-500 mb-4">
                            {isKiosk
                                ? 'Share this URL or QR code on the shared device. Participant IDs are generated automatically.'
                                : 'Share this URL with participants. Third-party systems can append participant ID as a query parameter.'}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-700 mb-2">Research URL</label>
                        <div className="flex gap-1 mb-2">
                            <Input
                                value={isKiosk ? participantShareUrl : `${participantShareUrl}?ECX=@id`}
                                readOnly
                                className="bg-gray-50 cursor-default"
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                title="Copy"
                                onClick={async () => {
                                    const url = isKiosk ? participantShareUrl : `${participantShareUrl}?ECX=@id`;
                                    if (!url) {
                                        toast.error('Failed to generate URL.');
                                        return;
                                    }
                                    try {
                                        await navigator.clipboard.writeText(url);
                                        toast.success('URL copied to clipboard');
                                    } catch {
                                        toast.error('Failed to copy URL');
                                    }
                                }}
                            >
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                        {!isKiosk && (
                            <p className="text-xs text-gray-400 mb-3">
                                <code className="bg-gray-100 px-1 rounded">@id</code> será reemplazado por el sistema externo con el ID real del participante.
                            </p>
                        )}
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleLinkPreview}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Link Preview
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => {
                                    const url = participantShareUrl;
                                    if (!url || url.trim().length === 0) {
                                        toast.error('Failed to generate URL. Verify that the participant domain is configured correctly.');
                                        return;
                                    }
                                    setShowQRModal(true);
                                }}
                            >
                                <QrCode className="h-4 w-4 mr-2" />
                                Generate QR
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
            )}

            {/* Participants tab */}
            {configTab === 'participants' && !isKiosk && researchId && participantShareUrl && (
                <PanelParticipantsSection
                    researchId={researchId}
                    participantShareUrl={participantShareUrl}
                    researchName={researchName || 'Research Study'}
                />
            )}

            {/* QR Code Modal */}
            <QRCodeModal
                isOpen={showQRModal}
                onClose={() => setShowQRModal(false)}
                url={participantShareUrl}
                title="Research link QR Code"
                description="This is your Public QR Code"
                downloadFileName="research-qr-code.png"
            />

            {/* Specific Config Modals */}
            <DemographicModals
                activeConfigModal={activeConfigModal}
                setActiveConfigModal={setActiveConfigModal}
                demographics={demographics}
                quotasEnabledState={quotasEnabledState}
                handleSaveDemographicConfig={handleSaveDemographicConfig}
                handleQuotasSave={handleQuotasSave}
                handleQuotasToggle={handleQuotasToggle}
                renderLabelEditor={renderLabelEditor}
            />
        </div>
    );
};
