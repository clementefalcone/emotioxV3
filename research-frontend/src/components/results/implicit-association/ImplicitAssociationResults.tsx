import { useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceArea, ResponsiveContainer,
} from 'recharts';
import { ResultsStateHandler } from '../shared/ResultsStateHandler';
import { Filters } from '../shared/Filters';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { useResultsFilter } from '../../../hooks/useResultsFilter';
import * as analyticsService from '../../../services/analytics.service';
import type { IATModuleResult, IATParticipantData } from '../../../services/analytics.service';

// Recharts Label `content` callback uses internal Props with RenderableText (includes `false`).
// A custom interface can't satisfy the overload without importing private types — eslint-disable is the pragmatic fix.

interface ImplicitAssociationResultsProps {
  researchId: string;
  stageId?: string;
  className?: string;
}

// Chart color palette — matches reference design
const TARGET_COLORS = [
  '#4F46E5', // indigo/purple (Target 1 / Attribute 1)
  '#22D3EE', // cyan/light blue (Target 2 / Attribute 2)
  '#10B981', // green (Target 3)
  '#F59E0B', // amber (Target 4)
  '#EF4444', // red (Target 5)
];

const LS_COLOR_PREFIX = 'emotiox-iat-colors-';

function useCustomColors(moduleId: string, count: number): [string[], Dispatch<SetStateAction<string[]>>] {
  const [colors, setColors] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`${LS_COLOR_PREFIX}${moduleId}`);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return TARGET_COLORS.slice(0, Math.max(count, 2));
  });

  useEffect(() => {
    try { localStorage.setItem(`${LS_COLOR_PREFIX}${moduleId}`, JSON.stringify(colors)); } catch { /* ignore */ }
  }, [moduleId, colors]);

  const getWithFallback = useMemo(() => {
    const padded = [...colors];
    while (padded.length < count) padded.push(TARGET_COLORS[padded.length % TARGET_COLORS.length]);
    return padded;
  }, [colors, count]);

  return [getWithFallback, setColors];
}

const ColorLegend = ({ labels, colors, onChange }: { labels: string[]; colors: string[]; onChange: (i: number, color: string) => void }) => (
  <div className="flex flex-wrap gap-3 mb-3">
    {labels.map((label, i) => (
      <label key={i} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600">
        <span
          className="w-5 h-5 rounded border border-gray-300 shrink-0 block"
          style={{ backgroundColor: colors[i] }}
        />
        <input
          type="color"
          value={colors[i] ?? colors[i % colors.length]}
          onChange={e => onChange(i, e.target.value)}
          className="sr-only"
        />
        {label}
      </label>
    ))}
  </div>
);

// ─── Association strength classification ─────────────────────────
type AssociationStrength = 'strong' | 'moderate' | 'weak' | 'none';

const classifyAssociation = (score: number): AssociationStrength => {
    const abs = Math.abs(score);
    if (abs >= 70) return 'strong';
    if (abs >= 40) return 'moderate';
    if (abs >= 15) return 'weak';
    return 'none';
};

const ASSOCIATION_STYLES: Record<AssociationStrength, { bg: string; text: string; label: string; labelEs: string }> = {
    strong: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', label: 'Strong', labelEs: 'Fuerte' },
    moderate: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: 'Moderate', labelEs: 'Media' },
    weak: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', label: 'Weak', labelEs: 'Baja' },
    none: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-500', label: 'None', labelEs: 'No association' },
};

const AssociationBadge = ({ score, targetName }: { score: number; targetName?: string }) => {
    const strength = classifyAssociation(score);
    const style = ASSOCIATION_STYLES[strength];
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${style.bg} ${style.text}`}>
            {targetName && <span className="font-normal opacity-70">{targetName}:</span>}
            {Math.abs(score)}% — {style.labelEs}
        </span>
    );
};

// ==========================================
// ATTRIBUTE TESTING — RADAR CHART
// ==========================================

const AttributeTestingChart = ({ module: mod, colors }: { module: IATModuleResult; colors: string[] }) => {
  const radarData = mod.scores.map(score => {
    const entry: Record<string, string | number> = { attribute: score.attributeLabel };
    for (const target of mod.targets) {
      entry[target.name] = score.targetScores[target.id] ?? 0;
    }
    return entry;
  });

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        IAT - Reaction Time Test (Attribute Testing, RTT)
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        Priming display time set in {mod.primingTime} ms
      </p>
      <div className="w-full" style={{ height: Math.max(450, mod.attributes.length * 30 + 200) }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="#E5E7EB" />
            <PolarAngleAxis
              dataKey="attribute"
              tick={{ fontSize: 12, fill: '#374151' }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[-100, 100]}
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              tickCount={5}
            />
            {mod.targets.map((target, i) => (
              <Radar
                key={target.id}
                name={target.name}
                dataKey={target.name}
                stroke={colors[i % colors.length]}
                fill={colors[i % colors.length]}
                fillOpacity={0.2}
                strokeWidth={2}
                dot={{ r: 4, fill: colors[i % colors.length] }}
              />
            ))}
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="circle"
            />
            <Tooltip
              formatter={(value: number, name: string) => [`${value}%`, name]}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                fontSize: 12,
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Association strength summary */}
      <div className="mt-4 space-y-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Association Strength</h4>
        {mod.scores.map(score => {
          const dominantTarget = mod.targets.reduce((best, t) =>
            Math.abs(score.targetScores[t.id] ?? 0) > Math.abs(score.targetScores[best.id] ?? 0) ? t : best
          , mod.targets[0]);
          const dominantScore = score.targetScores[dominantTarget?.id] ?? 0;
          return (
            <div key={score.attributeId} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 w-32 truncate">{score.attributeLabel}</span>
              <AssociationBadge score={dominantScore} targetName={dominantTarget?.name} />
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Tiempo de reacción por atributo</h4>
        <div style={{ height: Math.max(300, mod.scores.length * 40 + 100) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={radarData} barCategoryGap="15%" barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="attribute" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
              {mod.targets.map((target, i) => (
                <Bar
                  key={target.id}
                  dataKey={target.name}
                  fill={colors[i % colors.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// COMPARING ATTRIBUTE — GROUPED BAR + RADAR CHART
// ==========================================

const ASSOCIATION_BANDS = [
  { min: 56, label: 'Asociación fuerte', color: '#86EFAC' },
  { min: 25, label: 'Asociación media', color: '#FDE047' },
  { min: 0, label: 'Asociación baja', color: '#FCA5A5' },
];

const classifyAssociationBand = (score: number): string => {
  const abs = Math.abs(score);
  if (abs >= 56) return 'Asociación fuerte';
  if (abs >= 25) return 'Asociación media';
  return 'Asociación baja';
};

const CriteriaAssociationCharts = ({ module: mod, colors }: { module: IATModuleResult; colors: string[] }) => {
  const [visibleBands, setVisibleBands] = useState<Set<number>>(() => new Set([0, 1, 2]));
  const [visibleTargets, setVisibleTargets] = useState<Set<string>>(() => new Set(mod.targets.map(t => t.id)));
  const cs = mod.criteriaScores ?? [];

  if (cs.length === 0) {
    return <p className="mt-4 text-sm text-gray-400 italic">No criteria data available</p>;
  }

  const barData = cs.map(criterion => {
    const entry: Record<string, string | number> = { attribute: criterion.criterionLabel };
    for (const target of mod.targets) {
      const score = criterion.objectScores[target.id];
      entry[target.name] = score?.dim1Pct ?? 0;
    }
    return entry;
  });

  const maxValue = Math.max(
    70,
    ...cs.flatMap(c => mod.targets.map(t => c.objectScores[t.id]?.dim1Pct ?? 0))
  );
  const yMax = Math.ceil(maxValue / 10) * 10;

  const radarData = cs.map(criterion => {
    const entry: Record<string, string | number> = { attribute: criterion.criterionLabel };
    for (const target of mod.targets) {
      const score = criterion.objectScores[target.id];
      entry[target.name] = score?.dim1Pct ?? 0;
    }
    return entry;
  });

  return (
    <>
      {/* Grouped bar chart — criteria × objects */}
      <div className="flex justify-end gap-3 text-[11px] text-gray-500 mb-2">
        {ASSOCIATION_BANDS.map((b, i) => {
          const active = visibleBands.has(i);
          return (
            <button
              key={b.label}
              type="button"
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-colors ${active ? 'border-gray-300 bg-white' : 'border-transparent bg-gray-100 text-gray-400'}`}
              onClick={() => {
                const next = new Set(visibleBands);
                if (next.has(i)) next.delete(i); else next.add(i);
                setVisibleBands(next);
              }}
            >
              <div
                className="w-3 h-3 rounded-sm transition-opacity"
                style={{ backgroundColor: b.color, opacity: active ? 1 : 0.3 }}
              />
              {b.label}
            </button>
          );
        })}
      </div>
      <div className="w-full" style={{ height: 400 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={barData} barCategoryGap="15%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis
              dataKey="attribute"
              tick={{ fontSize: 11, fill: '#374151' }}
              axisLine={{ stroke: '#E5E7EB' }}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={70}
            />
            <YAxis
              domain={[0, yMax]}
              ticks={[0, 25, 56, yMax]}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={{ stroke: '#E5E7EB' }}
              tickFormatter={(v: number) => `${v}%`}
            />
            {visibleBands.has(0) && <ReferenceArea y1={56} y2={yMax} fill={ASSOCIATION_BANDS[0].color} fillOpacity={0.45} ifOverflow="hidden" />}
            {visibleBands.has(1) && <ReferenceArea y1={25} y2={56} fill={ASSOCIATION_BANDS[1].color} fillOpacity={0.45} ifOverflow="hidden" />}
            {visibleBands.has(2) && <ReferenceArea y1={0} y2={25} fill={ASSOCIATION_BANDS[2].color} fillOpacity={0.45} ifOverflow="hidden" />}
            {mod.targets.map((target, i) => (
              visibleTargets.has(target.id) ? (
                <Bar
                  key={target.id}
                  dataKey={target.name}
                  fill={colors[i % colors.length]}
                  radius={[3, 3, 0, 0]}
                />
              ) : null
            ))}
            <Tooltip
              formatter={(value: number, name: string) => [`${value}%`, name]}
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: 12 }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-3 text-[11px] text-gray-500 mt-2">
        {mod.targets.map((target, i) => {
          const active = visibleTargets.has(target.id);
          return (
            <button
              key={target.id}
              type="button"
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-colors ${active ? 'border-gray-300 bg-white' : 'border-transparent bg-gray-100 text-gray-400'}`}
              onClick={() => {
                const next = new Set(visibleTargets);
                if (next.has(target.id)) next.delete(target.id); else next.add(target.id);
                setVisibleTargets(next);
              }}
            >
              <div
                className="w-3 h-3 rounded-full transition-opacity"
                style={{ backgroundColor: colors[i % colors.length], opacity: active ? 1 : 0.3 }}
              />
              {target.name}
            </button>
          );
        })}
      </div>

      {/* Association strength per object */}
      <div className="mt-4 space-y-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Association Strength</h4>
        {mod.targets.map(target => {
          const avgPct = cs.length > 0
            ? Math.round(cs.reduce((sum, c) => sum + (c.objectScores[target.id]?.dim1Pct ?? 0), 0) / cs.length)
            : 0;
          return (
            <div key={target.id} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 w-32 truncate">{target.name}</span>
              <span className="text-sm font-medium text-gray-900">{avgPct}%</span>
              <span className="text-xs text-gray-500">— {classifyAssociationBand(avgPct)}</span>
            </div>
          );
        })}
      </div>

      {/* Radar chart */}
      <div className="mt-8">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Radar — Atributos evaluados
        </h4>
        <div className="w-full flex justify-center" style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <RadarChart data={radarData} outerRadius="75%">
              <PolarGrid stroke="#E5E7EB" />
              <PolarAngleAxis
                dataKey="attribute"
                tick={{ fontSize: 11, fill: '#374151' }}
              />
              <PolarRadiusAxis
                domain={[0, yMax]}
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickFormatter={(v: number) => `${v}%`}
              />
              {mod.targets.map((target, i) => (
                visibleTargets.has(target.id) ? (
                  <Radar
                    key={target.id}
                    name={target.name}
                    dataKey={target.name}
                    stroke={colors[i % colors.length]}
                    fill={colors[i % colors.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                ) : null
              ))}
              <Tooltip
                formatter={(value: number, name: string) => [`${value}%`, name]}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: 12 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-center gap-3 text-[11px] text-gray-500 mt-2">
          {mod.targets.map((target, i) => {
            const active = visibleTargets.has(target.id);
            return (
              <button
                key={target.id}
                type="button"
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-colors ${active ? 'border-gray-300 bg-white' : 'border-transparent bg-gray-100 text-gray-400'}`}
                onClick={() => {
                  const next = new Set(visibleTargets);
                  if (next.has(target.id)) next.delete(target.id); else next.add(target.id);
                  setVisibleTargets(next);
                }}
              >
                <div
                  className="w-3 h-3 rounded-full transition-opacity"
                  style={{ backgroundColor: colors[i % colors.length], opacity: active ? 1 : 0.3 }}
                />
                {target.name}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};

const ComparingAttributeChart = ({ module: mod, colors }: { module: IATModuleResult; colors: string[] }) => {
  const cs = mod.criteriaScores ?? [];

  const winsPerObject: Record<string, number> = {};
  for (const target of mod.targets) winsPerObject[target.id] = 0;
  for (const criterion of cs) {
    let bestId = '';
    let bestScore = -Infinity;
    for (const target of mod.targets) {
      const s = criterion.objectScores[target.id]?.dim1Pct ?? 0;
      if (s > bestScore) { bestScore = s; bestId = target.id; }
    }
    if (bestId) winsPerObject[bestId]++;
  }

  const netSummary = mod.targets.length >= 2 ? (() => {
    const sorted = [...mod.targets].sort((a, b) => (winsPerObject[b.id] ?? 0) - (winsPerObject[a.id] ?? 0));
    const leader = sorted[0];
    const runner = sorted[1];
    if (!leader || !runner) return null;
    return {
      leaderName: leader.name,
      runnerName: runner.name,
      leaderWins: winsPerObject[leader.id] ?? 0,
      total: cs.length,
    };
  })() : null;

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        IAT - Comparing Attribute
      </h3>
      <p className="text-sm text-gray-500 mb-1">
        Priming display time set in {mod.primingTime} ms
      </p>
      {netSummary && (
        <p className="text-sm text-gray-700 mb-4">
          <span className="font-semibold">Net Association Strength:</span>{' '}
          {netSummary.leaderWins} de {netSummary.total} atributos a favor de{' '}
          <span className="font-semibold">{netSummary.leaderName}</span>{' '}
          vs {netSummary.runnerName}
        </p>
      )}

      <CriteriaAssociationCharts module={mod} colors={colors} />
    </div>
  );
};

// ==========================================
// OBJECTS COMPARING — HORIZONTAL DIVERGENT BAR CHART
// ==========================================

const ObjectsComparingChart = ({ module: mod, colors }: { module: IATModuleResult; colors: string[] }) => {
  // For Objects Comparing, targets = objects, attributes = 2 dimensions
  // Each object gets 2 bars: dimension-1 (negative side) and dimension-2 (positive side)
  const dim1 = mod.attributes[0];
  const dim2 = mod.attributes[1];

  const barData = mod.targets.map(target => {
    // Find the score entry that has this target's scores
    // In Objects Comparing, scores are per-dimension (attribute) with target scores
    const dim1Score = mod.scores.find(s => s.attributeId === dim1?.id)?.targetScores[target.id] ?? 0;
    const dim2Score = mod.scores.find(s => s.attributeId === dim2?.id)?.targetScores[target.id] ?? 0;

    return {
      object: target.name,
      [dim1?.label ?? 'Dimension 1']: -Math.abs(dim1Score), // negative side (left)
      [dim2?.label ?? 'Dimension 2']: Math.abs(dim2Score),  // positive side (right)
      // For labels
      dim1Value: Math.abs(dim1Score),
      dim2Value: Math.abs(dim2Score),
    };
  });

  const dim1Label = dim1?.label ?? 'Dimension 1';
  const dim2Label = dim2?.label ?? 'Dimension 2';

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        IAT - Comparing Objects
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        Priming display time set in {mod.primingTime} ms
      </p>
      <div className="w-full" style={{ height: Math.max(300, mod.targets.length * 80 + 80) }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            data={barData}
            layout="vertical"
            barCategoryGap="30%"
            barGap={2}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#E5E7EB"
              horizontal={false}
            />
            <XAxis
              type="number"
              domain={[-100, 100]}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={{ stroke: '#E5E7EB' }}
              tickFormatter={(v: number) => `${v}`}
            />
            <YAxis
              type="category"
              dataKey="object"
              tick={{ fontSize: 12, fill: '#374151' }}
              width={80}
              axisLine={{ stroke: '#E5E7EB' }}
            />
            <Bar
              dataKey={dim1Label}
              fill={colors[0]}
              radius={[4, 0, 0, 4]}
              label={{
                position: 'left' as const,
                fontSize: 10,
                fill: colors[0],
                content: ({ value, x, y, height // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Label.Props internal type
}: any) => (
                  <text
                    x={(x ?? 0) - 6}
                    y={(y ?? 0) + (height ?? 0) / 2 + 4}
                    textAnchor="end"
                    fontSize={10}
                    fill={colors[0]}
                  >
                    {Math.abs(value ?? 0)}%
                  </text>
                ),
              }}
            />
            <Bar
              dataKey={dim2Label}
              fill={colors[1]}
              radius={[0, 4, 4, 0]}
              label={{
                position: 'right' as const,
                fontSize: 10,
                fill: colors[1],
                content: ({ value, x, y, width, height // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Label.Props internal type
}: any) => (
                  <text
                    x={(x ?? 0) + (width ?? 0) + 6}
                    y={(y ?? 0) + (height ?? 0) / 2 + 4}
                    textAnchor="start"
                    fontSize={10}
                    fill={colors[1]}
                  >
                    {Math.abs(value ?? 0)}%
                  </text>
                ),
              }}
            />
            <Tooltip
              formatter={(value: number, name: string) => [`${Math.abs(value)}%`, name]}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="circle"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Association strength per object — which dimension dominates */}
      <div className="mt-4 space-y-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Association Strength</h4>
        {mod.targets.map(target => {
          const dim1Score = mod.scores.find(s => s.attributeId === dim1?.id)?.targetScores[target.id] ?? 0;
          const dim2Score = mod.scores.find(s => s.attributeId === dim2?.id)?.targetScores[target.id] ?? 0;
          const dominant = Math.abs(dim1Score) >= Math.abs(dim2Score) ? dim1Label : dim2Label;
          const dominantValue = Math.max(Math.abs(dim1Score), Math.abs(dim2Score));
          return (
            <div key={target.id} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 w-32 truncate">{target.name}</span>
              <AssociationBadge score={dominantValue} targetName={dominant} />
            </div>
          );
        })}
      </div>

      {(mod.criteriaScores?.length ?? 0) > 0 && (
        <div className="mt-8">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            % {dim1Label} por atributo
          </h4>
          <CriteriaAssociationCharts module={mod} colors={TARGET_COLORS} />
        </div>
      )}

      <div className="mt-6">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Perfil por objeto</h4>
        <div style={{ height: 350 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={mod.targets.map(t => ({
              object: t.name,
              [dim1Label]: Math.abs(mod.scores.find(s => s.attributeId === dim1?.id)?.targetScores[t.id] ?? 0),
              [dim2Label]: Math.abs(mod.scores.find(s => s.attributeId === dim2?.id)?.targetScores[t.id] ?? 0),
            }))} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="#E5E7EB" />
              <PolarAngleAxis dataKey="object" tick={{ fontSize: 12, fill: '#374151' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} />
              <Radar name={dim1Label} dataKey={dim1Label} stroke={colors[0]} fill={colors[0]} fillOpacity={0.2} strokeWidth={2} />
              <Radar name={dim2Label} dataKey={dim2Label} stroke={colors[1]} fill={colors[1]} fillOpacity={0.2} strokeWidth={2} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// D-SCORE CARD
// ==========================================

const EFFECT_COLORS: Record<string, { bg: string; text: string }> = {
  none: { bg: 'bg-gray-100', text: 'text-gray-600' },
  slight: { bg: 'bg-blue-50', text: 'text-blue-700' },
  moderate: { bg: 'bg-amber-50', text: 'text-amber-700' },
  strong: { bg: 'bg-red-50', text: 'text-red-700' },
};

const EFFECT_LABELS: Record<string, string> = {
  none: 'No effect',
  slight: 'Slight',
  moderate: 'Moderate',
  strong: 'Strong',
};

const dScoreColumns: DataTableColumn<IATParticipantData>[] = [
  { key: 'participant', header: 'Participant', render: (p) => <span className="font-mono text-gray-700">{p.participantId}</span> },
  { key: 'dScore', header: 'D-score', align: 'right', render: (p) => <span className="font-semibold text-gray-900">{p.dScore}</span> },
  {
    key: 'effect', header: 'Effect',
    render: (p) => {
      const ec = EFFECT_COLORS[p.dScoreEffect || 'none'];
      return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ec.bg} ${ec.text}`}>{EFFECT_LABELS[p.dScoreEffect || 'none']}</span>;
    },
  },
  { key: 'quality', header: 'Quality', accessor: 'quality', cellClassName: 'text-gray-500' },
];

type ErrorCombination = { targetName: string; attributeLabel: string; errorRate: number; errors: number; total: number };

const errorCombinationColumns: DataTableColumn<ErrorCombination>[] = [
  { key: 'stimulus', header: 'Stimulus', accessor: 'targetName', cellClassName: 'text-gray-700' },
  { key: 'response', header: 'Response', accessor: 'attributeLabel', cellClassName: 'text-gray-700' },
  {
    key: 'errorRate', header: 'Error %', align: 'right',
    render: (c) => <span className={`font-semibold ${c.errorRate > 20 ? 'text-red-600' : c.errorRate > 10 ? 'text-amber-600' : 'text-gray-600'}`}>{c.errorRate}%</span>,
  },
  { key: 'trials', header: 'Errors / Total', align: 'right', render: (c) => <span className="text-gray-500">{c.errors} / {c.total}</span> },
];

const DScoreCard = ({ module: mod }: { module: IATModuleResult }) => {
  const ds = mod.dScore;
  if (!ds) return null;

  const colors = EFFECT_COLORS[ds.effect] || EFFECT_COLORS.none;
  // Position on a -1.5 to 1.5 scale
  const barPosition = Math.max(0, Math.min(100, ((ds.value + 1.5) / 3) * 100));

  return (
    <div className="border border-gray-200 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">Greenwald D-score</h4>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors.bg} ${colors.text}`}>
            {EFFECT_LABELS[ds.effect]}
          </span>
          <span className="text-lg font-bold text-gray-900">{ds.value}</span>
        </div>
      </div>

      {/* D-score bar visualization */}
      <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden mb-2">
        {/* Reference zones */}
        <div className="absolute inset-y-0 left-[40%] right-[40%] bg-gray-200/50" title="No effect zone" />
        <div className="absolute inset-y-0 left-[28.3%] w-[11.7%] bg-blue-100/50" title="Slight" />
        <div className="absolute inset-y-0 right-[28.3%] w-[11.7%] bg-blue-100/50" title="Slight" />
        <div className="absolute inset-y-0 left-[16.7%] w-[11.6%] bg-amber-100/50" title="Moderate" />
        <div className="absolute inset-y-0 right-[16.7%] w-[11.6%] bg-amber-100/50" title="Moderate" />
        {/* Center line */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-gray-400" />
        {/* Marker */}
        <div
          className="absolute top-0.5 bottom-0.5 w-3 rounded-full bg-blue-600 shadow-sm"
          style={{ left: `calc(${barPosition}% - 6px)` }}
          title={`D = ${ds.value}`}
        />
      </div>

      <div className="flex justify-between text-[10px] text-gray-400">
        <span>-1.5</span>
        <span>0</span>
        <span>+1.5</span>
      </div>

      {/* CI + participant count */}
      <p className="text-xs text-gray-500 mt-2">
        95% CI: [{ds.ciLower}, {ds.ciUpper}] &middot; {ds.validParticipants} valid participant{ds.validParticipants !== 1 ? 's' : ''}
        {ds.reliability !== null && ds.reliability !== undefined && (
          <> &middot; Split-half reliability: <span className={`font-semibold ${ds.reliability >= 0.7 ? 'text-green-600' : ds.reliability >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>{ds.reliability}</span></>
        )}
      </p>

      {/* Per-participant D-scores table */}
      {mod.participantData && mod.participantData.some(p => p.dScore != null) && (
        <details className="mt-3">
          <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-700">
            Individual D-scores ({mod.participantData.filter(p => p.dScore != null).length} participants)
          </summary>
          <div className="mt-2 border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
            <DataTable<IATParticipantData>
              columns={dScoreColumns}
              data={mod.participantData
                .filter(p => p.dScore != null)
                .sort((a, b) => Math.abs(b.dScore!) - Math.abs(a.dScore!))}
              rowKey={(p) => p.participantId}
              size="compact"
              stickyHeader
            />
          </div>
        </details>
      )}
    </div>
  );
};

// ==========================================
// ERROR ANALYSIS CARD
// ==========================================

const ErrorAnalysisCard = ({ module: mod }: { module: IATModuleResult }) => {
  const ea = mod.errorAnalysis;
  if (!ea) return null;

  return (
    <details className="border border-gray-200 rounded-lg p-4 mt-4">
      <summary className="text-sm font-semibold text-gray-700 cursor-pointer hover:text-gray-900">
        Error Analysis
        <span className="ml-2 text-xs font-normal text-gray-400">
          {ea.overallErrorRate}% errors &middot; {ea.overallFastRate}% fast responses
        </span>
      </summary>

      <div className="mt-3 space-y-4">
        {/* By phase */}
        <div>
          <h5 className="text-xs font-medium text-gray-500 mb-2">By Phase</h5>
          <div className="flex gap-3">
            {ea.byPhase.map(p => (
              <div key={p.phase} className="flex-1 border rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400 capitalize mb-1">{p.phase}</p>
                <p className={`text-lg font-bold ${p.errorRate > 20 ? 'text-red-600' : p.errorRate > 10 ? 'text-amber-600' : 'text-green-600'}`}>
                  {p.errorRate}%
                </p>
                <p className="text-[10px] text-gray-400">{p.errors}/{p.total} trials</p>
              </div>
            ))}
          </div>
        </div>

        {/* By combination — top 5 highest error rates */}
        {ea.byCombination.length > 0 && (
          <div>
            <h5 className="text-xs font-medium text-gray-500 mb-2">Highest Error Combinations</h5>
            <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
              <DataTable
                columns={errorCombinationColumns}
                data={ea.byCombination}
                rowKey={(_, i) => String(i)}
                size="compact"
              />
            </div>
          </div>
        )}
      </div>
    </details>
  );
};

// ==========================================
// EFFECT SIZE VISUALIZATION
// ==========================================

const EffectSizeBar = ({ module: mod }: { module: IATModuleResult }) => {
  const ds = mod.dScore;
  if (!ds || !mod.participantData) return null;

  const validParticipants = mod.participantData.filter(p => p.dScore != null && p.quality === 'good');
  if (validParticipants.length === 0) return null;

  // Histogram buckets
  const buckets = [
    { label: 'Strong -', min: -Infinity, max: -0.65, color: 'bg-red-400' },
    { label: 'Moderate -', min: -0.65, max: -0.35, color: 'bg-amber-400' },
    { label: 'Slight -', min: -0.35, max: -0.15, color: 'bg-blue-300' },
    { label: 'None', min: -0.15, max: 0.15, color: 'bg-gray-300' },
    { label: 'Slight +', min: 0.15, max: 0.35, color: 'bg-blue-400' },
    { label: 'Moderate +', min: 0.35, max: 0.65, color: 'bg-amber-500' },
    { label: 'Strong +', min: 0.65, max: Infinity, color: 'bg-red-500' },
  ];

  const bucketCounts = buckets.map(b => ({
    ...b,
    count: validParticipants.filter(p => p.dScore! >= b.min && p.dScore! < b.max).length,
  }));
  const maxCount = Math.max(...bucketCounts.map(b => b.count), 1);

  return (
    <div className="border border-gray-200 rounded-lg p-4 mt-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">D-score Distribution</h4>
      <div className="flex items-end gap-1 h-24">
        {bucketCounts.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            {b.count > 0 && (
              <span className="text-[10px] font-medium text-gray-600">{b.count}</span>
            )}
            <div
              className={`w-full rounded-t ${b.color}`}
              style={{ height: `${(b.count / maxCount) * 100}%`, minHeight: b.count > 0 ? 4 : 0 }}
              title={`${b.label}: ${b.count} participants`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {bucketCounts.map((b, i) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[9px] text-gray-400 leading-tight block">{b.label}</span>
          </div>
        ))}
      </div>
      {/* Reference lines */}
      <div className="flex justify-between mt-2 text-[10px] text-gray-400">
        <span>Strong negative bias</span>
        <span>No bias</span>
        <span>Strong positive bias</span>
      </div>
    </div>
  );
};

// ==========================================
// RT DISTRIBUTION BOX PLOT
// ==========================================

const RTDistributionCard = ({ module: mod, colors }: { module: IATModuleResult; colors: string[] }) => {
  const dist = mod.rtDistribution;
  if (!dist || dist.length === 0) return null;

  // Compute axis range across all conditions
  const globalMin = Math.min(...dist.map(d => d.min));
  const globalMax = Math.max(...dist.map(d => d.max));
  const padding = (globalMax - globalMin) * 0.1 || 50;
  const axisMin = Math.max(0, Math.floor((globalMin - padding) / 50) * 50);
  const axisMax = Math.ceil((globalMax + padding) / 50) * 50;
  const range = axisMax - axisMin || 1;

  const toX = (v: number) => ((v - axisMin) / range) * 100;

  // Tick marks
  const tickStep = range <= 500 ? 100 : range <= 1500 ? 200 : 500;
  const ticks: number[] = [];
  for (let t = Math.ceil(axisMin / tickStep) * tickStep; t <= axisMax; t += tickStep) {
    ticks.push(t);
  }

  const rowH = 40;
  const labelW = 128;
  const statsW = 120;
  const svgH = dist.length * rowH + 30; // +30 for axis

  return (
    <div className="border border-gray-200 rounded-lg p-4 mt-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">Reaction Time Distribution (ms)</h4>
      <div className="flex items-start">
        {/* Labels */}
        <div className="shrink-0" style={{ width: labelW }}>
          {dist.map((d, i) => (
            <div key={d.conditionId} className="flex items-center text-xs text-gray-700 truncate" style={{ height: rowH, paddingTop: i === 0 ? 0 : undefined }}>
              {d.label}
            </div>
          ))}
        </div>
        {/* SVG box plots */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <svg width="100%" height={svgH} preserveAspectRatio="none">
            {ticks.map(t => (
              <line key={t} x1={`${toX(t)}%`} y1={0} x2={`${toX(t)}%`} y2={dist.length * rowH} stroke="#E5E7EB" strokeWidth={1} />
            ))}
            {dist.map((d, i) => {
              const cy = i * rowH + rowH / 2;
              const boxH = 14;
              const color = colors[i % colors.length];
              return (
                <g key={d.conditionId}>
                  <line x1={`${toX(d.min)}%`} y1={cy} x2={`${toX(d.max)}%`} y2={cy} stroke={color} strokeWidth={1.5} />
                  <line x1={`${toX(d.min)}%`} y1={cy - boxH / 3} x2={`${toX(d.min)}%`} y2={cy + boxH / 3} stroke={color} strokeWidth={1.5} />
                  <line x1={`${toX(d.max)}%`} y1={cy - boxH / 3} x2={`${toX(d.max)}%`} y2={cy + boxH / 3} stroke={color} strokeWidth={1.5} />
                  <rect
                    x={`${toX(d.q1)}%`} y={cy - boxH / 2}
                    width={`${Math.max(0.5, toX(d.q3) - toX(d.q1))}%`} height={boxH}
                    fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1} rx={2}
                  />
                  <line x1={`${toX(d.median)}%`} y1={cy - boxH / 2} x2={`${toX(d.median)}%`} y2={cy + boxH / 2} stroke={color} strokeWidth={2} />
                  <circle cx={`${toX(d.mean)}%`} cy={cy} r={3} fill={color} />
                </g>
              );
            })}
            {ticks.map(t => (
              <text key={t} x={`${toX(t)}%`} y={dist.length * rowH + 16} textAnchor="middle" fontSize={11} fill="#9CA3AF">
                {t}
              </text>
            ))}
          </svg>
        </div>
        {/* Stats */}
        <div className="shrink-0 ml-3" style={{ width: statsW }}>
          {dist.map(d => (
            <div key={d.conditionId} className="flex items-center text-[11px] text-gray-500" style={{ height: rowH }}>
              <span>median: <span className="font-semibold text-gray-700">{d.median}ms</span></span>
              <span className="ml-2 text-gray-400">(n={d.count})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// MODULE CARD WRAPPER
// ==========================================

function buildIATTableData(mod: IATModuleResult): { headers: string[]; rows: string[][] } {
  if (mod.testType === 'comparing_attribute' || mod.testType === 'objects_comparing') {
    const dim1 = mod.attributes[0];
    const dim2 = mod.attributes[1];
    const headers = ['Objeto', dim1?.label ?? 'Dim 1', dim2?.label ?? 'Dim 2'];
    const rows = mod.targets.map(t => [
      t.name,
      `${Math.abs(mod.scores.find(s => s.attributeId === dim1?.id)?.targetScores[t.id] ?? 0)}%`,
      `${Math.abs(mod.scores.find(s => s.attributeId === dim2?.id)?.targetScores[t.id] ?? 0)}%`,
    ]);
    return { headers, rows };
  }
  const headers = ['Atributo', ...mod.targets.map(t => t.name)];
  const rows = mod.scores.map(s => [
    s.attributeLabel,
    ...mod.targets.map(t => `${s.targetScores[t.id] ?? 0}%`),
  ]);
  return { headers, rows };
}

function downloadCSV(headers: string[], rows: string[][], filename: string) {
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const IATModuleCard = ({ module: mod }: { module: IATModuleResult }) => {
  const targetLabels = mod.testType === 'objects_comparing'
    ? (mod.attributes.length >= 2 ? [mod.attributes[0].label, mod.attributes[1].label] : mod.targets.map(t => t.name))
    : mod.targets.map(t => t.name);
  const [colors, setColors] = useCustomColors(mod.moduleId, targetLabels.length);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  const handleColorChange = useCallback((i: number, color: string) => {
    setColors(prev => { const next = [...prev]; next[i] = color; return next; });
  }, [setColors]);

  const ChartComponent = {
    attribute_testing: AttributeTestingChart,
    comparing_attribute: ComparingAttributeChart,
    objects_comparing: ObjectsComparingChart,
  }[mod.testType];

  const tableData = buildIATTableData(mod);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      {mod.testTitle && (
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">{mod.testTitle}</p>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('chart')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === 'chart' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Gráfico
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Tabla
          </button>
        </div>
        <button
          onClick={() => downloadCSV(tableData.headers, tableData.rows, `${mod.testTitle || mod.testType}.csv`)}
          className="px-3 py-1 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
        >
          Exportar CSV
        </button>
      </div>

      {viewMode === 'chart' ? (
        <>
          <ColorLegend labels={targetLabels} colors={colors} onChange={handleColorChange} />
          <ChartComponent module={mod} colors={colors} />
          {mod.testType !== 'comparing_attribute' && (
            <>
              <DScoreCard module={mod} />
              <EffectSizeBar module={mod} />
              <ErrorAnalysisCard module={mod} />
            </>
          )}
          <RTDistributionCard module={mod} colors={colors} />
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {tableData.headers.map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  {row.map((cell, j) => (
                    <td key={j} className="py-2 px-3 text-gray-700">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mod.totalResponses === 0 && (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-sm font-semibold text-gray-700 mb-1">Sin respuestas aún</p>
          <p className="text-[13px] text-gray-400">Comparte el enlace del estudio para comenzar a recopilar datos.</p>
        </div>
      )}
      {mod.totalResponses > 0 && (
        <p className="mt-3 text-xs text-gray-400 text-right">
          {mod.totalResponses} respuesta{mod.totalResponses !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
};

// ==========================================
// MAIN COMPONENT
// ==========================================

export const ImplicitAssociationResults = ({ researchId, stageId, className }: ImplicitAssociationResultsProps) => {
  const [data, setData] = useState<analyticsService.ImplicitAssociationResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const {
    demographicData,
    demographicFilters,
    setDemographicFilters,
    userIdFilter,
    setUserIdFilter,
    completionMin,
    setCompletionMin,
    filteredParticipantIds,
  } = useResultsFilter(researchId);

  // Filter modules by participant when filters active
  const filteredModules = useMemo(() => {
    if (!data?.modules || !filteredParticipantIds) return data?.modules ?? [];
    return data.modules.map(mod => {
      const filteredPD = (mod.participantData ?? []).filter(p => filteredParticipantIds.has(p.participantId));
      return {
        ...mod,
        participantData: filteredPD,
      };
    });
  }, [data?.modules, filteredParticipantIds]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const results = await analyticsService.getImplicitAssociationResults(researchId, stageId);
      setData(results);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load implicit association results'));
    } finally {
      setIsLoading(false);
    }
  }, [researchId, stageId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadingSkeleton = (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-64" />
      <div className="h-96 bg-gray-200 rounded-xl" />
      <div className="h-96 bg-gray-200 rounded-xl" />
    </div>
  );

  return (
    <ResultsStateHandler
      isLoading={isLoading}
      error={error}
      onRetry={fetchData}
      loadingSkeleton={loadingSkeleton}
    >
      {data && (
        <div className={`flex gap-6 ${className ?? ''}`}>
          <div className="flex-1 min-w-0">
            {/* Header */}

            {filteredModules.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                <p className="text-sm font-semibold text-gray-700 mb-1">No IAT modules found</p>
                <p className="text-[13px] text-gray-400">Configure Implicit Association in the study builder.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {filteredModules.map(mod => (
                  <IATModuleCard key={mod.moduleId} module={mod} />
                ))}
              </div>
            )}
          </div>
          <div className="w-80 shrink-0 sticky top-4 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
            <Filters
              researchId={researchId}
              demographicData={demographicData}
              selectedFilters={demographicFilters}
              onFilterChange={setDemographicFilters}
              userIdFilter={userIdFilter}
              onUserIdFilterChange={setUserIdFilter}
              completionMin={completionMin}
              onCompletionMinChange={setCompletionMin}
            />
          </div>
        </div>
      )}
    </ResultsStateHandler>
  );
};
