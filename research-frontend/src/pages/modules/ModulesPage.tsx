import { useState, useEffect, useMemo, useRef, useId } from 'react';
import { Boxes, Plus, Trash2, Eye, Copy, CheckSquare, Square, Download, X, SortAsc, Search } from 'lucide-react';
import { ModulePreviewModal } from '../../components/modules/ModulePreviewModal';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { moduleTemplatesService, type ModuleTemplate } from '../../services/moduleTemplates.service';
import { stageTemplatesService } from '../../services/stageTemplates.service';
import type { StageTemplateWithModules } from '../../types/moduleBuilder.types';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../hooks/useToast';
import { ModulesGridSkeleton } from '../../components/ui/Skeleton';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { cn } from '../../lib/utils';
import { flat } from '../../utils/radashi';
import { useModuleTemplates, useModuleTemplate, useDeleteModuleTemplate } from '../../hooks/useModuleTemplatesQuery';
import { useAuthStore } from '../../stores/auth.store';

export const ModulesPage = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
    const sortSelectId = useId();
    
    // React Query hooks
    const { data: allModules = [], isLoading: modulesLoading, error: modulesError } = useModuleTemplates();
    const deleteModuleMutation = useDeleteModuleTemplate();
    
    const [stages, setStages] = useState<StageTemplateWithModules[]>([]);
    const [isLoadingStages, setIsLoadingStages] = useState(true);
    const [selectedModule, setSelectedModule] = useState<ModuleTemplate | null>(null);
    const [previewModuleId, setPreviewModuleId] = useState<string | null>(null);
    const { data: previewModule } = useModuleTemplate(previewModuleId);
    const [showPreview, setShowPreview] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<string | null>(null);
    
    // Computed: ungrouped modules
    const ungroupedModules = useMemo(() => {
        const modulesInStages = new Set(
            flat(stages.map(stage => stage.modules.map(m => m.id)))
        );
        return allModules.filter(m => !modulesInStages.has(m.id));
    }, [allModules, stages]);
    
    // Combined loading and error state
    const isLoading = modulesLoading || isLoadingStages;
    const error = modulesError ? 'Failed to load module templates' : null;

    // Delete modal state
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [moduleToDelete, setModuleToDelete] = useState<ModuleTemplate | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Multi-select state
    const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
    const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

    // Sort and filter state
    const [sortBy, setSortBy] = useState<'name' | 'date' | 'usage'>('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    // Module usage state
    const [moduleUsage, setModuleUsage] = useState<Map<string, { count: number; researches: Array<{ id: string; name: string }> }>>(new Map());
    const usageLoadingRef = useRef<Set<string>>(new Set());

    // Load stages on mount
    useEffect(() => {
        loadStages();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Recalculate tabs when data or search changes
    const { allTabs, currentTab, hasResults } = useMemo(() => {
        // Filter modules by search query
        const matchesSearch = (m: { name: string; description?: string | null }) =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.description?.toLowerCase().includes(searchQuery.toLowerCase());

        // Filter stages and their modules
        const filteredStages = stages.map(stage => ({
            ...stage,
            modules: stage.modules.filter(matchesSearch)
        })).filter(stage => stage.modules.length > 0 || !searchQuery);

        const filteredUngrouped = ungroupedModules.filter(matchesSearch);

        // Separate screen stages from other stages
        const isScreenStage = (s: StageTemplateWithModules) =>
            s.stage_type === 'single_module' &&
            (s.name === 'Welcome Screen' || s.name === 'Thank You Screen');

        const screenStages = filteredStages.filter(isScreenStage);
        const otherStages = filteredStages.filter(s => !isScreenStage(s));

        const tabs = [
            ...(screenStages.length > 0 ? [{
                id: 'screen-modules',
                name: 'Screen Modules',
                modules: screenStages.flatMap(s => s.modules),
                description: 'Welcome and Thank You screens'
            }] : []),
            ...otherStages.map(s => ({
                id: s.id,
                name: s.name,
                modules: s.modules,
                description: s.description || null
            })),
            ...(filteredUngrouped.length > 0 ? [{
                id: 'ungrouped',
                name: 'Other Modules',
                modules: filteredUngrouped,
                description: null
            }] : [])
        ];

        const results = filteredStages.some(s => s.modules.length > 0) || filteredUngrouped.length > 0;
        const tab = tabs.find(t => t.id === activeTab) || tabs[0];

        return { allTabs: tabs, currentTab: tab, hasResults: results };
    }, [stages, ungroupedModules, searchQuery, activeTab]);

    // Update active tab when search changes or tabs change
    useEffect(() => {
        if (allTabs.length > 0) {
            const currentTabExists = allTabs.some(t => t.id === activeTab);
            if (!currentTabExists || (currentTab && currentTab.modules.length === 0 && allTabs.some(t => t.modules.length > 0))) {
                const firstTabWithModules = allTabs.find(t => t.modules.length > 0);
                if (firstTabWithModules) {
                    setActiveTab(firstTabWithModules.id);
                } else if (allTabs.length > 0) {
                    setActiveTab(allTabs[0].id);
                }
            }
        }
    }, [searchQuery, allTabs, activeTab, currentTab]);

    // Load usage data only for modules in the current visible tab (lazy loading)
    useEffect(() => {
        if (currentTab && currentTab.modules.length > 0) {
            const moduleIds = currentTab.modules.map(m => m.id);
            loadModuleUsage(moduleIds);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]); // Only reload when active tab changes

    const loadStages = async () => {
        try {
            setIsLoadingStages(true);
            const stagesData = await stageTemplatesService.getAll();
            setStages(stagesData);
        } catch (err: unknown) {
            console.error('Failed to load stages:', err);
            toast.error('Failed to load stages');
        } finally {
            setIsLoadingStages(false);
        }
    };

    const loadModuleUsage = async (moduleIds: string[]) => {
        // Filter out modules that are already being loaded or already have usage data
        const idsToLoad = moduleIds.filter(id => 
            !usageLoadingRef.current.has(id) && !moduleUsage.has(id)
        );
        
        if (idsToLoad.length === 0) {
            return; // Nothing to load
        }
        
        // Mark as loading
        idsToLoad.forEach(id => usageLoadingRef.current.add(id));
        
        // Load usage data in parallel - don't block UI
        const usageMap = new Map<string, { count: number; researches: Array<{ id: string; name: string }> }>();
        
        // Use Promise.allSettled to load all in parallel and handle failures gracefully
        const results = await Promise.allSettled(
            idsToLoad.map(async (id) => {
                try {
                    const usage = await moduleTemplatesService.getUsage(id);
                    return { id, usage };
                } catch {
                    // Silently fail - backend endpoint might not be ready yet
                    return { id, usage: null };
                }
            })
        );
        
        // Process results
        results.forEach((result) => {
            if (result.status === 'fulfilled' && result.value.usage) {
                usageMap.set(result.value.id, result.value.usage);
            }
        });
        
        // Remove from loading set
        idsToLoad.forEach(id => usageLoadingRef.current.delete(id));
        
        // Update state with new usage data
        if (usageMap.size > 0) {
            setModuleUsage(prev => {
                const updated = new Map(prev);
                usageMap.forEach((value, key) => updated.set(key, value));
                return updated;
            });
        }
    };

    const handleDeleteClick = (template: ModuleTemplate, e: React.MouseEvent) => {
        e.stopPropagation();
        setModuleToDelete(template);
        setDeleteModalOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (!moduleToDelete) return;

        setIsDeleting(true);
        try {
            await deleteModuleMutation.mutateAsync(moduleToDelete.id);
            setDeleteModalOpen(false);
            setModuleToDelete(null);
        } catch (error) {
            // Error already handled by mutation
            console.error('Delete failed:', error);
        } finally {
            setIsDeleting(false);
        }
    };

    const handlePreview = (moduleId: string) => {
        setPreviewModuleId(moduleId);
        setShowPreview(true);
    };
    
    // Update selectedModule when previewModule loads
    useEffect(() => {
        if (previewModule && showPreview) {
            setSelectedModule(previewModule);
        }
    }, [previewModule, showPreview]);

    const handleDuplicateClick = (template: ModuleTemplate, e: React.MouseEvent) => {
        e.stopPropagation();
        const newName = prompt(`Enter a name for the duplicated module:`, `${template.name} (Copy)`);
        if (newName && newName.trim()) {
            handleConfirmDuplicate(template.id, newName.trim());
        }
    };

    const handleConfirmDuplicate = async (id: string, newName: string) => {
        try {
            await moduleTemplatesService.duplicate(id, newName);
            // React Query will auto-refetch due to staleTime
            toast.success('Module template duplicated successfully');
        } catch (error: unknown) {
            console.error('Failed to duplicate template:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to duplicate module template';
            toast.error(errorMessage);
        }
    };

    const handleToggleSelect = (moduleId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newSelected = new Set(selectedModules);
        if (newSelected.has(moduleId)) {
            newSelected.delete(moduleId);
        } else {
            newSelected.add(moduleId);
        }
        setSelectedModules(newSelected);
    };

    const handleSelectAll = () => {
        if (!currentTab) return;
        const allIds = new Set(currentTab.modules.map(m => m.id));
        setSelectedModules(allIds);
    };

    const handleDeselectAll = () => {
        setSelectedModules(new Set());
    };

    const handleBulkDelete = async () => {
        if (selectedModules.size === 0) return;

        try {
            setIsDeleting(true);
            await moduleTemplatesService.bulkDelete(Array.from(selectedModules));
            // React Query will auto-invalidate and refetch
            toast.success(`${selectedModules.size} module template(s) deleted successfully`);
            setSelectedModules(new Set());
            setIsMultiSelectMode(false);
        } catch (error: unknown) {
            console.error('Failed to delete templates:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to delete module templates';
            toast.error(errorMessage);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleExportSelected = () => {
        if (selectedModules.size === 0) return;

        const modulesToExport = [...selectedModules].map(id => {
            const module = ungroupedModules.find(m => m.id === id) ||
                stages.flatMap(s => s.modules).find(m => m.id === id);
            return module;
        }).filter(Boolean);

        const dataStr = JSON.stringify(modulesToExport, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const exportFileDefaultName = `module-templates-${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        toast.success(`${selectedModules.size} module(s) exported`);
    };


    const renderModuleCard = (module: { id: string; name: string; description?: string | null }, fullModule?: ModuleTemplate) => {
        const isSelected = selectedModules.has(module.id);
        const usage = moduleUsage.get(module.id);

        return (
            <div
                key={module.id}
                onClick={() => {
                    if (isMultiSelectMode) return;
                    if (isAdmin) navigate(`/modules/${module.id}`);
                    else handlePreview(module.id);
                }}
                className={cn(
                    "rounded-xl border bg-white px-4 py-3.5 hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer group relative",
                    isSelected ? "border-blue-400 ring-1 ring-blue-200" : "border-gray-100"
                )}
            >
                {isMultiSelectMode && (
                    <div className="absolute top-3 left-3 z-10" onClick={(e) => handleToggleSelect(module.id, e)}>
                        {isSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4 text-gray-300" />}
                    </div>
                )}
                <div className="flex items-start justify-between mb-2">
                    <div className="p-1.5 bg-blue-50 rounded-lg">
                        <Boxes className="h-4 w-4 text-blue-600" />
                    </div>
                    {fullModule && !isMultiSelectMode && isAdmin && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => handleDuplicateClick(fullModule, e)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors" title="Duplicate">
                                <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={(e) => handleDeleteClick(fullModule, e)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>
                <h4 className="text-[13px] font-medium text-gray-900 mb-0.5 group-hover:text-blue-600 transition-colors">{module.name}</h4>
                <p className="text-[11px] text-gray-400 line-clamp-2 mb-2.5">{module.description || 'No description'}</p>
                <div className="flex items-center justify-between">
                    {!isMultiSelectMode && (
                        <button onClick={(e) => { e.stopPropagation(); handlePreview(module.id); }} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium transition-colors">
                            <Eye className="h-3 w-3" /> Preview
                        </button>
                    )}
                    {usage && usage.count > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-medium"
                            title={`Used in ${usage.count} research${usage.count !== 1 ? 'es' : ''}: ${usage.researches.map(r => r.name).join(', ')}`}>
                            {usage.count} use{usage.count !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
            </div>
        );
    };


    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">Modules</h1>
                    <p className="text-[13px] text-gray-400 mt-0.5">Reusable research modules by stage</p>
                </div>
                <div className="flex items-center gap-2">
                    {!isMultiSelectMode ? (
                        <>
                            <button
                                onClick={() => { setIsMultiSelectMode(true); setSelectedModules(new Set()); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                <CheckSquare className="h-3.5 w-3.5" /> Select
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => navigate('/modules/new')}
                                    className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors active:scale-[0.98]"
                                >
                                    <Plus className="h-3.5 w-3.5" /> New Module
                                </button>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={() => { setIsMultiSelectMode(false); setSelectedModules(new Set()); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            <X className="h-3.5 w-3.5" /> Exit Selection
                        </button>
                    )}
                </div>
            </div>

            {/* Search + Sort */}
            <div className="flex items-center gap-3 px-6 pb-3 flex-shrink-0">
                <div className="relative w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search modules..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
                    />
                </div>
                {!isMultiSelectMode && (
                    <div className="flex items-center gap-1.5">
                        <div className="w-28">
                            <CustomSelect
                                id={sortSelectId}
                                value={sortBy}
                                onChange={(v) => setSortBy(v as 'name' | 'date' | 'usage')}
                                options={[
                                    { value: 'name', label: 'Name' },
                                    { value: 'date', label: 'Date' },
                                ]}
                            />
                        </div>
                        <button
                            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                            className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
                        >
                            <SortAsc className={cn('h-3.5 w-3.5 text-gray-500', sortOrder === 'desc' && 'rotate-180')} />
                        </button>
                    </div>
                )}
            </div>

            {/* Bulk Actions Bar */}
            {isMultiSelectMode && (
                <div className="mx-6 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-[13px] font-medium text-blue-900">
                            {selectedModules.size} selected
                        </span>
                        {currentTab && currentTab.modules.length > 0 && (
                            <div className="flex items-center gap-1.5">
                                <button onClick={handleSelectAll} className="text-[12px] text-blue-600 hover:text-blue-700 font-medium">All ({currentTab.modules.length})</button>
                                {selectedModules.size > 0 && <button onClick={handleDeselectAll} className="text-[12px] text-blue-600 hover:text-blue-700 font-medium">None</button>}
                            </div>
                        )}
                    </div>
                    {selectedModules.size > 0 && (
                        <div className="flex items-center gap-2">
                            <button onClick={handleExportSelected} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-white transition-colors">
                                <Download className="h-3.5 w-3.5" /> Export
                            </button>
                            {isAdmin && (
                                <button onClick={handleBulkDelete} disabled={isDeleting} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
                                    <Trash2 className="h-3.5 w-3.5" /> Delete
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">

            {/* Horizontal Tabs */}
            {hasResults && allTabs.length > 0 && (
                <div className="border-b border-gray-100">
                    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                        {allTabs.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'px-3 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors',
                                        isActive
                                            ? 'border-gray-900 text-gray-900'
                                            : 'border-transparent text-gray-400 hover:text-gray-600'
                                    )}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {tab.name}
                                        <span className={cn(
                                            'px-1.5 py-0.5 rounded-full text-[10px]',
                                            isActive ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'
                                        )}>
                                            {tab.modules.length}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {isLoading ? (
                <ModulesGridSkeleton count={8} />
            ) : error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-[13px] text-red-700">{error}</div>
            ) : !hasResults ? (
                <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
                    <Boxes className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-[13px] text-gray-400">{searchQuery ? 'No modules match search' : 'Module templates will appear here. Create one from the builder.'}</p>
                    {!searchQuery && isAdmin && (
                        <button onClick={() => navigate('/modules/new')} className="mt-3 text-[13px] text-blue-600 hover:text-blue-700 font-medium">Create first module</button>
                    )}
                </div>
            ) : currentTab && (
                <div className="space-y-3">
                    {currentTab.description && <p className="text-[13px] text-gray-500">{currentTab.description}</p>}
                    {currentTab.modules.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {currentTab.modules.map(module => {
                                const fullModule = ungroupedModules.find(m => m.id === module.id) ||
                                    stages.flatMap(s => s.modules).find(m => m.id === module.id);
                                return renderModuleCard(module, fullModule as ModuleTemplate | undefined);
                            })}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
                            <Boxes className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-[13px] text-gray-400">{searchQuery ? 'No modules match search' : 'No modules in this stage'}</p>
                        </div>
                    )}
                </div>
            )}

            </div> {/* end scrollable content */}

            <ModulePreviewModal
                module={selectedModule}
                isOpen={showPreview}
                onClose={() => setShowPreview(false)}
                onEdit={isAdmin ? () => {
                    if (selectedModule) {
                        navigate(`/modules/${selectedModule.id}`);
                    }
                } : undefined}
            />

            <ConfirmationModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={handleConfirmDelete}
                title="Delete Module Template"
                message={`Are you sure you want to delete "${moduleToDelete?.name}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
                isLoading={isDeleting}
            />

        </div>
    );
};
