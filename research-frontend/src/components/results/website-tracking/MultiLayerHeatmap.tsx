/**
 * Multi-Layer Heatmap
 * Loads the actual live page URL in an iframe (like Hotjar/Mouseflow) and overlays
 * independent canvas layers for click, scroll, and attention heatmaps.
 * Falls back to screenshot if the live page can't be loaded.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import simpleheat from 'simpleheat';
import * as trackingService from '../../../services/tracking.service';
import { configService } from '../../../services/api/config.service';
import { useAuthStore } from '../../../stores/auth.store';

interface MultiLayerHeatmapProps {
    researchId: string;
    pageUrl: string;
    device?: 'mobile' | 'tablet' | 'desktop';
    screenshotUrl?: string | null;
    hasSnapshot?: boolean;
    layers: { click: boolean; scroll: boolean; attention: boolean; density: boolean; mouseAttention: boolean };
    intensity: number;
    opacity: number;
}

const scrollPctToColor = (pct: number): string => {
    const stops = [
        { at: 100, color: [134, 239, 172] },
        { at: 75, color: [253, 224, 71] },
        { at: 50, color: [251, 146, 60] },
        { at: 25, color: [252, 165, 165] },
        { at: 0, color: [253, 164, 175] },
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

export const MultiLayerHeatmap = ({
    researchId,
    pageUrl,
    device,
    screenshotUrl,
    hasSnapshot,
    layers,
    intensity,
    opacity,
}: MultiLayerHeatmapProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const clickCanvasRef = useRef<HTMLCanvasElement>(null);
    const scrollCanvasRef = useRef<HTMLCanvasElement>(null);
    const attentionCanvasRef = useRef<HTMLCanvasElement>(null);
    const densityCanvasRef = useRef<HTMLCanvasElement>(null);
    const mouseAttentionCanvasRef = useRef<HTMLCanvasElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const [ready, setReady] = useState(false);
    const [proxyFailed, setProxyFailed] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Iframe URL — prefer DOM snapshot (preserves JS-rendered styles) over live proxy
    const token = useAuthStore((s) => s.token);
    const proxyUrl = useMemo(() => {
        const base = configService.getBaseUrl();
        if (hasSnapshot) {
            return `${base}/tracking/${researchId}/snapshot-html?page=${encodeURIComponent(pageUrl)}&token=${encodeURIComponent(token || '')}`;
        }
        return `${base}/tracking/${researchId}/proxy-page?url=${encodeURIComponent(pageUrl)}&token=${encodeURIComponent(token || '')}`;
    }, [researchId, pageUrl, token, hasSnapshot]);

    // Screenshot first (reliable), proxy fallback only if no screenshot
    const useScreenshot = !!screenshotUrl;
    const useProxy = !useScreenshot && !proxyFailed;
    const hasBackdrop = useScreenshot || useProxy;

    const { data: clickData } = useQuery({
        queryKey: ['tracking', researchId, 'heatmap', pageUrl, device || 'all'],
        queryFn: () => trackingService.getClickHeatmap(researchId, pageUrl, device),
        enabled: (layers.click || layers.density) && hasBackdrop,
        staleTime: 10_000,
    });

    // Element-based clicks for precise proxy iframe rendering
    const { data: elementClickData } = useQuery({
        queryKey: ['tracking', researchId, 'element-clicks', pageUrl, device || 'all'],
        queryFn: () => trackingService.getElementClicks(researchId, pageUrl, device),
        enabled: layers.click && useProxy && hasBackdrop,
        staleTime: 10_000,
    });

    const { data: attentionData } = useQuery({
        queryKey: ['tracking', researchId, 'attention', pageUrl, device || 'all'],
        queryFn: () => trackingService.getAttentionHeatmap(researchId, pageUrl, device),
        enabled: layers.attention && hasBackdrop,
        staleTime: 10_000,
    });

    const { data: scrollData } = useQuery({
        queryKey: ['tracking', researchId, 'scroll', pageUrl],
        queryFn: () => trackingService.getScrollDepth(researchId, pageUrl),
        enabled: layers.scroll && hasBackdrop,
        staleTime: 10_000,
    });

    const { data: gazeZoneData } = useQuery({
        queryKey: ['tracking', researchId, 'gaze', pageUrl],
        queryFn: () => trackingService.getTrackingGaze(researchId, pageUrl),
        enabled: layers.mouseAttention && hasBackdrop,
        staleTime: 10_000,
    });

    // Proxy iframe loaded — same-origin, can always read DOM dimensions
    const handleIframeLoad = useCallback(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) {
                // Wait for CSS to load and layout to settle
                setTimeout(() => {
                    const w = Math.max(doc.body?.scrollWidth || 0, doc.documentElement?.scrollWidth || 0);
                    const h = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0);
                    if (w > 0 && h > 0) {
                        setDimensions({ width: w, height: h });
                        setReady(true);
                    }
                }, 2000);
                return;
            }
        } catch {
            // Proxy failed — fall back to screenshot
            setProxyFailed(true);
        }
    }, []);

    // Detect proxy load failure with a timeout
    useEffect(() => {
        if (!useProxy || ready) return;
        const timer = setTimeout(() => {
            if (!ready) setProxyFailed(true);
        }, 12000);
        return () => clearTimeout(timer);
    }, [useProxy, ready]);

    // Screenshot fallback — measure from image
    const handleImgLoad = useCallback(() => {
        const img = imgRef.current;
        if (!img) return;
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        setReady(true);
    }, []);

    // ─── Resolve element-based click positions from proxy iframe (same-origin) ────
    const resolveElementPoints = useCallback((): Array<[number, number, number]> => {
        const clicks = elementClickData?.clicks;
        if (!clicks || !useProxy || !iframeRef.current || !ready) return [];

        let iframeDoc: Document | null = null;
        try {
            iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document || null;
        } catch { return []; }
        if (!iframeDoc) return [];

        const points: Array<[number, number, number]> = [];
        const w = dimensions.width;

        for (const click of clicks) {
            // Try element-based positioning (same-origin = always accessible)
            if (click.selector && click.offsetX > 0) {
                try {
                    const el = iframeDoc.querySelector(click.selector);
                    if (el) {
                        const rect = el.getBoundingClientRect();
                        const scrollY = iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop || 0;
                        const px = rect.left + (click.offsetX / 100) * rect.width;
                        const py = rect.top + scrollY + (click.offsetY / 100) * rect.height;
                        points.push([px, py, click.count]);
                        continue;
                    }
                } catch { /* selector not found */ }
            }
            // Fallback to absolute coordinates
            points.push([(click.x / 100) * w, (click.y / 100) * w, click.count]);
        }
        return points;
    }, [elementClickData, useProxy, ready, dimensions]);

    // ─── Render click layer ─────────────────────────────────────────
    useEffect(() => {
        const canvas = clickCanvasRef.current;
        if (!ready || !canvas || dimensions.width === 0 || !layers.click) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = dimensions.width;
        const h = dimensions.height;
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        // Dark overlay — reduced 30%
        ctx.fillStyle = `rgba(0, 0, 0, ${(opacity / 100) * 0.7})`;
        ctx.fillRect(0, 0, w, h);

        // Use element-based points when available (live iframe), fallback to absolute
        const elementPoints = resolveElementPoints();
        const useElementData = elementPoints.length > 0;

        const heatCanvas = document.createElement('canvas');
        heatCanvas.width = w;
        heatCanvas.height = h;
        const heat = simpleheat(heatCanvas);
        const baseR = Math.max(20, Math.round(Math.min(w, h) * 0.04));
        const r = Math.round(baseR * (intensity / 50));
        heat.radius(r, Math.round(r * 0.9));
        heat.gradient({
            0.15: '#0f0', 0.35: '#8f0', 0.5: '#ff0',
            0.7: '#f80', 0.85: '#f00', 1.0: '#f00',
        });

        if (useElementData) {
            heat.data(elementPoints);
            heat.max(Math.max(3, Math.ceil(elementPoints.length * 0.05)));
        } else if (clickData?.clicks) {
            const points: Array<[number, number, number]> = clickData.clicks.map(c => [
                (c.x / 100) * w, (c.y / 100) * w, c.count,
            ]);
            heat.data(points);
            heat.max(Math.max(3, Math.ceil(points.length * 0.05)));
        }

        heat.draw(0.05);
        ctx.globalAlpha = 0.7;
        ctx.drawImage(heatCanvas, 0, 0);
        ctx.globalAlpha = 1;
    }, [ready, dimensions, layers.click, clickData, elementClickData, intensity, opacity, resolveElementPoints]);

    // ─── Render scroll layer ────────────────────────────────────────
    useEffect(() => {
        const canvas = scrollCanvasRef.current;
        if (!ready || !canvas || dimensions.width === 0 || !layers.scroll) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = dimensions.width;
        const h = dimensions.height;
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        if (scrollData?.depths && scrollData.depths.length > 0) {
            const depths = scrollData.depths;
            const bandCount = depths.length;
            const bandH = h / bandCount;

            for (let i = 0; i < bandCount; i++) {
                const d = depths[i];
                const y = i * bandH;
                ctx.fillStyle = scrollPctToColor(d.percentage);
                ctx.globalAlpha = 0.25;
                ctx.fillRect(0, y, w, bandH);

                ctx.globalAlpha = 1;
                const label = `${d.percentage}%`;
                const fontSize = Math.max(11, Math.round(w * 0.014));
                ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                const labelY = y + bandH / 2;
                const labelX = w - 8;
                const metrics = ctx.measureText(label);
                const pillW = metrics.width + 12;
                const pillHt = fontSize + 6;
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.beginPath();
                ctx.roundRect(labelX - pillW, labelY - pillHt / 2, pillW + 4, pillHt, 3);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(label, labelX, labelY + 1);
            }

            ctx.globalAlpha = 0.25;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            for (let i = 1; i < bandCount; i++) {
                const y = i * bandH;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
    }, [ready, dimensions, layers.scroll, scrollData]);

    // ─── Render attention layer ─────────────────────────────────────
    useEffect(() => {
        const canvas = attentionCanvasRef.current;
        if (!ready || !canvas || dimensions.width === 0 || !layers.attention) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = dimensions.width;
        const h = dimensions.height;
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        if (attentionData?.points) {
            const max = attentionData.maxDwell || 1;
            const sorted = [...attentionData.points].sort((a, b) => a.y - b.y);

            for (const p of sorted) {
                const ratio = Math.min(p.dwell / max, 1);
                const r2 = Math.round(ratio < 0.5 ? ratio * 2 * 255 : 255);
                const g2 = Math.round(ratio < 0.5 ? 200 + ratio * 110 : 255 * (1 - (ratio - 0.5) * 2));
                const bandTop = (p.y / 100) * w;
                const bandH = (2 / 100) * w;
                ctx.globalAlpha = 0.18 + ratio * 0.22;
                ctx.fillStyle = `rgb(${r2},${g2},0)`;
                ctx.fillRect(0, bandTop, w, bandH);
            }
            ctx.globalAlpha = 1;
        }
    }, [ready, dimensions, layers.attention, attentionData]);

    // ─── Render density layer (10×10 grid) ──────────────────────────
    useEffect(() => {
        const canvas = densityCanvasRef.current;
        if (!ready || !canvas || dimensions.width === 0 || !layers.density) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = dimensions.width;
        const h = dimensions.height;
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        if (clickData?.clicks) {
            const GRID = 10;
            const cells = new Array(GRID * GRID).fill(0);
            let maxCount = 0;

            for (const click of clickData.clicks) {
                const px = (click.x / 100) * w;
                const py = (click.y / 100) * w;
                const col = Math.min(Math.floor((px / w) * GRID), GRID - 1);
                const row = Math.min(Math.floor((py / h) * GRID), GRID - 1);
                cells[row * GRID + col] += click.count;
                if (cells[row * GRID + col] > maxCount) maxCount = cells[row * GRID + col];
            }

            const cellW = w / GRID;
            const cellH = h / GRID;

            // Fill cells
            for (let idx = 0; idx < cells.length; idx++) {
                if (cells[idx] === 0) continue;
                const row = Math.floor(idx / GRID);
                const col = idx % GRID;
                const alpha = maxCount > 0 ? (cells[idx] / maxCount) * 0.55 + 0.08 : 0;
                ctx.fillStyle = `rgba(147, 51, 234, ${alpha})`; // purple
                ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
            }

            // Grid lines
            ctx.strokeStyle = 'rgba(147, 51, 234, 0.2)';
            ctx.lineWidth = 1;
            for (let i = 1; i < GRID; i++) {
                ctx.beginPath();
                ctx.moveTo(i * cellW, 0); ctx.lineTo(i * cellW, h);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(0, i * cellH); ctx.lineTo(w, i * cellH);
                ctx.stroke();
            }

            // Count labels
            const fontSize = Math.max(10, Math.round(Math.min(cellW, cellH) * 0.3));
            ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let idx = 0; idx < cells.length; idx++) {
                if (cells[idx] === 0) continue;
                const row = Math.floor(idx / GRID);
                const col = idx % GRID;
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillText(String(cells[idx]), col * cellW + cellW / 2, row * cellH + cellH / 2 + 1);
                ctx.fillStyle = 'white';
                ctx.fillText(String(cells[idx]), col * cellW + cellW / 2, row * cellH + cellH / 2);
            }
        }
    }, [ready, dimensions, layers.density, clickData]);

    // ─── Render gaze zone grid overlay (3×3 quadrant distribution) ────
    useEffect(() => {
        const canvas = mouseAttentionCanvasRef.current;
        if (!ready || !canvas || dimensions.width === 0 || !layers.mouseAttention) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = dimensions.width;
        const h = dimensions.height;
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        if (!gazeZoneData?.quadrantDistribution) return;

        const dist = gazeZoneData.quadrantDistribution;
        const grid: Array<Array<{ key: string; pct: number }>> = [
            [{ key: 'top-left', pct: dist['top-left'] || 0 }, { key: 'top-center', pct: dist['top-center'] || 0 }, { key: 'top-right', pct: dist['top-right'] || 0 }],
            [{ key: 'center-left', pct: dist['center-left'] || 0 }, { key: 'center', pct: dist['center'] || 0 }, { key: 'center-right', pct: dist['center-right'] || 0 }],
            [{ key: 'bottom-left', pct: dist['bottom-left'] || 0 }, { key: 'bottom-center', pct: dist['bottom-center'] || 0 }, { key: 'bottom-right', pct: dist['bottom-right'] || 0 }],
        ];
        const maxPct = Math.max(...grid.flat().map(c => c.pct), 1);
        const cellW = w / 3;
        const cellH = h / 3;
        const gap = 2;

        grid.forEach((row, ri) => {
            row.forEach((cell, ci) => {
                const x = ci * cellW + gap;
                const y = ri * cellH + gap;
                const cw = cellW - gap * 2;
                const ch = cellH - gap * 2;
                const intensity = cell.pct / maxPct;
                const alpha = 0.08 + intensity * 0.45;

                ctx.fillStyle = `rgba(37, 99, 235, ${alpha})`;
                ctx.beginPath();
                const r = 6;
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + cw - r, y);
                ctx.quadraticCurveTo(x + cw, y, x + cw, y + r);
                ctx.lineTo(x + cw, y + ch - r);
                ctx.quadraticCurveTo(x + cw, y + ch, x + cw - r, y + ch);
                ctx.lineTo(x + r, y + ch);
                ctx.quadraticCurveTo(x, y + ch, x, y + ch - r);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
                ctx.closePath();
                ctx.fill();

                if (cell.pct > 0) {
                    const fontSize = Math.max(12, Math.round(Math.min(cw, ch) * 0.12));
                    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = intensity > 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(55,65,81,0.9)';
                    ctx.fillText(`${cell.pct}%`, x + cw / 2, y + ch / 2);
                }
            });
        });
    }, [ready, dimensions, layers.mouseAttention, gazeZoneData]);

    // Clear canvas when layer toggled off
    useEffect(() => {
        if (!layers.click && clickCanvasRef.current) {
            const ctx = clickCanvasRef.current.getContext('2d');
            ctx?.clearRect(0, 0, clickCanvasRef.current.width, clickCanvasRef.current.height);
        }
    }, [layers.click]);

    useEffect(() => {
        if (!layers.scroll && scrollCanvasRef.current) {
            const ctx = scrollCanvasRef.current.getContext('2d');
            ctx?.clearRect(0, 0, scrollCanvasRef.current.width, scrollCanvasRef.current.height);
        }
    }, [layers.scroll]);

    useEffect(() => {
        if (!layers.attention && attentionCanvasRef.current) {
            const ctx = attentionCanvasRef.current.getContext('2d');
            ctx?.clearRect(0, 0, attentionCanvasRef.current.width, attentionCanvasRef.current.height);
        }
    }, [layers.attention]);

    useEffect(() => {
        if (!layers.density && densityCanvasRef.current) {
            const ctx = densityCanvasRef.current.getContext('2d');
            ctx?.clearRect(0, 0, densityCanvasRef.current.width, densityCanvasRef.current.height);
        }
    }, [layers.density]);

    useEffect(() => {
        if (!layers.mouseAttention && mouseAttentionCanvasRef.current) {
            const ctx = mouseAttentionCanvasRef.current.getContext('2d');
            ctx?.clearRect(0, 0, mouseAttentionCanvasRef.current.width, mouseAttentionCanvasRef.current.height);
        }
    }, [layers.mouseAttention]);

    const canvasStyle = 'absolute top-0 left-0 pointer-events-none w-full h-full';

    // Device width constraints
    const maxWidth = device === 'mobile' ? 375 : device === 'tablet' ? 768 : undefined;

    return (
        <div className={maxWidth ? 'flex justify-center' : ''}>
            <div
                ref={containerRef}
                className="relative rounded-lg border border-gray-200 bg-white overflow-hidden"
                style={{ width: '100%', maxWidth }}
            >
                {/* Proxied page iframe — same-origin for DOM access (Hotjar-style) */}
                {useProxy && (
                    <div className="relative" style={{ width: '100%' }}>
                        <iframe
                            ref={iframeRef}
                            src={proxyUrl}
                            sandbox="allow-same-origin"
                            onLoad={handleIframeLoad}
                            className="border-0 w-full"
                            style={{
                                height: ready ? dimensions.height : '500vh',
                                pointerEvents: 'none',
                            }}
                            title="Tracked page"
                        />
                        {ready && (
                            <>
                                <canvas ref={clickCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={scrollCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={attentionCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={densityCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={mouseAttentionCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                            </>
                        )}
                        {!ready && (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80">
                                <span className="text-gray-400 text-sm">Loading page...</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Screenshot fallback */}
                {useScreenshot && screenshotUrl && (
                    <div className="relative" style={{ width: '100%' }}>
                        <img
                            ref={imgRef}
                            src={screenshotUrl}
                            onLoad={handleImgLoad}
                            alt="Page screenshot"
                            className="w-full h-auto block"
                        />
                        {ready && (
                            <>
                                <canvas ref={clickCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={scrollCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={attentionCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={densityCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                                <canvas ref={mouseAttentionCanvasRef} className={canvasStyle} style={{ width: '100%', height: '100%' }} />
                            </>
                        )}
                    </div>
                )}

                {/* No backdrop at all */}
                {!useProxy && !useScreenshot && (
                    <div className="bg-gray-50 rounded-lg p-12 text-center">
                        <p className="text-sm text-gray-500">No page data available.</p>
                    </div>
                )}

                {layers.mouseAttention && gazeZoneData?.dataSource && (gazeZoneData.dataSource.cursor > 0 || gazeZoneData.dataSource.calibratedGaze > 0) && (
                    <div className="absolute top-2 right-2 bg-white/90 border border-gray-200 rounded-lg px-3 py-1.5 text-[10px] text-gray-600 flex items-center gap-3 z-10">
                        {gazeZoneData.dataSource.cursor > 0 && (
                            <span className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                                {gazeZoneData.dataSource.cursor} cursor
                            </span>
                        )}
                        {gazeZoneData.dataSource.calibratedGaze > 0 && (
                            <span className="flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${gazeZoneData.dataSource.qualityBreakdown.good > gazeZoneData.dataSource.qualityBreakdown.fair ? 'bg-green-500' : gazeZoneData.dataSource.qualityBreakdown.fair > gazeZoneData.dataSource.qualityBreakdown.low ? 'bg-amber-500' : 'bg-red-500'}`} />
                                {gazeZoneData.dataSource.calibratedGaze} gaze
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
