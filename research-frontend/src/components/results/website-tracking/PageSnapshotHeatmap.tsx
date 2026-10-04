/**
 * Page Snapshot Heatmap
 * Renders a captured DOM snapshot in a sandboxed iframe with a heatmap canvas overlay.
 * Scripts are stripped from the snapshot to prevent execution warnings.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import simpleheat from 'simpleheat';
import * as trackingService from '../../../services/tracking.service';

interface PageSnapshotHeatmapProps {
    researchId: string;
    pageUrl: string;
    heatmapType: 'click' | 'scroll' | 'attention';
    device?: 'mobile' | 'tablet' | 'desktop';
    screenshotUrl?: string | null;
    /** External intensity value (0-100). If provided, hides internal slider. */
    externalIntensity?: number;
    /** External opacity value (0-80). If provided, hides internal slider. */
    externalOpacity?: number;
}

/**
 * Strip all script-related content from HTML to prevent sandbox warnings.
 * Removes <script> tags, inline event handlers (onclick, onload, etc.), and javascript: URLs.
 */
const sanitizeSnapshot = (html: string): string => {
    let clean = html;
    // Remove <script>...</script> and <script ... />
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    clean = clean.replace(/<script\b[^>]*\/>/gi, '');
    // Remove <noscript>...</noscript>
    clean = clean.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
    // Remove inline event handlers (on*)
    clean = clean.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '');
    clean = clean.replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');
    // Remove javascript: URLs
    clean = clean.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
    clean = clean.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
    return clean;
};

// Map scroll reach percentage to color (green=most viewed → red=least viewed)
const scrollPctToColor = (pct: number): string => {
    const stops = [
        { at: 100, color: [134, 239, 172] }, // green-300
        { at: 75, color: [253, 224, 71] },   // yellow-300
        { at: 50, color: [251, 146, 60] },   // orange-300
        { at: 25, color: [252, 165, 165] },  // red-300
        { at: 0, color: [253, 164, 175] },   // rose-300
    ];
    for (let i = 0; i < stops.length - 1; i++) {
        if (pct >= stops[i + 1].at) {
            const range = stops[i].at - stops[i + 1].at;
            const t = range > 0 ? (pct - stops[i + 1].at) / range : 0;
            const c = stops[i + 1].color.map((v, j) => Math.round(v + (stops[i].color[j] - v) * t));
            return `rgb(${c[0]},${c[1]},${c[2]})`;
        }
    }
    const last = stops[stops.length - 1].color;
    return `rgb(${last[0]},${last[1]},${last[2]})`;
};

export const PageSnapshotHeatmap = ({
    researchId,
    pageUrl,
    heatmapType,
    device,
    screenshotUrl,
    externalIntensity,
    externalOpacity,
}: PageSnapshotHeatmapProps) => {
    const hasExternalControls = externalIntensity !== undefined && externalOpacity !== undefined;
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const [iframeReady, setIframeReady] = useState(false);
    const [imgReady, setImgReady] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [containerWidth, setContainerWidth] = useState(0);
    const [_intensity, setIntensity] = useState(50);
    const [_opacity, setOpacity] = useState(45);
    const intensity = externalIntensity ?? _intensity;
    const opacity = externalOpacity ?? _opacity;

    const useScreenshot = !!screenshotUrl;

    // Fetch snapshot HTML (only if no screenshot available)
    const { data: snapshotHtml } = useQuery({
        queryKey: ['tracking', researchId, 'snapshot', pageUrl],
        queryFn: () => trackingService.getPageSnapshot(researchId, pageUrl),
        enabled: !useScreenshot,
        staleTime: 60_000,
    });

    const hasBackdrop = useScreenshot || !!snapshotHtml;

    // Fetch heatmap data
    const { data: clickData } = useQuery({
        queryKey: ['tracking', researchId, 'heatmap', pageUrl, device || 'all'],
        queryFn: () => trackingService.getClickHeatmap(researchId, pageUrl, device),
        enabled: heatmapType === 'click' && hasBackdrop,
        staleTime: 10_000,
    });

    const { data: attentionData } = useQuery({
        queryKey: ['tracking', researchId, 'attention', pageUrl, device || 'all'],
        queryFn: () => trackingService.getAttentionHeatmap(researchId, pageUrl, device),
        enabled: heatmapType === 'attention' && hasBackdrop,
        staleTime: 10_000,
    });

    // Fetch scroll depth data
    const { data: scrollData } = useQuery({
        queryKey: ['tracking', researchId, 'scroll', pageUrl],
        queryFn: () => trackingService.getScrollDepth(researchId, pageUrl),
        enabled: heatmapType === 'scroll' && hasBackdrop,
        staleTime: 10_000,
    });

    // Sanitize and prepare srcdoc
    const srcdoc = useMemo(() => {
        if (!snapshotHtml) return '';
        const sanitized = sanitizeSnapshot(snapshotHtml);
        const injectStyle = `<style>
            * { pointer-events: none !important; user-select: none !important; }
            html, body { overflow: hidden !important; margin: 0 !important; }
        </style>`;
        return sanitized.replace('</head>', injectStyle + '</head>');
    }, [snapshotHtml]);

    // Screenshot image loaded — measure natural dimensions
    const handleImgLoad = useCallback(() => {
        const img = imgRef.current;
        if (!img) return;
        const cw = containerRef.current?.clientWidth || 1200;
        setContainerWidth(cw);
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        setImgReady(true);
    }, []);

    // Measure dimensions from the iframe after load — use allow-same-origin for measurement
    const handleIframeLoad = useCallback(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        const cw = containerRef.current?.clientWidth || 1200;
        setContainerWidth(cw);
        try {
            const doc = iframe.contentDocument;
            if (doc) {
                const w = Math.max(doc.body?.scrollWidth || 0, doc.documentElement?.scrollWidth || 0);
                const h = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0);
                if (w > 0 && h > 0) {
                    setDimensions({ width: w, height: h });
                    setIframeReady(true);
                    return;
                }
            }
        } catch {
            // Cross-origin fallback
        }
        // Fallback: use container width and 16:9 aspect ratio
        setDimensions({ width: cw, height: Math.round(cw * 1.5) });
        setIframeReady(true);
    }, []);

    // Recalculate containerWidth when device filter changes (screenshot mode only)
    useEffect(() => {
        if (!useScreenshot || !containerRef.current) return;
        const timer = setTimeout(() => {
            const cw = containerRef.current?.clientWidth || 0;
            if (cw > 0 && cw !== containerWidth) setContainerWidth(cw);
        }, 50);
        return () => clearTimeout(timer);
    }, [device, useScreenshot]); // eslint-disable-line react-hooks/exhaustive-deps

    const isReady = useScreenshot ? imgReady : iframeReady;

    // Render heatmap overlay on canvas
    useEffect(() => {
        if (!isReady || !canvasRef.current || dimensions.width === 0) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = dimensions.width;
        const h = dimensions.height;
        canvas.width = w;
        canvas.height = h;

        if (heatmapType === 'scroll' && scrollData?.depths) {
            // Scroll depth: gradient bands over the snapshot
            const depths = scrollData.depths;
            if (depths.length === 0) return;
            const bandHeight = h / depths.length;

            for (let i = 0; i < depths.length; i++) {
                const d = depths[i];
                const y = i * bandHeight;
                const color = scrollPctToColor(d.percentage);
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.55;
                ctx.fillRect(0, y, w, bandHeight);

                // Percentage label pill on right edge
                ctx.globalAlpha = 1;
                const label = `${d.percentage}%`;
                ctx.font = `bold ${Math.max(14, Math.round(w * 0.018))}px -apple-system, sans-serif`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                const labelY = y + bandHeight / 2;
                const labelX = w - 12;
                const metrics = ctx.measureText(label);
                const pillW = metrics.width + 16;
                const pillH = Math.max(20, Math.round(w * 0.022));
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.beginPath();
                ctx.roundRect(labelX - pillW, labelY - pillH / 2, pillW + 4, pillH, 4);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(label, labelX, labelY + 1);
            }

            // Divider lines
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            for (let i = 1; i < depths.length; i++) {
                const y = i * bandHeight;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            return;
        }

        if (heatmapType === 'attention' && attentionData?.points) {
            // Attention: horizontal bands painted directly — no simpleheat
            // Each point has y (band center as % of viewport width) and dwell (ms)
            const max = attentionData.maxDwell || 1;
            const sorted = [...attentionData.points].sort((a, b) => a.y - b.y);

            for (const p of sorted) {
                const ratio = Math.min(p.dwell / max, 1);
                // Green (low attention) → Yellow (mid) → Red (high)
                const r2 = Math.round(ratio < 0.5 ? ratio * 2 * 255 : 255);
                const g2 = Math.round(ratio < 0.5 ? 200 + ratio * 110 : 255 * (1 - (ratio - 0.5) * 2));
                const b2 = 0;
                const bandTop = (p.y / 100) * w;
                const bandH = (2 / 100) * w; // 2% band height
                ctx.globalAlpha = 0.35 + ratio * 0.35; // 35%-70% opacity based on intensity
                ctx.fillStyle = `rgb(${r2},${g2},${b2})`;
                ctx.fillRect(0, bandTop, w, bandH);
            }
            ctx.globalAlpha = 1;
            return;
        }

        // Click: dark overlay + simpleheat
        ctx.fillStyle = `rgba(0, 0, 0, ${opacity / 100})`;
        ctx.fillRect(0, 0, w, h);

        const heatCanvas = document.createElement('canvas');
        heatCanvas.width = w;
        heatCanvas.height = h;

        const heat = simpleheat(heatCanvas);

        if (heatmapType === 'click' && clickData?.clicks) {
            const baseR = Math.max(20, Math.round(Math.min(w, h) * 0.04));
            const r = Math.round(baseR * (intensity / 50));
            heat.radius(r, Math.round(r * 0.9));
            heat.gradient({
                0.15: '#0f0', 0.35: '#8f0', 0.5: '#ff0',
                0.7: '#f80', 0.85: '#f00', 1.0: '#f00',
            });
            const points: Array<[number, number, number]> = clickData.clicks.map(c => [
                (c.x / 100) * w, (c.y / 100) * w, c.count,
            ]);
            heat.data(points);
            heat.max(Math.max(3, Math.ceil(points.length * 0.05)));
            heat.draw(0.05);
        }

        ctx.drawImage(heatCanvas, 0, 0);
    }, [isReady, dimensions, heatmapType, clickData, attentionData, scrollData, intensity, opacity]);

    if (!useScreenshot && !snapshotHtml) {
        return (
            <div className="bg-gray-50 rounded-lg p-12 text-center">
                <p className="text-sm text-gray-500">No page snapshot captured yet.</p>
                <p className="text-xs text-gray-400 mt-1">Visit the tracked page to capture a DOM snapshot automatically.</p>
            </div>
        );
    }

    return (
        <div>
            {/* Sliders — hidden when controlled externally, not applicable for scroll */}
            {!hasExternalControls && heatmapType !== 'scroll' && (
            <div className="flex items-center gap-6 mb-2 px-1">
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                    Intensity
                    <input type="range" min={10} max={100} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="w-24 h-1 accent-blue-600" />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                    Opacity
                    <input type="range" min={0} max={80} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 h-1 accent-blue-600" />
                </label>
            </div>
            )}
        {/* Device viewport simulation — only when a real device screenshot exists */}
        <div className={useScreenshot && device ? 'flex justify-center' : ''}>
        <div
            ref={containerRef}
            className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-all duration-300"
            style={{
                maxHeight: '70vh',
                overflowY: 'auto',
                maxWidth: useScreenshot && device === 'mobile' ? 375 : useScreenshot && device === 'tablet' ? 768 : undefined,
                width: '100%',
            }}
        >
            {useScreenshot ? (
                /* Screenshot mode: img + canvas overlay */
                <div className="relative" style={{ width: '100%' }}>
                    <img
                        ref={imgRef}
                        src={screenshotUrl!}
                        onLoad={handleImgLoad}
                        alt="Page screenshot"
                        className="w-full h-auto block"
                    />
                    {imgReady && (
                        <canvas
                            ref={canvasRef}
                            className="absolute top-0 left-0 pointer-events-none w-full h-full"
                            style={{ width: '100%', height: '100%' }}
                        />
                    )}
                </div>
            ) : (
                /* DOM snapshot fallback: iframe + canvas, scaled to fit */
                <>
                    {(() => {
                        const scale = containerWidth > 0 && dimensions.width > 0
                            ? Math.min(1, containerWidth / dimensions.width)
                            : 1;
                        const scaledH = dimensions.height * scale;
                        return (
                            <div style={{ width: containerWidth || '100%', height: scaledH || 'auto', position: 'relative' }}>
                                <div style={{
                                    width: dimensions.width || '100%',
                                    height: dimensions.height || '100vh',
                                    transform: `scale(${scale})`,
                                    transformOrigin: 'top left',
                                }}>
                                    <iframe
                                        ref={iframeRef}
                                        srcDoc={srcdoc}
                                        sandbox="allow-same-origin"
                                        onLoad={handleIframeLoad}
                                        className="border-0"
                                        style={{
                                            width: dimensions.width || '100%',
                                            height: dimensions.height > 0 ? dimensions.height : '100vh',
                                            pointerEvents: 'none',
                                        }}
                                        title="Page snapshot"
                                    />

                                    {iframeReady && (
                                        <canvas
                                            ref={canvasRef}
                                            className="absolute top-0 left-0 pointer-events-none"
                                            style={{ width: dimensions.width, height: dimensions.height }}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </>
            )}

            {!isReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                    <span className="text-gray-400 text-sm">{useScreenshot ? 'Loading screenshot...' : 'Loading page snapshot...'}</span>
                </div>
            )}
        </div>
        </div>
        </div>
    );
};
