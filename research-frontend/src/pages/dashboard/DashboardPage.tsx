import { useState, useMemo, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResearches, useDeleteResearch, useDuplicateResearch, useDashboardSummary, useArchiveResearch, useUnarchiveResearch } from '../../hooks/useResearchQuery';
import { useResearchTypes } from '../../hooks/useResearchTypesQuery';
import { useAuthStore } from '../../stores/auth.store';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { Trash2, Copy, Users, FileText, BarChart3, CheckCircle, Archive, ArchiveRestore, Search, X, Plus } from 'lucide-react';
import { CustomSelect } from '../../components/ui/CustomSelect';
import type { Research, DashboardSummary } from '../../services/research.service';

/* ─── Summary Card ──────────────────────────────────────────────── */

/** Tiny inline sparkline from an array of numbers */
const Sparkline = memo(({ data, color }: { data: number[]; color: string }) => {
    if (data.length < 2) return null;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const w = 64;
    const h = 24;
    const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
    return (
        <svg width={w} height={h} className="flex-shrink-0">
            <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
});
Sparkline.displayName = 'Sparkline';

const SummaryCard = memo(({ label, value, icon: Icon, accent, trend, sparkData, sparkColor }: {
    label: string;
    value: string | number;
    icon: React.ElementType;
    accent: string;
    trend?: { value: number; label: string } | null;
    sparkData?: number[];
    sparkColor?: string;
}) => (
    <div className="flex items-center gap-3.5 rounded-xl border border-gray-200 bg-white px-4 py-3.5">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${accent}`}>
            <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
                <p className="text-[22px] font-semibold text-gray-900 leading-tight">{value}</p>
                {trend && trend.value !== 0 && (
                    <span className={`text-[11px] font-medium ${trend.value > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {trend.value > 0 ? '+' : ''}{trend.value} {trend.label}
                    </span>
                )}
            </div>
            <p className="text-[11px] text-gray-400 leading-tight mt-0.5">{label}</p>
        </div>
        {sparkData && sparkData.length >= 2 && (
            <Sparkline data={sparkData} color={sparkColor ?? '#9ca3af'} />
        )}
    </div>
));
SummaryCard.displayName = 'SummaryCard';

/* ─── Status Badge ──────────────────────────────────────────────── */

const STATUS_STYLES: Record<string, { dot: string; bg: string; text: string }> = {
    active:    { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    approved:  { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    completed: { dot: 'bg-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700' },
    closed:    { dot: 'bg-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700' },
    draft:     { dot: 'bg-gray-400',    bg: 'bg-gray-50',    text: 'text-gray-600' },
    pending:   { dot: 'bg-amber-500',   bg: 'bg-amber-50',   text: 'text-amber-700' },
    rejected:  { dot: 'bg-red-500',     bg: 'bg-red-50',     text: 'text-red-700' },
};

const StatusBadge = ({ status, archived }: { status: string; archived: boolean }) => {
    const s = archived
        ? { dot: 'bg-orange-400', bg: 'bg-orange-50', text: 'text-orange-700' }
        : STATUS_STYLES[status.toLowerCase()] ?? { dot: 'bg-gray-400', bg: 'bg-gray-50', text: 'text-gray-600' };
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-full ${s.bg} ${s.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {archived ? 'archived' : status}
        </span>
    );
};

/* ─── Research Table Row ────────────────────────────────────────── */

const ResearchTableRow = memo(({
    research,
    participantCount,
    index,
    onRowClick,
    onDelete,
    onDuplicate,
    onArchive,
}: {
    research: Research;
    participantCount: number;
    index: number;
    onRowClick: (id: string) => void;
    onDelete: (research: Research, e: React.MouseEvent) => void;
    onDuplicate: (research: Research, e: React.MouseEvent) => void;
    onArchive: (research: Research, e: React.MouseEvent) => void;
}) => {
    const isArchived = Boolean(research.archived_at);
    const creatorName = [research.creator_first_name, research.creator_last_name].filter(Boolean).join(' ');

    return (
        <tr
            onClick={() => onRowClick(research.id)}
            className={`group hover:bg-gray-50/80 cursor-pointer transition-colors ${isArchived ? 'opacity-50' : ''}`}
        >
            <td className="px-1.5 py-2.5 whitespace-nowrap text-[11px] text-gray-400 w-6 text-center">
                {index}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap">
                <div className="text-[13px] font-medium text-gray-900">{research.name}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{research.research_technique_name || ''}</div>
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap">
                <StatusBadge status={research.status} archived={isArchived} />
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap hidden md:table-cell">
                <span className="text-[13px] text-gray-500 truncate max-w-[120px] block">{creatorName || '—'}</span>
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-gray-500 hidden lg:table-cell truncate max-w-[120px]">
                {research.enterprise_name || '—'}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-gray-500 hidden lg:table-cell">
                {participantCount > 0 ? participantCount : '—'}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-gray-400 hidden xl:table-cell">
                {new Date(research.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                })}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap">
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => onDuplicate(research, e)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Duplicate">
                        <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={(e) => onArchive(research, e)} className={`p-1.5 text-gray-400 rounded-md transition-colors ${isArchived ? 'hover:text-green-600 hover:bg-green-50' : 'hover:text-orange-600 hover:bg-orange-50'}`} title={isArchived ? 'Unarchive' : 'Archive'}>
                        {isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={(e) => onDelete(research, e)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </td>
        </tr>
    );
});
ResearchTableRow.displayName = 'ResearchTableRow';

/* ─── Table Skeleton ────────────────────────────────────────────── */

const TableSkeletonRow = memo(() => (
    <tr className="animate-pulse">
        <td className="px-3 py-3"><div className="h-4 bg-gray-100 rounded w-32" /></td>
        <td className="px-3 py-3"><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
        <td className="px-3 py-3 hidden md:table-cell"><div className="h-4 bg-gray-100 rounded w-20" /></td>
        <td className="px-3 py-3 hidden lg:table-cell"><div className="h-4 bg-gray-100 rounded w-20" /></td>
        <td className="px-3 py-3 hidden lg:table-cell"><div className="h-4 bg-gray-100 rounded w-12" /></td>
        <td className="px-3 py-3 hidden xl:table-cell"><div className="h-4 bg-gray-100 rounded w-20" /></td>
        <td className="px-3 py-3"><div className="h-4 w-4 bg-gray-100 rounded" /></td>
    </tr>
));
TableSkeletonRow.displayName = 'TableSkeletonRow';

/* ─── Summary Cards (with trends + sparklines) ─────────────────── */

function monthOverMonthTrend(series: number[]) {
    if (series.length < 2) return null;
    return { value: series[series.length - 1] - series[series.length - 2], label: 'this month' };
}

function SummaryCards({ summary }: { summary: DashboardSummary | undefined }) {
    const researchSpark = summary?.researchesOverTime?.map(d => d.count) ?? [];
    const participantSpark = summary?.participantsOverTime?.map(d => d.count) ?? [];

    // Month-over-month trend: last vs previous
    const researchTrend = monthOverMonthTrend(researchSpark);
    const participantTrend = monthOverMonthTrend(participantSpark);

    const activeCount = summary?.byStatus?.active ?? 0;
    const draftCount = summary?.byStatus?.draft ?? 0;

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 flex-shrink-0">
            <SummaryCard
                label="Researches"
                value={summary?.totalResearches ?? '—'}
                icon={FileText}
                accent="bg-blue-50 text-blue-600"
                trend={researchTrend}
                sparkData={researchSpark}
                sparkColor="#3b82f6"
            />
            <SummaryCard
                label="Active Studies"
                value={activeCount}
                icon={BarChart3}
                accent="bg-emerald-50 text-emerald-600"
                trend={draftCount > 0 ? { value: draftCount, label: 'drafts' } : null}
            />
            <SummaryCard
                label="Participants"
                value={summary?.totalParticipants ?? '—'}
                icon={Users}
                accent="bg-violet-50 text-violet-600"
                trend={participantTrend}
                sparkData={participantSpark}
                sparkColor="#8b5cf6"
            />
            <SummaryCard
                label="Avg. Completion"
                value={summary ? `${summary.avgCompletionRate}%` : '—'}
                icon={CheckCircle}
                accent="bg-amber-50 text-amber-600"
            />
        </div>
    );
}

/* ─── Main Dashboard ────────────────────────────────────────────── */

export const DashboardPage = () => {
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const { data: researches = [], isLoading } = useResearches();
    const { data: researchTypes = [] } = useResearchTypes();
    const { data: summary } = useDashboardSummary();
    const deleteResearch = useDeleteResearch();
    const duplicateResearch = useDuplicateResearch();
    const archiveResearch = useArchiveResearch();
    const unarchiveResearch = useUnarchiveResearch();

    const typedResearches = researches as Research[];
    const typedResearchTypes = researchTypes as Array<{ id: string; name: string }>;

    const [activeFilter, setActiveFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [techniqueFilter, setTechniqueFilter] = useState<string>('all');
    const [enterpriseFilter, setEnterpriseFilter] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [researchToDelete, setResearchToDelete] = useState<Research | null>(null);
    const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
    const [researchToDuplicate, setResearchToDuplicate] = useState<Research | null>(null);
    const [duplicateName, setDuplicateName] = useState('');

    const techniques = useMemo(() => {
        const set = new Map<string, string>();
        for (const r of typedResearches) {
            if (r.research_technique_name) set.set(r.research_technique_name, r.research_technique_name);
        }
        return Array.from(set.values()).sort();
    }, [typedResearches]);

    const enterprises = useMemo(() => {
        const set = new Map<string, string>();
        for (const r of typedResearches) {
            if (r.enterprise_name) set.set(r.enterprise_name, r.enterprise_name);
        }
        return Array.from(set.values()).sort();
    }, [typedResearches]);

    const hasActiveFilters = activeFilter !== 'all' || statusFilter !== 'all' || techniqueFilter !== 'all' || enterpriseFilter !== 'all' || dateFrom || dateTo || searchQuery.trim();

    const clearAllFilters = useCallback(() => {
        setActiveFilter('all');
        setStatusFilter('all');
        setTechniqueFilter('all');
        setEnterpriseFilter('all');
        setDateFrom('');
        setDateTo('');
        setSearchQuery('');
    }, []);

    const filteredResearches = useMemo(() => {
        let result = typedResearches;
        if (!showArchived) result = result.filter(r => !r.archived_at);
        if (activeFilter !== 'all') result = result.filter(r => r.research_type_id === activeFilter);
        if (statusFilter !== 'all') result = result.filter(r => r.status.toLowerCase() === statusFilter);
        if (techniqueFilter !== 'all') result = result.filter(r => r.research_technique_name === techniqueFilter);
        if (enterpriseFilter !== 'all') result = result.filter(r => r.enterprise_name === enterpriseFilter);
        if (dateFrom) result = result.filter(r => r.created_at >= dateFrom);
        if (dateTo) { const toEnd = dateTo + 'T23:59:59'; result = result.filter(r => r.created_at <= toEnd); }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(r => {
                const creatorName = [r.creator_first_name, r.creator_last_name].filter(Boolean).join(' ').toLowerCase();
                return r.name.toLowerCase().includes(q) ||
                    creatorName.includes(q) ||
                    (r.creator_email?.toLowerCase().includes(q) ?? false) ||
                    (r.research_technique_name?.toLowerCase().includes(q) ?? false) ||
                    (r.research_type_name?.toLowerCase().includes(q) ?? false) ||
                    (r.enterprise_name?.toLowerCase().includes(q) ?? false);
            });
        }
        return result;
    }, [typedResearches, activeFilter, statusFilter, searchQuery, showArchived, techniqueFilter, enterpriseFilter, dateFrom, dateTo]);

    const metricsMap = useMemo(() => {
        const map = new Map<string, { participants: number; responses: number }>();
        if (summary?.topResearches) {
            for (const r of summary.topResearches) {
                map.set(r.id, { participants: r.participantCount, responses: r.responseCount });
            }
        }
        return map;
    }, [summary]);

    const handleDeleteClick = useCallback((research: Research, e: React.MouseEvent) => {
        e.stopPropagation();
        setResearchToDelete(research);
        setDeleteModalOpen(true);
    }, []);

    const handleConfirmDelete = useCallback(async () => {
        if (!researchToDelete) return;
        try {
            await deleteResearch.mutateAsync(researchToDelete.id);
            setDeleteModalOpen(false);
            setResearchToDelete(null);
        } catch (error) {
            console.error('Failed to delete research:', error);
        }
    }, [researchToDelete, deleteResearch]);

    const handleDuplicateClick = useCallback((research: Research, e: React.MouseEvent) => {
        e.stopPropagation();
        setResearchToDuplicate(research);
        setDuplicateName(`${research.name} - Copy`);
        setDuplicateModalOpen(true);
    }, []);

    const handleDuplicateConfirm = useCallback(async () => {
        if (!researchToDuplicate) return;
        try {
            await duplicateResearch.mutateAsync({ id: researchToDuplicate.id, name: duplicateName });
            setDuplicateModalOpen(false);
            setResearchToDuplicate(null);
        } catch (error) {
            console.error('Failed to duplicate research:', error);
        }
    }, [researchToDuplicate, duplicateName, duplicateResearch]);

    const handleArchiveClick = useCallback((research: Research, e: React.MouseEvent) => {
        e.stopPropagation();
        if (research.archived_at) {
            unarchiveResearch.mutate(research.id);
        } else {
            archiveResearch.mutate(research.id);
        }
    }, [archiveResearch, unarchiveResearch]);

    const handleRowClick = useCallback((researchId: string) => {
        navigate(`/research/${researchId}/builder`);
    }, [navigate]);

    const greeting = user?.first_name ? `Welcome back, ${user.first_name}` : 'Welcome back';

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">{greeting}</h1>
                    <p className="text-[13px] text-gray-400 mt-0.5">Here's what's happening with your research</p>
                </div>
                <button
                    onClick={() => navigate('/research')}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors active:scale-[0.98]"
                >
                    <Plus className="h-4 w-4" />
                    New Research
                </button>
            </div>

            {/* Summary Cards */}
            <SummaryCards summary={summary} />

            {/* Main Content */}
            <div className="flex flex-col xl:flex-row gap-3 flex-1 min-h-0 px-6 py-4">
                {/* Left: Research Table */}
                <div className="flex-1 rounded-xl border border-gray-200 bg-white overflow-hidden min-w-0 flex flex-col min-h-0">
                    {/* Search + filters */}
                    <div className="px-3 pt-3 pb-2 border-b border-gray-100 flex-shrink-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-shrink-0">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8 pr-3 h-10 text-sm border border-gray-200 rounded-lg w-48 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400"
                                />
                            </div>

                            {techniques.length > 1 && (
                                <div className="w-40">
                                    <CustomSelect
                                        value={techniqueFilter}
                                        onChange={(v) => setTechniqueFilter(v)}
                                        options={[
                                            { value: 'all', label: 'All techniques' },
                                            ...techniques.map(t => ({ value: t, label: t })),
                                        ]}
                                        placeholder="All techniques"
                                    />
                                </div>
                            )}

                            {enterprises.length > 1 && (
                                <div className="w-40">
                                    <CustomSelect
                                        value={enterpriseFilter}
                                        onChange={(v) => setEnterpriseFilter(v)}
                                        options={[
                                            { value: 'all', label: 'All enterprises' },
                                            ...enterprises.map(e => ({ value: e, label: e })),
                                        ]}
                                        placeholder="All enterprises"
                                    />
                                </div>
                            )}

                            <div className="flex items-center gap-1 flex-shrink-0">
                                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                    className={`px-3 h-10 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 ${dateFrom ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`}
                                    title="From date" />
                                <span className="text-xs text-gray-300">–</span>
                                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                    className={`px-3 h-10 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 ${dateTo ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`}
                                    title="To date" />
                            </div>

                            <button
                                onClick={() => setShowArchived(!showArchived)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                                    showArchived ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'text-gray-500 hover:bg-gray-50 border border-transparent'
                                }`}
                            >
                                <Archive className="h-3 w-3" />
                                {showArchived ? 'Archived' : 'Archived'}
                            </button>

                            {hasActiveFilters && (
                                <button onClick={clearAllFilters} className="px-2 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1">
                                    <X className="h-3 w-3" />
                                    Clear
                                </button>
                            )}
                        </div>

                        {/* Type + Status pills */}
                        <div className="flex items-center gap-1 flex-wrap">
                            <button
                                onClick={() => setActiveFilter('all')}
                                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                                    activeFilter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                                }`}
                            >
                                All
                            </button>
                            {typedResearchTypes.map(type => (
                                <button
                                    key={type.id}
                                    onClick={() => setActiveFilter(type.id)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                                        activeFilter === type.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                                    }`}
                                >
                                    {type.name}
                                </button>
                            ))}

                            <span className="w-px h-4 bg-gray-200 mx-1" />

                            {['active', 'draft', 'completed'].map(s => {
                                const st = STATUS_STYLES[s] ?? STATUS_STYLES.draft;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                                            statusFilter === s ? `${st.bg} ${st.text}` : 'text-gray-500 hover:bg-gray-100'
                                        }`}
                                    >
                                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                                        {s.charAt(0).toUpperCase() + s.slice(1)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className={`flex-1 min-h-0 ${filteredResearches.length > 0 || isLoading ? 'overflow-auto' : 'overflow-hidden'}`}>
                        <table className="w-full min-w-[600px] table-fixed">
                            <thead className="bg-gray-50/80 border-b border-gray-100 sticky top-0 z-10">
                                <tr>
                                    <th className="px-3 py-2 text-center text-[11px] font-medium text-gray-400 uppercase tracking-wider w-6">#</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider w-[26%]">Name</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider w-[10%]">Status</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell w-[12%]">Author</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell w-[12%]">Enterprise</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell w-[10%]">Participants</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden xl:table-cell w-[12%]">Created</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider w-[10%]"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {isLoading ? (
                                    [...Array(5)].map((_, i) => <TableSkeletonRow key={i} />)
                                ) : filteredResearches.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-16 text-center">
                                            {(researches as Research[]).length === 0 && !hasActiveFilters ? (
                                                <div className="flex flex-col items-center">
                                                    <FileText className="h-10 w-10 text-gray-300 mb-3" />
                                                    <p className="text-sm font-semibold text-gray-700 mb-1">No research projects yet</p>
                                                    <p className="text-[13px] text-gray-400 mb-4">Create your first research to start collecting data.</p>
                                                    <button
                                                        onClick={() => navigate('/research')}
                                                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                        New Research
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <p className="text-sm text-gray-400">No researches found</p>
                                                    {hasActiveFilters && (
                                                        <button onClick={clearAllFilters} className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
                                                            Clear filters
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredResearches.map((research, i) => (
                                        <ResearchTableRow
                                            key={research.id}
                                            research={research}
                                            participantCount={metricsMap.get(research.id)?.participants ?? 0}
                                            index={i + 1}
                                            onRowClick={handleRowClick}
                                            onDelete={handleDeleteClick}
                                            onDuplicate={handleDuplicateClick}
                                            onArchive={handleArchiveClick}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Right Panel — Metrics Trends */}
                {summary?.metricsTrends && summary.metricsTrends.some(m => m.avgNps !== null || m.avgCsat !== null || m.avgCes !== null) && (
                    <div className="w-full xl:w-64 flex-shrink-0">
                        <div className="rounded-xl border border-gray-100 bg-white p-4">
                            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Metrics</h3>
                            <div className="space-y-2.5">
                                {(['avgNps', 'avgCsat', 'avgCes'] as const).map(metric => {
                                    const label = metric === 'avgNps' ? 'NPS' : metric === 'avgCsat' ? 'CSAT' : 'CES';
                                    const dot = metric === 'avgNps' ? 'bg-blue-500' : metric === 'avgCsat' ? 'bg-emerald-500' : 'bg-amber-500';
                                    const values = summary.metricsTrends.filter(m => m[metric] !== null);
                                    if (values.length === 0) return null;
                                    const latest = values[values.length - 1]?.[metric];
                                    const prev = values.length >= 2 ? values[values.length - 2]?.[metric] : null;
                                    const trend = latest !== null && prev !== null ? (latest as number) - (prev as number) : null;
                                    return (
                                        <div key={metric} className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={`h-2 w-2 rounded-full ${dot}`} />
                                                <span className="text-[13px] text-gray-600">{label}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[13px] font-semibold text-gray-900">{latest}</span>
                                                {trend !== null && (
                                                    <span className={`text-[11px] font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                        {trend >= 0 ? '+' : ''}{Math.round(trend * 10) / 10}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                title="Delete Research"
                message={`Are you sure you want to delete "${researchToDelete?.name}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
                isLoading={deleteResearch.isPending}
            />

            {/* Duplicate modal */}
            {duplicateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4 border border-gray-200/60">
                        <h3 className="text-base font-semibold text-gray-900 mb-1">Duplicate Research</h3>
                        <p className="text-[13px] text-gray-500 mb-4">Enter a name for the copy:</p>
                        <input
                            type="text"
                            value={duplicateName}
                            onChange={(e) => setDuplicateName(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 mb-4"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter' && duplicateName.trim()) handleDuplicateConfirm(); }}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => { setDuplicateModalOpen(false); setResearchToDuplicate(null); }}
                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDuplicateConfirm}
                                disabled={!duplicateName.trim() || duplicateResearch.isPending}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {duplicateResearch.isPending ? 'Duplicating...' : 'Duplicate'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
