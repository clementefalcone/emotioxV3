import { useMemo } from 'react';
import type { EyeTrackingStimulus } from '../../../services/analytics.service';
import { formatParticipantLabel } from './participantLabel';

const SEQUENCE_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

export const SequencePanel = ({
  sequenceAnalysis,
}: {
  sequenceAnalysis: NonNullable<EyeTrackingStimulus['sequenceAnalysis']>;
}) => {
  const { participantSequences, transitionMatrix, aoiLabels } = sequenceAnalysis;
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    aoiLabels.forEach((label, i) => { map[label] = SEQUENCE_COLORS[i % SEQUENCE_COLORS.length]; });
    return map;
  }, [aoiLabels]);

  return (
    <div className="space-y-6">
      {/* Transition Matrix */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Transition Probabilities</h4>
        <p className="text-xs text-gray-400 mb-2">
          Rows = "from" AOI, columns = "to" AOI. Values = % of transitions.
        </p>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left text-gray-500 font-medium">From \ To</th>
                {aoiLabels.map(label => (
                  <th key={label} className="px-2 py-1.5 text-center font-medium" style={{ color: colorMap[label] }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {aoiLabels.map(from => (
                <tr key={from}>
                  <td className="px-2 py-1.5 font-medium" style={{ color: colorMap[from] }}>{from}</td>
                  {aoiLabels.map(to => {
                    const pct = transitionMatrix[from]?.[to] ?? 0;
                    const intensity = pct / 100;
                    const bgAlpha = Math.max(0.03, intensity * 0.6);
                    return (
                      <td
                        key={to}
                        className="px-2 py-1.5 text-center border border-gray-100"
                        style={{
                          backgroundColor: from === to
                            ? `rgba(156, 163, 175, ${bgAlpha})`
                            : `rgba(59, 130, 246, ${bgAlpha})`,
                        }}
                      >
                        <span className={`font-semibold ${pct > 30 ? 'text-blue-800' : pct > 10 ? 'text-gray-700' : 'text-gray-400'}`}>
                          {pct > 0 ? `${pct}%` : '—'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-participant sequences */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">
          Exploration Sequences ({participantSequences.length} participants)
        </h4>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {participantSequences.map(ps => (
            <div key={ps.participantId} className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-gray-400 w-24 truncate shrink-0" title={ps.participantId}>
                {formatParticipantLabel(ps.participantId)}
              </span>
              <div className="flex items-center gap-0.5 flex-wrap">
                {ps.sequence.map((aoi, i) => (
                  <span key={i} className="flex items-center gap-0.5">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
                      style={{ backgroundColor: colorMap[aoi] || '#6B7280' }}
                    >
                      {aoi}
                    </span>
                    {i < ps.sequence.length - 1 && (
                      <span className="text-[10px] text-gray-300">&rarr;</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Most common sequence */}
      {participantSequences.length >= 3 && (() => {
        const seqStrings = participantSequences.map(ps => ps.sequence.join('\u2192'));
        const counts: Record<string, number> = {};
        for (const s of seqStrings) counts[s] = (counts[s] || 0) + 1;
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const top3 = sorted.slice(0, 3);
        if (top3.length === 0) return null;
        return (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Most Common Patterns</h4>
            <div className="space-y-1">
              {top3.map(([seq, count], i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-500 w-6">#{i + 1}</span>
                  <div className="flex items-center gap-0.5">
                    {seq.split('\u2192').map((aoi, j) => (
                      <span key={j} className="flex items-center gap-0.5">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
                          style={{ backgroundColor: colorMap[aoi] || '#6B7280' }}
                        >
                          {aoi}
                        </span>
                        {j < seq.split('\u2192').length - 1 && <span className="text-[10px] text-gray-300">&rarr;</span>}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-gray-400">
                    {count} participant{count !== 1 ? 's' : ''} ({Math.round((count / participantSequences.length) * 100)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
