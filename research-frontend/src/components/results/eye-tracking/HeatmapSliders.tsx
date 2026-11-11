import type { Dispatch, SetStateAction } from 'react';
import type { HeatmapSettings } from './HeatmapSettingsModal';

interface HeatmapSlidersProps {
  readonly settings: HeatmapSettings;
  readonly onChange: Dispatch<SetStateAction<HeatmapSettings>>;
}

export function HeatmapSliders({ settings, onChange }: HeatmapSlidersProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 px-1">
      <label className="flex items-center gap-2 text-xs text-gray-500">
        Opacidad
        <input type="range" min={10} max={100} value={settings.opacity}
          onChange={e => onChange(prev => ({ ...prev, opacity: Number(e.target.value) }))}
          className="w-20 h-1 accent-red-500" />
        <span className="w-6 text-right">{settings.opacity}</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-500">
        Blur / suavizado
        <input type="range" min={1} max={40} value={settings.blur}
          onChange={e => onChange(prev => ({ ...prev, blur: Number(e.target.value) }))}
          className="w-20 h-1 accent-green-500" />
        <span className="w-6 text-right">{settings.blur}</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-500">
        Exposición / intensidad
        <input type="range" min={1} max={80} value={settings.threshold}
          onChange={e => onChange(prev => ({ ...prev, threshold: Number(e.target.value) }))}
          className="w-20 h-1 accent-blue-500" />
        <span className="w-6 text-right">{settings.threshold}</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-500">
        Capa negra
        <input type="range" min={0} max={80} value={settings.darkOverlay}
          onChange={e => onChange(prev => ({ ...prev, darkOverlay: Number(e.target.value) }))}
          className="w-20 h-1 accent-blue-800" />
        <span className="w-6 text-right">{settings.darkOverlay}</span>
      </label>
    </div>
  );
}
