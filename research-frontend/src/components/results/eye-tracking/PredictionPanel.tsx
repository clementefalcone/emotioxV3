import { useState, useCallback } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { DEFAULT_HEATMAP_SETTINGS } from './HeatmapSettingsModal';
import { HeatmapRenderer } from '../cognitive-task/components/HeatmapRenderer';
import { mediaService } from '../../../services/media.service';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';

export const PredictionPanel = ({
  stimulus,
  researchId,
  onPredictionComplete,
  displayImageUrl,
}: {
  stimulus: EyeTrackingStimulus & { stimulusUrl: string };
  researchId: string;
  onPredictionComplete: () => void;
  displayImageUrl?: string;
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settings, setSettings] = useState({ ...DEFAULT_HEATMAP_SETTINGS, opacity: 75, blur: 14, threshold: 40, darkOverlay: 0 });

  const handleRunPrediction = useCallback(async () => {
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      await mediaService.predictModuleAttention(researchId, stimulus.moduleId);
      onPredictionComplete();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Prediction failed');
    } finally {
      setIsProcessing(false);
    }
  }, [researchId, stimulus.moduleId, onPredictionComplete]);

  if (stimulus.predictionHeatmap && stimulus.predictionHeatmap.length > 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400">
            {stimulus.predictionHeatmap.length.toLocaleString()} saliency points
            {stimulus.predictionProcessedAt && ` \u00b7 ${new Date(stimulus.predictionProcessedAt).toLocaleDateString()}`}
          </p>
          <button
            onClick={handleRunPrediction}
            disabled={isProcessing}
            className="text-xs text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Re-run prediction'}
          </button>
        </div>
        <div className="relative">
          <HeatmapRenderer
            imageUrl={displayImageUrl || stimulus.stimulusUrl}
            data={stimulus.predictionHeatmap.map(p => ({ x: p.x, y: p.y, value: p.value }))}
            blur={settings.blur}
            opacity={settings.opacity}
            threshold={settings.threshold}
            darkOverlay={settings.darkOverlay}
            className="w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Opacidad
            <input type="range" min={10} max={100} value={settings.opacity}
              onChange={e => setSettings(prev => ({ ...prev, opacity: Number(e.target.value) }))}
              className="w-20 h-1 accent-red-500" />
            <span className="w-6 text-right">{settings.opacity}</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Blur / suavizado
            <input type="range" min={1} max={40} value={settings.blur}
              onChange={e => setSettings(prev => ({ ...prev, blur: Number(e.target.value) }))}
              className="w-20 h-1 accent-green-500" />
            <span className="w-6 text-right">{settings.blur}</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Exposición / intensidad
            <input type="range" min={1} max={80} value={settings.threshold}
              onChange={e => setSettings(prev => ({ ...prev, threshold: Number(e.target.value) }))}
              className="w-20 h-1 accent-blue-500" />
            <span className="w-6 text-right">{settings.threshold}</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Capa negra
            <input type="range" min={0} max={80} value={settings.darkOverlay}
              onChange={e => setSettings(prev => ({ ...prev, darkOverlay: Number(e.target.value) }))}
              className="w-20 h-1 accent-blue-800" />
            <span className="w-6 text-right">{settings.darkOverlay}</span>
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
      <Sparkles className="h-8 w-8 text-gray-300 mx-auto mb-3" />
      <p className="text-sm text-gray-600 mb-4">
        Run TranSalNet attention prediction to see where viewers are likely to look.
      </p>
      <button
        onClick={handleRunPrediction}
        disabled={isProcessing || !stimulus.stimulusUrl}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Run Prediction
          </>
        )}
      </button>
      {errorMsg && (
        <p className="text-xs text-red-500 mt-3">{errorMsg}</p>
      )}
    </div>
  );
};
