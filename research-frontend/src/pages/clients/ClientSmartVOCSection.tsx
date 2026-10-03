import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { ClientSmartVOCSummary, SmartVOCMetricKey } from './clientSmartVocSummary';

const METRICS: { key: SmartVOCMetricKey; label: string; color: string }[] = [
    { key: 'nps', label: 'NPS', color: '#006AFF' },
    { key: 'csat', label: 'CSAT', color: '#D97706' },
    { key: 'ces', label: 'CES', color: '#0D9488' },
    { key: 'cv', label: 'CV', color: '#E11D48' },
];

const NPS_SEGMENTS = [
    { key: 'promoters', label: 'Promotores', color: '#059669' },
    { key: 'neutrals', label: 'Neutros', color: '#94A3B8' },
    { key: 'detractors', label: 'Detractores', color: '#E11D48' },
] as const;

const AXIS_TICK = { fontSize: 11, fill: '#64748B' };
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' };
const TOOLTIP_ITEM_STYLE = { color: '#334155' };
const SCORE_DOMAIN: [number, number] = [-100, 100];
const METRIC_ORDER = Object.fromEntries(METRICS.map((m, index) => [m.key, index]));
const sortByMetricOrder = (item: { dataKey?: unknown }) => METRIC_ORDER[String(item.dataKey)];

const formatMonth = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString('es-CL', { month: 'short', year: '2-digit' });

const SectionTitle = ({ title, caption }: { title: string; caption?: string }) => (
    <div className="flex items-baseline gap-2 mb-3">
        <h3 className="text-[12px] font-semibold text-slate-900">{title}</h3>
        {caption && <span className="text-[11px] text-slate-500">{caption}</span>}
    </div>
);

const MetricTiles = ({ summary }: { summary: ClientSmartVOCSummary }) => (
    <div className="flex flex-wrap gap-3">
        {METRICS.filter(m => summary.total[m.key] !== null).map(m => (
            <div key={m.key} className="flex-1 min-w-[140px] rounded-lg bg-slate-50 p-3">
                <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                    <span className="text-[11px] font-medium text-slate-500 uppercase">{m.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900 mt-1">{summary.total[m.key]}</p>
            </div>
        ))}
    </div>
);

const NpsDistribution = ({ summary }: { summary: ClientSmartVOCSummary }) => {
    const { promoters, neutrals, detractors } = summary.total;
    const total = promoters + neutrals + detractors;
    if (total === 0) return null;
    const percent = (count: number) => Math.round((count / total) * 100);

    return (
        <div>
            <SectionTitle title="Distribución NPS" caption={`${total} respuestas`} />
            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded">
                {NPS_SEGMENTS.filter(s => summary.total[s.key] > 0).map(s => (
                    <div
                        key={s.key}
                        title={`${s.label}: ${summary.total[s.key]} (${percent(summary.total[s.key])}%)`}
                        style={{ width: `${percent(summary.total[s.key])}%`, backgroundColor: s.color }}
                    />
                ))}
            </div>
            <div className="flex flex-wrap gap-4 mt-2">
                {NPS_SEGMENTS.map(s => (
                    <div key={s.key} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                        {s.label} <span className="font-semibold text-slate-900">{percent(summary.total[s.key])}%</span>
                        <span className="text-slate-400">({summary.total[s.key]})</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const StudyComparisonChart = ({ summary }: { summary: ClientSmartVOCSummary }) => {
    const visibleMetrics = METRICS.filter(m => summary.studies.some(s => s[m.key] !== null));
    const hasMultipleClients = new Set(summary.studies.map(s => s.enterpriseName)).size > 1;
    const data = summary.studies.map(s => ({
        ...s,
        label: hasMultipleClients ? `${s.name} · ${s.enterpriseName ?? 'Sin cliente'}` : s.name,
    }));
    return (
        <div>
            <SectionTitle title="Comparación por estudio" caption="Puntaje -100 a 100 (CSAT 0 a 100)" />
            <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data} barGap={2} barCategoryGap="24%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
                    <YAxis domain={SCORE_DOMAIN} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
                    <ReferenceLine y={0} stroke="#9CA3AF" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} cursor={{ fill: '#F1F5F9' }} itemSorter={sortByMetricOrder} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} itemSorter={null} />
                    {visibleMetrics.map(m => (
                        <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

const MonthlyTrendChart = ({ summary }: { summary: ClientSmartVOCSummary }) => {
    const visibleMetrics = METRICS.filter(m => summary.months.some(month => month[m.key] !== null));
    const data = summary.months.map(month => ({ ...month, label: `${formatMonth(month.month)} · n=${month.responses}` }));
    return (
        <div>
            <SectionTitle title="Tendencia mensual" caption="Todas las respuestas del cliente por mes (n = respuestas)" />
            <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis domain={SCORE_DOMAIN} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
                    <ReferenceLine y={0} stroke="#9CA3AF" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} itemSorter={sortByMetricOrder} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} itemSorter={null} />
                    {visibleMetrics.map(m => (
                        <Line key={m.key} dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2} dot={{ r: 4 }} connectNulls type="linear" />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export const ClientSmartVOCSection = ({ summary }: { summary: ClientSmartVOCSummary }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-4 flex flex-col gap-5">
        <div className="flex items-center gap-3">
            <h2 className="text-[13px] font-semibold text-gray-900">SmartVOC Consolidado</h2>
            <span className="text-[11px] text-gray-400">
                {summary.studies.length} estudio{summary.studies.length !== 1 ? 's' : ''} · {summary.total.responses} participantes
            </span>
        </div>
        <MetricTiles summary={summary} />
        <NpsDistribution summary={summary} />
        <div className="flex flex-col xl:flex-row gap-5">
            <div className="flex-1 min-w-0"><StudyComparisonChart summary={summary} /></div>
            {summary.months.length > 1 && <div className="flex-1 min-w-0"><MonthlyTrendChart summary={summary} /></div>}
        </div>
    </div>
);
