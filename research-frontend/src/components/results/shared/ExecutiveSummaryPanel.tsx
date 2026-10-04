import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, RefreshCw, ChevronDown, Download } from 'lucide-react';
import apiClient from '../../../services/api/client';

interface ExecutiveSummary {
    generatedAt: string;
    overview: string;
    keyFindings: string[];
    recommendations: string[];
    metrics: {
        participantCount: number;
        responseCount: number;
        nps?: number;
        csat?: number;
        ces?: number;
    };
    sentiment?: {
        positive: number;
        negative: number;
        neutral: number;
    };
}

export const ExecutiveSummaryPanel = ({ researchId, filteredParticipantIds }: { researchId: string; filteredParticipantIds?: string[] }) => {
    const [expanded, setExpanded] = useState(false);
    const queryClient = useQueryClient();

    const { data: summary, isLoading } = useQuery({
        queryKey: ['executive-summary', researchId],
        queryFn: async () => {
            const res = await apiClient.get<{ summary: ExecutiveSummary | null }>(
                `/analytics/research/${researchId}/executive-summary`
            );
            return res.summary;
        },
        staleTime: 60_000,
    });

    const generate = useMutation({
        mutationFn: async () => {
            const body: Record<string, unknown> = {};
            if (filteredParticipantIds && filteredParticipantIds.length > 0) {
                body.participantIds = filteredParticipantIds;
            }
            const res = await apiClient.post<{ summary: ExecutiveSummary }>(
                `/analytics/research/${researchId}/executive-summary`,
                body
            );
            return res.summary;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['executive-summary', researchId] });
        },
    });

    const handleDownloadPdf = useCallback(() => {
        if (!summary) return;

        const sentimentTotal = (summary.sentiment?.positive ?? 0) + (summary.sentiment?.negative ?? 0) + (summary.sentiment?.neutral ?? 0);
        const sentimentHtml = sentimentTotal > 0 ? `
            <h3 style="font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 10px">Sentiment Distribution</h3>
            <div style="display:flex;gap:24px">
                ${(['Positive', 'Neutral', 'Negative'] as const).map(label => {
                    const val = label === 'Positive' ? summary.sentiment!.positive : label === 'Neutral' ? summary.sentiment!.neutral : summary.sentiment!.negative;
                    const pct = Math.round((val / sentimentTotal) * 100);
                    const color = label === 'Positive' ? '#22c55e' : label === 'Negative' ? '#ef4444' : '#9ca3af';
                    return `<div style="flex:1"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;color:#4b5563">${label}</span><span style="font-size:12px;font-weight:600;color:#111827">${pct}%</span></div><div style="height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div></div></div>`;
                }).join('')}
            </div>` : '';

        const html = `
            <div style="font-family:'Plus Jakarta Sans',Inter,system-ui,sans-serif;max-width:700px;margin:0 auto;padding:40px 32px;color:#1e293b">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
                    <div style="width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:8px;display:flex;align-items:center;justify-content:center">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
                    </div>
                    <div>
                        <h1 style="font-size:20px;font-weight:700;margin:0">Executive Summary</h1>
                        <p style="font-size:12px;color:#9ca3af;margin:2px 0 0">${new Date(summary.generatedAt).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                    </div>
                </div>

                <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px">
                    <p style="font-size:14px;line-height:1.7;color:#475569;margin:0">${summary.overview}</p>
                </div>

                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
                    ${[
                        { label: 'Participants', value: summary.metrics.participantCount },
                        { label: 'Responses', value: summary.metrics.responseCount },
                        ...(summary.metrics.nps !== undefined ? [{ label: 'NPS', value: summary.metrics.nps }] : []),
                        ...(summary.metrics.csat !== undefined ? [{ label: 'CSAT', value: summary.metrics.csat }] : []),
                        ...(summary.metrics.ces !== undefined ? [{ label: 'CES', value: summary.metrics.ces }] : []),
                    ].map(m => `<div style="background:#f9fafb;border-radius:8px;padding:10px 16px"><p style="font-size:20px;font-weight:700;color:#111827;margin:0">${m.value}</p><p style="font-size:11px;color:#6b7280;margin:2px 0 0">${m.label}</p></div>`).join('')}
                </div>

                ${summary.keyFindings.length > 0 ? `
                    <h3 style="font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px">Key Findings</h3>
                    <ol style="padding-left:0;list-style:none;margin:0 0 24px">
                        ${summary.keyFindings.map((f, i) => `<li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px"><span style="width:22px;height:22px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i + 1}</span><span style="font-size:13px;color:#4b5563;line-height:1.6">${f}</span></li>`).join('')}
                    </ol>
                ` : ''}

                ${summary.recommendations.length > 0 ? `
                    <h3 style="font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px">Recommendations</h3>
                    <ul style="padding-left:0;list-style:none;margin:0 0 24px">
                        ${summary.recommendations.map(r => `<li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0;margin-top:7px"></span><span style="font-size:13px;color:#4b5563;line-height:1.6">${r}</span></li>`).join('')}
                    </ul>
                ` : ''}

                ${sentimentHtml}

                <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center">
                    <p style="font-size:10px;color:#9ca3af">Generated by EmotioX · ${new Date(summary.generatedAt).toLocaleString('es')}</p>
                </div>
            </div>`;

        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Executive Summary</title><style>*{margin:0;padding:0;box-sizing:border-box}@media print{@page{margin:1.5cm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${html}</body></html>`;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(fullHtml);
        win.document.close();
        setTimeout(() => { win.print(); }, 500);
    }, [summary]);

    if (isLoading) {
        return (
            <div className="bg-white border border-gray-100 rounded-lg p-4 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-48 mb-3" />
                <div className="h-4 bg-gray-200 rounded w-full mb-2" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
            </div>
        );
    }

    if (!summary) {
        return (
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Sparkles className="h-5 w-5 text-blue-500" />
                    <div>
                        <p className="text-sm font-medium text-gray-900">Executive Summary</p>
                        <p className="text-xs text-gray-500">Generate an AI-powered summary of this research</p>
                    </div>
                </div>
                <button
                    onClick={() => generate.mutate()}
                    disabled={generate.isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {generate.isPending ? (
                        <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Generating...
                        </>
                    ) : (
                        <>
                            <Sparkles className="h-4 w-4" />
                            Generate Summary
                        </>
                    )}
                </button>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
            {/* Header */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(!expanded)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer select-none"
            >
                <div className="flex items-center gap-3">
                    <Sparkles className="h-5 w-5 text-blue-500" />
                    <span className="text-sm font-medium text-gray-900">Executive Summary</span>
                    <span className="text-xs text-gray-400">
                        {new Date(summary.generatedAt).toLocaleDateString()}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadPdf(); }}
                        className="p-1.5 text-gray-400 hover:text-green-600 rounded hover:bg-green-50"
                        title="Download PDF"
                    >
                        <Download className="h-4 w-4" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); generate.mutate(); }}
                        disabled={generate.isPending}
                        className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50"
                        title="Regenerate"
                    >
                        <RefreshCw className={`h-4 w-4 ${generate.isPending ? 'animate-spin' : ''}`} />
                    </button>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
                </div>
            </div>

            {/* Overview (always visible) */}
            <div className="px-4 pb-3">
                <p className="text-sm text-gray-600 leading-relaxed">{summary.overview}</p>
            </div>

            {/* Expanded content — smooth collapse */}
            <CollapsibleContent expanded={expanded}>
                <div className="px-4 pb-4 space-y-4 border-t border-gray-50 pt-4">
                    {/* Metrics row */}
                    <div className="flex gap-4 flex-wrap">
                        <MetricBadge label="Participants" value={summary.metrics.participantCount} />
                        <MetricBadge label="Responses" value={summary.metrics.responseCount} />
                        {summary.metrics.nps !== undefined && <MetricBadge label="NPS" value={summary.metrics.nps} />}
                        {summary.metrics.csat !== undefined && <MetricBadge label="CSAT" value={summary.metrics.csat} />}
                        {summary.metrics.ces !== undefined && <MetricBadge label="CES" value={summary.metrics.ces} />}
                    </div>

                    {/* Key Findings */}
                    {summary.keyFindings.length > 0 && (
                        <div>
                            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Key Findings</h4>
                            <ul className="space-y-1.5">
                                {summary.keyFindings.map((finding, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                                            {i + 1}
                                        </span>
                                        <span className="text-sm text-gray-600">{finding}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Recommendations */}
                    {summary.recommendations.length > 0 && (
                        <div>
                            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Recommendations</h4>
                            <ul className="space-y-1.5">
                                {summary.recommendations.map((rec, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 mt-2" />
                                        <span className="text-sm text-gray-600">{rec}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Sentiment */}
                    {summary.sentiment && (summary.sentiment.positive + summary.sentiment.negative + summary.sentiment.neutral > 0) && (
                        <div>
                            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Sentiment Distribution</h4>
                            <div className="flex gap-4">
                                <SentimentBar label="Positive" value={summary.sentiment.positive} color="bg-green-500" total={summary.sentiment.positive + summary.sentiment.negative + summary.sentiment.neutral} />
                                <SentimentBar label="Neutral" value={summary.sentiment.neutral} color="bg-gray-400" total={summary.sentiment.positive + summary.sentiment.negative + summary.sentiment.neutral} />
                                <SentimentBar label="Negative" value={summary.sentiment.negative} color="bg-red-500" total={summary.sentiment.positive + summary.sentiment.negative + summary.sentiment.neutral} />
                            </div>
                        </div>
                    )}
                </div>
            </CollapsibleContent>
        </div>
    );
};

const CollapsibleContent = ({ expanded, children }: { expanded: boolean; children: React.ReactNode }) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        if (contentRef.current) {
            setHeight(contentRef.current.scrollHeight);
        }
    }, [expanded, children]);

    return (
        <div
            className="overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
            style={{
                maxHeight: expanded ? height : 0,
                opacity: expanded ? 1 : 0,
            }}
        >
            <div ref={contentRef}>
                {children}
            </div>
        </div>
    );
};

const MetricBadge = ({ label, value }: { label: string; value: number }) => (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
        <p className="text-lg font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
    </div>
);

const SentimentBar = ({ label, value, color, total }: { label: string; value: number; color: string; total: number }) => {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600">{label}</span>
                <span className="text-xs font-medium text-gray-900">{pct}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};
