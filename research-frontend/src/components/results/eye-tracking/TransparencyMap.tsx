import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';

export const TransparencyMap = ({
  imageUrl,
  fixations,
  excludedParticipants,
}: {
  imageUrl: string;
  fixations: EyeTrackingStimulus['fixations'];
  excludedParticipants?: Set<string>;
}) => {
  const includedFixations = useMemo(
    () => excludedParticipants?.size ? fixations.filter(f => !excludedParticipants.has(f.participantId)) : fixations,
    [fixations, excludedParticipants],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blurAmount, setBlurAmount] = useState(20);
  const [revealRadius, setRevealRadius] = useState(40);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Reusable offscreen canvases
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  // Cache mask when only blur changes (gradients only depend on fixations + revealRadius)
  const cachedMaskKey = useRef('');
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      renderTransparency(img);
    };
    img.src = imageUrl;
    return () => { img.onload = null; img.src = ''; imgRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Debounce slider changes to avoid re-rendering every pixel drag
  useEffect(() => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(() => renderTransparency(img), 80);
    return () => { if (renderTimerRef.current) clearTimeout(renderTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedFixations, blurAmount, revealRadius]);

  const renderTransparency = useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw blurred image as base
    ctx.filter = `blur(${blurAmount}px)`;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';

    // Dark overlay on blurred
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, w, h);

    // Reuse offscreen canvas for sharp image
    if (!offscreenRef.current || offscreenRef.current.width !== w || offscreenRef.current.height !== h) {
      offscreenRef.current = document.createElement('canvas');
      offscreenRef.current.width = w;
      offscreenRef.current.height = h;
    }
    const offCtx = offscreenRef.current.getContext('2d');
    if (!offCtx) return;
    offCtx.clearRect(0, 0, w, h);
    offCtx.drawImage(img, 0, 0, w, h);

    // Only rebuild mask when fixations or revealRadius change (not blur)
    const maskKey = `${includedFixations.length}-${revealRadius}`;
    if (!maskRef.current || maskRef.current.width !== w || maskRef.current.height !== h) {
      maskRef.current = document.createElement('canvas');
      maskRef.current.width = w;
      maskRef.current.height = h;
      cachedMaskKey.current = '';
    }
    if (cachedMaskKey.current !== maskKey) {
      cachedMaskKey.current = maskKey;
      const maskCtx = maskRef.current.getContext('2d');
      if (!maskCtx) return;
      maskCtx.clearRect(0, 0, w, h);

      // Fixations are in percent (0-100) — convert to canvas pixels
      const maxCoord = Math.max(...includedFixations.map(f => Math.max(f.x, f.y)), 1);
      const isPercent = maxCoord <= 100;

      const maxDur = Math.max(...includedFixations.map(f => f.duration), 1);
      for (const fix of includedFixations) {
        const fx = isPercent ? (fix.x / 100) * w : fix.x;
        const fy = isPercent ? (fix.y / 100) * h : fix.y;
        const baseR = (revealRadius / 100) * Math.min(w, h) * 0.1;
        const durScale = 0.5 + (fix.duration / maxDur) * 0.5;
        const r = baseR * durScale;

        const gradient = maskCtx.createRadialGradient(fx, fy, 0, fx, fy, r);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.7, 'rgba(255,255,255,0.6)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        maskCtx.fillStyle = gradient;
        maskCtx.fillRect(fx - r, fy - r, r * 2, r * 2);
      }
    }

    // Apply mask to sharp image
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(maskRef.current, 0, 0);
    offCtx.globalCompositeOperation = 'source-over';

    // Composite revealed areas onto blurred base
    ctx.drawImage(offscreenRef.current, 0, 0);
  }, [includedFixations, blurAmount, revealRadius]);

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <label className="text-xs text-gray-500 flex items-center gap-2">
          Blur
          <input
            type="range"
            min={5}
            max={50}
            value={blurAmount}
            onChange={e => setBlurAmount(Number(e.target.value))}
            className="w-20 h-1 accent-blue-600"
          />
          <span className="text-xs text-gray-400 w-8">{blurAmount}px</span>
        </label>
        <label className="text-xs text-gray-500 flex items-center gap-2">
          Reveal
          <input
            type="range"
            min={10}
            max={100}
            value={revealRadius}
            onChange={e => setRevealRadius(Number(e.target.value))}
            className="w-20 h-1 accent-blue-600"
          />
          <span className="text-xs text-gray-400 w-8">{revealRadius}%</span>
        </label>
        <span className="text-xs text-gray-400">{includedFixations.length} fixations</span>
      </div>
      <div className="rounded-lg overflow-hidden border bg-gray-100">
        <canvas
          ref={canvasRef}
          className="block w-full h-auto"
        />
      </div>
      <p className="text-xs text-gray-400 mt-2 text-center">
        Zonas nítidas = donde miraron los participantes. Borroso = no visto.
      </p>
    </div>
  );
};
