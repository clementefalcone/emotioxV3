import { useState, useCallback, memo, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CreateResearchForm } from '../../components/research/CreateResearchForm';
import { CreateResearchTechniqueModal } from '../../components/research/CreateResearchTechniqueModal';
import { CreateEnterpriseModal } from '../../components/research/CreateEnterpriseModal';
import { useResearches, useDeleteResearch, useDuplicateResearch } from '../../hooks/useResearchQuery';
import { useIsViewer } from '../../hooks/useIsViewer';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { Drawer } from '../../components/ui/Drawer';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { ResearchCardSkeleton } from '../../components/ui/Skeleton';
import { ArrowRight, Calendar, Clock, Folder, Plus, Trash2, FlaskConical, Building2, Copy, List, LayoutGrid, ExternalLink, User, UserPlus, Loader2, X, Search, Archive } from 'lucide-react';
import { researchService } from '../../services/research.service';
import { researchTechniquesService } from '../../services/researchTechniques.service';
import { researchTypesService } from '../../services/researchTypes.service';
import apiClient from '../../services/api/client';
import type { Research } from '../../services/research.service';
import type { ResearchTechnique } from '../../services/researchTechniques.service';
import type { ResearchType } from '../../services/researchTypes.service';

/* ─── Status helpers ────────────────────────────────────────────── */

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

/* ─── Inline rename input ───────────────────────────────────────── */

const InlineRename = ({ name, onRename }: { name: string; onRename: (newName: string) => void }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(name);

    if (isEditing) {
        return (
            <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => { if (editName.trim() && editName.trim() !== name) onRename(editName.trim()); setIsEditing(false); }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { if (editName.trim() && editName.trim() !== name) onRename(editName.trim()); setIsEditing(false); }
                    if (e.key === 'Escape') { setEditName(name); setIsEditing(false); }
                }}
                className="text-[13px] font-medium text-gray-900 w-full px-1 py-0.5 border border-blue-400 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
            />
        );
    }
    return (
        <span
            className="text-[13px] font-medium text-gray-900 cursor-text hover:text-blue-600 transition-colors"
            onDoubleClick={() => { setEditName(name); setIsEditing(true); }}
            title="Double-click to rename"
        >
            {name}
        </span>
    );
};

/* ─── Research Card ─────────────────────────────────────────────── */

const ResearchCard = memo(({
    research,
    onResearchClick,
    onDelete,
    onDuplicate,
    onRename,
    readOnly = false,
}: {
    research: Research;
    onResearchClick: (id: string) => void;
    onDelete: (research: Research, e: React.MouseEvent) => void;
    onDuplicate: (research: Research) => void;
    onRename: (research: Research, newName: string) => void;
    readOnly?: boolean;
}) => {
    const isArchived = Boolean(research.archived_at);
    const creatorName = [research.creator_first_name, research.creator_last_name].filter(Boolean).join(' ') || null;
    const formattedDate = new Date(research.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const formattedUpdatedAt = research.updated_at
        ? new Date(research.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null;

    return (
        <div
            className={`group rounded-xl border border-gray-100 bg-white px-5 py-4 hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer ${isArchived ? 'opacity-50' : ''}`}
            onClick={() => onResearchClick(research.id)}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1.5" onClick={e => e.stopPropagation()}>
                        <InlineRename name={research.name} onRename={(n) => onRename(research, n)} />
                        <StatusBadge status={research.status} archived={isArchived} />
                    </div>

                    {research.description && (
                        <p className="text-[13px] text-gray-500 mb-2 line-clamp-1">{research.description}</p>
                    )}

                    <div className="flex items-center gap-4 text-[12px] text-gray-400 flex-wrap">
                        {creatorName && (
                            <span className="flex items-center gap-1.5">
                                <User className="h-3 w-3" />
                                {creatorName}
                            </span>
                        )}
                        <span className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3" />
                            {formattedDate}
                        </span>
                        {formattedUpdatedAt && formattedUpdatedAt !== formattedDate && (
                            <span className="flex items-center gap-1.5">
                                <Clock className="h-3 w-3" />
                                {formattedUpdatedAt}
                            </span>
                        )}
                        {research.research_type_name && (
                            <span className="flex items-center gap-1.5">
                                <Folder className="h-3 w-3" />
                                {research.research_type_name}
                            </span>
                        )}
                        {research.research_technique_name && (
                            <span className="flex items-center gap-1.5">
                                <FlaskConical className="h-3 w-3" />
                                {research.research_technique_name}
                            </span>
                        )}
                        {research.enterprise_name && (
                            <span className="flex items-center gap-1.5">
                                <Building2 className="h-3 w-3" />
                                {research.enterprise_name}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {!readOnly && (
                        <>
                            <button onClick={() => onDuplicate(research)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Duplicate">
                                <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={(e) => onDelete(research, e)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}
                    <button className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Open">
                        <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
});
ResearchCard.displayName = 'ResearchCard';

/* ─── Research Table Row ────────────────────────────────────────── */

const ResearchTableRow = memo(({
    research,
    onOpen,
    onDelete,
    onDuplicate,
    onRename,
    readOnly = false,
}: {
    research: Research;
    onOpen: (id: string) => void;
    onDelete: (research: Research, e: React.MouseEvent) => void;
    onDuplicate: (research: Research) => void;
    onRename: (research: Research, newName: string) => void;
    readOnly?: boolean;
}) => {
    const isArchived = Boolean(research.archived_at);
    const creatorName = [research.creator_first_name, research.creator_last_name].filter(Boolean).join(' ') || '—';

    return (
        <tr
            onClick={() => onOpen(research.id)}
            className={`group hover:bg-gray-50/80 cursor-pointer transition-colors ${isArchived ? 'opacity-50' : ''}`}
        >
            <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                <InlineRename name={research.name} onRename={(n) => onRename(research, n)} />
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap">
                <StatusBadge status={research.status} archived={isArchived} />
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-gray-500 hidden md:table-cell">
                {research.research_type_name || '—'}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-gray-500 hidden xl:table-cell">
                {creatorName}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-gray-400 hidden md:table-cell">
                {new Date(research.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-gray-400 hidden lg:table-cell">
                {research.research_technique_name || '—'}
            </td>
            <td className="px-3 py-2.5 whitespace-nowrap">
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onOpen(research.id); }} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Open">
                        <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                    {!readOnly && (
                        <>
                            <button onClick={(e) => { e.stopPropagation(); onDuplicate(research); }} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Duplicate">
                                <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={(e) => onDelete(research, e)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}
                </div>
            </td>
        </tr>
    );
});
ResearchTableRow.displayName = 'ResearchTableRow';

/* ─── Main Research Page ────────────────────────────────────────── */

export const ResearchPage = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const isViewer = useIsViewer();
    const [showTechniqueModal, setShowTechniqueModal] = useState(false);
    const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [researchToDelete, setResearchToDelete] = useState<Research | null>(null);
    const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
    const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
    const [researchToDuplicate, setResearchToDuplicate] = useState<Research | null>(null);
    const [duplicateName, setDuplicateName] = useState('');
    const [showInviteDrawer, setShowInviteDrawer] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteEmails, setInviteEmails] = useState<string[]>([]);
    const [inviteLoading, setInviteLoading] = useState(false);
    const [inviteResult, setInviteResult] = useState<{ sent: string[]; failed: Array<{ email: string; message: string }> } | null>(null);
    const [viewers, setViewers] = useState<Array<{ id: string; email: string; firstName: string | null; lastName: string | null; createdAt: string }>>([]);
    const [viewersLoading, setViewersLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [techniqueFilter, setTechniqueFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [enterpriseFilter, setEnterpriseFilter] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [showArchived, setShowArchived] = useState(false);

    useEffect(() => {
        if (searchParams.get('inviteViewer') !== '1') return;
        setShowInviteDrawer(true);
        setInviteResult(null);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('inviteViewer');
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const loadViewers = useCallback(async () => {
        setViewersLoading(true);
        try {
            const res = await apiClient.get<{ viewers: typeof viewers }>('/users/viewers');
            setViewers(res.viewers || []);
        } catch { setViewers([]); }
        finally { setViewersLoading(false); }
    }, []);

    useEffect(() => {
        if (showInviteDrawer) void loadViewers();
    }, [showInviteDrawer, loadViewers]);

    const { data: researches = [], isLoading, error } = useResearches();
    const deleteResearch = useDeleteResearch();
    const duplicateResearch = useDuplicateResearch();
    const typedResearches = researches as Research[];

    const [allTechniques, setAllTechniques] = useState<ResearchTechnique[]>([]);
    const [allTypes, setAllTypes] = useState<ResearchType[]>([]);
    useEffect(() => {
        researchTechniquesService.list().then(res => setAllTechniques(res.researchTechniques || [])).catch(() => setAllTechniques([]));
        researchTypesService.list().then(res => setAllTypes(res.researchTypes || [])).catch(() => setAllTypes([]));
    }, []);

    const techniquesWithResearches = useMemo(() => {
        const set = new Set<string>();
        for (const r of typedResearches) if (r.research_technique_name) set.add(r.research_technique_name);
        return set;
    }, [typedResearches]);

    const techniqueOptions = useMemo(() => [
        { value: 'all', label: 'All techniques' },
        ...allTechniques.map(t => ({ value: t.name, label: t.name, disabled: !techniquesWithResearches.has(t.name) })),
    ], [allTechniques, techniquesWithResearches]);

    const typesWithResearches = useMemo(() => {
        const set = new Set<string>();
        for (const r of typedResearches) if (r.research_type_name) set.add(r.research_type_name);
        return set;
    }, [typedResearches]);

    const typeOptions = useMemo(() => [
        { value: 'all', label: 'All types' },
        ...allTypes.map(t => ({ value: t.name, label: t.name, disabled: !typesWithResearches.has(t.name) })),
    ], [allTypes, typesWithResearches]);

    const enterpriseNames = useMemo(() => {
        const set = new Set<string>();
        for (const r of typedResearches) if (r.enterprise_name) set.add(r.enterprise_name);
        return Array.from(set).sort();
    }, [typedResearches]);

    const hasActiveFilters = techniqueFilter !== 'all' || typeFilter !== 'all' || enterpriseFilter !== 'all' || dateFrom || dateTo || searchQuery.trim();

    const clearAllFilters = useCallback(() => {
        setSearchQuery(''); setTechniqueFilter('all'); setTypeFilter('all'); setEnterpriseFilter('all'); setDateFrom(''); setDateTo('');
    }, []);

    const filteredResearches = useMemo(() => {
        let result = typedResearches;
        if (!showArchived) result = result.filter(r => !r.archived_at);
        if (techniqueFilter !== 'all') result = result.filter(r => r.research_technique_name === techniqueFilter);
        if (typeFilter !== 'all') result = result.filter(r => r.research_type_name === typeFilter);
        if (enterpriseFilter !== 'all') result = result.filter(r => r.enterprise_name === enterpriseFilter);
        if (dateFrom) result = result.filter(r => r.created_at >= dateFrom);
        if (dateTo) result = result.filter(r => r.created_at <= dateTo + 'T23:59:59');
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(r => {
                const creator = [r.creator_first_name, r.creator_last_name].filter(Boolean).join(' ').toLowerCase();
                return r.name.toLowerCase().includes(q) || creator.includes(q) ||
                    (r.creator_email?.toLowerCase().includes(q) ?? false) ||
                    (r.research_technique_name?.toLowerCase().includes(q) ?? false) ||
                    (r.enterprise_name?.toLowerCase().includes(q) ?? false) ||
                    (r.research_type_name?.toLowerCase().includes(q) ?? false);
            });
        }
        return result;
    }, [typedResearches, searchQuery, techniqueFilter, typeFilter, enterpriseFilter, dateFrom, dateTo, showArchived]);

    const handleResearchClick = useCallback((id: string) => navigate(`/research/${id}/builder`), [navigate]);
    const handleDeleteClick = useCallback((research: Research, e: React.MouseEvent) => { e.stopPropagation(); setResearchToDelete(research); setDeleteModalOpen(true); }, []);
    const handleConfirmDelete = useCallback(async () => {
        if (!researchToDelete) return;
        try { await deleteResearch.mutateAsync(researchToDelete.id); setDeleteModalOpen(false); setResearchToDelete(null); }
        catch (error) { console.error('Failed to delete research:', error); }
    }, [researchToDelete, deleteResearch]);
    const handleRename = useCallback(async (research: Research, newName: string) => {
        try { await researchService.update(research.id, { name: newName }); queryClient.invalidateQueries({ queryKey: ['research'] }); }
        catch (error) { console.error('Failed to rename research:', error); }
    }, [queryClient]);
    const handleDuplicateClick = useCallback((research: Research) => { setResearchToDuplicate(research); setDuplicateName(`${research.name} - Copy`); setDuplicateModalOpen(true); }, []);
    const handleDuplicateConfirm = useCallback(async () => {
        if (!researchToDuplicate) return;
        try { await duplicateResearch.mutateAsync({ id: researchToDuplicate.id, name: duplicateName }); setDuplicateModalOpen(false); setResearchToDuplicate(null); }
        catch (error) { console.error('Failed to duplicate research:', error); }
    }, [researchToDuplicate, duplicateName, duplicateResearch]);

    const handleAddInviteEmail = useCallback(() => {
        const email = inviteEmail.trim().toLowerCase();
        if (!email || !email.includes('@') || inviteEmails.includes(email)) return;
        setInviteEmails(prev => [...prev, email]); setInviteEmail('');
    }, [inviteEmail, inviteEmails]);
    const handleRemoveInviteEmail = useCallback((email: string) => { setInviteEmails(prev => prev.filter(item => item !== email)); }, []);
    const handleInviteViewer = useCallback(async () => {
        if (inviteEmails.length === 0) return;
        setInviteLoading(true); setInviteResult(null);
        const sent: string[] = []; const failed: Array<{ email: string; message: string }> = [];
        try {
            for (const email of inviteEmails) {
                try { await apiClient.post('/users/invite', { email }); sent.push(email); }
                catch (err: unknown) { failed.push({ email, message: err instanceof Error ? err.message : 'Failed' }); }
            }
            setInviteResult({ sent, failed });
            if (sent.length > 0) { setInviteEmails(failed.map(item => item.email)); void loadViewers(); }
        } finally { setInviteLoading(false); }
    }, [inviteEmails, loadViewers]);

    /* ─── Create form (full page) ─── */
    if (showCreateForm) {
        return (
            <div className="h-full p-6">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold text-gray-900">Create Research</h1>
                        <p className="text-[13px] text-gray-400 mt-0.5">Set up a new research project</p>
                    </div>
                    <button onClick={() => setShowCreateForm(false)} className="text-[13px] font-medium text-gray-500 hover:text-gray-700 transition-colors">
                        ← Back to list
                    </button>
                </div>
                <CreateResearchForm onSuccess={() => setShowCreateForm(false)} />
                <CreateResearchTechniqueModal isOpen={showTechniqueModal} onClose={() => setShowTechniqueModal(false)} />
                <CreateEnterpriseModal isOpen={showEnterpriseModal} onClose={() => setShowEnterpriseModal(false)} />
            </div>
        );
    }

    /* ─── Main ─── */
    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-semibold text-gray-900">Research</h1>
                    <span className="text-[13px] text-gray-400">{filteredResearches.length} project{filteredResearches.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                    {/* View toggle */}
                    <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                        <button
                            onClick={() => setViewMode('cards')}
                            className={`p-1.5 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                            title="Card view"
                        >
                            <LayoutGrid className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                            title="Table view"
                        >
                            <List className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    {!isViewer && (
                        <>
                            <button
                                onClick={() => { setShowInviteDrawer(true); setInviteResult(null); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                <UserPlus className="h-3.5 w-3.5" />
                                Invite
                            </button>
                            <button
                                onClick={() => setShowCreateForm(true)}
                                className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors active:scale-[0.98]"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                New Research
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 px-6 pb-3 flex-shrink-0">
                <div className="relative flex-shrink-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-48 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400"
                    />
                </div>

                {allTechniques.length > 0 && (
                    <div className="w-40">
                        <CustomSelect
                            options={techniqueOptions}
                            value={techniqueFilter}
                            onChange={(v) => setTechniqueFilter(v)}
                            placeholder="All techniques"
                            className={`!h-[30px] !text-xs !py-0 ${techniqueFilter !== 'all' ? '!border-blue-300 !bg-blue-50 !text-blue-700' : '!border-gray-200 !text-gray-500'}`}
                        />
                    </div>
                )}

                {allTypes.length > 0 && (
                    <div className="w-40">
                        <CustomSelect
                            options={typeOptions}
                            value={typeFilter}
                            onChange={(v) => setTypeFilter(v)}
                            placeholder="All types"
                            className={`!h-[30px] !text-xs !py-0 ${typeFilter !== 'all' ? '!border-blue-300 !bg-blue-50 !text-blue-700' : '!border-gray-200 !text-gray-500'}`}
                        />
                    </div>
                )}

                {enterpriseNames.length > 1 && (
                    <div className="w-40">
                        <CustomSelect
                            options={[{ value: 'all', label: 'All enterprises' }, ...enterpriseNames.map(e => ({ value: e, label: e }))]}
                            value={enterpriseFilter}
                            onChange={(v) => setEnterpriseFilter(v)}
                            placeholder="All enterprises"
                            className={`!h-[30px] !text-xs !py-0 ${enterpriseFilter !== 'all' ? '!border-blue-300 !bg-blue-50 !text-blue-700' : '!border-gray-200 !text-gray-500'}`}
                        />
                    </div>
                )}

                <div className="flex items-center gap-1 flex-shrink-0">
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                        className={`px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 ${dateFrom ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`} title="From date" />
                    <span className="text-xs text-gray-300">–</span>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                        className={`px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 ${dateTo ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`} title="To date" />
                </div>

                <button
                    onClick={() => setShowArchived(!showArchived)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${showArchived ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'text-gray-500 hover:bg-gray-50 border border-transparent'}`}
                >
                    <Archive className="h-3 w-3" />
                    Archived
                </button>

                {hasActiveFilters && (
                    <button onClick={clearAllFilters} className="px-2 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1">
                        <X className="h-3 w-3" /> Clear
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
                {isLoading ? (
                    <div className="space-y-2">
                        <ResearchCardSkeleton /><ResearchCardSkeleton /><ResearchCardSkeleton />
                    </div>
                ) : error ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
                        <h2 className="text-base font-semibold text-red-800 mb-1">Error Loading Researches</h2>
                        <p className="text-[13px] text-red-600 mb-4">{error instanceof Error ? error.message : 'Failed to load'}</p>
                        <button onClick={() => window.location.reload()} className="text-sm font-medium text-red-700 hover:text-red-800">Try Again</button>
                    </div>
                ) : typedResearches.length === 0 ? (
                    <div className="rounded-xl border border-gray-100 bg-white p-16 text-center">
                        <Folder className="mx-auto h-10 w-10 text-gray-300 mb-3" />
                        <h3 className="text-base font-medium text-gray-900 mb-1">No Research Projects Yet</h3>
                        <p className="text-[13px] text-gray-400 mb-5">{isViewer ? 'No projects available.' : 'Create your first research project'}</p>
                        {!isViewer && (
                            <Button onClick={() => setShowCreateForm(true)}>
                                <Plus className="h-4 w-4 mr-1.5" /> Create Research
                            </Button>
                        )}
                    </div>
                ) : filteredResearches.length === 0 ? (
                    <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
                        <Search className="mx-auto h-8 w-8 text-gray-300 mb-2" />
                        <p className="text-[13px] text-gray-400 mb-2">No researches match filters</p>
                        <button onClick={clearAllFilters} className="text-[13px] text-blue-600 hover:text-blue-700 font-medium">Clear filters</button>
                    </div>
                ) : viewMode === 'cards' ? (
                    <div className="space-y-2">
                        {filteredResearches.map(research => (
                            <ResearchCard
                                key={research.id}
                                research={research}
                                onResearchClick={handleResearchClick}
                                onDelete={handleDeleteClick}
                                onDuplicate={handleDuplicateClick}
                                onRename={handleRename}
                                readOnly={isViewer}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-xl border border-gray-100 overflow-x-auto">
                        <table className="w-full min-w-[600px]">
                            <thead className="bg-gray-50/80 border-b border-gray-100">
                                <tr>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Name</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Status</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Type</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden xl:table-cell">Researcher</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Created</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Technique</th>
                                    <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredResearches.map(research => (
                                    <ResearchTableRow
                                        key={research.id}
                                        research={research}
                                        onOpen={handleResearchClick}
                                        onDelete={handleDeleteClick}
                                        onDuplicate={handleDuplicateClick}
                                        onRename={handleRename}
                                        readOnly={isViewer}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modals */}
            <CreateResearchTechniqueModal isOpen={showTechniqueModal} onClose={() => setShowTechniqueModal(false)} />
            <CreateEnterpriseModal isOpen={showEnterpriseModal} onClose={() => setShowEnterpriseModal(false)} />

            <ConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => { setDeleteModalOpen(false); setResearchToDelete(null); }}
                onConfirm={handleConfirmDelete}
                title="Delete Research"
                message={`Are you sure you want to delete "${researchToDelete?.name}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
                isLoading={deleteResearch.isPending}
            />

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
                            <button onClick={() => { setDuplicateModalOpen(false); setResearchToDuplicate(null); }} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">Cancel</button>
                            <button onClick={handleDuplicateConfirm} disabled={!duplicateName.trim() || duplicateResearch.isPending} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                                {duplicateResearch.isPending ? 'Duplicating...' : 'Duplicate'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Drawer isOpen={showInviteDrawer} onClose={() => setShowInviteDrawer(false)} title="Invite Viewer" width="md"
                footer={
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowInviteDrawer(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">Close</button>
                        <button onClick={handleInviteViewer} disabled={inviteEmails.length === 0 || inviteLoading}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                            {inviteLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : <><UserPlus className="h-4 w-4" /> Send</>}
                        </button>
                    </div>
                }
            >
                <div className="space-y-5">
                    <p className="text-[13px] text-gray-500">They will receive an email with a link to sign in with Google. They will only see the studies you share with them from Share, read-only.</p>
                    <div>
                        <label className="text-[13px] font-medium text-gray-700 mb-1.5 block">Email addresses</label>
                        <div className="flex items-center gap-2">
                            <input type="email" placeholder="email@example.com" value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddInviteEmail(); } }}
                                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" autoFocus />
                            <button onClick={handleAddInviteEmail} disabled={!inviteEmail.trim() || !inviteEmail.includes('@')}
                                className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors">Add</button>
                        </div>
                    </div>
                    {inviteEmails.length > 0 && (
                        <div className="space-y-1.5">
                            {inviteEmails.map(email => (
                                <div key={email} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                    <span className="text-[13px] text-gray-700">{email}</span>
                                    <button onClick={() => handleRemoveInviteEmail(email)} className="text-gray-400 hover:text-red-500 transition-colors"><X className="h-3.5 w-3.5" /></button>
                                </div>
                            ))}
                        </div>
                    )}
                    {inviteResult && (
                        <div className="space-y-2">
                            {inviteResult.sent.length > 0 && <p className="text-[13px] text-emerald-600">Sent {inviteResult.sent.length} invitation{inviteResult.sent.length !== 1 ? 's' : ''}.</p>}
                            {inviteResult.failed.length > 0 && (
                                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                                    <p className="text-[13px] font-medium text-red-700 mb-1">Failed</p>
                                    {inviteResult.failed.map(item => <p key={item.email} className="text-[13px] text-red-600">{item.email}: {item.message}</p>)}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="border-t border-gray-100 pt-4">
                        <h3 className="text-[13px] font-medium text-gray-900 mb-3">
                            Invited viewers {viewers.length > 0 && <span className="text-gray-400">({viewers.length})</span>}
                        </h3>
                        {viewersLoading ? (
                            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-10 bg-gray-100 rounded-lg" />)}</div>
                        ) : viewers.length === 0 ? (
                            <p className="text-[13px] text-gray-400">No viewers invited yet.</p>
                        ) : (
                            <div className="space-y-1.5">
                                {viewers.map(viewer => (
                                    <div key={viewer.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[13px] text-gray-700 truncate">{viewer.email}</p>
                                                {(viewer.firstName || viewer.lastName) && <p className="text-[11px] text-gray-400 truncate">{[viewer.firstName, viewer.lastName].filter(Boolean).join(' ')}</p>}
                                            </div>
                                        </div>
                                        <span className="text-[11px] text-gray-400 whitespace-nowrap ml-3">
                                            {new Date(viewer.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Drawer>
        </div>
    );
};
