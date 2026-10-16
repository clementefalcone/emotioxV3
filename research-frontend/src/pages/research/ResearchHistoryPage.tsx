import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { enterprisesService, type Enterprise, type EnterpriseResearch } from '../../services/enterprises.service';
import { researchService } from '../../services/research.service';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { useToast } from '../../hooks/useToast';
import { buildMonthlyCreations } from '../../utils/monthlyCreations';

const STATUS_STYLES: Record<string, { dot: string; bg: string; text: string }> = {
    draft:     { dot: 'bg-gray-400',    bg: 'bg-gray-50',    text: 'text-gray-600' },
    active:    { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    completed: { dot: 'bg-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700' },
    archived:  { dot: 'bg-orange-400',  bg: 'bg-orange-50',  text: 'text-orange-700' },
};

export const ResearchHistoryPage = () => {
    const navigate = useNavigate();
    const toast = useToast();

    const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
    const [selectedEnterpriseId, setSelectedEnterpriseId] = useState('');
    const [selectedEnterprise, setSelectedEnterprise] = useState<Enterprise | null>(null);
    const [researches, setResearches] = useState<EnterpriseResearch[]>([]);
    const [loading, setLoading] = useState(true);
    const [monthsShown, setMonthsShown] = useState<number | null>(null);

    useEffect(() => {
        enterprisesService.list().then(res => {
            setEnterprises(res.enterprises);
            if (res.enterprises.length > 0) setSelectedEnterpriseId(res.enterprises[0].id);
        }).catch(() => toast.error('Failed to load clients')).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedEnterpriseId) return;
        setSelectedEnterprise(enterprises.find(e => e.id === selectedEnterpriseId) || null);
        setMonthsShown(null);
        enterprisesService.listResearches(selectedEnterpriseId)
            .then(res => setResearches(res.researches))
            .catch(() => setResearches([]));
    }, [selectedEnterpriseId, enterprises]);

    const allMonths = useMemo(() => buildMonthlyCreations(researches, new Date()), [researches]);
    const visibleMonthCount = Math.min(monthsShown ?? allMonths.length, allMonths.length);
    const chartData = allMonths.slice(allMonths.length - visibleMonthCount);

    const stats = useMemo(() => {
        const byStatus = { draft: 0, active: 0, completed: 0 };
        const types = new Set<string>();
        for (const r of researches) {
            const s = r.status as keyof typeof byStatus;
            if (s in byStatus) byStatus[s]++;
            if (r.research_type_name) types.add(r.research_type_name);
        }
        return { ...byStatus, total: researches.length, types: Array.from(types) };
    }, [researches]);

    const handleDelete = async (research: EnterpriseResearch) => {
        if (!confirm(`Delete "${research.name}"?`)) return;
        try {
            await researchService.delete(research.id);
            setResearches(prev => prev.filter(r => r.id !== research.id));
            toast.success('Deleted');
        } catch { toast.error('Failed to delete'); }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">History</h1>
                    <p className="text-[13px] text-gray-400 mt-0.5">Research activity per client</p>
                </div>
                <div className="w-48 flex-shrink-0">
                    <CustomSelect
                        value={selectedEnterpriseId}
                        onChange={setSelectedEnterpriseId}
                        options={enterprises.map(ent => ({ value: ent.id, label: ent.name }))}
                        placeholder="Select client"
                    />
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
                {loading ? (
                    <div className="space-y-4 animate-pulse">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div className="lg:col-span-2 h-64 bg-gray-100 rounded-xl" />
                            <div className="h-64 bg-gray-100 rounded-xl" />
                        </div>
                        <div className="h-40 bg-gray-100 rounded-xl" />
                    </div>
                ) : (
                <>
                {/* Top row: Chart + Client Info */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Chart */}
                    <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-white p-4">
                        <div className="flex items-center gap-3 mb-3">
                            <h2 className="text-[13px] font-semibold text-gray-900">{selectedEnterprise?.name || 'Client'}</h2>
                            <span className="text-[11px] text-gray-400">{researches.length} project{researches.length !== 1 ? 's' : ''}</span>
                            {allMonths.length > 1 && (
                                <div className="ml-auto flex items-center gap-2">
                                    <span className="text-[11px] text-gray-500 whitespace-nowrap">Last</span>
                                    <input
                                        type="range"
                                        min={1}
                                        max={allMonths.length}
                                        value={visibleMonthCount}
                                        onChange={(e) => setMonthsShown(Number(e.target.value))}
                                        aria-label="Months shown"
                                        className="w-32 h-1.5 accent-blue-600"
                                    />
                                    <span className="text-[11px] text-gray-700 font-medium whitespace-nowrap w-16">{visibleMonthCount} month{visibleMonthCount !== 1 ? 's' : ''}</span>
                                </div>
                            )}
                        </div>
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} axisLine={false} tickLine={false} width={28} />
                                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                                    <Bar dataKey="completed" stackId="a" fill="#3b82f6" name="Completed" />
                                    <Bar dataKey="active" stackId="a" fill="#10b981" name="Active" />
                                    <Bar dataKey="draft" stackId="a" fill="#f59e0b" name="Draft" radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-[220px] flex items-center justify-center text-[13px] text-gray-400">
                                Activity history will appear as researches are created and modified.
                            </div>
                        )}
                    </div>

                    {/* Client Info */}
                    <div className="rounded-xl border border-gray-100 bg-white p-4">
                        <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Client</h2>
                        <h3 className="text-base font-semibold text-gray-900 mb-2">{selectedEnterprise?.name || '—'}</h3>

                        {selectedEnterprise?.description && (
                            <p className="text-[13px] text-gray-500 leading-relaxed mb-4">{selectedEnterprise.description}</p>
                        )}

                        {stats.total > 0 && (
                            <div className="space-y-3">
                                <div className="grid grid-cols-3 gap-2">
                                    {([['draft', 'Draft', 'bg-amber-50 text-amber-700'], ['active', 'Active', 'bg-emerald-50 text-emerald-700'], ['completed', 'Done', 'bg-blue-50 text-blue-700']] as const).map(([key, label, cls]) => (
                                        <div key={key} className={`text-center p-2 rounded-lg ${cls}`}>
                                            <p className="text-lg font-semibold">{stats[key]}</p>
                                            <p className="text-[10px] font-medium uppercase">{label}</p>
                                        </div>
                                    ))}
                                </div>
                                {stats.types.length > 0 && (
                                    <div>
                                        <p className="text-[11px] text-gray-400 uppercase font-medium mb-1.5">Types</p>
                                        <div className="flex flex-wrap gap-1">
                                            {stats.types.map(t => (
                                                <span key={t} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">{t}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {stats.total === 0 && !selectedEnterprise?.description && (
                            <p className="text-[13px] text-gray-400">Activity history will appear as researches are created and modified.</p>
                        )}
                    </div>
                </div>

                {/* Research table */}
                <div className="rounded-xl border border-gray-100 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50/80 border-b border-gray-100">
                            <tr>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Name</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Type</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Status</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Created</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden xl:table-cell">Researcher</th>
                                <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {researches.length === 0 ? (
                                <tr><td colSpan={6} className="px-3 py-12 text-center text-[13px] text-gray-400">No projects found for this client. Create a research to get started.</td></tr>
                            ) : researches.map(r => {
                                const s = STATUS_STYLES[r.status] ?? STATUS_STYLES.draft;
                                return (
                                    <tr key={r.id} className="group hover:bg-gray-50/80 cursor-pointer transition-colors" onClick={() => navigate(`/research/${r.id}/builder`)}>
                                        <td className="px-3 py-2.5 text-[13px] font-medium text-gray-900 max-w-[200px] truncate">{r.name}</td>
                                        <td className="px-3 py-2.5 text-[13px] text-gray-500 hidden md:table-cell">{r.research_type_name || '—'}</td>
                                        <td className="px-3 py-2.5">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${s.bg} ${s.text}`}>
                                                <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                                                {r.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-[13px] text-gray-400 hidden lg:table-cell">
                                            {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="px-3 py-2.5 text-[13px] text-gray-500 hidden xl:table-cell truncate max-w-[140px]">
                                            {[r.creator_first_name, r.creator_last_name].filter(Boolean).join(' ') || r.creator_email || '—'}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                                <button onClick={() => navigate(`/research/${r.id}/builder`)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Open">
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </button>
                                                <button onClick={() => handleDelete(r)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors" title="Delete">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                </>
                )}
            </div>
        </div>
    );
};
