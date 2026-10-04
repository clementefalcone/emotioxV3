import { useState, useEffect } from 'react';
import { FileText, Plus, Pencil, Trash2, Link, FlaskConical, Search } from 'lucide-react';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { AssignTechniquesModal } from '../../components/research-types/AssignTechniquesModal';
import { researchTypesService, type ResearchType } from '../../services/researchTypes.service';
import { researchTechniquesService, type ResearchTechnique } from '../../services/researchTechniques.service';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../stores/auth.store';

export const ResearchTypesPage = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
    const [searchQuery, setSearchQuery] = useState('');

    const [researchTypes, setResearchTypes] = useState<ResearchType[]>([]);
    const [isLoadingTypes, setIsLoadingTypes] = useState(true);
    const [typesError, setTypesError] = useState<string | null>(null);

    const [researchTechniques, setResearchTechniques] = useState<ResearchTechnique[]>([]);
    const [isLoadingTechniques, setIsLoadingTechniques] = useState(true);
    const [techniquesError, setTechniquesError] = useState<string | null>(null);

    const [deleteTypeModalOpen, setDeleteTypeModalOpen] = useState(false);
    const [typeToDelete, setTypeToDelete] = useState<ResearchType | null>(null);
    const [isDeletingType, setIsDeletingType] = useState(false);

    const [deleteTechniqueModalOpen, setDeleteTechniqueModalOpen] = useState(false);
    const [techniqueToDelete, setTechniqueToDelete] = useState<ResearchTechnique | null>(null);
    const [isDeletingTechnique, setIsDeletingTechnique] = useState(false);

    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [typeToAssign, setTypeToAssign] = useState<ResearchType | null>(null);

    useEffect(() => { loadResearchTypes(); loadResearchTechniques(); }, []);

    const loadResearchTypes = async () => {
        try { setIsLoadingTypes(true); const res = await researchTypesService.list(); setResearchTypes(res.researchTypes); }
        catch { setTypesError('Failed to load research types'); }
        finally { setIsLoadingTypes(false); }
    };

    const loadResearchTechniques = async () => {
        try { setIsLoadingTechniques(true); const res = await researchTechniquesService.list(); setResearchTechniques(res.researchTechniques); }
        catch { setTechniquesError('Failed to load techniques'); }
        finally { setIsLoadingTechniques(false); }
    };

    const handleConfirmDeleteType = async () => {
        if (!typeToDelete) return;
        try { setIsDeletingType(true); await researchTypesService.delete(typeToDelete.id); await loadResearchTypes(); setDeleteTypeModalOpen(false); setTypeToDelete(null); toast.success('Type deleted'); }
        catch { toast.error('Failed to delete type'); }
        finally { setIsDeletingType(false); }
    };

    const handleConfirmDeleteTechnique = async () => {
        if (!techniqueToDelete) return;
        try { setIsDeletingTechnique(true); await researchTechniquesService.delete(techniqueToDelete.id); await loadResearchTechniques(); setDeleteTechniqueModalOpen(false); setTechniqueToDelete(null); toast.success('Technique deleted'); }
        catch { toast.error('Failed to delete technique'); }
        finally { setIsDeletingTechnique(false); }
    };

    const q = searchQuery.toLowerCase();
    const filteredTypes = researchTypes.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
    const filteredTechniques = researchTechniques.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">Research Types</h1>
                    <p className="text-[13px] text-gray-400 mt-0.5">Manage types and techniques</p>
                </div>
                {isAdmin && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigate('/research-types/new')}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors active:scale-[0.98]"
                        >
                            <Plus className="h-3.5 w-3.5" /> New Type
                        </button>
                        <button
                            onClick={() => navigate('/research-techniques/new')}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            <Plus className="h-3.5 w-3.5" /> New Technique
                        </button>
                    </div>
                )}
            </div>

            {/* Search */}
            <div className="px-6 pb-3 flex-shrink-0">
                <div className="relative w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search types and techniques..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
                    />
                </div>
            </div>

            {/* Two columns */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 px-6 pb-4">
                {/* Research Types */}
                <div className="flex flex-col min-h-0 rounded-xl border border-gray-100 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/80 flex-shrink-0">
                        <FileText className="h-3.5 w-3.5 text-gray-400" />
                        <h2 className="text-[13px] font-semibold text-gray-700">Types</h2>
                        <span className="text-[11px] text-gray-400 ml-auto">{filteredTypes.length}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                        {isLoadingTypes ? (
                            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-gray-100 rounded-xl" />)}</div>
                        ) : typesError ? (
                            <p className="text-[13px] text-red-600 text-center py-8">{typesError}</p>
                        ) : filteredTypes.length === 0 ? (
                            <div className="text-center py-12">
                                <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                                <p className="text-[13px] text-gray-400">{searchQuery ? 'No types match search' : 'Create a research type to organize your studies.'}</p>
                            </div>
                        ) : filteredTypes.map(type => (
                            <div key={type.id} className="group rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-gray-200 transition-all">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-[13px] font-medium text-gray-900 truncate">{type.name}</h3>
                                        <p className="text-[11px] text-gray-400 mt-0.5">
                                            Updated {new Date(type.updated_at || type.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </p>
                                    </div>
                                    {isAdmin && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                            <button
                                                onClick={() => { setTypeToAssign(type); setAssignModalOpen(true); }}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors"
                                                title="Assign techniques"
                                            >
                                                <Link className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => navigate(`/research-types/${type.id}`)}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors"
                                                title="Edit"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => { setTypeToDelete(type); setDeleteTypeModalOpen(true); }}
                                                className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Research Techniques */}
                <div className="flex flex-col min-h-0 rounded-xl border border-gray-100 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/80 flex-shrink-0">
                        <FlaskConical className="h-3.5 w-3.5 text-gray-400" />
                        <h2 className="text-[13px] font-semibold text-gray-700">Techniques</h2>
                        <span className="text-[11px] text-gray-400 ml-auto">{filteredTechniques.length}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                        {isLoadingTechniques ? (
                            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-gray-100 rounded-xl" />)}</div>
                        ) : techniquesError ? (
                            <p className="text-[13px] text-red-600 text-center py-8">{techniquesError}</p>
                        ) : filteredTechniques.length === 0 ? (
                            <div className="text-center py-12">
                                <FlaskConical className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                                <p className="text-[13px] text-gray-400">{searchQuery ? 'No techniques match search' : 'Create a technique to define default stages for your studies.'}</p>
                            </div>
                        ) : filteredTechniques.map(technique => (
                            <div key={technique.id} className="group rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-gray-200 transition-all">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-[13px] font-medium text-gray-900">{technique.name}</h3>
                                        {technique.description && (
                                            <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{technique.description}</p>
                                        )}
                                    </div>
                                    {isAdmin && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                            <button
                                                onClick={() => navigate(`/research-techniques/${technique.id}`)}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors"
                                                title="Edit"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => { setTechniqueToDelete(technique); setDeleteTechniqueModalOpen(true); }}
                                                className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <ConfirmationModal isOpen={deleteTypeModalOpen} onClose={() => setDeleteTypeModalOpen(false)} onConfirm={handleConfirmDeleteType}
                title="Delete Research Type" message={`Delete "${typeToDelete?.name}"? This cannot be undone.`} confirmText="Delete" variant="danger" isLoading={isDeletingType} />
            <ConfirmationModal isOpen={deleteTechniqueModalOpen} onClose={() => setDeleteTechniqueModalOpen(false)} onConfirm={handleConfirmDeleteTechnique}
                title="Delete Technique" message={`Delete "${techniqueToDelete?.name}"? This cannot be undone.`} confirmText="Delete" variant="danger" isLoading={isDeletingTechnique} />
            <AssignTechniquesModal isOpen={assignModalOpen} onClose={() => setAssignModalOpen(false)} researchType={typeToAssign} onSuccess={async () => { await loadResearchTypes(); }} />
        </div>
    );
};
