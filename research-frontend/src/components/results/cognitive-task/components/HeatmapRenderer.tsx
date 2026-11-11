import { useEffect, useRef, useState } from 'react';
import { loadCachedStimulusImage } from '../../../../utils/stimulusImageCache';
import {
    computeStimulusDisplaySize,
    type HeatmapVisualProfile,
    type StimulusDisplaySize,
} from '../../../../utils/attentionPrediction.utils';
import { paintHeatmap, type HeatmapCoordSystem, type HeatmapGranularity, type HeatmapPoint } from './paintHeatmap';

interface HeatmapRendererProps {
    imageUrl: string;
    data: HeatmapPoint[];
    className?: string;
    canvasClassName?: string;
    borderless?: boolean;
    radius?: number;
    blur?: number;
    opacity?: number;
    threshold?: number;
    darkOverlay?: number;
    /** precise = discrete hotspots; smooth = legacy diffuse blobs */
    granularity?: HeatmapGranularity;
    /** Fine-tuned render tuning (Lab / Precise / Balanced / Smooth) */
    visualProfile?: HeatmapVisualProfile;
    /** Coordinate system of data points. When set, skips auto-detection.
     *  - 'pixel': absolute image pixel coords (e.g. 0-1920)
     *  - 'percent': percentage coords (0-100)
     *  - 'normalized': normalized coords (0-1)
     */
    coordSystem?: HeatmapCoordSystem;
    /** When set with borderless, sizes canvas to fit container without upscaling */
    fitMaxHeightPx?: number;
}

export const HeatmapRenderer = ({
    imageUrl,
    data,
    className = '',
    canvasClassName,
    borderless = false,
    radius: radiusProp,
    blur: blurProp,
    opacity: opacityProp,
    threshold: thresholdProp,
    darkOverlay = 0,
    granularity = 'precise',
    visualProfile = 'precise',
    coordSystem,
    fitMaxHeightPx,
}: HeatmapRendererProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fitContainerRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const heatCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
    const [displaySize, setDisplaySize] = useState<StimulusDisplaySize | null>(null);

    useEffect(() => {
        let cancelled = false;
        setImageLoaded(false);

        void loadCachedStimulusImage(imageUrl)
            .then((img) => {
                if (cancelled) return;
                setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                imgRef.current = img;
                setImageLoaded(true);
            })
            .catch(() => {
                if (!cancelled) setImageLoaded(false);
            });

        return () => {
            cancelled = true;
            imgRef.current = null;
        };
    }, [imageUrl]);

    useEffect(() => {
        if (!imageLoaded || !canvasRef.current || !imgRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const img = imgRef.current;
        const w = naturalSize.width;
        const h = naturalSize.height;
        canvas.width = w;
        canvas.height = h;

        ctx.drawImage(img, 0, 0);

        heatCanvasRef.current ??= document.createElement('canvas');
        paintHeatmap(ctx, heatCanvasRef.current, {
            data,
            radius: radiusProp,
            blur: blurProp,
            opacity: opacityProp,
            threshold: thresholdProp,
            darkOverlay,
            granularity,
            visualProfile,
            coordSystem,
        });
    }, [imageLoaded, naturalSize, data, imageUrl, radiusProp, blurProp, opacityProp, thresholdProp, darkOverlay, coordSystem, granularity, visualProfile]);

    useEffect(() => {
        if (!borderless || !fitMaxHeightPx || naturalSize.width <= 0) {
            setDisplaySize(null);
            return;
        }

        const container = fitContainerRef.current;
        if (!container) {
            return;
        }

        const updateDisplaySize = (): void => {
            const measuredWidth = container.clientWidth || container.parentElement?.clientWidth || 0;
            const maxWidth = measuredWidth > 0
                ? measuredWidth
                : Math.min(typeof window !== 'undefined' ? window.innerWidth - 96 : 800, 1200);
            setDisplaySize(
                computeStimulusDisplaySize(
                    naturalSize.width,
                    naturalSize.height,
                    maxWidth,
                    fitMaxHeightPx,
                ),
            );
        };

        updateDisplaySize();
        const frame = requestAnimationFrame(updateDisplaySize);
        const observer = new ResizeObserver(updateDisplaySize);
        observer.observe(container);
        window.addEventListener('resize', updateDisplaySize);

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener('resize', updateDisplaySize);
        };
    }, [borderless, fitMaxHeightPx, naturalSize.width, naturalSize.height]);

    if (!imageUrl) return <div className="bg-gray-200 h-64 flex items-center justify-center">No Image URL</div>;

    const wrapperClass = borderless
        ? `relative block w-full max-w-full leading-[0] ${className}`.trim()
        : `relative overflow-hidden rounded-lg shadow-sm border ${className}`;

    const canvasFitClass = canvasClassName ?? 'w-full h-auto block';
    const fallbackMaxWidth = typeof window !== 'undefined'
        ? Math.min(window.innerWidth - 96, 1200)
        : 800;
    const resolvedDisplaySize = borderless && fitMaxHeightPx && naturalSize.width > 0
        ? (displaySize ?? computeStimulusDisplaySize(
            naturalSize.width,
            naturalSize.height,
            fallbackMaxWidth,
            fitMaxHeightPx,
        ))
        : null;
    const useFitSizing = resolvedDisplaySize != null && resolvedDisplaySize.width > 0;

    return (
        <div ref={fitContainerRef} className={wrapperClass}>
            {useFitSizing ? (
                <div
                    className="relative mx-auto"
                    style={{ width: resolvedDisplaySize.width, height: resolvedDisplaySize.height }}
                >
                    <canvas ref={canvasRef} className="block h-full w-full" />
                </div>
            ) : (
                <canvas ref={canvasRef} className={canvasFitClass} />
            )}
            {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100 min-h-[12rem]">
                    <span className="text-gray-400">Loading image...</span>
                </div>
            )}
        </div>
    );
};
