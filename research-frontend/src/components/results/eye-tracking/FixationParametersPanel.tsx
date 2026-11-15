import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { FixationParameters } from '../../../services/analytics.service';
import { cn } from '../../../lib/utils';

const DEFAULT_FIXATION_PARAMETERS: FixationParameters = {
  windowStartS: 0,
  windowEndS: null,
  minDurationMs: 120,
  maxDurationMs: null,
  maxDispersionPercent: 6,
  mergeRangePercent: 0,
};

interface ParameterField {
  readonly key: keyof FixationParameters;
  readonly label: string;
  readonly help: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly emptyLabel?: string;
}

const PARAMETER_FIELDS: readonly ParameterField[] = [
  { key: 'windowStartS', label: 'Ventana de análisis: desde (s)', help: 'Ignora las fijaciones anteriores a este segundo de exposición.', min: 0, max: 120, step: 0.5 },
  { key: 'windowEndS', label: 'Ventana de análisis: hasta (s)', help: 'Ignora las fijaciones posteriores a este segundo. Vacío = hasta el final.', min: 0, max: 120, step: 0.5, emptyLabel: 'Final' },
  { key: 'minDurationMs', label: 'Duración mínima de fijación (ms)', help: 'Fijaciones más cortas se descartan. Bajo ~100 ms suele ser movimiento del ojo, no una mirada.', min: 0, max: 1000, step: 10 },
  { key: 'maxDurationMs', label: 'Duración máxima de fijación (ms)', help: 'Fijaciones más largas se descartan (mirada perdida, distracción). Vacío = sin límite.', min: 100, max: 5000, step: 50, emptyLabel: 'Sin límite' },
  { key: 'maxDispersionPercent', label: 'Dispersión máxima (% del estímulo)', help: 'Cuánto puede moverse la mirada y seguir contando como una sola fijación. Recalcula las fijaciones desde la mirada cruda.', min: 1, max: 20, step: 0.5 },
  { key: 'mergeRangePercent', label: 'Rango de fusión (% del estímulo)', help: 'Une fijaciones seguidas que caen a menos de esta distancia. 0 = no unir.', min: 0, max: 15, step: 0.5 },
];

interface FixationParametersPanelProps {
  readonly parameters: FixationParameters | null;
  readonly onApply: (parameters: FixationParameters | null) => void;
}

export function FixationParametersPanel({ parameters, onApply }: FixationParametersPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<FixationParameters>(parameters ?? DEFAULT_FIXATION_PARAMETERS);

  const updateDraft = (key: keyof FixationParameters, raw: string, emptyLabel?: string) =>
    setDraft(previous => ({ ...previous, [key]: raw === '' && emptyLabel ? null : Number(raw) }));

  return (
    <div className="mt-3 rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setIsOpen(previous => !previous)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-gray-600"
      >
        <span className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Parámetros de fijación
          <span className={cn('rounded px-1.5 py-0.5 text-[10px]', parameters ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500')}>
            {parameters ? 'Personalizados' : 'Originales de la sesión'}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-3 py-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {PARAMETER_FIELDS.map(field => {
              const value = draft[field.key];
              return (
                <label key={field.key} className="flex w-64 flex-col gap-1 text-xs text-gray-500" title={field.help}>
                  {field.label}
                  <span className="flex items-center gap-2">
                    <input
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={value ?? field.max}
                      onChange={event => updateDraft(field.key, event.target.value)}
                      className="h-1 flex-1 accent-blue-600"
                    />
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={value ?? ''}
                      placeholder={field.emptyLabel}
                      onChange={event => updateDraft(field.key, event.target.value, field.emptyLabel)}
                      aria-label={field.label}
                      className="w-20 rounded border border-gray-200 px-1.5 py-0.5 text-right text-gray-700"
                    />
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">
            Afecta al heatmap, recorrido, primera mirada, replay, AOI y emociones por AOI. Las respuestas antiguas sin mirada cruda solo se filtran por ventana y duración. El blur y la capa negra se ajustan en los controles del heatmap.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => onApply(draft)} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
              Aplicar
            </button>
            <button type="button" onClick={() => { setDraft(parameters ?? DEFAULT_FIXATION_PARAMETERS); setIsOpen(false); }} className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="button" onClick={() => { setDraft(DEFAULT_FIXATION_PARAMETERS); onApply(null); }} className="ml-auto text-xs text-gray-500 underline hover:text-gray-700">
              Volver a las fijaciones originales
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
