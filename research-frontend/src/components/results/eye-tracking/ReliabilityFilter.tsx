import { cn } from '../../../lib/utils';

type QualityGrade = 'good' | 'fair' | 'low';

interface ReliabilityParticipant {
  participantId: string;
  qualityGrade: QualityGrade;
}

const RELIABILITY_FILTERS: ReadonlyArray<{ id: string; label: string; accepts: (grade: QualityGrade) => boolean }> = [
  { id: 'all', label: 'Todos', accepts: () => true },
  { id: 'fair', label: 'Regular o mejor', accepts: (grade) => grade !== 'low' },
  { id: 'good', label: 'Solo buena', accepts: (grade) => grade === 'good' },
];

interface ReliabilityFilterProps {
  participants: readonly ReliabilityParticipant[];
  excludedParticipants: ReadonlySet<string>;
  onChange: (excluded: Set<string>) => void;
}

const excludedBy = (participants: readonly ReliabilityParticipant[], accepts: (grade: QualityGrade) => boolean): Set<string> =>
  new Set(participants.filter((p) => !accepts(p.qualityGrade)).map((p) => p.participantId));

const isSameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));

export function ReliabilityFilter({ participants, excludedParticipants, onChange }: ReliabilityFilterProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filtrar por fiabilidad">
      {RELIABILITY_FILTERS.map((filter) => {
        const excluded = excludedBy(participants, filter.accepts);
        const isActive = isSameSet(excluded, excludedParticipants);
        return (
          <button
            key={filter.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(excluded)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap',
              isActive ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100',
            )}
          >
            {filter.label} ({participants.length - excluded.size})
          </button>
        );
      })}
    </div>
  );
}
