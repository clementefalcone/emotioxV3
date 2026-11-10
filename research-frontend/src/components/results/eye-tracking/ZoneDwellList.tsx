import type { ReplayZone, ZoneDwell } from './gazeReplay';

interface ZoneDwellListProps {
  readonly zones: readonly ReplayZone[];
  readonly dwellByZone: ReadonlyMap<string, ZoneDwell>;
  readonly activeZoneId: string | null;
}

export function ZoneDwellList({ zones, dwellByZone, activeZoneId }: ZoneDwellListProps) {
  const maxDwellMs = Math.max(1, ...[...dwellByZone.values()].map(dwell => dwell.dwellMs));

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tiempo de fijación por zona hasta este momento</h4>
      {zones.map(zone => {
        const dwell = dwellByZone.get(zone.id) ?? { dwellMs: 0, firstEntryMs: null };
        const isActive = zone.id === activeZoneId;
        return (
          <div
            key={zone.id}
            className={`flex items-center gap-3 rounded px-3 py-1.5 text-sm ${isActive ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-gray-50'}`}
          >
            <span className={`w-40 truncate ${isActive ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>{zone.label}</span>
            <div className="flex-1 h-2 rounded-full bg-gray-200">
              <div className="h-2 rounded-full bg-blue-500" style={{ width: `${(dwell.dwellMs / maxDwellMs) * 100}%` }} />
            </div>
            <span className="w-14 text-right font-mono text-xs text-gray-600">{(dwell.dwellMs / 1000).toFixed(1)} s</span>
            <span className="w-28 text-right text-xs text-gray-400">
              {dwell.firstEntryMs === null ? 'sin mirar' : `entra a ${(dwell.firstEntryMs / 1000).toFixed(1)} s`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
