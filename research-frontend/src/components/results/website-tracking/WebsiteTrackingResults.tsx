/**
 * Website Tracking Results
 * Tabbed view: Click Heatmap, Scroll Depth, Session Replay, Funnels.
 * Overview metrics + export + page selector.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
    MousePointerClick, Users, Activity, AlertTriangle,
    Download, ArrowDownUp, PlayCircle, TrendingDown, Eye, Grid3X3, SmilePlus, Scan,
} from 'lucide-react';
import * as trackingService from '../../../services/tracking.service';
import { EmptyState } from '../../ui/EmptyState';
import { CustomSelect } from '../../ui/CustomSelect';
import { MultiLayerHeatmap } from './MultiLayerHeatmap';
import { WebTrackingReportButton } from './WebTrackingReportButton';
import { SessionReplayPlayer } from './SessionReplayPlayer';
import { FunnelChart } from './FunnelChart';
import { PageFlowDiagram } from './PageFlowDiagram';
import { resolveMediaUrl } from '../../../services/media.service';
import { TrackingEmotionsTab } from './TrackingEmotionsTab';
import { TrackingAttentionTab } from './TrackingAttentionTab';
import { TrackingFrictionTab } from './TrackingFrictionTab';
import { CaptureErrorBadges } from './CaptureErrorBadges';

const formatDateTime = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' })
        + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
};

type ResultTab = 'funnels' | 'heatmaps' | 'sessions' | 'friction' | 'live' | 'emotions' |'attention';
type HeatmapSubTab = 'click' | 'scroll' | 'attention' | 'density' | 'mouseAttention';
type FunnelSubTab = 'custom-funnels' | 'page-flow' | 'comparison';

interface WebsiteTrackingResultsProps {
    researchId: string;
}

export const WebsiteTrackingResults = ({ researchId }: WebsiteTrackingResultsProps) => {
    const [activeTab, setActiveTab] = useState<ResultTab>('funnels');
    const [heatmapLayers, setHeatmapLayers] = useState<Record<HeatmapSubTab, boolean>>({ click: true, scroll: true, attention: true, density: false, mouseAttention: false });
    const [heatmapIntensity, setHeatmapIntensity] = useState(50);
    const [heatmapOpacity, setHeatmapOpacity] = useState(45);
    const [funnelSubTab, setFunnelSubTab] = useState<FunnelSubTab>('custom-funnels');
    const [selectedPageUrl, setSelectedPageUrl] = useState<string | undefined>();
    const [deviceFilter, setDeviceFilter] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [exporting, setExporting] = useState(false);
    const [replaySessionId, setReplaySessionId] = useState<string | null>(null);

    // Live sessions — real-time via React Query (5s refresh)
    const { data: liveData } = useQuery({
        queryKey: ['tracking', researchId, 'live'],
        queryFn: () => trackingService.getLiveSessions(researchId),
        refetchInterval: 5000,
    });
    const liveCount = liveData?.sessions?.length || 0;

    const handleExport = useCallback(async () => {
        setExporting(true);
        try {
            const data = await trackingService.getExportData(researchId);
            // Sessions CSV
            const sessionsCsv = toCsv(data.sessions, [
                'id', 'visitor_id', 'page_url', 'page_title', 'viewport_width', 'viewport_height',
                'user_agent', 'referrer', 'started_at', 'ended_at',
            ]);
            downloadCsv(sessionsCsv, `tracking-sessions-${researchId}.csv`);
            // Events CSV
            const eventsCsv = toCsv(data.events, [
                'session_id', 'event_type', 'x', 'y', 'scroll_y', 'scroll_depth_pct',
                'target_selector', 'target_text', 'timestamp_ms',
            ]);
            downloadCsv(eventsCsv, `tracking-events-${researchId}.csv`);
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            setExporting(false);
        }
    }, [researchId]);

    // Fetch overview metrics
    const { data: overview, isLoading: loadingOverview } = useQuery({
        queryKey: ['tracking', researchId, 'overview', dateFrom, dateTo],
        queryFn: () => trackingService.getOverview(researchId, dateFrom || undefined, dateTo || undefined),
        staleTime: 10_000,
    });

    // Fetch tracked pages
    const { data: pages, isLoading: loadingPages } = useQuery({
        queryKey: ['tracking', researchId, 'pages'],
        queryFn: () => trackingService.getTrackedPages(researchId),
        staleTime: 10_000,
    });


    // Auto-select first page
    useEffect(() => {
        if (pages && pages.length > 0 && !selectedPageUrl) {
            setSelectedPageUrl(pages[0].pageUrl);
        }
    }, [pages, selectedPageUrl]);

    const selectedPage = useMemo(
        () => pages?.find((p) => p.pageUrl === selectedPageUrl),
        [pages, selectedPageUrl]
    );

    const selectedScreenshotUrl = useMemo(() => {
        if (!selectedPage) return null;
        const devices = selectedPage.screenshotDevices;
        const activeDevice = deviceFilter;
        // Try device-specific screenshot, fallback to desktop, then legacy s3key
        const key = devices?.[activeDevice] || devices?.desktop || selectedPage.screenshotS3Key;
        return key ? resolveMediaUrl(`/api/media/${key}`) : null;
    }, [selectedPage, deviceFilter]);


    const isLoading = loadingOverview || loadingPages;

    if (isLoading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="grid grid-cols-5 gap-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-24 bg-gray-200 rounded-xl" />
                    ))}
                </div>
                <div className="h-96 bg-gray-200 rounded-xl" />
            </div>
        );
    }

    if (!overview || overview.totalSessions === 0) {
        return (
            <EmptyState
                icon={<MousePointerClick className="h-12 w-12" />}
                title="No tracking data yet"
                description="Install the tracking script on your website and wait for visitors to start interacting."
                className="py-20"
            />
        );
    }

    const tabs: Array<{ id: ResultTab; label: string; icon: React.ReactNode; tooltip: string }> = [
        { id: 'funnels', label: 'Funnels', icon: <TrendingDown className="h-4 w-4" />, tooltip: 'Conversion funnels and page flow analysis' },
        { id: 'heatmaps', label: 'Heatmaps', icon: <MousePointerClick className="h-4 w-4" />, tooltip: 'Click, scroll, and attention overlays on your pages' },
        { id: 'sessions', label: 'Sessions', icon: <Users className="h-4 w-4" />, tooltip: 'Visitor journeys with session replay' },
        { id: 'friction', label: 'Friction', icon: <AlertTriangle className="h-4 w-4" />, tooltip: 'Rage clicks, dead clicks, speed browsing, and mouse-out events' },
        { id: 'live', label: 'Live', icon: <Activity className="h-4 w-4" />, tooltip: 'Currently active visitors on your site' },
        { id: 'emotions', label: 'Emotions', icon: <SmilePlus className="h-4 w-4" />, tooltip: 'Visitor facial emotion analysis' },
        { id: 'attention', label: 'Attention', icon: <Eye className="h-4 w-4" />, tooltip: 'Webcam-based gaze zone attention tracking' },
    ];

    return (
        <div className="space-y-4">
            {/* Toolbar: Tabs + inline stats + date + export */}
            <div className="flex items-center gap-2 border-b border-gray-200 pb-px">
                {/* Tabs */}
                <nav className="flex gap-1">
                    {tabs.map((tab) => (
                        <Tip key={tab.id} tip={tab.tooltip}>
                            <button
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
                                    activeTab === tab.id
                                        ? 'border-blue-600 text-blue-600 font-medium'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                {tab.icon}
                                {tab.label}
                                {tab.id === 'live' && liveCount > 0 && (
                                    <span className="relative flex h-2 w-2 ml-0.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                                    </span>
                                )}
                            </button>
                        </Tip>
                    ))}
                </nav>

                <div className="h-4 w-px bg-gray-200 mx-1" />

                {/* Inline stats */}
                <div className="flex items-center gap-3 text-[11px] text-gray-500">
                    <span><strong className="text-slate-800">{overview.uniqueVisitors}</strong> visitors</span>
                    <span><strong className="text-slate-800">{overview.totalSessions}</strong> sessions</span>
                    <span><strong className="text-slate-800">{overview.pagesTracked}</strong> pages</span>
                    <span><strong className="text-slate-800">{formatDuration(overview.avgSessionDuration)}</strong> avg</span>
                </div>

                {/* Right side: date filter + export */}
                <div className="ml-auto flex items-center gap-2">
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2 py-1 text-[11px] border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                    <span className="text-[10px] text-gray-400">—</span>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2 py-1 text-[11px] border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                    {(dateFrom || dateTo) && (
                        <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] text-blue-600 hover:text-blue-800">
                            Clear
                        </button>
                    )}
                    <button
                        onClick={handleExport}
                        disabled={exporting}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
                    >
                        <Download className="h-3.5 w-3.5" />
                        {exporting ? '...' : 'CSV'}
                    </button>
                    <WebTrackingReportButton researchId={researchId} />
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'heatmaps' && (
                <div className="space-y-3">
                    {/* Toolbar: page selector + layer toggles + controls */}
                    <div className="space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-72 flex-shrink-0">
                            <CustomSelect
                                label="Page"
                                labelPosition="inline"
                                value={selectedPageUrl || ''}
                                onChange={(val) => setSelectedPageUrl(val)}
                                options={(pages || []).map((page) => ({
                                    value: page.pageUrl,
                                    label: `${page.pageTitle || shortenUrl(page.pageUrl)} — ${page.sessionCount} views`,
                                }))}
                                placeholder="Select a page"
                            />
                        </div>

                        {/* Layer toggles */}
                        <div className="flex items-center gap-1">
                            {([
                                { id: 'click' as const, label: 'Click', icon: <MousePointerClick className="h-3.5 w-3.5" />, color: 'red', tip: 'Where users click on the page' },
                                { id: 'scroll' as const, label: 'Scroll', icon: <ArrowDownUp className="h-3.5 w-3.5" />, color: 'green', tip: 'How far down users scroll' },
                                { id: 'attention' as const, label: 'Attention', icon: <Eye className="h-3.5 w-3.5" />, color: 'blue', tip: 'Time spent viewing each zone' },
                                { id: 'density' as const, label: 'Density', icon: <Grid3X3 className="h-3.5 w-3.5" />, color: 'purple', tip: 'Click concentration areas' },
                                { id: 'mouseAttention' as const, label: 'Gaze Focus', icon: <Scan className="h-3.5 w-3.5" />, color: 'orange', tip: 'Cursor position weighted by gaze attention — shows where users look based on mouse + eye correlation' },
                            ]).map((layer) => (
                                <Tip key={layer.id} tip={layer.tip}>
                                    <button
                                        onClick={() => setHeatmapLayers(prev => ({ ...prev, [layer.id]: !prev[layer.id] }))}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                            heatmapLayers[layer.id]
                                                ? layer.color === 'red'
                                                    ? 'bg-red-50 border-red-200 text-red-700'
                                                    : layer.color === 'green'
                                                        ? 'bg-green-50 border-green-200 text-green-700'
                                                        : layer.color === 'purple'
                                                            ? 'bg-purple-50 border-purple-200 text-purple-700'
                                                            : layer.color === 'orange'
                                                                ? 'bg-orange-50 border-orange-200 text-orange-700'
                                                                : 'bg-blue-50 border-blue-200 text-blue-700'
                                                : 'bg-white border-gray-200 text-gray-400'
                                        }`}
                                    >
                                        {layer.icon}
                                        {layer.label}
                                    </button>
                                </Tip>
                            ))}
                        </div>
                    </div>

                    {/* Row 2: Intensity, Opacity, Device filter */}
                    <div className="flex items-center gap-4">
                        <Tip tip="Heatmap point radius — higher values spread heat wider">
                            <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-default">
                                Intensity
                                <input type="range" min={10} max={100} value={heatmapIntensity} onChange={(e) => setHeatmapIntensity(Number(e.target.value))} className="w-24 h-1 accent-blue-600" />
                                <span className="text-[10px] text-slate-400 w-6 text-right">{heatmapIntensity}</span>
                            </label>
                        </Tip>
                        <Tip tip="Dark overlay transparency behind the heatmap">
                            <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-default">
                                Opacity
                                <input type="range" min={0} max={80} value={heatmapOpacity} onChange={(e) => setHeatmapOpacity(Number(e.target.value))} className="w-24 h-1 accent-blue-600" />
                                <span className="text-[10px] text-slate-400 w-6 text-right">{heatmapOpacity}</span>
                            </label>
                        </Tip>

                        {/* Device filter */}
                        <div className="flex gap-1 ml-auto">
                            {(['desktop', 'tablet', 'mobile'] as const).map((d) => {
                                const hasData = !!selectedPage?.screenshotDevices?.[d];
                                const tipText = hasData
                                    ? `View ${d} heatmap`
                                    : `No ${d} screenshot captured yet`;
                                return (
                                    <Tip key={d} tip={tipText}>
                                        <button
                                            onClick={() => hasData && setDeviceFilter(d)}
                                            disabled={!hasData}
                                            className={`px-2 py-1 text-[10px] rounded transition-colors ${
                                                deviceFilter === d
                                                    ? 'bg-blue-100 text-blue-700 font-medium'
                                                    : hasData
                                                        ? 'text-slate-500 hover:bg-slate-100'
                                                        : 'text-slate-300 cursor-not-allowed'
                                            }`}
                                        >
                                            {d.charAt(0).toUpperCase() + d.slice(1)}
                                        </button>
                                    </Tip>
                                );
                            })}
                        </div>
                    </div>
                    </div>

                    {/* Heatmap inline */}
                    {selectedPageUrl ? (
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 220px)' }}>
                            <div className="h-full overflow-auto p-4">
                                <MultiLayerHeatmap
                                    researchId={researchId}
                                    pageUrl={selectedPageUrl}
                                    device={deviceFilter}
                                    screenshotUrl={selectedScreenshotUrl}
                                    hasSnapshot={selectedPage?.hasSnapshot}
                                    layers={heatmapLayers}
                                    intensity={heatmapIntensity}
                                    opacity={heatmapOpacity}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center" style={{ height: 'calc(100vh - 220px)' }}>
                            <p className="text-sm text-gray-400">Select a page to view its heatmap</p>
                        </div>
                    )}
                </div>
            )}


            {activeTab === 'sessions' && (
                <VisitorJourneysTab researchId={researchId} onReplay={setReplaySessionId} />
            )}

            {activeTab === 'live' && (
                <LiveSessionsTab sessions={liveData?.sessions || []} onReplay={setReplaySessionId} />
            )}

            {activeTab === 'emotions' && (
                <TrackingEmotionsTab researchId={researchId} selectedPageUrl={selectedPageUrl} />
            )}

            {activeTab === 'attention' && (
                <TrackingAttentionTab researchId={researchId} selectedPageUrl={selectedPageUrl} />
            )}

            {activeTab === 'friction' && (
                <TrackingFrictionTab researchId={researchId} />
            )}

            {activeTab === 'funnels' && (
                <div className="space-y-4">
                    {/* Funnel sub-tabs: Custom Funnels | Page Flow */}
                    <div className="flex gap-1 border-b border-gray-200 pb-px">
                        {([
                            { id: 'custom-funnels' as const, label: 'Custom Funnels', tip: 'Define step-by-step conversion paths and measure drop-off' },
                            { id: 'page-flow' as const, label: 'Page Flow', tip: 'Page visits and navigation transitions side by side' },
                            { id: 'comparison' as const, label: 'Comparison', tip: 'Compare all funnels side by side — which converts best?' },
                        ]).map((sub) => (
                            <Tip key={sub.id} tip={sub.tip}>
                                <button
                                    onClick={() => setFunnelSubTab(sub.id as FunnelSubTab)}
                                    className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                                        funnelSubTab === sub.id
                                            ? 'border-blue-600 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    {sub.label}
                                </button>
                            </Tip>
                        ))}
                    </div>

                    {funnelSubTab === 'custom-funnels' && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5" style={{ height: 'calc(100vh - 280px)' }}>
                            <FunnelChart researchId={researchId} view="custom-funnels" />
                        </div>
                    )}

                    {funnelSubTab === 'comparison' && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5" style={{ minHeight: 'calc(100vh - 280px)' }}>
                            <FunnelChart researchId={researchId} view="comparison" />
                        </div>
                    )}

                    {funnelSubTab === 'page-flow' && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col" style={{ height: 'calc(100vh - 240px)' }}>
                            <div className="shrink-0 mb-3">
                                <h3 className="text-sm font-semibold text-slate-800 mb-1">Page Flow</h3>
                                <p className="text-xs text-gray-400">Visual map of navigation between pages. Nodes = page visits. Arrows = transitions between pages (count).</p>
                            </div>
                            <div className="flex-1 min-h-0 overflow-auto rounded-lg">
                                <PageFlowDiagram researchId={researchId} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Session Replay Modal */}
            {replaySessionId && (
                <SessionReplayPlayer
                    researchId={researchId}
                    sessionId={replaySessionId}
                    onClose={() => setReplaySessionId(null)}
                />
            )}
        </div>
    );
};

// ─── Helper Components ───────────────────────────────────────────────

/** Portal-based tooltip that never clips. Wraps any children. */
const Tip = ({ tip, children }: { tip: string; children: React.ReactNode }) => {
    const ref = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState(false);
    const [style, setStyle] = useState<React.CSSProperties>({});

    useEffect(() => {
        if (hover && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            const top = rect.bottom + 8;
            let left = rect.left + rect.width / 2;

            // After initial render, measure tooltip and clamp
            requestAnimationFrame(() => {
                if (tooltipRef.current) {
                    const tw = tooltipRef.current.offsetWidth;
                    const vw = window.innerWidth;
                    // Clamp: don't overflow left or right edge (8px margin)
                    const minLeft = tw / 2 + 8;
                    const maxLeft = vw - tw / 2 - 8;
                    left = Math.max(minLeft, Math.min(maxLeft, left));
                    setStyle({ top, left, transform: 'translateX(-50%)' });
                }
            });

            setStyle({ top, left, transform: 'translateX(-50%)' });
        }
    }, [hover]);

    return (
        <div ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="inline-flex">
            {children}
            {hover && createPortal(
                <div
                    ref={tooltipRef}
                    className="fixed pointer-events-none z-[99999] px-2.5 py-1.5 bg-slate-800 text-white text-[11px] rounded-md whitespace-nowrap shadow-lg"
                    style={style}
                >
                    {tip}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-800" />
                </div>,
                document.body
            )}
        </div>
    );
};

// ─── Friendly Visitor Names ──────────────────────────────────────────

const ANIMALS = ['Fox', 'Owl', 'Bear', 'Wolf', 'Hawk', 'Deer', 'Lion', 'Lynx', 'Crow', 'Seal',
    'Hare', 'Dove', 'Frog', 'Wren', 'Puma', 'Ibis', 'Yak', 'Newt', 'Moth', 'Kite',
    'Swan', 'Mole', 'Crab', 'Lark', 'Pike', 'Ram', 'Orca', 'Bee', 'Jay', 'Asp'];
const COLORS = ['Blue', 'Red', 'Jade', 'Gold', 'Teal', 'Mint', 'Rose', 'Plum', 'Sage', 'Coral',
    'Amber', 'Ruby', 'Lime', 'Sky', 'Sand', 'Aqua', 'Dusk', 'Fern', 'Rust', 'Snow'];

function friendlyVisitorName(visitorId: string): string {
    let hash = 0;
    for (let i = 0; i < visitorId.length; i++) {
        hash = ((hash << 5) - hash + visitorId.charCodeAt(i)) | 0;
    }
    const h = Math.abs(hash);
    return `${COLORS[h % COLORS.length]} ${ANIMALS[(h >>> 8) % ANIMALS.length]}`;
}

// ─── Utilities ───────────────────────────────────────────────────────

const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
};

const shortenUrl = (url: string): string => {
    try {
        const u = new URL(url);
        return u.pathname === '/' ? u.hostname : `${u.hostname}${u.pathname}`;
    } catch {
        return url.length > 50 ? url.slice(0, 50) + '...' : url;
    }
};

const toCsv = (rows: Array<Record<string, unknown>>, columns: string[]): string => {
    const header = columns.join(',');
    const body = rows.map((row) =>
        columns.map((col) => {
            const val = row[col];
            if (val == null) return '';
            const str = String(val);
            return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
        }).join(',')
    ).join('\n');
    return `${header}\n${body}`;
};

const downloadCsv = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

const formatMs = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
};

const getDeviceIcon = (vw: number) => {
    if (vw < 768) return '📱';
    if (vw <= 1024) return '📱';
    return '🖥️';
};

// ─── Visitor Journeys Tab ───────────────────────────────────────────

const VisitorJourneysTab = ({ researchId, onReplay }: { researchId: string; onReplay: (id: string) => void }) => {
    const [selectedVisitor, setSelectedVisitor] = useState<string | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: ['tracking', researchId, 'visitors'],
        queryFn: () => trackingService.getVisitorJourneys(researchId, 20, 0),
        staleTime: 10_000,
    });

    if (isLoading) return <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />;

    const visitors = data?.visitors || [];

    if (visitors.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <Users className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No visitor data yet.</p>
            </div>
        );
    }

    const active = selectedVisitor ? visitors.find((v, i) => `${v.visitorId}_${i}` === selectedVisitor) : undefined;

    return (
        <div className="flex gap-0 bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
            {/* Left: visitor list */}
            <div className="w-[340px] shrink-0 border-r border-gray-100 flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100 shrink-0">
                    <h3 className="text-sm font-semibold text-slate-800">
                        Visitors
                        <span className="ml-2 text-xs font-normal text-gray-500">{data?.totalVisitors} total</span>
                    </h3>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {visitors.map((visitor, vIdx) => {
                        const visitKey = `${visitor.visitorId}_${vIdx}`;
                        const isActive = selectedVisitor === visitKey;
                        return (
                            <button
                                key={visitKey}
                                onClick={() => setSelectedVisitor(isActive ? null : visitKey)}
                                className={`w-full px-4 py-3 flex items-center gap-3 text-left border-b border-gray-50 transition-colors ${
                                    isActive ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                                }`}
                            >
                                <span className="text-base">{getDeviceIcon(visitor.viewportWidth)}</span>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>
                                        {friendlyVisitorName(visitor.visitorId)}
                                    </p>
                                    <p className="text-[10px] text-gray-400 truncate">
                                        Entry: {shortenUrl(visitor.entryPage)}
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[9px] text-gray-400">{visitor.lastSeen ? formatDateTime(visitor.lastSeen as string) : ''}</p>
                                    <p className="text-[10px] text-gray-500">{visitor.pages.length} page{visitor.pages.length !== 1 ? 's' : ''}</p>
                                    <p className="text-[10px] text-gray-400">{formatMs(visitor.totalDurationMs)}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Right: detail panel */}
            <div className="flex-1 flex flex-col min-w-0">
                {active ? (
                    <>
                        {/* Header */}
                        <div className="px-5 py-3 border-b border-gray-100 shrink-0 flex items-center gap-3">
                            <span className="text-lg">{getDeviceIcon(active.viewportWidth)}</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800">{friendlyVisitorName(active.visitorId)}</p>
                                <p className="text-xs text-gray-500">
                                    Entry: {shortenUrl(active.entryPage)} · {active.pages.length} pages · {formatMs(active.totalDurationMs)}
                                </p>
                            </div>
                            <p className="text-[10px] text-gray-400 shrink-0">
                                {active.lastSeen ? formatDateTime(active.lastSeen as string) : ''}
                            </p>
                        </div>

                        {/* Page list */}
                        <div className="flex-1 overflow-y-auto">
                            <div className="px-5 py-2 flex gap-4 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                <span className="w-6">#</span>
                                <span className="w-20">Date</span>
                                <span className="flex-1">Page</span>
                                <span className="w-24">Timeline</span>
                                <span className="w-14 text-right">Duration</span>
                                <span className="w-10 text-right">Events</span>
                                <span className="w-8" />
                            </div>
                            {active.pages.map((page, pageIdx) => {
                                const maxDur = Math.max(...active.pages.map(p => p.durationMs), 1);
                                const barPct = (page.durationMs / maxDur) * 100;

                                // Gap between this page and the previous one
                                const prevPage = pageIdx > 0 ? active.pages[pageIdx - 1] : null;
                                const prevEnd = prevPage?.startedAt ? new Date(prevPage.startedAt as string).getTime() + prevPage.durationMs : 0;
                                const thisStart = page.startedAt ? new Date(page.startedAt as string).getTime() : 0;
                                const gapMs = prevPage ? thisStart - prevEnd : 0;
                                const showGap = gapMs > 10000; // show if >10s gap

                                return (
                                    <div key={`${page.sessionId}-${page.index}`}>
                                    {showGap && (
                                        <div className="px-5 py-1.5 flex items-center gap-2 bg-amber-50/50 border-b border-amber-100">
                                            <div className="flex-1 border-t border-dashed border-amber-300" />
                                            <span className="text-[9px] font-medium text-amber-600 flex items-center gap-1">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                                                </svg>
                                                Left page · {formatMs(gapMs)} away
                                            </span>
                                            <div className="flex-1 border-t border-dashed border-amber-300" />
                                        </div>
                                    )}
                                    <div
                                        className="px-5 py-2.5 flex items-center gap-4 border-b border-gray-50 text-xs hover:bg-gray-50 transition-colors"
                                    >
                                        <span className="text-gray-400 font-mono w-6">#{page.index}</span>
                                        <span className="text-[10px] text-gray-400 font-mono w-20">
                                            {page.startedAt ? new Date(page.startedAt as string).toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(page.startedAt as string).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                        <span className="text-slate-700 truncate flex-1" title={page.pageUrl}>
                                            {shortenUrl(page.pageUrl)}
                                        </span>
                                        <CaptureErrorBadges errors={page.captureErrors} />
                                        <div className="w-24">
                                            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${page.clickCount > 0 ? 'bg-red-400' : 'bg-blue-400'}`}
                                                    style={{ width: `${Math.max(2, barPct)}%` }}
                                                />
                                            </div>
                                        </div>
                                        <span className="text-gray-600 font-mono w-14 text-right">{formatMs(page.durationMs)}</span>
                                        <span className="text-gray-500 w-10 text-right">{page.eventCount}</span>
                                        {page.hasRrweb ? (
                                            <button
                                                onClick={() => onReplay(page.sessionId)}
                                                className="p-1 rounded hover:bg-blue-50 text-blue-600 w-8 flex items-center justify-center"
                                                title="Replay (DOM recording)"
                                            >
                                                <PlayCircle className="h-3.5 w-3.5" />
                                            </button>
                                        ) : (
                                            <span className="w-8 flex items-center justify-center" title="No DOM recording">
                                                <PlayCircle className="h-3.5 w-3.5 text-gray-300" />
                                            </span>
                                        )}
                                    </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <Users className="h-10 w-10 text-gray-200 mx-auto mb-2" />
                            <p className="text-sm text-gray-400">Select a visitor to see their journey</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Live Sessions Tab ──────────────────────────────────────────────

const LiveSessionsTab = ({ sessions, onReplay }: { sessions: trackingService.LiveVisitor[]; onReplay: (id: string) => void }) => {
    const [dataUpdatedAt, setDataUpdatedAt] = useState(() => Date.now());
    useEffect(() => { setDataUpdatedAt(Date.now()); }, [sessions]);

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                    </span>
                    Live Sessions
                    <span className="text-xs font-normal text-gray-500">{sessions.length} active</span>
                </h3>
                <span className="text-[10px] text-gray-400">Live stream</span>
            </div>

            {sessions.length === 0 ? (
                <div className="px-5 py-12 text-center">
                    <Activity className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No active sessions right now.</p>
                    <p className="text-xs text-gray-400 mt-1">Sessions appear here when someone visits the tracked site.</p>
                </div>
            ) : (
                <div className="divide-y divide-gray-100">
                    {sessions.map((visitor, sIdx) => {
                        const totalEvents = visitor.pages.reduce((sum, p) => sum + p.eventCount, 0);
                        const timeSinceStart = dataUpdatedAt > 0 ? dataUpdatedAt - new Date(visitor.firstSeen).getTime() : 0;
                        const latestSession = visitor.pages[visitor.pages.length - 1];
                        return (
                            <div key={`${visitor.visitorId}_${sIdx}`} className="px-5 py-3">
                                <div className="flex items-center gap-4">
                                    <span className="text-lg">{getDeviceIcon(visitor.viewportWidth)}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-800 truncate">
                                            {friendlyVisitorName(visitor.visitorId)}
                                        </p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                            {formatMs(timeSinceStart)} on site · {totalEvents} events
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {latestSession && (
                                            <button
                                                onClick={() => onReplay(latestSession.sessionId)}
                                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                                            >
                                                <PlayCircle className="h-3 w-3" /> Replay
                                            </button>
                                        )}
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                                        </span>
                                    </div>
                                </div>
                                {/* Page journey */}
                                <div className="ml-10 mt-2 space-y-1">
                                    {visitor.pages.map((page, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[10px]">
                                            <span className="text-gray-400 font-mono w-12 shrink-0">
                                                {page.startedAt ? new Date(page.startedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                                            </span>
                                            <span className="text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                                {shortenUrl(page.pageUrl)}
                                            </span>
                                            <span className="text-gray-400">{page.eventCount} events</span>
                                            <button
                                                onClick={() => onReplay(page.sessionId)}
                                                className="p-0.5 rounded hover:bg-blue-50 text-blue-500"
                                                title="Replay this page"
                                            >
                                                <PlayCircle className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};


