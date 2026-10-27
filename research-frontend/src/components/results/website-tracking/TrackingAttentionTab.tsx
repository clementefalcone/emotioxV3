/**
 * TrackingAttentionTab
 * Displays webcam-based gaze attention analytics for Website Tracking sessions.
 * Layout: attention score + quadrant grid + attention timeline + session list.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import * as trackingService from '../../../services/tracking.service';
import type { TrackingGazeData } from '../../../services/tracking.service';
import { TrackingZonesPanel } from './TrackingZonesPanel';
import { TrackingCaptureEmptyState } from './TrackingCaptureEmptyState';

type GazeQuadrant =
    | 'top-left' | 'top-center' | 'top-right'
    | 'center-left' | 'center' | 'center-right'
    | 'bottom-left' | 'bottom-center' | 'bottom-right';

const QUADRANT_LABELS: Record<GazeQuadrant, string> = {
    'top-left': 'TL', 'top-center': 'TC', 'top-right': 'TR',
    'center-left': 'CL', 'center': 'C', 'center-right': 'CR',
    'bottom-left': 'BL', 'bottom-center': 'BC', 'bottom-right': 'BR',
};

const QUADRANT_GRID: GazeQuadrant[][] = [
    ['top-left', 'top-center', 'top-right'],
    ['center-left', 'center', 'center-right'],
    ['bottom-left', 'bottom-center', 'bottom-right'],
];

const ATTENTION_COLORS = {
    engaged: '#22c55e',
    distracted: '#f59e0b',
    away: '#ef4444',
};

interface TrackingAttentionTabProps {
    researchId: string;
    selectedPageUrl?: string;
}

export const TrackingAttentionTab = ({ researchId, selectedPageUrl }: TrackingAttentionTabProps) => {
    const { data: pageData, isLoading: pageLoading } = useQuery({
        queryKey: ['tracking', researchId, 'gaze', selectedPageUrl],
        queryFn: () => trackingService.getTrackingGaze(researchId, selectedPageUrl),
    });

    const pageHasData = (pageData?.totalSamples ?? 0) > 0;
    const { data: allData, isLoading: allLoading } = useQuery({
        queryKey: ['tracking', researchId, 'gaze', '__all__'],
        queryFn: () => trackingService.getTrackingGaze(researchId, undefined),
        enabled: !pageLoading && !pageHasData,
    });

    const data = pageHasData ? pageData : allData;
    const isLoading = pageLoading || (!pageHasData && allLoading);

    if (isLoading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
                        <div className="h-32 bg-gray-100 rounded" />
                    </div>
                ))}
            </div>
        );
    }

    if (!data || data.totalSamples === 0) {
        return (
            <TrackingCaptureEmptyState
                researchId={researchId}
                icon={Eye}
                title="No attention data collected yet"
                captureSetting="captureGaze"
                toggleLabel="Gaze Tracking"
            />
        );
    }

    return (
        <div className="space-y-3">
            {/* Summary cards */}
            <div className="flex gap-3">
                <SummaryCard label="Sessions" value={data.totalSessions} />
                <SummaryCard label="Samples" value={data.totalSamples.toLocaleString()} />
                <SummaryCard
                    label="Attention"
                    value={`${Math.round(data.avgAttentionScore * 100)}%`}
                    color={data.avgAttentionScore > 0.7 ? '#22c55e' : data.avgAttentionScore > 0.4 ? '#f59e0b' : '#ef4444'}
                />
                <SummaryCard label="Focus Zone" value={QUADRANT_LABELS[data.dominantQuadrant]} />
            </div>

            <TrackingZonesPanel researchId={researchId} />

            {/* Main panels */}
            <div className="flex gap-3">
                {/* Quadrant heatmap grid */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 flex-1">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Gaze Zone Distribution</h3>
                    <p className="text-[10px] text-gray-300 mb-3">Probabilistic area estimation — each sample spreads across zones based on iris uncertainty. Not exact gaze.</p>
                    <div className="flex flex-col gap-1 max-w-[240px] mx-auto">
                        {QUADRANT_GRID.map((row, ri) => (
                            <div key={ri} className="flex gap-1">
                                {row.map((q) => {
                                    const pct = data.quadrantDistribution[q] || 0;
                                    const maxPct = Math.max(...Object.values(data.quadrantDistribution), 1);
                                    const intensity = pct / maxPct;
                                    const bg = `rgba(37, 99, 235, ${0.05 + intensity * 0.55})`;
                                    return (
                                        <div
                                            key={q}
                                            className="flex-1 aspect-square flex flex-col items-center justify-center rounded-lg border border-gray-100 text-xs"
                                            style={{ backgroundColor: bg }}
                                        >
                                            <span className="font-semibold" style={{ color: intensity > 0.5 ? '#fff' : '#374151' }}>
                                                {pct > 0 ? `${pct}%` : '–'}
                                            </span>
                                            <span className="text-[9px]" style={{ color: intensity > 0.5 ? 'rgba(255,255,255,0.7)' : '#9ca3af' }}>
                                                {QUADRANT_LABELS[q]}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Attention state distribution */}
                <div className="bg-white rounded-xl border border-gray-200 p-4" style={{ width: 280 }}>
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Attention State</h3>
                    <div className="space-y-3">
                        {(['engaged', 'distracted', 'away'] as const).map(state => (
                            <div key={state} className="flex items-center gap-2">
                                <span className="text-xs text-gray-600 w-20 text-right capitalize">{state}</span>
                                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                                    <div
                                        className="h-full rounded transition-all"
                                        style={{
                                            width: `${data.attentionDistribution[state]}%`,
                                            backgroundColor: ATTENTION_COLORS[state],
                                        }}
                                    />
                                </div>
                                <span className="text-[11px] text-gray-400 w-10 text-right">
                                    {data.attentionDistribution[state]}%
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-100">
                        <p className="text-[10px] text-gray-400">
                            <strong>Engaged:</strong> looking at screen, gaze near cursor<br />
                            <strong>Distracted:</strong> head turned &gt;30°<br />
                            <strong>Away:</strong> no face detected
                        </p>
                    </div>
                </div>
            </div>

            {/* Timeline */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Attention Score Timeline</h3>
                <AttentionTimelineCanvas data={data} />
            </div>

            {/* Session list */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    Sessions with Attention Data ({data.perSession.length})
                </h3>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                    {data.perSession.map(s => (
                        <div key={s.sessionId} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-xs">
                            <div
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: s.avgScore > 0.7 ? '#22c55e' : s.avgScore > 0.4 ? '#f59e0b' : '#ef4444' }}
                            />
                            <span className="text-gray-700 font-medium truncate flex-1">{s.pageUrl}</span>
                            <span className="text-gray-400">{QUADRANT_LABELS[s.dominantQuadrant]}</span>
                            <span className="text-gray-400">{Math.round(s.avgScore * 100)}%</span>
                            <span className="text-gray-300">{s.sampleCount} samples</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const SummaryCard = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
    <div className="bg-white rounded-xl border border-gray-200 p-3 flex-1">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-lg font-semibold mt-0.5" style={color ? { color } : undefined}>{value}</p>
    </div>
);

const AttentionTimelineCanvas = ({ data }: { data: TrackingGazeData }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width, h = canvas.height;
        const pad = { top: 15, bottom: 20, left: 35, right: 10 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        ctx.clearRect(0, 0, w, h);

        const tl = data.timeline;
        if (tl.length < 2) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Not enough data for timeline', w / 2, h / 2);
            return;
        }

        // Zero line at 50%
        const halfY = pad.top + plotH / 2;
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, halfY); ctx.lineTo(w - pad.right, halfY); ctx.stroke();

        // Y labels
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('100%', pad.left - 4, pad.top + 4);
        ctx.fillText('50%', pad.left - 4, halfY + 4);
        ctx.fillText('0%', pad.left - 4, pad.top + plotH + 4);

        const n = tl.length;
        const xStep = plotW / Math.max(n - 1, 1);

        // Attention score area fill
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top + plotH);
        tl.forEach((d, i) => {
            const x = pad.left + i * xStep;
            const y = pad.top + plotH - d.score * plotH;
            ctx.lineTo(x, y);
        });
        ctx.lineTo(pad.left + (n - 1) * xStep, pad.top + plotH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
        ctx.fill();

        // Score line
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        tl.forEach((d, i) => {
            const x = pad.left + i * xStep;
            const y = pad.top + plotH - d.score * plotH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Attention state color dots
        tl.forEach((d, i) => {
            const x = pad.left + i * xStep;
            ctx.fillStyle = ATTENTION_COLORS[d.attention] || '#94a3b8';
            ctx.beginPath();
            ctx.arc(x, pad.top + plotH + 8, 2.5, 0, Math.PI * 2);
            ctx.fill();
        });
    }, [data]);

    useEffect(() => { draw(); }, [draw]);

    return <canvas ref={canvasRef} width={1200} height={200} className="w-full" style={{ height: 160 }} />;
};
