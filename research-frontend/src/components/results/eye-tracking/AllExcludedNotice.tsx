import { ShieldAlert } from 'lucide-react';

interface AllExcludedNoticeProps {
  participantCount: number;
  onIncludeAll: () => void;
}

export function AllExcludedNotice({ participantCount, onIncludeAll }: AllExcludedNoticeProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border-b border-red-100">
      <ShieldAlert className="h-4 w-4 text-red-600 shrink-0" />
      <p className="flex-1 text-sm text-red-800">
        Los {participantCount} participantes quedaron fuera del filtro de fiabilidad, por eso las visualizaciones están vacías.
      </p>
      <button
        type="button"
        onClick={onIncludeAll}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-100 transition-colors whitespace-nowrap"
      >
        Incluir todos
      </button>
    </div>
  );
}
