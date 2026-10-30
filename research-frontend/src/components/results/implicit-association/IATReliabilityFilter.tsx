import { cn } from '../../../lib/utils';
import type { IATResponseQuality, IATResponseQualityLevel } from '../../../services/analytics.service';

const QUALITY_LABELS: Record<IATResponseQualityLevel, string> = {
  reliable: 'fiables',
  same_choice: 'siempre la misma respuesta',
  too_fast: 'demasiado rápidas',
};

const QUALITY_RULES = 'Siempre la misma respuesta: 95 % o más de elecciones iguales. Demasiado rápidas: más del 30 % de respuestas en menos de 300 ms.';

interface IATReliabilityFilterProps {
  qualities: readonly IATResponseQuality[];
  isReliableOnly: boolean;
  onChange: (isReliableOnly: boolean) => void;
}

export function IATReliabilityFilter({ qualities, isReliableOnly, onChange }: IATReliabilityFilterProps) {
  const countOf = (level: IATResponseQualityLevel) => qualities.filter((q) => q.quality === level).length;
  const reliableCount = countOf('reliable');
  const options = [
    { isReliableOnly: false, label: `Todos (${qualities.length})` },
    { isReliableOnly: true, label: `Solo fiables (${reliableCount})` },
  ];
  const summary = (Object.keys(QUALITY_LABELS) as IATResponseQualityLevel[])
    .map((level) => `${countOf(level)} ${QUALITY_LABELS[level]}`)
    .join(' · ');

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="flex items-center gap-1" role="group" aria-label="Filtrar por fiabilidad">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={option.isReliableOnly === isReliableOnly}
            onClick={() => onChange(option.isReliableOnly)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap',
              option.isReliableOnly === isReliableOnly ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500" title={QUALITY_RULES}>
        Fiabilidad: {summary} · se muestran {isReliableOnly ? reliableCount : qualities.length} de {qualities.length}
      </p>
    </div>
  );
}
