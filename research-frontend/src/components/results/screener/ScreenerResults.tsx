import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent } from '../../ui/Card';
import { ResultsStateHandler } from '../shared/ResultsStateHandler';
import { Filters } from '../shared/Filters';
import { useResultsFilter } from '../../../hooks/useResultsFilter';
import { NoMatchingParticipantsNotice } from '../shared/NoMatchingParticipantsNotice';
import { TrendingUp, TrendingDown, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import * as analyticsService from '../../../services/analytics.service';
import type { ScreenerResults as ScreenerResultsType } from '../../../services/analytics.service';

interface ScreenerResultsProps {
  researchId: string;
  className?: string;
}

// Colores para cada choice/route — mismos tonos del diseño de referencia
const ROUTE_COLORS = [
  '#93C5FD', // light blue
  '#3B82F6', // blue
  '#1E3A5F', // dark navy
  '#60A5FA', // medium blue
  '#2563EB', // strong blue
  '#1D4ED8', // darker blue
];

export const ScreenerResults = ({ researchId, className }: ScreenerResultsProps) => {
  const [data, setData] = useState<ScreenerResultsType | null>(null);
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
  const scopeParticipantIds = useMemo(
    () => (filteredParticipantIds ? [...filteredParticipantIds] : undefined),
    [filteredParticipantIds],
  );

  const fetchData = useCallback(async (isCancelled: () => boolean = () => false) => {
    setError(null);
    try {
      const results = await analyticsService.getScreenerResults(researchId, scopeParticipantIds);
      if (!isCancelled()) setData(results);
    } catch (err) {
      if (!isCancelled()) setError(err instanceof Error ? err : new Error(`Failed to load screener results for research ${researchId}`));
    } finally {
      if (!isCancelled()) setIsLoading(false);
    }
  }, [researchId, scopeParticipantIds]);

  useEffect(() => {
    let isCancelled = false;
    fetchData(() => isCancelled);
    return () => { isCancelled = true; };
  }, [fetchData]);

  const loadingSkeleton = (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-96 bg-gray-200 rounded-xl" />
        <div className="space-y-4">
          <div className="h-24 bg-gray-200 rounded-xl" />
          <div className="h-24 bg-gray-200 rounded-xl" />
          <div className="h-24 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  );

  return (
    <ResultsStateHandler
      isLoading={isLoading}
      error={error}
      onRetry={() => fetchData()}
      loadingSkeleton={loadingSkeleton}
    >
      {data && (
        <div className={className ?? ''}>
          {data.questionText ? (
            <h2 className="text-xl font-semibold text-gray-900 mb-6">{data.questionText}</h2>
          ) : null}

          <div className="flex items-start gap-6">
            {filteredParticipantIds?.size === 0 ? (
              <div className="flex-1 min-w-0">
                <NoMatchingParticipantsNotice />
              </div>
            ) : (
              <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-5 gap-6">
                <Card className="lg:col-span-3 rounded-lg shadow-none">
                  <CardContent className="p-6">
                    <DistributionChart data={data} />
                  </CardContent>
                </Card>

                <div className="lg:col-span-2 flex flex-col gap-4">
                  <StatusCard
                    label="Entrevistas con sobrecutoa"
                    count={data.overquota}
                    icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
                  />
                  <StatusCard
                    label="Entrevistas descalificadas"
                    count={data.disqualified}
                    icon={<XCircle className="h-5 w-5 text-red-500" />}
                  />
                  <StatusCard
                    label="Entrevistas completas"
                    count={data.qualified}
                    icon={<CheckCircle className="h-5 w-5 text-green-500" />}
                  />

                  <Card className="flex-1 rounded-lg shadow-none">
                    <CardContent className="p-4 h-full">
                      <WeeklyChart timeSeries={data.weeklyTimeSeries} />
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            <div className="w-80 shrink-0 sticky top-0 max-h-[calc(100vh-8rem)] overflow-y-auto">
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
        </div>
      )}
    </ResultsStateHandler>
  );
};

// ─── Distribution Chart (stacked bar + best/slowest day) ────────────

function DistributionChart({ data }: { data: ScreenerResultsType }) {
  const { dailyDistribution, choiceDistribution, totalResponses, bestDay, slowestDay } = data;

  // Build recharts data: one entry per day, one key per choice label
  const choiceLabels = choiceDistribution.map(c => c.label);
  const chartData = dailyDistribution
    .filter(d => d.count > 0)
    .map(d => {
      const entry: Record<string, string | number> = { date: formatShortDate(d.date) };
      for (const label of choiceLabels) {
        entry[label] = d.byChoice[label] || 0;
      }
      return entry;
    });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Distribución de usuarios</h3>
          <p className="text-xs text-gray-500">Clasificación por respuesta</p>
        </div>
        <span className="text-3xl font-bold text-blue-500">{totalResponses.toLocaleString()}</span>
      </div>

      {/* Stacked bar chart */}
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) => {
                const choice = choiceDistribution.find(c => c.label === value);
                const eligibility = choice?.eligibility === 'Qualify' ? 'clasifica' : choice?.eligibility === 'Disqualify' ? 'descalifica' : choice?.eligibility;
                return `${value} (${eligibility})`;
              }}
            />
            {choiceLabels.map((label, idx) => (
              <Bar
                key={label}
                dataKey={label}
                stackId="routes"
                fill={ROUTE_COLORS[idx % ROUTE_COLORS.length]}
                radius={idx === choiceLabels.length - 1 ? [2, 2, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[220px] flex flex-col items-center justify-center text-center">
          <p className="text-sm font-semibold text-gray-700 mb-1">Sin datos de respuesta aún</p>
          <p className="text-[13px] text-gray-400">Las respuestas aparecerán aquí cuando los participantes completen el screener.</p>
        </div>
      )}

      {/* Best / Slowest day */}
      <div className="mt-4 space-y-3 border-t pt-4">
        {bestDay && (
          <DayRow
            icon={<TrendingUp className="h-5 w-5 text-gray-400" />}
            title="Mejor día de asignación"
            subtitle={`${bestDay.dayName}, ${bestDay.hour}`}
            count={bestDay.count}
            percentage={bestDay.percentage}
          />
        )}
        {slowestDay && (
          <DayRow
            icon={<TrendingDown className="h-5 w-5 text-gray-400" />}
            title="Día más lento"
            subtitle={`${slowestDay.dayName}, ${slowestDay.hour}`}
            count={slowestDay.count}
            percentage={slowestDay.percentage}
          />
        )}
      </div>
    </div>
  );
}

// ─── Weekly Line Chart ──────────────────────────────────────────────

function WeeklyChart({ timeSeries }: { timeSeries: ScreenerResultsType['weeklyTimeSeries'] }) {
  if (timeSeries.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={80}>
      <LineChart data={timeSeries} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <XAxis dataKey="dayName" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 10 }} hide />
        <Tooltip
          formatter={(value: number) => [value, 'Participantes']}
          labelFormatter={(label: string) => `Distribución — ${label}`}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#3B82F6"
          strokeWidth={2}
          dot={{ r: 3, fill: '#3B82F6' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Status Card ────────────────────────────────────────────────────

function StatusCard({ label, count, icon }: { label: string; count: number; icon: React.ReactNode }) {
  return (
    <Card className="rounded-lg shadow-none">
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <span className="text-sm font-medium text-gray-700">{label}</span>
        </div>
        <span className="text-2xl font-bold text-gray-900">{count.toLocaleString()}</span>
      </CardContent>
    </Card>
  );
}

// ─── Day Row ────────────────────────────────────────────────────────

function DayRow({
  icon, title, subtitle, count, percentage,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  percentage: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-gray-900">{count}</p>
        <p className="text-xs text-gray-500">{percentage}%</p>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
