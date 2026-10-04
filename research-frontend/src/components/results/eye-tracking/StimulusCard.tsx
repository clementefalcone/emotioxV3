import { useState, useCallback, useMemo, useEffect } from 'react';
import { Eye, Users, Clock, Crosshair, Image, Download, ShieldCheck, Film, Signal, PenTool } from 'lucide-react';
import { toPng } from 'html-to-image';
import { cn } from '../../../lib/utils';
import { HeatmapRenderer } from '../cognitive-task/components/HeatmapRenderer';
import type { EyeTrackingStimulus, EyeTrackingAOI } from '../../../services/analytics.service';
import { resolveStimulusUrl, MetricBadge, ViewModeTab, AOIRow } from './shared';
import type { ViewMode } from './shared';
import { ZoneHeatmapOverlay } from './ZoneHeatmapOverlay';
import { AOIDrawer, type AOI } from '../../research/AOIDrawer';
import { modulesService } from '../../../services/modules.service';
import { EmotionPanel } from './EmotionPanel';
import { SequencePanel } from './SequencePanel';
import { TransparencyMap } from './TransparencyMap';
import { FirstLookOverlay } from './FirstLookOverlay';
import { ScanpathOverlay } from './ScanpathOverlay';
import { VideoGazePlayer } from './VideoGazePlayer';
import { PredictionPanel } from './PredictionPanel';
import { HeatmapSettingsModal, DEFAULT_HEATMAP_SETTINGS } from './HeatmapSettingsModal';
import type { HeatmapSettings } from './HeatmapSettingsModal';

export const StimulusCard = ({ stimulus: rawStimulus, researchId, onRefresh }: { stimulus: EyeTrackingStimulus; researchId: string; onRefresh: () => void }) => {
  const stimulus = { ...rawStimulus, stimulusUrl: resolveStimulusUrl(rawStimulus.stimulusUrl) };
  const isShelf = stimulus.modality === 'shelf' && stimulus.shelfUrls && stimulus.shelfUrls.length > 0;
  const resolvedShelfUrls = useMemo(
    () => stimulus.shelfUrls?.map(u => resolveStimulusUrl(u)) ?? [],
    [stimulus.shelfUrls],
  );
  const isVideo = stimulus.stimulusType === 'video';
  const hasZoneMass = stimulus.zoneMass && Object.values(stimulus.zoneMass).some(v => v > 0);
  const hasV3 = !!stimulus.v3Heatmap;
  const hasV3Temporal = hasV3 && stimulus.v3Heatmap?.hasTemporalData;
  const hasHeatData = hasZoneMass || stimulus.heatmapData.length > 0 || stimulus.fixations.length > 0 || hasV3;
  const hasVideoGaze = isVideo && stimulus.gazeTimeline && stimulus.gazeTimeline.length > 0;
  const defaultViewMode: ViewMode = hasVideoGaze ? 'video' : 'heatmap';
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [densityMode, setDensityMode] = useState<'density' | 'firstlook' | 'peak'>('density');
  const [imageContainerRef, setImageContainerRef] = useState<HTMLDivElement | null>(null);
  const [heatmapSettings, setHeatmapSettings] = useState<HeatmapSettings>(DEFAULT_HEATMAP_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [showAoiModal, setShowAoiModal] = useState(false);
  const [showQualityTable, setShowQualityTable] = useState(false);
  const [excludedParticipants, setExcludedParticipants] = useState<Set<string>>(() => {
    return new Set(stimulus.participants.filter(p => p.qualityGrade === 'low').map(p => p.participantId));
  });
  const [stimulusSize, setStimulusSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!stimulus.stimulusUrl || isVideo) return;
    const img = new window.Image();
    img.onload = () => {
      const maxH = window.innerHeight * 0.72;
      const maxW = Math.min(window.innerWidth - 400, 1200);
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1.2);
      setStimulusSize({ width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
    };
    img.src = stimulus.stimulusUrl;
  }, [stimulus.stimulusUrl, isVideo]);

  /** Decode a base64 Float64Array grid into cell-center points with values. */
  const decodeGridToPoints = useCallback((base64: string, cols: number, rows: number, cellW: number, cellH: number, minVal = 0.01) => {
    try {
      const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const grid = new Float64Array(binary.buffer, binary.byteOffset, cols * rows);
      const points: Array<{ x: number; y: number; value: number }> = [];
      // Find max for normalization
      let max = 0;
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] !== Infinity && grid[i] > max) max = grid[i];
      }
      if (max <= 0) return [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const raw = grid[r * cols + c];
          if (raw === Infinity || raw <= 0) continue;
          const val = raw / max;
          if (val > minVal) {
            points.push({ x: (c + 0.5) * cellW, y: (r + 0.5) * cellH, value: val });
          }
        }
      }
      return points;
    } catch { return []; }
  }, []);

  // Convert V3 density grid (base64 Float64Array) to HeatmapRenderer points
  const v3HeatmapPoints = useMemo(() => {
    const v3 = stimulus.v3Heatmap;
    if (!v3?.normalizedBase64) return [];
    return decodeGridToPoints(v3.normalizedBase64, v3.cols, v3.rows, v3.cellW, v3.cellH);
  }, [stimulus.v3Heatmap, decodeGridToPoints]);

  // Temporal V3 points (first-look or peak time)
  const v3TemporalPoints = useMemo(() => {
    const v3 = stimulus.v3Heatmap;
    if (!v3?.hasTemporalData) return [];
    const base64 = densityMode === 'firstlook' ? v3.firstAttentionBase64 : v3.peakTimeBase64;
    if (!base64) return [];
    return decodeGridToPoints(base64, v3.cols, v3.rows, v3.cellW, v3.cellH, 0);
  }, [stimulus.v3Heatmap, densityMode, decodeGridToPoints]);

  const fixationDensityPoints = useMemo(() => {
    if (stimulus.fixations.length === 0) return [];
    const cellSize = 2;
    const grid = new Map<string, number>();
    for (const f of stimulus.fixations) {
      if (excludedParticipants.has(f.participantId)) continue;
      const col = Math.floor(f.x / cellSize);
      const row = Math.floor(f.y / cellSize);
      const key = `${col},${row}`;
      grid.set(key, (grid.get(key) ?? 0) + 1);
    }
    let max = 0;
    for (const v of grid.values()) if (v > max) max = v;
    if (max === 0) return [];
    const points: Array<{ x: number; y: number; value: number }> = [];
    for (const [key, count] of grid) {
      const [c, r] = key.split(',').map(Number);
      points.push({ x: (c + 0.5) * cellSize, y: (r + 0.5) * cellSize, value: count / max });
    }
    return points;
  }, [stimulus.fixations, excludedParticipants]);

  const hasRealDensity = fixationDensityPoints.length > 0;

  const filteredHeatmapData = useMemo(() => {
    const src = stimulus.fixations.length > 0 ? stimulus.fixations : [];
    if (src.length === 0) return stimulus.heatmapData.map(p => ({ x: p.x, y: p.y, value: p.duration }));
    return src
      .filter(f => !excludedParticipants.has(f.participantId))
      .map(f => ({ x: f.x, y: f.y, value: f.duration }));
  }, [stimulus.fixations, stimulus.heatmapData, excludedParticipants]);

  const [shelfCompositeUrl, setShelfCompositeUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isShelf || resolvedShelfUrls.length === 0) return;
    const cols = stimulus.shelfItems ?? 5;
    const rows = stimulus.shelfCount ?? 2;
    let cancelled = false;
    Promise.all(resolvedShelfUrls.map(u => {
      const img = new window.Image();
      if (u.startsWith('http')) img.crossOrigin = 'anonymous';
      img.src = u;
      return new Promise<HTMLImageElement>(r => { img.onload = () => r(img); img.onerror = () => r(img); });
    })).then(images => {
      if (cancelled) return;
      const validImages = images.filter(i => i.naturalWidth > 0);
      if (validImages.length === 0) return;
      const cellW = validImages[0].naturalWidth;
      const cellH = validImages[0].naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = cols * cellW;
      canvas.height = rows * cellH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const totalCells = rows * cols;
      for (let i = 0; i < totalCells; i++) {
        const img = validImages[i % validImages.length];
        const col = i % cols;
        const row = Math.floor(i / cols);
        ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH);
      }
      setShelfCompositeUrl(canvas.toDataURL('image/jpeg', 0.85));
    });
    return () => { cancelled = true; };
  }, [isShelf, resolvedShelfUrls, stimulus.shelfItems, stimulus.shelfCount]);

  const effectiveStimulusUrl = isShelf && shelfCompositeUrl ? shelfCompositeUrl : stimulus.stimulusUrl;

  const handleDownload = useCallback(async () => {
    if (!imageContainerRef) return;
    try {
      const dataUrl = await toPng(imageContainerRef);
      const link = document.createElement('a');
      link.download = `eye-tracking-${stimulus.moduleName.replace(/\s+/g, '-').toLowerCase()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch { /* ignore download errors */ }
  }, [imageContainerRef, stimulus.moduleName]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Toolbar */}

      {/* Metrics bar */}
      <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 border-b border-gray-100">
        <MetricBadge
          icon={<Users className="h-4 w-4" />}
          label="Participantes"
          value={stimulus.uniqueParticipants}
        />
        <MetricBadge
          icon={<Eye className="h-4 w-4" />}
          label="Respuestas"
          value={stimulus.totalResponses}
        />
        <MetricBadge
          icon={<Clock className="h-4 w-4" />}
          label="Tiempo promedio"
          value={stimulus.avgDwellTime > 0 ? `${(stimulus.avgDwellTime / 1000).toFixed(1)}s` : '—'}
        />
        <MetricBadge
          icon={<Crosshair className="h-4 w-4" />}
          label="Fijaciones promedio"
          value={stimulus.avgFixationCount || '—'}
        />
      </div>

      {/* Quality summary + participant table */}
      {stimulus.qualitySummary && (
        <div className="border-b border-amber-100">
          <button
            type="button"
            onClick={() => setShowQualityTable(prev => !prev)}
            className="flex items-center gap-2 w-full px-4 py-2 bg-amber-50 text-xs hover:bg-amber-100 transition-colors"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span className="text-amber-700 flex-1 text-left">
              Quality gate: <span className="font-medium text-green-700">{stimulus.qualitySummary.good} good</span>
              {stimulus.qualitySummary.fair > 0 && <>, <span className="font-medium text-amber-700">{stimulus.qualitySummary.fair} fair</span></>}
              {stimulus.qualitySummary.low > 0 && <>, <span className="font-medium text-red-700">{stimulus.qualitySummary.low} excluded</span></>}
            </span>
            <span className="text-amber-500">{showQualityTable ? '▲' : '▼'}</span>
          </button>
          {showQualityTable && stimulus.participants.length > 0 && (
            <div className="px-4 py-3 bg-white overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1.5 pr-3 font-medium text-gray-600">Participant</th>
                    <th className="text-center py-1.5 px-2 font-medium text-gray-600">Grade</th>
                    <th className="text-center py-1.5 px-2 font-medium text-gray-600">Calibration</th>
                    <th className="text-center py-1.5 px-2 font-medium text-gray-600">RMSE</th>
                    <th className="text-center py-1.5 px-2 font-medium text-gray-600">Integrity</th>
                    <th className="text-center py-1.5 px-2 font-medium text-gray-600">Fixations</th>
                    <th className="text-center py-1.5 px-2 font-medium text-gray-600">Dwell</th>
                    <th className="text-center py-1.5 px-2 font-medium text-gray-600">
                      <label className="flex items-center justify-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={excludedParticipants.size === 0}
                          ref={el => { if (el) el.indeterminate = excludedParticipants.size > 0 && excludedParticipants.size < stimulus.participants.length; }}
                          onChange={() => {
                            setExcludedParticipants(prev =>
                              prev.size === 0
                                ? new Set(stimulus.participants.map(p => p.participantId))
                                : new Set()
                            );
                          }}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                        />
                        Include
                      </label>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stimulus.participants.map(p => {
                    const gradeColor = p.qualityGrade === 'good' ? 'text-green-700 bg-green-50' : p.qualityGrade === 'fair' ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50';
                    const isExcluded = excludedParticipants.has(p.participantId);
                    return (
                      <tr key={p.participantId} className={cn('border-b border-gray-100', isExcluded && 'opacity-40')}>
                        <td className="py-1.5 pr-3 text-gray-800 font-mono">{p.participantId.slice(0, 12)}</td>
                        <td className="text-center py-1.5 px-2">
                          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', gradeColor)}>{p.qualityGrade}</span>
                        </td>
                        <td className="text-center py-1.5 px-2 text-gray-500">{p.calibrationQuality}</td>
                        <td className="text-center py-1.5 px-2 text-gray-500">{p.calibrationRmsePx != null ? `${Math.round(p.calibrationRmsePx)}px` : '—'}</td>
                        <td className="text-center py-1.5 px-2 text-gray-500">{Math.round(p.integrityScore * 100)}%</td>
                        <td className="text-center py-1.5 px-2 text-gray-500">{p.totalFixations}</td>
                        <td className="text-center py-1.5 px-2 text-gray-500">{p.totalDwellTime.toFixed(1)}s</td>
                        <td className="text-center py-1.5 px-2">
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={() => {
                              setExcludedParticipants(prev => {
                                const next = new Set(prev);
                                if (next.has(p.participantId)) next.delete(p.participantId);
                                else next.add(p.participantId);
                                return next;
                              });
                            }}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Video quality metrics */}
      {stimulus.videoQuality && (
        <div className="grid grid-cols-3 gap-4 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
          <MetricBadge
            icon={<Film className="h-4 w-4" />}
            label="Completion"
            value={`${stimulus.videoQuality.completionRate}% (${stimulus.videoQuality.completed}/${stimulus.videoQuality.total})`}
          />
          <MetricBadge
            icon={<Signal className="h-4 w-4" />}
            label="Gaze Coverage"
            value={`${stimulus.videoQuality.gazeCoverage}%`}
          />
          <MetricBadge
            icon={<Clock className="h-4 w-4" />}
            label="Video Duration"
            value={`${stimulus.videoQuality.videoDurationS}s`}
          />
        </div>
      )}

      {stimulus.totalResponses > 0 && <>
      {/* View mode tabs + Download */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex gap-1 flex-wrap">
          <ViewModeTab
            active={viewMode === 'heatmap'}
            onClick={() => setViewMode('heatmap')}
            label="Mapa de calor"
          />
          {!isVideo && !isShelf && (
            <>
              <ViewModeTab
                active={viewMode === 'scanpath'}
                onClick={() => setViewMode('scanpath')}
                label="Scan Path"
              />
              <ViewModeTab
                active={viewMode === 'firstlook'}
                onClick={() => setViewMode('firstlook')}
                label="First Look"
              />
              <ViewModeTab
                active={viewMode === 'transparency'}
                onClick={() => setViewMode('transparency')}
                label="Transparency"
              />
            </>
          )}
          {stimulus.sequenceAnalysis && !isShelf && (
            <ViewModeTab
              active={viewMode === 'sequence'}
              onClick={() => setViewMode('sequence')}
              label="Sequence"
            />
          )}
          {!isVideo && !isShelf && (
            <ViewModeTab
              active={viewMode === 'image'}
              onClick={() => setViewMode('image')}
              label="Image"
            />
          )}
          {stimulus.emotions?.enabled && (
            <ViewModeTab
              active={viewMode === 'emotions'}
              onClick={() => setViewMode('emotions')}
              label="Emotions"
            />
          )}
          {isShelf && stimulus.aois.length > 0 && (
            <ViewModeTab
              active={viewMode === 'comparison'}
              onClick={() => setViewMode('comparison')}
              label="Comparativa"
            />
          )}
          {!isShelf && (
            <ViewModeTab
              active={viewMode === 'prediction'}
              onClick={() => setViewMode('prediction')}
              label="Prediction"
            />
          )}
          {stimulus.stimulusType === 'video' && stimulus.gazeTimeline && stimulus.gazeTimeline.length > 0 && (
            <ViewModeTab
              active={viewMode === 'video'}
              onClick={() => setViewMode('video')}
              label="Video Gaze"
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {stimulus.stimulusUrl && (
            <button
              onClick={() => setShowAoiModal(true)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              title="Draw and view AOI metrics"
            >
              <PenTool className="h-3.5 w-3.5" />
              AOI{stimulus.aois.length > 0 ? ` (${stimulus.aois.length})` : ''}
            </button>
          )}
          {stimulus.stimulusUrl && (
            <button
              onClick={handleDownload}
              className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
              title="Download image"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Stimulus image / heatmap / emotions / prediction */}
      <div className="px-5 pb-4">
        <div
          className="mx-auto"
          style={stimulusSize
            ? { width: stimulusSize.width }
            : undefined}
        >
        {viewMode === 'density' && stimulus.stimulusUrl ? (
          <div ref={setImageContainerRef} className="w-full relative">
            {hasRealDensity ? (
              <>
                <HeatmapRenderer
                  imageUrl={effectiveStimulusUrl}
                  data={fixationDensityPoints}
                  coordSystem="percent"
                  blur={heatmapSettings.blur}
                  opacity={heatmapSettings.opacity}
                  threshold={heatmapSettings.threshold}
                  className="w-full"
                />
                <div className="mt-2 text-xs text-gray-400">
                  Fixation density · {stimulus.fixations.length - [...excludedParticipants].reduce((n, pid) => n + stimulus.fixations.filter(f => f.participantId === pid).length, 0)} fixations · {stimulus.uniqueParticipants - excludedParticipants.size} participants
                </div>
              </>
            ) : hasV3 ? (
              <>
                {hasV3Temporal && (
                  <div className="flex items-center gap-1 mb-3">
                    {(['density', 'firstlook', 'peak'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setDensityMode(mode)}
                        className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                          densityMode === mode
                            ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                            : 'bg-white border-gray-200 text-slate-500 hover:bg-gray-50'
                        }`}
                      >
                        {mode === 'density' ? 'Density' : mode === 'firstlook' ? 'First Look' : 'Peak Time'}
                      </button>
                    ))}
                  </div>
                )}
                <HeatmapRenderer
                  imageUrl={effectiveStimulusUrl}
                  data={densityMode === 'density' || !hasV3Temporal ? v3HeatmapPoints : v3TemporalPoints}
                  coordSystem="percent"
                  blur={heatmapSettings.blur}
                  opacity={heatmapSettings.opacity}
                  threshold={heatmapSettings.threshold}
                  className="w-full"
                />
                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span>
                    V3 {densityMode === 'density' ? 'probabilistic' : densityMode === 'firstlook' ? 'first look (temporal)' : 'peak attention (temporal)'}
                    {' · '}{stimulus.v3Heatmap!.participantCount} participant{stimulus.v3Heatmap!.participantCount !== 1 ? 's' : ''}
                    · confidence {(stimulus.v3Heatmap!.avgConfidence * 100).toFixed(0)}%
                  </span>
                  <span>
                    {stimulus.v3Heatmap!.totalMassS.toFixed(1)}s total · coverage {(stimulus.v3Heatmap!.avgSpatialCoverage * 100).toFixed(0)}%
                  </span>
                </div>
                {stimulus.v3Heatmap!.aoiMetrics.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Probabilistic AOI Attention</h4>
                    {stimulus.v3Heatmap!.aoiMetrics.map(aoi => (
                      <div key={aoi.aoiId} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                        <span className="font-medium text-gray-700">{aoi.label}</span>
                        <div className="flex gap-4 text-xs text-gray-500">
                          <span>{aoi.totalDwellS.toFixed(1)}s dwell</span>
                          <span>{(aoi.avgAttentionShare * 100).toFixed(0)}% share</span>
                          {aoi.earliestFirstAttentionMs !== null && (
                            <span>TTFA {(aoi.earliestFirstAttentionMs / 1000).toFixed(1)}s</span>
                          )}
                          <span>{aoi.participantCount} participant{aoi.participantCount !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg bg-gray-100 border border-gray-200 h-64 flex items-center justify-center">
                <p className="text-sm text-gray-400">No density data available</p>
              </div>
            )}
          </div>
        ) : viewMode === 'sequence' && stimulus.sequenceAnalysis ? (
          <SequencePanel sequenceAnalysis={stimulus.sequenceAnalysis} />
        ) : viewMode === 'transparency' && stimulus.stimulusUrl ? (
          <TransparencyMap imageUrl={effectiveStimulusUrl} fixations={stimulus.fixations} excludedParticipants={excludedParticipants} />
        ) : viewMode === 'firstlook' && stimulus.stimulusUrl ? (
          <FirstLookOverlay imageUrl={effectiveStimulusUrl} fixations={stimulus.fixations} excludedParticipants={excludedParticipants} />
        ) : viewMode === 'scanpath' && stimulus.stimulusUrl ? (
          <ScanpathOverlay
            imageUrl={effectiveStimulusUrl}
            fixations={stimulus.fixations.filter(f => !excludedParticipants.has(f.participantId))}
          />
        ) : viewMode === 'comparison' && stimulus.aois.length > 0 ? (
          <ShelfComparison aois={stimulus.aois} shelfUrls={resolvedShelfUrls} />
        ) : viewMode === 'video' && stimulus.gazeTimeline ? (
          <VideoGazePlayer videoUrl={stimulus.stimulusUrl} gazeTimeline={stimulus.gazeTimeline} />
        ) : viewMode === 'emotions' ? (
          <EmotionPanel emotions={stimulus.emotions} />
        ) : viewMode === 'prediction' ? (
          <PredictionPanel stimulus={stimulus} researchId={researchId} onPredictionComplete={onRefresh} displayImageUrl={effectiveStimulusUrl} />
        ) : stimulus.stimulusUrl ? (
          <div ref={setImageContainerRef} className="w-full relative">
            {viewMode === 'heatmap' && hasHeatData ? (
              filteredHeatmapData.length > 0 ? (
                <>
                  <HeatmapRenderer
                    imageUrl={effectiveStimulusUrl}
                    data={filteredHeatmapData}
                    coordSystem="percent"
                    blur={heatmapSettings.blur}
                    opacity={heatmapSettings.opacity}
                    threshold={heatmapSettings.threshold}
                    className="w-full h-full"
                    canvasClassName="w-full h-full block object-contain"
                  />
                  {heatmapSettings.darkOverlay > 0 && (
                    <div className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: heatmapSettings.darkOverlay / 100 }} />
                  )}
                </>
              ) : hasZoneMass ? (
                <ZoneHeatmapOverlay imageUrl={effectiveStimulusUrl} zoneMass={stimulus.zoneMass!} />
              ) : null
            ) : (
              <div className="rounded-lg overflow-hidden border bg-gray-100 relative">
                <img
                  src={effectiveStimulusUrl}
                  alt={stimulus.moduleName}
                  className="w-full h-full object-contain block"
                />
                {stimulus.aois.length > 0 && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {stimulus.aois.map((aoi) => (
                      <g key={aoi.id}>
                        <rect x={aoi.x} y={aoi.y} width={aoi.width} height={aoi.height} fill="none" stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="1.5 1" />
                        <text x={aoi.x + 0.5} y={aoi.y + 2.5} fontSize="2.2" fill="#3b82f6" fontWeight="600">{aoi.label}</text>
                      </g>
                    ))}
                  </svg>
                )}
              </div>
            )}
            {stimulus.aois.length > 0 && viewMode === 'heatmap' && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                {stimulus.aois.map((aoi) => (
                  <g key={aoi.id}>
                    <rect x={aoi.x} y={aoi.y} width={aoi.width} height={aoi.height} fill="none" stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="1.5 1" />
                    <text x={aoi.x + 0.5} y={aoi.y + 2.5} fontSize="2.2" fill="#3b82f6" fontWeight="600">{aoi.label}</text>
                  </g>
                ))}
              </svg>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-gray-100 border border-gray-200 h-64 flex items-center justify-center">
            <div className="text-center">
              <Image className="h-10 w-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No stimulus image configured</p>
            </div>
          </div>
        )}
        </div>

        {viewMode === 'heatmap' && hasHeatData && (
          <div className="flex items-center gap-6 mt-3 px-1">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Opacidad
              <input type="range" min={10} max={100} value={heatmapSettings.opacity}
                onChange={e => setHeatmapSettings(prev => ({ ...prev, opacity: Number(e.target.value) }))}
                className="w-20 h-1 accent-red-500" />
              <span className="w-6 text-right">{heatmapSettings.opacity}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Blur / suavizado
              <input type="range" min={1} max={40} value={heatmapSettings.blur}
                onChange={e => setHeatmapSettings(prev => ({ ...prev, blur: Number(e.target.value) }))}
                className="w-20 h-1 accent-green-500" />
              <span className="w-6 text-right">{heatmapSettings.blur}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Exposición / intensidad
              <input type="range" min={1} max={80} value={heatmapSettings.threshold}
                onChange={e => setHeatmapSettings(prev => ({ ...prev, threshold: Number(e.target.value) }))}
                className="w-20 h-1 accent-blue-500" />
              <span className="w-6 text-right">{heatmapSettings.threshold}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Capa negra
              <input type="range" min={0} max={80} value={heatmapSettings.darkOverlay}
                onChange={e => setHeatmapSettings(prev => ({ ...prev, darkOverlay: Number(e.target.value) }))}
                className="w-20 h-1 accent-blue-800" />
              <span className="w-6 text-right">{heatmapSettings.darkOverlay}</span>
            </label>
          </div>
        )}
      </div>
      </>}

      {stimulus.totalResponses === 0 && (
        <div className="px-5 pb-5">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-sm font-semibold text-gray-700 mb-1">Sin respuestas aún</p>
            <p className="text-[13px] text-gray-400">Comparte el enlace del estudio para comenzar a recopilar datos.</p>
          </div>
        </div>
      )}


      {/* Heatmap settings modal */}
      {showSettings && stimulus.stimulusUrl && (
        <HeatmapSettingsModal
          imageUrl={effectiveStimulusUrl}
          heatmapData={filteredHeatmapData}
          settings={heatmapSettings}
          coordSystem="percent"
          onApply={setHeatmapSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* AOI draw + metrics modal */}
      {showAoiModal && (
        <AoiModal
          stimulus={stimulus}
          displayImageUrl={effectiveStimulusUrl}
          onClose={() => setShowAoiModal(false)}
          onSave={onRefresh}
        />
      )}
    </div>
  );
};

// ─── AOI Modal ──────────────────────────────────────────────────

function AoiModal({ stimulus, displayImageUrl, onClose, onSave }: {
  stimulus: EyeTrackingStimulus & { stimulusUrl: string };
  displayImageUrl?: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const drawableAois: AOI[] = stimulus.aois.map(a => ({
    id: a.id, label: a.label, x: a.x, y: a.y, width: a.width, height: a.height,
  }));
  const [aois, setAois] = useState<AOI[]>(drawableAois);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await modulesService.getById(stimulus.moduleId);
      const mod = res.module;
      const config = typeof mod.config === 'string' ? JSON.parse(mod.config) : (mod.config || {});
      const comps = config.structure?.components || [];
      const aoiComp = comps.find((c: { id: string }) => c.id === 'aois');
      if (aoiComp) {
        aoiComp.value = JSON.stringify(aois);
      } else {
        comps.push({ id: 'aois', type: 'hidden', label: 'AOIs', value: JSON.stringify(aois), order: 99, hidden: true });
      }
      await modulesService.update(stimulus.moduleId, { config });
      onSave();
      handleClose();
    } catch {
      console.error('Failed to save AOIs');
    } finally {
      setSaving(false);
    }
  }, [aois, stimulus.moduleId, onSave, handleClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-colors duration-200 ${visible ? 'bg-black/40' : 'bg-black/0'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-white rounded-xl shadow-lg w-[90vw] max-w-4xl max-h-[85vh] flex flex-col transition-all duration-200 ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <PenTool className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">Areas of Interest</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save AOIs'}
            </button>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {(displayImageUrl || stimulus.stimulusUrl) && (
            <AOIDrawer
              imageUrl={displayImageUrl || stimulus.stimulusUrl}
              aois={aois}
              onChange={setAois}
              maxHeight={400}
            />
          )}
          {aois.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-semibold text-gray-700">Métricas</h4>
              {aois.map((aoi, idx) => {
                const original = stimulus.aois.find(a => a.id === aoi.id);
                const merged = original ? { ...original, ...aoi } : { ...aoi, dwellTimePercent: 0, fixationCount: 0, avgDuration: 0, participantCount: 0 };
                return <AOIRow key={aoi.id} aoi={merged} index={idx} stimulusUrl={displayImageUrl || stimulus.stimulusUrl} />;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ShelfComparison({ aois, shelfUrls }: { aois: EyeTrackingAOI[]; shelfUrls: string[] }) {
  const sorted = [...aois].sort((a, b) => b.dwellTimePercent - a.dwellTimePercent);
  const maxDwell = Math.max(...sorted.map(a => a.dwellTimePercent), 1);

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3">Comparativa por producto</h4>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((aoi, idx) => {
          const imgUrl = shelfUrls[idx % shelfUrls.length];
          const isWinner = idx === 0 && aoi.dwellTimePercent > 0;
          return (
            <div key={aoi.id} className={`rounded-lg border p-3 ${isWinner ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
              {imgUrl && (
                <img src={imgUrl} alt={aoi.label} className="w-full h-20 object-contain rounded mb-2" />
              )}
              <p className="text-xs font-semibold text-gray-900 truncate mb-2">{aoi.label}</p>
              <div className="w-full h-2 bg-gray-100 rounded-full mb-2">
                <div className={`h-2 rounded-full ${isWinner ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${(aoi.dwellTimePercent / maxDwell) * 100}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div>
                  <span className="text-gray-400">% AOI</span>
                  <p className="font-semibold text-gray-800">{aoi.dwellTimePercent.toFixed(1)}%</p>
                </div>
                <div>
                  <span className="text-gray-400">Fijaciones</span>
                  <p className="font-semibold text-gray-800">{aoi.fixationCount}</p>
                </div>
                <div>
                  <span className="text-gray-400">Duración</span>
                  <p className="font-semibold text-gray-800">{(aoi.avgDuration / 1000).toFixed(1)}s</p>
                </div>
                <div>
                  <span className="text-gray-400">Participantes</span>
                  <p className="font-semibold text-gray-800">{aoi.participantCount}</p>
                </div>
                {aoi.avgTTFF !== undefined && (
                  <div>
                    <span className="text-gray-400">1ra fijación</span>
                    <p className="font-semibold text-gray-800">{(aoi.avgTTFF / 1000).toFixed(1)}s</p>
                  </div>
                )}
                {aoi.noticeRate !== undefined && (
                  <div>
                    <span className="text-gray-400">Notado</span>
                    <p className="font-semibold text-gray-800">{aoi.noticeRate.toFixed(0)}%</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
