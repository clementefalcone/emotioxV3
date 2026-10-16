import { useState, useMemo } from 'react';
import { useSmartVOCAnalytics } from '../../../hooks/useSmartVOCAnalytics';
import { useResultsFilter } from '../../../hooks/useResultsFilter';
import { ResultsStateHandler } from '../shared/ResultsStateHandler';
import { SmartVOCResultsSkeleton } from './components/SmartVOCResultsSkeleton';
import { CPVCard } from './components/CPVCard';
import { TrustFlowChart } from './components/TrustFlowChart';
import { MetricCard } from './components/MetricCard';
import { QuestionCard } from './components/QuestionCard';
import { NEVQuestionCard } from './components/NEVQuestionCard';
import { buildNevValueBlocks } from './nevValueBlocks';
import { NPSAnalysis } from './components/NPSAnalysis';
import { VOCComments } from './components/VOCComments';
import { Filters } from './components/Filters';
import { safeCalculatePercentage, calculateCSAT, calculateCES, calculateCV, hasScores, getCESZones } from '../shared/utils/calculations';
import { cn } from '../../../lib/utils';

interface SmartVOCResultsProps {
  researchId: string;
  className?: string;
}

/** Canonical NEV emotions: IDs match participant-frontend EmotionSelector (lowercase, no accents). Labels in Spanish for consistent display. */
const NEV_EMOTIONS: Array<{ id: string; label: string; isPositive: boolean }> = [
  { id: 'feliz', label: 'Feliz', isPositive: true },
  { id: 'satisfecho', label: 'Satisfecho', isPositive: true },
  { id: 'confiado', label: 'Confiado', isPositive: true },
  { id: 'valorado', label: 'Valorado', isPositive: true },
  { id: 'cuidado', label: 'Cuidado', isPositive: true },
  { id: 'seguro', label: 'Seguro', isPositive: true },
  { id: 'enfocado', label: 'Enfocado', isPositive: true },
  { id: 'indulgente', label: 'Indulgente', isPositive: true },
  { id: 'estimulado', label: 'Estimulado', isPositive: true },
  { id: 'exploratorio', label: 'Exploratorio', isPositive: true },
  { id: 'interesado', label: 'Interesado', isPositive: true },
  { id: 'energico', label: 'Enérgico', isPositive: true },
  { id: 'descontento', label: 'Descontento', isPositive: false },
  { id: 'frustrado', label: 'Frustrado', isPositive: false },
  { id: 'irritado', label: 'Irritado', isPositive: false },
  { id: 'decepcion', label: 'Decepción', isPositive: false },
  { id: 'estresado', label: 'Estresado', isPositive: false },
  { id: 'infeliz', label: 'Infeliz', isPositive: false },
  { id: 'desatendido', label: 'Desatendido', isPositive: false },
  { id: 'apresurado', label: 'Apresurado', isPositive: false }
];

/** Normalize emotion key for aggregation (lowercase, remove accents) so no records are lost. */
function normalizeEmotionKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0301/g, '')
    .replace(/\u0300/g, '')
    .replace(/[\u0302\u0303\u0308]/g, '');
}

export type TimeRange = 'today' | 'week' | 'month' | '6months' | '12months';

const RANGE_DAYS: Record<TimeRange, number> = { today: 0, week: 7, month: 30, '6months': 180, '12months': 365 };

/** Filter timestamped items by time range */
function filterByTimeRange<T extends { date: string }>(
  items: T[],
  range: TimeRange
): T[] {
  if (!items || items.length === 0) return [];
  const now = new Date();
  const days = RANGE_DAYS[range];
  const cutoff = days === 0
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getTime() - days * 86_400_000);
  return items.filter(item => new Date(item.date) >= cutoff);
}

/** Compute emotional states from NEV responses; keys normalized so no records are lost (e.g. Enérgico/energico -> energico). */
function computeEmotionalStates(nevResponses: Array<{ emotions: string[]; date: string }>): Record<string, number> {
  const states: Record<string, number> = {};
  nevResponses.forEach(r => {
    r.emotions.forEach(e => {
      const key = normalizeEmotionKey(e);
      states[key] = (states[key] || 0) + 1;
    });
  });
  return states;
}

export const SmartVOCResults = ({ researchId, className }: SmartVOCResultsProps) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const { data, isLoading, error, refetch, isLive } = useSmartVOCAnalytics(researchId);

  // Shared filter hook — persists completionMin in localStorage, deduplicates filter logic
  const {
    demographicData,
    demographicFilters,
    setDemographicFilters,
    userIdFilter,
    setUserIdFilter,
    completionMin,
    setCompletionMin,
    filteredParticipantIds,
    filterByParticipant,
    sentimentFilter,
    setSentimentFilter,
  } = useResultsFilter(researchId);

  // Trust Flow chart data — computed from filtered individual scores (not pre-aggregated backend data)
  const trustFlowDailyData = useMemo(() => {
    if (!data) return [];
    const npsScores = filterByParticipant(data.metrics.npsScores || []);
    const nevResponses = filterByParticipant(data.nevResponsesData || []);
    // Group by day
    const byDay = new Map<string, { npsVals: number[]; nevPositive: number; nevNegative: number; nevTotal: number }>();
    npsScores.forEach(s => {
      const dayKey = new Date(s.date).toISOString().split('T')[0];
      if (!byDay.has(dayKey)) byDay.set(dayKey, { npsVals: [], nevPositive: 0, nevNegative: 0, nevTotal: 0 });
      byDay.get(dayKey)!.npsVals.push(s.value);
    });
    nevResponses.forEach(r => {
      const dayKey = new Date(r.date).toISOString().split('T')[0];
      if (!byDay.has(dayKey)) byDay.set(dayKey, { npsVals: [], nevPositive: 0, nevNegative: 0, nevTotal: 0 });
      const bucket = byDay.get(dayKey)!;
      r.emotions.forEach((e: string) => {
        const key = normalizeEmotionKey(e);
        if (NEV_EMOTIONS.find(ne => ne.id === key)?.isPositive) bucket.nevPositive++;
        else bucket.nevNegative++;
        bucket.nevTotal++;
      });
    });
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, { npsVals, nevPositive, nevNegative, nevTotal }]) => {
        const p = npsVals.filter(v => v >= 9).length;
        const d = npsVals.filter(v => v <= 6).length;
        const nps = npsVals.length > 0 ? Math.round(((p - d) / npsVals.length) * 100) : 0;
        const nev = nevTotal > 0 ? Math.round(((nevPositive - nevNegative) / nevTotal) * 100) : 0;
        return {
          stage: new Date(dayKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          nps,
          nev,
          timestamp: dayKey,
        };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filteredParticipantIds]);

  const trustFlowIntradayData = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const npsScores = filterByParticipant(data.metrics.npsScores || []).filter(s => new Date(s.date) >= todayStart);
    const nevResponses = filterByParticipant(data.nevResponsesData || []).filter(r => new Date(r.date) >= todayStart);
    // Group into 30-min intervals
    const bySlot = new Map<number, { npsVals: number[]; nevPositive: number; nevNegative: number; nevTotal: number }>();
    const toSlot = (dateStr: string) => {
      const d = new Date(dateStr);
      return Math.floor((d.getHours() * 60 + d.getMinutes()) / 30);
    };
    npsScores.forEach(s => {
      const slot = toSlot(s.date);
      if (!bySlot.has(slot)) bySlot.set(slot, { npsVals: [], nevPositive: 0, nevNegative: 0, nevTotal: 0 });
      bySlot.get(slot)!.npsVals.push(s.value);
    });
    nevResponses.forEach(r => {
      const slot = toSlot(r.date);
      if (!bySlot.has(slot)) bySlot.set(slot, { npsVals: [], nevPositive: 0, nevNegative: 0, nevTotal: 0 });
      const bucket = bySlot.get(slot)!;
      r.emotions.forEach((e: string) => {
        const key = normalizeEmotionKey(e);
        if (NEV_EMOTIONS.find(ne => ne.id === key)?.isPositive) bucket.nevPositive++;
        else bucket.nevNegative++;
        bucket.nevTotal++;
      });
    });
    return Array.from(bySlot.entries())
      .sort(([a], [b]) => a - b)
      .map(([slot, { npsVals, nevPositive, nevNegative, nevTotal }]) => {
        const h = Math.floor((slot * 30) / 60);
        const m = (slot * 30) % 60;
        const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const p = npsVals.filter(v => v >= 9).length;
        const d = npsVals.filter(v => v <= 6).length;
        const nps = npsVals.length > 0 ? Math.round(((p - d) / npsVals.length) * 100) : 0;
        const nev = nevTotal > 0 ? Math.round(((nevPositive - nevNegative) / nevTotal) * 100) : 0;
        const slotDate = new Date(todayStart);
        slotDate.setMinutes(slot * 30);
        return { stage: label, nps, nev, timestamp: slotDate.toISOString() };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filteredParticipantIds]);

  // ========== DEMOGRAPHIC + TIME-RANGE FILTERED DATA ==========
  // All 5 panels use this filtered data instead of raw all-time data
  const filtered = useMemo(() => {
    if (!data) return null;

    // First apply demographic filter, then time-range filter
    const csatValues = filterByTimeRange(filterByParticipant(data.metrics.csatScores || []), timeRange).map(s => s.value);
    const cesValues = filterByTimeRange(filterByParticipant(data.metrics.cesScores || []), timeRange).map(s => s.value);
    const cvValues = filterByTimeRange(filterByParticipant(data.metrics.cvScores || []), timeRange).map(s => s.value);
    const npsFiltered = filterByTimeRange(filterByParticipant(data.metrics.npsScores || []), timeRange);
    const nevFiltered = filterByTimeRange(filterByParticipant(data.nevResponsesData || []), timeRange);
    const vocFiltered = filterByTimeRange(
      filterByParticipant(
        (data.vocResponses || [])
          .filter((v): v is typeof v & { createdAt: string } => !!v.createdAt)
          .map(v => ({ text: v.text, sentiment: v.sentiment, date: v.createdAt, participantId: v.participantId }))
      ),
      timeRange
    );
    const npsValues = npsFiltered.map(s => s.value);

    // NPS aggregates
    const promoters = npsValues.filter(s => s >= 9).length;
    const neutrals = npsValues.filter(s => s >= 7 && s <= 8).length;
    const detractors = npsValues.filter(s => s <= 6).length;
    const npsScore = npsValues.length > 0
      ? Math.round(((promoters - detractors) / npsValues.length) * 100) : 0;

    // Emotional states from filtered NEV responses
    const emotionalStates = computeEmotionalStates(nevFiltered);

    // CPV — uses dynamic CES zones
    const cesZonesLocal = getCESZones(data?.scaleConfigs?.ces?.max ?? 5);
    const csatPct = csatValues.length > 0
      ? Math.round((csatValues.filter((s: number) => s >= 4).length / csatValues.length) * 100) : 0;
    const cesPct = cesValues.length > 0
      ? Math.round((cesValues.filter((s: number) => s >= cesZonesLocal.negative[0] && s <= cesZonesLocal.negative[1]).length / cesValues.length) * 100) : 0;
    const cpvValue = csatPct - cesPct;

    return {
      csatValues, cesValues, cvValues, npsValues,
      promoters, neutrals, detractors, npsScore, cpvValue,
      emotionalStates,
      vocComments: vocFiltered
        .map(v => ({ text: v.text, mood: v.sentiment || 'indeterminate' }))
        .filter(c => sentimentFilter.length === 0 || sentimentFilter.includes(c.mood)),
      vocExportRows: vocFiltered.map(v => ({ participantId: v.participantId ?? '', text: v.text, mood: v.sentiment })),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- filterByParticipant depends on filteredParticipantIds
  }, [data, timeRange, filteredParticipantIds, sentimentFilter]);

  // CES scale config from backend (supports 1-5, 1-7, 1-10)
  const cesMax = data?.scaleConfigs?.ces?.max ?? 5;

  // Check which metrics have actual data (all-time, for panel visibility)
  const hasCSAT = hasScores(data?.metrics.csatScores);
  const hasCES = hasScores(data?.metrics.cesScores);
  const hasCV = hasScores(data?.metrics.cvScores);
  const hasNEV = data?.nevResponsesData && data.nevResponsesData.length > 0;
  const hasNPS = hasScores(data?.metrics.npsScores);
  const hasVOC = data?.vocResponses && data.vocResponses.length > 0;

  // Build MetricCard chart data: group filtered scores by day for all time ranges
  const buildChartData = (
    scores: Array<{ value: number; date: string; participantId?: string }>,
    positiveFn: (v: number) => boolean,
    negativeFn: (v: number) => boolean
  ) => {
    const filtered2 = filterByTimeRange(filterByParticipant(scores), timeRange);
    const byDay = new Map<string, number[]>();
    filtered2.forEach(s => {
      const dayKey = new Date(s.date).toDateString();
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(s.value);
    });
    return Array.from(byDay.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([dayKey, vals]) => ({
        date: new Date(dayKey).toISOString().split('T')[0],
        satisfied: vals.length > 0 ? Math.round((vals.filter(positiveFn).length / vals.length) * 100) : 0,
        dissatisfied: vals.length > 0 ? Math.round((vals.filter(negativeFn).length / vals.length) * 100) : 0,
      }));
  };

  const csatChartData = buildChartData(data?.metrics.csatScores || [], v => v >= 4, v => v <= 2);
  const cesChartZones = getCESZones(data?.scaleConfigs?.ces?.max ?? 5);
  const cesChartData = buildChartData(data?.metrics.cesScores || [], v => v >= cesChartZones.positive[0] && v <= cesChartZones.positive[1], v => v >= cesChartZones.negative[0] && v <= cesChartZones.negative[1]);
  const cvChartData = buildChartData(data?.metrics.cvScores || [], v => v >= 4, v => v <= 2);

  // Filter visible metric cards — scores from filtered data
  const visibleMetricCards = [
    { show: hasCSAT, component: <MetricCard key="csat" title="Customer Satisfaction" abbreviation="CSAT" score={calculateCSAT(filtered?.csatValues)} question="How satisfied are you with our service?" monthlyData={csatChartData} /> },
    { show: hasCES, component: <MetricCard key="ces" title="Customer Effort Score" abbreviation="CES" score={calculateCES(filtered?.cesValues, cesMax)} question="How easy was it to use our service?" monthlyData={cesChartData} /> },
    { show: hasCV, component: <MetricCard key="cv" title="Cognitive Value" abbreviation="CV" score={calculateCV(filtered?.cvValues)} question="How valuable do you find our service?" monthlyData={cvChartData} /> }
  ].filter(card => card.show);
  // Determinar clases de grid para métricas
  const gridColsClass =
    visibleMetricCards.length === 1 ? 'grid-cols-1 md:grid-cols-1' :
    visibleMetricCards.length === 2 ? 'grid-cols-1 md:grid-cols-2' :
    'grid-cols-1 md:grid-cols-3';

  // Generate question cards — all using filtered data
  const qt = data?.questionTexts || {};
  const cesZones = getCESZones(cesMax);
  let questionCounter = 0;
  const questionCards = [];

  if (hasCSAT) {
    questionCounter++;
    questionCards.push(
      <QuestionCard
        key="csat-detail"
        questionNumber={`2.${questionCounter}`}
        title="CSAT"
        questionText={qt.csat || 'How satisfied are you with our service?'}
        score={Math.round(calculateCSAT(filtered?.csatValues))}
        responses={filtered?.csatValues?.length || 0}
        breakdown={[
          { label: 'Promoters', percentage: safeCalculatePercentage(filtered?.csatValues, (score) => score >= 4), color: 'bg-green-500' },
          { label: 'Neutrals', percentage: safeCalculatePercentage(filtered?.csatValues, (score) => score === 3), color: 'bg-gray-400' },
          { label: 'Detractors', percentage: safeCalculatePercentage(filtered?.csatValues, (score) => score <= 2), color: 'bg-red-500' }
        ]}
      />
    );
  }

  if (hasCES) {
    questionCounter++;
    questionCards.push(
      <QuestionCard
        key="ces-detail"
        questionNumber={`2.${questionCounter}`}
        title="CES"
        questionText={qt.ces || 'How easy was it to use our service?'}
        score={Math.round(calculateCES(filtered?.cesValues, cesMax))}
        responses={filtered?.cesValues?.length || 0}
        breakdown={[
          { label: 'Little effort', percentage: safeCalculatePercentage(filtered?.cesValues, (s) => s >= cesZones.positive[0] && s <= cesZones.positive[1]), color: 'bg-green-500' },
          { label: 'Neutral', percentage: safeCalculatePercentage(filtered?.cesValues, (s) => s >= cesZones.neutral[0] && s <= cesZones.neutral[1]), color: 'bg-gray-400' },
          { label: 'Much effort', percentage: safeCalculatePercentage(filtered?.cesValues, (s) => s >= cesZones.negative[0] && s <= cesZones.negative[1]), color: 'bg-red-500' }
        ]}
      />
    );
  }

  if (hasCV) {
    questionCounter++;
    questionCards.push(
      <QuestionCard
        key="cv-detail"
        questionNumber={`2.${questionCounter}`}
        title="CV"
        questionText={qt.cv || 'How valuable do you find our service?'}
        score={Math.round(calculateCV(filtered?.cvValues))}
        responses={filtered?.cvValues?.length || 0}
        breakdown={[
          { label: 'Worth', percentage: safeCalculatePercentage(filtered?.cvValues, (score) => score >= 4), color: 'bg-green-500' },
          { label: 'Neutrals', percentage: safeCalculatePercentage(filtered?.cvValues, (score) => score === 3), color: 'bg-gray-400' },
          { label: 'Worthless', percentage: safeCalculatePercentage(filtered?.cvValues, (score) => score <= 2), color: 'bg-red-500' }
        ]}
      />
    );
  }

  if (hasNEV) {
    questionCounter++;
    const states = filtered?.emotionalStates || {};
    const totalEmotions = Object.values(states).reduce((sum, count) => sum + count, 0);

    const canonicalIds = new Set(NEV_EMOTIONS.map(e => e.id));
    const emotionalStatesList = [
      ...NEV_EMOTIONS.map(e => ({
        name: e.label,
        value: totalEmotions > 0 && states[e.id] ? Math.round((states[e.id] / totalEmotions) * 100) : 0,
        isPositive: e.isPositive
      })),
      ...Object.keys(states)
        .filter(k => !canonicalIds.has(k))
        .map(k => ({
          name: k,
          value: totalEmotions > 0 ? Math.round((states[k] / totalEmotions) * 100) : 0,
          isPositive: false
        }))
    ];

    const { longTerm, shortTerm } = buildNevValueBlocks(states);

    questionCards.push(
      <NEVQuestionCard
        key="nev-detail"
        questionNumber={`2.${questionCounter}`}
        title="Net Emotional Value (NEV)"
        nevScore={longTerm.nev}
        emotionalStates={emotionalStatesList}
        longTerm={longTerm}
        shortTerm={shortTerm}
      />
    );
  }

  if (hasNPS) {
    questionCounter++;
    // Agrupar scores filtrados por demografía + tiempo (all ranges use filtered individual scores)
    const filteredScores = filterByTimeRange(filterByParticipant(data?.metrics.npsScores || []), timeRange);
    const byDay = new Map<string, number[]>();
    filteredScores.forEach(item => {
      const dayKey = new Date(item.date).toDateString();
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(item.value);
    });
    const npsChartData = Array.from(byDay.entries())
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([dayKey, scores]) => {
        const p = scores.filter(s => s >= 9).length;
        const n = scores.filter(s => s >= 7 && s <= 8).length;
        const d = scores.filter(s => s <= 6).length;
        const total = p + n + d || 1;
        const nps = scores.length > 0 ? Math.round(((p - d) / scores.length) * 100) : 0;
        return {
          month: new Date(dayKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          promoters: Math.round((p / total) * 100),
          neutrals: Math.round((n / total) * 100),
          detractors: Math.round((d / total) * 100),
          npsRatio: nps,
          date: dayKey
        };
      });
    questionCards.push(
      <NPSAnalysis
        key="nps-detail"
        monthlyData={npsChartData}
        score={filtered?.npsScore || 0}
        promoters={filtered?.promoters || 0}
        neutrals={filtered?.neutrals || 0}
        detractors={filtered?.detractors || 0}
        totalResponses={filtered?.npsValues?.length || 0}
        questionText={qt.nps || 'On a scale from 0-10, how likely are you to recommend us to a friend or colleague?'}
        questionNumber={`2.${questionCounter}`}
        title="NPS"
      />
    );
  }

  if (hasVOC) {
    questionCounter++;
    questionCards.push(
      <VOCComments
        key="voc-detail"
        questionNumber={`2.${questionCounter}`}
        questionText={qt.voc || 'Voice of Customer'}
        comments={filtered?.vocComments || []}
        researchId={researchId}
        cognitiveExportRows={filtered?.vocExportRows}
        moduleId="voc"
        filteredParticipantIds={filteredParticipantIds}
      />
    );
  }

  return (
    <ResultsStateHandler
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      loadingSkeleton={<SmartVOCResultsSkeleton />}
    >
      {/* Mensaje aclaratorio sobre tiempo real */}
      {!isLive && (
        <div className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <p className="text-xs text-yellow-700">
            <strong>Note:</strong> Results are not updated in real time. To see the latest data, reconnect monitoring or reload the page.
          </p>
        </div>
      )}
      <div className={cn('flex gap-6', className)}>
        {/* Left: Main scrollable content */}
        <div className="flex-1">
          {/* Sticky top bar: CPV + Time Range Selector */}
          <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm pb-3 mb-4">
            <div className="flex items-center gap-4">
              <CPVCard value={filtered?.cpvValue || 0} />
              <div className="flex gap-2">
                {([
                  { value: 'today' as const, label: 'Today' },
                  { value: 'week' as const, label: 'Week' },
                  { value: 'month' as const, label: 'Month' },
                  { value: '6months' as const, label: '6M' },
                  { value: '12months' as const, label: '12M' },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setTimeRange(value)}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded-full transition-colors',
                      timeRange === value
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Trust Flow Chart — full width */}
          <div className="mb-6">
            <TrustFlowChart
              dailyData={trustFlowDailyData}
              intradayData={trustFlowIntradayData}
              timeRange={timeRange}
            />
          </div>

          {/* Metrics Cards: Only show cards with data */}
          {visibleMetricCards.length > 0 && (
            <div className={cn('grid gap-6 mb-6', gridColsClass)}>
              {visibleMetricCards.map(card => card.component)}
            </div>
          )}

          {/* Question Cards */}
          <div className="space-y-6">
            {questionCards.length > 0 ? (
              questionCards
            ) : (
              <div className="text-center p-12 bg-gray-50 rounded-xl">
                <p className="text-sm font-semibold text-gray-700 mb-1">No SmartVOC data available yet</p>
                <p className="text-[13px] text-gray-400">Share the survey link with participants to start collecting responses.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Filters — fixed column */}
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
            sentimentFilter={sentimentFilter}
            onSentimentFilterChange={setSentimentFilter}
          />
        </div>
      </div>
    </ResultsStateHandler>
  );
};
