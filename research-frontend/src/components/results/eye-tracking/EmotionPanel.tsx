import { useMemo } from 'react';
import { SmilePlus } from 'lucide-react';
import type { EmotionAggregation, EkmanEmotion } from '../../../services/analytics.service';
import { EMOTION_COLORS, EMOTION_LABELS } from './shared';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';

const EmotionDistributionChart = ({ distribution }: { distribution: Record<EkmanEmotion, number> }) => {
  const sorted = useMemo(() =>
    (Object.entries(distribution) as [EkmanEmotion, number][])
      .sort((a, b) => b[1] - a[1]),
    [distribution],
  );
  const maxPct = Math.max(...sorted.map(([, v]) => v), 1);

  return (
    <div className="space-y-2">
      {sorted.map(([emotion, pct]) => {
        const colors = EMOTION_COLORS[emotion];
        return (
          <div key={emotion} className="flex items-center gap-3">
            <span className={`text-xs font-medium w-16 text-right ${colors.text}`}>
              {EMOTION_LABELS[emotion]}
            </span>
            <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${colors.bar}`}
                style={{ width: `${(pct / maxPct) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-700 w-12">{pct.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
};

const EmotionTimeline = ({ timeline }: { timeline: EmotionAggregation['timeline'] }) => {
  if (timeline.length === 0) return null;

  const maxTs = timeline[timeline.length - 1].timestamp;
  const cellWidth = Math.max(100 / timeline.length, 2);

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2">Emotion Timeline</h4>
      <div className="flex gap-px rounded-lg overflow-hidden border border-gray-200">
        {timeline.map((sample, i) => {
          const colors = EMOTION_COLORS[sample.emotion];
          return (
            <div
              key={i}
              className={`h-8 ${colors.bar}`}
              style={{ width: `${cellWidth}%`, opacity: Math.max(0.3, sample.confidence) }}
              title={`${(sample.timestamp / 1000).toFixed(1)}s — ${EMOTION_LABELS[sample.emotion]} (${(sample.confidence * 100).toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-400">0s</span>
        <span className="text-[10px] text-gray-400">{(maxTs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
};

const AU_LABELS: Record<string, string> = {
  AU1: 'Inner Brow Raise',
  AU2: 'Outer Brow Raise',
  AU4: 'Brow Lowerer',
  AU6: 'Cheek Raiser',
  AU12: 'Lip Corner Pull',
  AU15: 'Lip Corner Depress',
  AU20: 'Lip Stretcher',
  AU25: 'Lips Part',
  AU26: 'Jaw Drop',
};

const AU_KEYS = ['AU1', 'AU2', 'AU4', 'AU6', 'AU12', 'AU15', 'AU20', 'AU25', 'AU26'] as const;

const ActionUnitsPanel = ({ timeline }: { timeline: EmotionAggregation['timeline'] }) => {
  const hasAUData = useMemo(() =>
    timeline.some(s => s.actionUnits && Object.values(s.actionUnits).some(v => v > 0)),
    [timeline],
  );

  const avgAUs = useMemo(() => {
    if (!hasAUData || timeline.length === 0) return null;
    const sums: Record<string, number> = {};
    for (const k of AU_KEYS) sums[k] = 0;
    let count = 0;
    for (const s of timeline) {
      if (!s.actionUnits) continue;
      for (const k of AU_KEYS) sums[k] += s.actionUnits[k] || 0;
      count++;
    }
    if (count === 0) return null;
    for (const k of AU_KEYS) sums[k] /= count;
    return sums;
  }, [timeline, hasAUData]);

  if (!hasAUData || !avgAUs) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
        <p className="text-sm text-gray-500">No Action Unit data available. AUs require the face landmark model.</p>
      </div>
    );
  }

  const maxAU = Math.max(...Object.values(avgAUs), 0.01);

  return (
    <div className="space-y-4">
      {/* Average AU bars */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Average Action Unit Activation</h4>
        <div className="space-y-1.5">
          {AU_KEYS.map(au => {
            const val = avgAUs[au];
            return (
              <div key={au} className="flex items-center gap-3">
                <span className="text-xs font-mono w-10 text-gray-600">{au}</span>
                <span className="text-xs text-gray-500 w-32 truncate">{AU_LABELS[au]}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded transition-all"
                    style={{ width: `${(val / maxAU) * 100}%`, opacity: Math.max(0.3, val) }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-600 w-10 text-right">{(val * 100).toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AU Timeline Heatmap */}
      {timeline.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">AU Timeline</h4>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {AU_KEYS.map(au => (
              <div key={au} className="flex items-center">
                <span className="text-[10px] font-mono text-gray-500 w-10 px-1 bg-gray-50 border-r border-gray-200 py-0.5 text-center flex-shrink-0">{au}</span>
                <div className="flex flex-1 gap-px">
                  {timeline.map((s, i) => {
                    const val = s.actionUnits?.[au] || 0;
                    return (
                      <div
                        key={i}
                        className="h-3 flex-1"
                        style={{
                          backgroundColor: val > 0.05 ? `rgba(99, 102, 241, ${Math.min(val, 1)})` : 'transparent',
                        }}
                        title={`${(s.timestamp / 1000).toFixed(1)}s — ${au}: ${(val * 100).toFixed(0)}%`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-400">0s</span>
            <span className="text-[10px] text-gray-400">{(timeline[timeline.length - 1]?.timestamp / 1000).toFixed(1)}s</span>
          </div>
        </div>
      )}
    </div>
  );
};

const MicroExpressionsPanel = ({ data }: { data: NonNullable<EmotionAggregation['microExpressions']> }) => {
  const sorted = useMemo(() =>
    [...data.events].sort((a, b) => a.startTimestamp - b.startTimestamp),
    [data.events],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <h4 className="text-sm font-semibold text-gray-700">Micro-Expressions</h4>
        <span className="text-xs text-gray-500">{data.total} detected</span>
        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">{data.briefCount} brief</span>
        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">{data.microCount} micro</span>
      </div>

      {/* By emotion breakdown */}
      {Object.keys(data.byEmotion).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(data.byEmotion) as [string, number][])
            .sort((a, b) => b[1] - a[1])
            .map(([emotion, count]) => {
              const colors = EMOTION_COLORS[emotion as keyof typeof EMOTION_COLORS];
              return (
                <span key={emotion} className={`px-2 py-1 rounded text-xs font-medium ${colors?.bg || 'bg-gray-100'} ${colors?.text || 'text-gray-700'}`}>
                  {EMOTION_LABELS[emotion as keyof typeof EMOTION_LABELS] || emotion}: {count}
                </span>
              );
            })}
        </div>
      )}

      {/* Events table */}
      {sorted.length > 0 && (
        <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Time</th>
                <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Emotion</th>
                <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Duration</th>
                <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Type</th>
                <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((event, i) => {
                const colors = EMOTION_COLORS[event.emotion as keyof typeof EMOTION_COLORS];
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-600">{(event.startTimestamp / 1000).toFixed(1)}s</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colors?.bg || 'bg-gray-100'} ${colors?.text || 'text-gray-700'}`}>
                        {EMOTION_LABELS[event.emotion as keyof typeof EMOTION_LABELS] || event.emotion}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-600">{event.durationMs}ms</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] font-medium ${event.category === 'brief' ? 'text-purple-600' : 'text-indigo-600'}`}>
                        {event.category}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-600">{(event.peakConfidence * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const MoodStates = ({ distribution }: { distribution: Record<EkmanEmotion, number> }) => {
  const d = distribution;
  const frustration = (d.neutral + d.sadness + d.disgust) / 3;
  const interest = (d.surprise + d.joy + d.neutral) / 3;
  const concentration = (d.neutral + d.fear + d.sadness) / 3;

  const moodColor = (val: number) => val >= 50 ? 'text-red-600' : val >= 25 ? 'text-amber-600' : 'text-green-600';

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3">Estados de ánimo</h4>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-200 p-3 text-center">
          <p className={`text-xl font-bold ${moodColor(frustration)}`}>{frustration.toFixed(1)}%</p>
          <p className="text-xs text-gray-500 mt-1">Frustración</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3 text-center">
          <p className={`text-xl font-bold ${interest > 30 ? 'text-blue-600' : 'text-gray-500'}`}>{interest.toFixed(1)}%</p>
          <p className="text-xs text-gray-500 mt-1">Interés</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3 text-center">
          <p className={`text-xl font-bold ${concentration > 30 ? 'text-indigo-600' : 'text-gray-500'}`}>{concentration.toFixed(1)}%</p>
          <p className="text-xs text-gray-500 mt-1">Concentración</p>
        </div>
      </div>
    </div>
  );
};

const EmScoreCard = ({ distribution }: { distribution: Record<EkmanEmotion, number> }) => {
  const d = distribution;
  const comfort = d.joy;
  const curiosity = d.surprise;
  const engagement = (d.joy + d.surprise) / 2;
  const worry = d.fear;
  const uncertainty = d.neutral;
  const ethical = d.disgust;

  const emScore = 2 * (comfort + curiosity) + 1.5 * engagement - (worry + uncertainty) - 2 * ethical;

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-700">EmScore</h4>
          <p className="text-xs text-gray-400 mt-0.5">Clima emocional del diseño</p>
        </div>
        <p className={`text-3xl font-bold ${emScore >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {emScore.toFixed(1)}
        </p>
      </div>
    </div>
  );
};

export const EmotionPanel = ({ emotions }: { emotions: EmotionAggregation }) => {
  if (!emotions.enabled) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <SmilePlus className="h-8 w-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">Emotion recognition was not enabled for this stimulus.</p>
      </div>
    );
  }

  if (emotions.totalSamples === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <SmilePlus className="h-8 w-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No se detectaron emociones en las respuestas registradas.</p>
        <p className="text-xs text-gray-400 mt-1">Las nuevas respuestas capturarán datos de expresiones faciales automáticamente.</p>
      </div>
    );
  }

  const dominantColors = EMOTION_COLORS[emotions.dominantEmotion];

  return (
    <div className="space-y-5">
      {/* Dominant emotion + confidence */}
      <div className="flex items-center gap-4">
        <div className={`px-3 py-1.5 rounded-full text-sm font-semibold ${dominantColors.bg} ${dominantColors.text}`}>
          {EMOTION_LABELS[emotions.dominantEmotion]}
        </div>
        <span className="text-xs text-gray-500">
          Emoción dominante &middot; {emotions.totalSamples.toLocaleString()} muestras &middot; {(emotions.avgConfidence * 100).toFixed(0)}% confianza promedio
        </span>
      </div>

      {/* EmScore */}
      <EmScoreCard distribution={emotions.distribution} />

      {/* Mood States */}
      <MoodStates distribution={emotions.distribution} />

      {/* Distribution bars */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Distribución de emociones</h4>
        <EmotionDistributionChart distribution={emotions.distribution} />
      </div>

      {/* Timeline */}
      <EmotionTimeline timeline={emotions.timeline} />

      {/* Action Units */}
      <ActionUnitsPanel timeline={emotions.timeline} />

      {/* Micro-Expressions */}
      {emotions.microExpressions && emotions.microExpressions.total > 0 && (
        <MicroExpressionsPanel data={emotions.microExpressions} />
      )}

      {/* Per-participant table */}
      {emotions.perParticipant.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Per Participant</h4>
          <div className="border rounded-lg overflow-hidden">
            <DataTable
              columns={emotionParticipantColumns}
              data={emotions.perParticipant}
              rowKey={(p) => p.participantId}
              size="compact"
            />
          </div>
        </div>
      )}
    </div>
  );
};

type EmotionParticipant = { participantId: string; dominantEmotion: EkmanEmotion; sampleCount: number };

const emotionParticipantColumns: DataTableColumn<EmotionParticipant>[] = [
  { key: 'participant', header: 'Participant', render: (p) => <span className="font-mono text-xs text-gray-700">{p.participantId}</span> },
  {
    key: 'dominant', header: 'Dominant',
    render: (p) => {
      const c = EMOTION_COLORS[p.dominantEmotion];
      return <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>{EMOTION_LABELS[p.dominantEmotion]}</span>;
    },
  },
  { key: 'samples', header: 'Samples', align: 'right', accessor: 'sampleCount', cellClassName: 'text-gray-500' },
];
