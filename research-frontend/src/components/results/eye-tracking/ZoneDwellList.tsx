export interface ZoneDwellRow {
  readonly zoneId: string;
  readonly label: string;
  readonly dwellMs: number;
  readonly detail: string;
  readonly isActive: boolean;
}

interface ZoneDwellListProps {
  readonly title: string;
  readonly rows: readonly ZoneDwellRow[];
}

export function ZoneDwellList({ title, rows }: ZoneDwellListProps) {
  const maxDwellMs = Math.max(1, ...rows.map(row => row.dwellMs));

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h4>
      {rows.map(row => (
        <div
          key={row.zoneId}
          className={`flex items-center gap-3 rounded px-3 py-1.5 text-sm ${row.isActive ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-gray-50'}`}
        >
          <span className={`w-40 truncate ${row.isActive ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>{row.label}</span>
          <div className="flex-1 h-2 rounded-full bg-gray-200">
            <div className="h-2 rounded-full bg-blue-500" style={{ width: `${(row.dwellMs / maxDwellMs) * 100}%` }} />
          </div>
          <span className="w-14 text-right font-mono text-xs text-gray-600">{(row.dwellMs / 1000).toFixed(1)} s</span>
          <span className="w-36 text-right text-xs text-gray-400">{row.detail}</span>
        </div>
      ))}
    </div>
  );
}
