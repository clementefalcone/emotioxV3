/**
 * Website Tracking Configuration View
 * Builder view for Website Tracking research type.
 * Shows tracking config, embed snippet, and domain setup.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as trackingService from '../../services/tracking.service';
import type { TrackingConfig } from '../../services/tracking.service';
import { researchKeys } from '../../hooks/useResearchQuery';
import { CopyButton } from '../ui/CopyButton';
import type { Research } from '../../services/research.service';

interface WebsiteTrackingConfigProps {
    research: Research;
}

export const WebsiteTrackingConfig = ({ research }: WebsiteTrackingConfigProps) => {
    const queryClient = useQueryClient();
    const [snippet, setSnippet] = useState<string>('');
    const [saving, setSaving] = useState(false);

    const settings = (research.settings || {}) as Record<string, unknown>;
    const existingConfig = (settings.trackingConfig || {}) as Partial<TrackingConfig>;
    const [config, setConfig] = useState<TrackingConfig>({
        captureClicks: existingConfig.captureClicks !== false,
        captureScroll: existingConfig.captureScroll === true,
        captureMousemove: existingConfig.captureMousemove === true,
        consentRequired: existingConfig.consentRequired !== false,
        flushIntervalMs: existingConfig.flushIntervalMs || 2000,
        maxEventsPerFlush: existingConfig.maxEventsPerFlush || 50,
        allowedDomains: existingConfig.allowedDomains || [],
        consentText: existingConfig.consentText || 'This site uses interaction tracking for UX research.',
        consentAcceptLabel: existingConfig.consentAcceptLabel || 'Accept',
        consentDeclineLabel: existingConfig.consentDeclineLabel || 'Decline',
        consentPosition: existingConfig.consentPosition || 'bottom',
        samplingRate: existingConfig.samplingRate ?? 100,
        excludedIPs: existingConfig.excludedIPs || [],
        targetPages: existingConfig.targetPages || [],
        excludePages: existingConfig.excludePages || [],
        dataRetentionDays: existingConfig.dataRetentionDays || 90,
        captureEmotions: existingConfig.captureEmotions === true,
        emotionVideoEnabled: existingConfig.emotionVideoEnabled === true,
        captureGaze: existingConfig.captureGaze === true,
        gazeCalibrationPoints: existingConfig.gazeCalibrationPoints === 5 ? 5 : 9,
    });
    const [domainInput, setDomainInput] = useState('');

    // Load embed snippet
    useEffect(() => {
        trackingService.getEmbedSnippet(research.id)
            .then(setSnippet)
            .catch(() => setSnippet('<!-- Error loading snippet -->'));
    }, [research.id]);

    const handleToggle = useCallback((key: keyof TrackingConfig) => {
        setConfig((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const handleAddDomain = useCallback(() => {
        const domain = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        if (domain && !config.allowedDomains.includes(domain)) {
            setConfig((prev) => ({
                ...prev,
                allowedDomains: [...prev.allowedDomains, domain],
            }));
            setDomainInput('');
        }
    }, [domainInput, config.allowedDomains]);

    const handleRemoveDomain = useCallback((domain: string) => {
        setConfig((prev) => ({
            ...prev,
            allowedDomains: prev.allowedDomains.filter((d) => d !== domain),
        }));
    }, []);

    // Auto-save config on change (debounced 1s). Skip initial mount.
    const mountedRef = useRef(false);
    useEffect(() => {
        if (!mountedRef.current) { mountedRef.current = true; return; }
        const timer = setTimeout(() => {
            setSaving(true);
            trackingService.updateConfig(research.id, config)
                .then(() => queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) }))
                .catch(() => { /* best-effort */ })
                .finally(() => setSaving(false));
        }, 1000);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    const [verifying, setVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState<'success' | 'no_sessions' | 'script_error' | null>(null);

    const handleVerify = useCallback(async () => {
        setVerifying(true);
        setVerifyResult(null);

        try {
            // Brief polling: 5 checks over 15s — enough to catch a visitor loading the page
            for (let i = 0; i < 5; i++) {
                const result = await trackingService.verifyInstallation(research.id, 300);
                if (result.hasData) {
                    setVerifyResult('success');
                    try {
                        await trackingService.updateConfig(research.id, { ...config, verified: true });
                        queryClient.invalidateQueries({ queryKey: researchKeys.detail(research.id) });
                    } catch { /* best-effort */ }
                    return;
                }
                if (i < 4) await new Promise(r => setTimeout(r, 3000));
            }
            setVerifyResult('no_sessions');
        } catch {
            setVerifyResult('script_error');
        } finally {
            setVerifying(false);
        }
    }, [research.id, config, queryClient]);

    const isActive = research.status === 'active';

    const hasSnippet = !!snippet;
    const hasVerified = verifyResult === 'success' || existingConfig.verified === true;

    return (
        <div className="space-y-3">
            {/* Status bar: checklist + tracking status badge */}
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-2.5 flex items-center gap-5">
                <ChecklistItem done={isActive} label="Activate" />
                <ChecklistItem done={hasSnippet} label="Add snippet" />
                <ChecklistItem done={hasVerified} label="Verify" />
                {hasVerified ? (
                    <Link
                        to={`/research/${research.id}/builder/results`}
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                    >
                        <span>View results →</span>
                    </Link>
                ) : (
                    <span
                        className="flex items-center gap-1.5 text-xs text-slate-400 cursor-not-allowed"
                        title="Verify the installation first to view results"
                    >
                        View results →
                    </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                    {isActive ? (
                        <span className="flex items-center gap-1.5 text-[10px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                            <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" /></span>
                            Recording
                        </span>
                    ) : (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Draft</span>
                    )}
                </div>
            </div>

            {/* Main grid: 3 columns */}
            <div className="grid grid-cols-[minmax(0,480px)_200px_200px] gap-3">
                {/* Col 1: Tracking Script */}
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-slate-900">
                            Tracking Script
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleVerify}
                                disabled={verifying}
                                className="text-[10px] text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                            >
                                {verifying ? 'Listening...' : 'Verify'}
                            </button>
                            {hasVerified && <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Active</span>}
                            {verifyResult === 'no_sessions' && <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">No data</span>}
                            {verifyResult === 'script_error' && <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Error</span>}
                        </div>
                    </div>
                    <div className="relative">
                        <pre className="bg-slate-900 text-green-400 text-[10px] p-2.5 rounded-lg overflow-x-auto font-mono leading-snug whitespace-pre-wrap break-all">
                            {snippet || 'Loading...'}
                        </pre>
                        {snippet && (
                            <CopyButton
                                text={snippet}
                                className="absolute top-1.5 right-1.5 p-1 bg-slate-700 hover:bg-slate-600 text-slate-300"
                            />
                        )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5">Paste in your website&apos;s &lt;head&gt; tag</p>
                </div>

                {/* Col 2: Domains */}
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                        <Globe className="h-3 w-3 text-slate-400" />
                        <h3 className="text-xs font-semibold text-slate-900">Domains</h3>
                    </div>
                    <div className="flex gap-1 mb-1.5">
                        <input
                            type="text"
                            value={domainInput}
                            onChange={(e) => setDomainInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
                            placeholder="example.com"
                            className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                        <button
                            onClick={handleAddDomain}
                            disabled={!domainInput.trim()}
                            className="px-2 py-1 text-[10px] font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 shrink-0"
                        >
                            +
                        </button>
                    </div>
                    {config.allowedDomains.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                            {config.allowedDomains.map((domain) => (
                                <span key={domain} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full">
                                    {domain}
                                    <button onClick={() => handleRemoveDomain(domain)} className="text-slate-400 hover:text-red-500">&times;</button>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-slate-400">Empty = any domain</p>
                    )}
                </div>

                {/* Col 3: Capture toggles */}
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <h3 className="text-xs font-semibold text-slate-900 mb-2">Capture</h3>
                    <div className="space-y-1.5">
                        <CompactToggle label="Clicks" enabled={config.captureClicks} onToggle={() => handleToggle('captureClicks')} />
                        <CompactToggle label="Scroll" enabled={config.captureScroll} onToggle={() => handleToggle('captureScroll')} />
                        <CompactToggle label="Mouse" enabled={config.captureMousemove} onToggle={() => handleToggle('captureMousemove')} />
                        <CompactToggle label="Consent" enabled={config.consentRequired} onToggle={() => handleToggle('consentRequired')} />
                        <CompactToggle label="Emotions" enabled={config.captureEmotions} onToggle={() => handleToggle('captureEmotions')} />
                        {config.captureEmotions && (
                            <>
                                <p className="text-[10px] text-gray-400 ml-9">Webcam-based facial expression estimation. Requires camera permission from visitors. Best for aggregate trends across sessions.</p>
                                <CompactToggle label="Record Video" enabled={config.emotionVideoEnabled} onToggle={() => handleToggle('emotionVideoEnabled')} />
                            </>
                        )}
                        <CompactToggle label="Gaze Tracking" enabled={config.captureGaze} onToggle={() => handleToggle('captureGaze')} />
                        {config.captureGaze && (
                            <>
                                <p className="text-[10px] text-gray-400 ml-9">Eye gaze calibration via the front camera on mobile and desktop. Visitors complete a brief calibration before browsing. Generates gaze heatmaps without cursor data.</p>
                                <div className="flex items-center gap-2 ml-9">
                                    <span className="text-[10px] text-gray-500">Calibration points:</span>
                                    {([5, 9] as const).map(n => (
                                        <button
                                            key={n}
                                            onClick={() => setConfig(prev => ({ ...prev, gazeCalibrationPoints: n }))}
                                            className={`px-2 py-0.5 text-[10px] rounded ${config.gazeCalibrationPoints === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Consent customization — only when enabled, full width */}
            {config.consentRequired && (
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <h3 className="text-xs font-semibold text-slate-900 mb-2">Consent Banner</h3>
                    <div className="grid grid-cols-[minmax(0,320px)_80px_80px_auto] gap-3 items-end">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">Text</label>
                            <input
                                type="text"
                                value={config.consentText}
                                onChange={(e) => setConfig((prev) => ({ ...prev, consentText: e.target.value }))}
                                className="w-full px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">Accept</label>
                            <input
                                type="text"
                                value={config.consentAcceptLabel}
                                onChange={(e) => setConfig((prev) => ({ ...prev, consentAcceptLabel: e.target.value }))}
                                className="w-20 px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">Decline</label>
                            <input
                                type="text"
                                value={config.consentDeclineLabel}
                                onChange={(e) => setConfig((prev) => ({ ...prev, consentDeclineLabel: e.target.value }))}
                                className="w-20 px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div className="flex gap-1">
                            {(['bottom', 'top'] as const).map((pos) => (
                                <button
                                    key={pos}
                                    onClick={() => setConfig((prev) => ({ ...prev, consentPosition: pos }))}
                                    className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${
                                        config.consentPosition === pos
                                            ? 'bg-blue-50 border-blue-300 text-blue-700'
                                            : 'bg-white border-gray-200 text-slate-500'
                                    }`}
                                >
                                    {pos === 'bottom' ? '↓' : '↑'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Advanced: Sampling, IP exclusion, Page targeting, Retention */}
            <div className="grid grid-cols-4 gap-3">
                {/* Sampling */}
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <h3 className="text-xs font-semibold text-slate-900 mb-1">Sampling</h3>
                    <p className="text-[10px] text-slate-400 mb-2">% of visitors tracked</p>
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min={1}
                            max={100}
                            value={config.samplingRate}
                            onChange={(e) => setConfig((prev) => ({ ...prev, samplingRate: Number(e.target.value) }))}
                            className="flex-1 h-1 accent-blue-600"
                        />
                        <span className="text-xs font-mono text-slate-700 w-8 text-right">{config.samplingRate}%</span>
                    </div>
                </div>

                {/* Data Retention */}
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <h3 className="text-xs font-semibold text-slate-900 mb-1">Retention</h3>
                    <p className="text-[10px] text-slate-400 mb-2">Days to keep data</p>
                    <div className="flex gap-1">
                        {[30, 60, 90, 180].map((d) => (
                            <button
                                key={d}
                                onClick={() => setConfig((prev) => ({ ...prev, dataRetentionDays: d }))}
                                className={`flex-1 py-1 text-[10px] rounded-md border transition-colors ${
                                    config.dataRetentionDays === d
                                        ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                                        : 'bg-white border-gray-200 text-slate-500'
                                }`}
                            >
                                {d}d
                            </button>
                        ))}
                    </div>
                </div>

                {/* IP Exclusion */}
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <h3 className="text-xs font-semibold text-slate-900 mb-1">Exclude IPs</h3>
                    <div className="flex gap-1 mb-1">
                        <input
                            type="text"
                            placeholder="192.168.1.1"
                            className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const val = (e.target as HTMLInputElement).value.trim();
                                    if (val && !config.excludedIPs.includes(val)) {
                                        setConfig((prev) => ({ ...prev, excludedIPs: [...prev.excludedIPs, val] }));
                                        (e.target as HTMLInputElement).value = '';
                                    }
                                }
                            }}
                        />
                    </div>
                    {config.excludedIPs.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                            {config.excludedIPs.map((ip) => (
                                <span key={ip} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full">
                                    {ip}
                                    <button onClick={() => setConfig((prev) => ({ ...prev, excludedIPs: prev.excludedIPs.filter((i) => i !== ip) }))} className="text-slate-400 hover:text-red-500">&times;</button>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-slate-400">Press Enter to add</p>
                    )}
                </div>

                {/* Page Targeting */}
                <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <h3 className="text-xs font-semibold text-slate-900 mb-1">Page Targeting</h3>
                    <div className="space-y-1.5">
                        <div>
                            <label className="text-[10px] text-green-600">Include (empty = all)</label>
                            <input
                                type="text"
                                placeholder="/pricing"
                                className="w-full px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = (e.target as HTMLInputElement).value.trim();
                                        if (val && !config.targetPages.includes(val)) {
                                            setConfig((prev) => ({ ...prev, targetPages: [...prev.targetPages, val] }));
                                            (e.target as HTMLInputElement).value = '';
                                        }
                                    }
                                }}
                            />
                        </div>
                        {config.targetPages.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {config.targetPages.map((p) => (
                                    <span key={p} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-green-50 text-green-700 rounded-full">
                                        {p}
                                        <button onClick={() => setConfig((prev) => ({ ...prev, targetPages: prev.targetPages.filter((x) => x !== p) }))} className="text-green-400 hover:text-red-500">&times;</button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div>
                            <label className="text-[10px] text-red-500">Exclude</label>
                            <input
                                type="text"
                                placeholder="/admin"
                                className="w-full px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = (e.target as HTMLInputElement).value.trim();
                                        if (val && !config.excludePages.includes(val)) {
                                            setConfig((prev) => ({ ...prev, excludePages: [...prev.excludePages, val] }));
                                            (e.target as HTMLInputElement).value = '';
                                        }
                                    }
                                }}
                            />
                        </div>
                        {config.excludePages.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {config.excludePages.map((p) => (
                                    <span key={p} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-red-50 text-red-600 rounded-full">
                                        {p}
                                        <button onClick={() => setConfig((prev) => ({ ...prev, excludePages: prev.excludePages.filter((x) => x !== p) }))} className="text-red-400 hover:text-red-600">&times;</button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Auto-save indicator */}
            {saving && (
                <div className="flex items-center justify-end gap-2 text-xs text-gray-400">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Saving...
                </div>
            )}
        </div>
    );
};

// ─── Checklist Item Component ────────────────────────────────────────

const ChecklistItem = ({ done, label }: { done: boolean; label: string }) => (
    <div className="flex items-center gap-1.5">
        <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
            done ? 'bg-green-500 border-green-500' : 'border-gray-300'
        }`}>
            {done && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
        </div>
        <span className={`text-xs ${done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{label}</span>
    </div>
);

const CompactToggle = ({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) => (
    <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-700">{label}</span>
        <button
            onClick={onToggle}
            className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                enabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
        >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
        </button>
    </div>
);
