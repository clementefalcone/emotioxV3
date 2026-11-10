import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useResearch, researchKeys } from '../../hooks/useResearchQuery';
import { researchService, type Research, type Stage, type Module } from '../../services/research.service';
import { useWelcomeScreenRedirect } from '../../hooks/useWelcomeScreenRedirect';
import { useModuleComponents } from '../../hooks/useModuleComponents';
import { useModuleDraftStore } from '../../stores/useModuleDraftStore';
import { ResearchBuilderHeader } from '../../components/research/ResearchBuilderHeader';
import { ResearchSettingsView } from '../../components/research/ResearchSettingsView';
import { ModuleContentEditor } from '../../components/research/ModuleContentEditor';
import type { SmartVOCModuleCardRef } from '../../components/research/SmartVOCModuleCard';
import type { CognitiveTaskModuleCardRef } from '../../components/research/CognitiveTaskModuleCard';
import { ResearchConfigurationModule } from '../../components/research/ResearchConfigurationModule';
import { AttentionPredictionView } from '../../components/research/AttentionPredictionView';
import { InsightsFindingView } from '../../components/research/InsightsFindingView';
import { ClientsBenchmarkView } from '../../components/research/ClientsBenchmarkView';
import { WebsiteTrackingConfig } from '../../components/research/WebsiteTrackingConfig';
import { ModuleTemplateSelectionModal } from '../../components/research/ModuleTemplateSelectionModal';
import { LoadingErrorStates } from '../../components/research/LoadingErrorStates';
import { EyeTrackingLiveTestModal } from '../../components/research/EyeTrackingLiveTestModal';
import { useToast } from '../../hooks/useToast';
import { modulesService } from '../../services/modules.service';
import { moduleTemplatesService } from '../../services/moduleTemplates.service';
import { withModuleConditionality, withModuleConditionalityConfig, withModuleHidden, withModuleRequired } from '../../utils/moduleRequired';
import {
    SmartVOCStageView,
    CollectionStageView,
    useResearchBuilderData,
    toOptionalString,
    sanitizeFileUploadSerializedValue,
    syncRankingConfig,
    transformResearchConfigComponentValues,
    flattenResearchConfig,
} from './research-builder';

export type { EnabledDemographic } from './research-builder';

export const ResearchBuilderPage = () => {
    const { id, moduleId, stageId, stimulusId } = useParams<{ id: string; moduleId?: string; stageId?: string; stimulusId?: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const toast = useToast();
    const queryClient = useQueryClient();

    const { data: research, isLoading: loading, error } = useResearch(id || null);
    const { clearAll: clearAllDrafts, clearDraft, clearDrafts } = useModuleDraftStore();

    // Clear all drafts when switching to a different research
    useEffect(() => {
        clearAllDrafts();
    }, [id, clearAllDrafts]);

    // Type assertion para TypeScript
    const typedResearch = research as Research | null;

    const isAttentionPrediction = typedResearch?.research_type_name === 'Attention Prediction' ||
                                 typedResearch?.research_type_name === "Attention's Prediction";
    const isInsightsFinding = typedResearch?.research_type_name === 'Insights Finding';
    const isClientsBenchmark = typedResearch?.research_type_name === "Client's Benchmark";
    const isWebsiteTracking = typedResearch?.research_type_name === 'Website Tracking';
    const isFileBasedResearch = isAttentionPrediction || isInsightsFinding || isClientsBenchmark || isWebsiteTracking;

    // Redirect to first file/stimulus for file-based research if none selected
    // Website Tracking doesn't use stimuli — it has its own config view
    useEffect(() => {
        if (isFileBasedResearch && !isWebsiteTracking && !stimulusId && typedResearch?.settings) {
            const stimuli = (typedResearch.settings as { stimuli?: Array<{ mediaId: string }> })?.stimuli || [];
            if (stimuli.length > 0) {
                navigate(`/research/${id}/builder/stimulus/${stimuli[0].mediaId}`, { replace: true });
            }
        }
    }, [isFileBasedResearch, isWebsiteTracking, stimulusId, typedResearch, id, navigate]);

    const isSettings = location.pathname.endsWith('/settings');
    // Use useParams for moduleId instead of regex for better reactivity
    const activeModuleId = moduleId || null;

    // Find the active stage by stageId from URL params
    const activeStageFromUrl = stageId && typedResearch?.stages
        ? typedResearch.stages.find((s: Stage) => s.id === stageId) || null
        : null;

    const activeModule = activeModuleId && typedResearch && typedResearch.stages
        ? typedResearch.stages.flatMap((s: Stage) => s.modules || []).find((m: Module) => m.id === activeModuleId) || null
        : null;

    const {
        smartVOCStage,
        smartVOCModules,
        isSmartVOCStage,
        collectionStage,
        collectionModules,
        isCollectionStageActive,
        enabledDemographics,
        studyModulesWithOptions,
        linkableModules,
        moduleQuestionNumbers,
    } = useResearchBuilderData({
        typedResearch,
        activeModule,
        activeStageFromUrl,
        stageId,
        activeModuleId,
    });

    // Check if current module is Research Configuration
    const isResearchConfigModule = activeModule?.name === 'Research Configuration';
    const isEyeTrackingModule = activeModule?.name?.trim().toLowerCase() === 'eye tracking';
    const [isLiveTestOpen, setIsLiveTestOpen] = useState(false);

    const { components, componentValues, setComponentValues } = useModuleComponents(activeModule);

    // Initialize componentValues from config for Research Configuration module
    useEffect(() => {
        if (isResearchConfigModule && activeModule?.config) {
            const flatConfig = flattenResearchConfig(activeModule.config);
            setComponentValues(prev => ({
                ...prev,
                ...flatConfig
            }));
        }
    }, [isResearchConfigModule, activeModule, setComponentValues]);

    // Refs for SmartVOC module cards to access their component values
    const smartVOCModuleRefs = useRef<Map<string, SmartVOCModuleCardRef>>(new Map());

    // Refs for Cognitive Task module cards to access their component values
    const collectionModuleRefs = useRef<Map<string, CognitiveTaskModuleCardRef>>(new Map());

    // Refs for DOM elements to scroll to modules
    const smartVOCModuleElementRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const collectionModuleElementRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // Function to scroll to a specific module
    const scrollToModule = useCallback((moduleId: string, type: 'smartvoc' | 'cognitive') => {
        const refs = type === 'smartvoc' ? smartVOCModuleElementRefs : collectionModuleElementRefs;
        const element = refs.current.get(moduleId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    // Move a module up or down within its stage
    const handleMoveModule = useCallback(async (
        modules: Module[],
        stage: Stage,
        index: number,
        direction: 'up' | 'down'
    ) => {
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= modules.length) return;

        // Block reorder if any module hasn't been saved yet (local- prefix)
        if (modules.some(m => m.id.startsWith('local-'))) {
            toast.error('Save all modules before reordering');
            return;
        }

        // Build new order
        const reordered = [...modules];
        [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

        const updates = reordered.map((m, i) => ({ moduleId: m.id, order_index: i }));

        try {
            await modulesService.updateModulesOrder(stage.id, updates);
            await queryClient.invalidateQueries({ queryKey: researchKeys.detail(id!) });
        } catch (err) {
            console.error('Failed to reorder modules:', err);
            toast.error('Failed to reorder modules');
        }
    }, [id, queryClient, toast]);

    useWelcomeScreenRedirect(typedResearch, loading, activeModuleId, isSettings, id);

    const [isSaving, setIsSaving] = useState(false);

    // State for module template selection modal
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [selectedStage, setSelectedStage] = useState<Stage | null>(null);

    const handleDeleteModule = async (moduleId: string): Promise<void> => {
        if (!id) return;
        try {
            await researchService.deleteModule(id, moduleId);
            // Invalidate React Query cache to refetch research data
            queryClient.invalidateQueries({ queryKey: researchKeys.detail(id) });
        } catch (err) {
            console.error('Failed to delete module:', err);
            alert('Failed to delete module. Please try again.');
        }
    };

    /** Persists a module: creates new local modules, updates existing ones */
    const saveOrCreateModule = async (module: Module, config: Record<string, unknown>, stageId?: string) => {
        const isLocal = module.id.startsWith('local-');
        if (isLocal) {
            return modulesService.create({
                research_id: id!,
                stage_id: stageId,
                name: module.name,
                description: module.description,
                order_index: module.order_index,
                config,
            });
        }
        return modulesService.update(module.id, { config, order: module.order_index });
    };

    const handleSaveModule = async (): Promise<void> => {
        if (!id) return;

        try {
            setIsSaving(true);

            if (isSmartVOCStage && smartVOCModules.length > 0) {
                // Save all Smart VOC modules with their current component values
                const updatePromises = smartVOCModules.map((module) => {
                    const moduleRef = smartVOCModuleRefs.current.get(module.id);
                    if (!moduleRef) {
                        console.warn(`No ref found for module ${module.id}`);
                        return saveOrCreateModule(module, module.config, smartVOCStage?.id);
                    }

                    const currentComponentValues = moduleRef.getComponentValues();
                    const currentComponents = moduleRef.getComponents();
                    const required = moduleRef.getRequired();

                    const updatedComponents = currentComponents.map(comp => {
                        const updated = syncRankingConfig({
                            ...comp,
                            value: comp.type === 'file-upload'
                                ? sanitizeFileUploadSerializedValue(currentComponentValues[comp.id] || comp.value)
                                : (currentComponentValues[comp.id] || comp.value)
                        });
                        // Sync selectRange.predefined with the selected value for select components (CES/CV scale)
                        const selectedValue = currentComponentValues[comp.id];
                        if (updated.type === 'select' && updated.selectRange && selectedValue && selectedValue.includes('-')) {
                            updated.selectRange = { ...updated.selectRange, predefined: selectedValue as typeof updated.selectRange.predefined };
                        }
                        return updated;
                    });

                    const configWithStructure = {
                        ...module.config,
                        structure: {
                            ...(module.config.structure || {}),
                            components: updatedComponents
                        }
                    };

                    const hidden = moduleRef.getHidden();
                    const conditionality = moduleRef.getConditionality();
                    const ccConfig = moduleRef.getConditionalityConfig();

                    const config = withModuleConditionalityConfig(
                        withModuleConditionality(withModuleHidden(withModuleRequired(configWithStructure, required), hidden), conditionality),
                        conditionality ? ccConfig : null
                    );

                    return saveOrCreateModule(module, config, smartVOCStage?.id);
                });
                await Promise.all(updatePromises);
                clearDrafts(smartVOCModules.map(m => m.id));
                toast.success(`Saved ${smartVOCModules.length} Smart VOC module(s) successfully`);

                // Invalidate and refetch research data to update the UI
                if (id) {
                    await queryClient.invalidateQueries({ queryKey: researchKeys.detail(id) });
                }
            } else if (isCollectionStageActive && collectionModules.length > 0) {
                // Save all Cognitive Task modules with their current component values (same structure as Smart VOC)
                const updatePromises = collectionModules.map(module => {
                    const moduleRef = collectionModuleRefs.current.get(module.id);
                    if (!moduleRef) {
                        console.warn(`No ref found for module ${module.id}`);
                        return saveOrCreateModule(module, module.config, collectionStage?.id);
                    }

                    const currentComponentValues = moduleRef.getComponentValues();
                    const currentComponents = moduleRef.getComponents();
                    const required = moduleRef.getRequired();

                    const updatedComponents = currentComponents.map(comp => syncRankingConfig({
                        ...comp,
                        value: comp.type === 'file-upload'
                            ? sanitizeFileUploadSerializedValue(currentComponentValues[comp.id] || comp.value)
                            : (currentComponentValues[comp.id] || comp.value)
                    }));

                    const configWithStructure = {
                        ...module.config,
                        structure: {
                            ...(module.config.structure || {}),
                            components: updatedComponents
                        }
                    };

                    const hidden = moduleRef.getHidden();
                    const conditionality = moduleRef.getConditionality();
                    const ccConfig = moduleRef.getConditionalityConfig();

                    const config = withModuleConditionalityConfig(
                        withModuleConditionality(withModuleHidden(withModuleRequired(configWithStructure, required), hidden), conditionality),
                        conditionality ? ccConfig : null
                    );

                    return saveOrCreateModule(module, config, collectionStage?.id);
                });
                await Promise.all(updatePromises);
                clearDrafts(collectionModules.map(m => m.id));
                toast.success(`Saved ${collectionModules.length} ${collectionStage?.name || 'collection'} module(s) successfully`);

                // Invalidate and refetch research data to update the UI
                if (id) {
                    await queryClient.invalidateQueries({ queryKey: researchKeys.detail(id) });
                }
            } else if (activeModule) {
                // Special handling for Research Configuration module
                if (isResearchConfigModule) {
                    // Transform componentValues into structured config
                    const structuredConfig = transformResearchConfigComponentValues(componentValues);

                    // Preserve other config properties but overwrite the structured ones
                    const config = {
                        ...activeModule.config,
                        ...structuredConfig
                    };

                    await modulesService.update(activeModule.id, {
                        config,
                        order: activeModule.order_index
                    });
                    clearDraft(activeModule.id);
                    toast.success('Research Configuration saved successfully');
                } else {
                    // Update components with new values while preserving structure
                    const updatedComponents = components.map(comp => syncRankingConfig({
                        ...comp,
                        // Update default value or value from componentValues
                        ...(comp.settings?.readonly
                            ? {
                                settings: {
                                    ...comp.settings,
                                    defaultValue: comp.type === 'file-upload'
                                        ? (sanitizeFileUploadSerializedValue(
                                            toOptionalString(componentValues[comp.id]) ?? toOptionalString(comp.settings.defaultValue)
                                        ) ?? toOptionalString(comp.settings.defaultValue))
                                        : (toOptionalString(componentValues[comp.id]) ?? toOptionalString(comp.settings.defaultValue)),
                                },
                            }
                            : {
                                value: comp.type === 'file-upload'
                                    ? sanitizeFileUploadSerializedValue(toOptionalString(componentValues[comp.id]))
                                    : toOptionalString(componentValues[comp.id]),
                            }
                        )
                    }));

                    // Inject virtual componentValues that aren't in the original template components
                    const virtualComponents: typeof updatedComponents = [];
                    const injectVirtual = (id: string, type: string, label: string) => {
                        if (componentValues[id] !== undefined && !updatedComponents.find(c => c.id === id)) {
                            virtualComponents.push({
                                id,
                                type: type as typeof updatedComponents[number]['type'],
                                label,
                                value: componentValues[id],
                                order: -1,
                                hidden: true,
                            } as typeof updatedComponents[number]);
                        }
                    };
                    injectVirtual('test-title', 'input', 'Test title');
                    injectVirtual('aois', 'hidden', 'Areas of Interest');
                    injectVirtual('webcam-recording', 'checkbox', 'Webcam recording');

                    // Preserve the correct backend structure: { structure: { components: [...] } }
                    const config = {
                        ...activeModule.config,
                        structure: {
                            ...(activeModule.config.structure || {}),
                            components: [...virtualComponents, ...updatedComponents]
                        }
                    };

                    await modulesService.update(activeModule.id, {
                        config,
                        order: activeModule.order_index
                    });
                    clearDraft(activeModule.id);
                    toast.success('Module saved successfully');
                }
            }

            // Invalidate and refetch research data to update the UI
            if (id) {
                await queryClient.invalidateQueries({ queryKey: researchKeys.detail(id) });
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to save module';
            toast.error(errorMessage);
            console.error('Save module error:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleComponentValueChange = useCallback((componentId: string, value: string): void => {
        setComponentValues((prev) => ({
            ...prev,
            [componentId]: value,
        }));
    }, [setComponentValues]);

    /**
     * Opens the module template selection modal for a specific stage
     */
    const handleOpenTemplateModal = useCallback((stage: Stage) => {
        setSelectedStage(stage);
        setIsTemplateModalOpen(true);
    }, []);

    /**
     * Creates a module from a selected template
     */
    const handleCreateModuleFromTemplate = useCallback(async (templateId: string) => {
        if (!id || !selectedStage) {
            toast.error('Missing research or stage information');
            return;
        }

        try {
            // Fetch template structure
            const template = await moduleTemplatesService.getById(templateId);

            // Parse structure if it comes as a JSON string from MySQL
            const structure = typeof template.structure === 'string'
                ? JSON.parse(template.structure)
                : template.structure;

            const freshStage = typedResearch?.stages?.find((s: Stage) => s.id === selectedStage.id);
            const existingModules = freshStage?.modules || selectedStage.modules || [];
            const nextOrderIndex = existingModules.length;

            // Create local module (not persisted yet — saved on "Save")
            const newModule: Module = {
                id: `local-${crypto.randomUUID()}`,
                name: template.name,
                description: template.description || '',
                order_index: nextOrderIndex,
                is_from_template: true,
                config: { structure },
                questions: [],
            };

            // Inject into React Query cache so it renders immediately
            queryClient.setQueryData(researchKeys.detail(id), (old: Research | undefined) => {
                if (!old) return old;
                return {
                    ...old,
                    stages: old.stages?.map((s: Stage) =>
                        s.id === selectedStage.id
                            ? { ...s, modules: [...(s.modules || []), newModule] }
                            : s
                    ),
                };
            });

            toast.success('Module added');

            // Scroll to the new module
            const scrollType = selectedStage.stage_type === 'single_module' ? 'smartvoc' : 'cognitive';
            requestAnimationFrame(() => {
                setTimeout(() => scrollToModule(newModule.id, scrollType), 100);
            });
        } catch (error) {
            console.error('Failed to add module from template:', error);
            throw error;
        }
    }, [id, selectedStage, typedResearch, queryClient, toast, scrollToModule]);

    // Loading state
    if (loading) {
        return <LoadingErrorStates type="loading" />;
    }

    // Error state
    if (error || !typedResearch) {
        return <LoadingErrorStates type="error" error={error} onBack={() => navigate('/research')} />;
    }

    return (
        <div className="h-full w-full flex flex-col p-3 sm:p-4 lg:p-4 overflow-hidden">
            {!isFileBasedResearch && (
                <div className="flex-shrink-0 mb-3">
                    <ResearchBuilderHeader
                        research={typedResearch}
                        activeModule={isSmartVOCStage || isCollectionStageActive ? null : activeModule}
                        isSettings={isSettings}
                        isSaving={isSaving}
                        onSave={handleSaveModule}
                        isSmartVOCStage={isSmartVOCStage}
                        smartVOCStageName={smartVOCStage?.name}
                        isCollectionStage={isCollectionStageActive}
                        collectionStageName={collectionStage?.name}
                        modules={isSmartVOCStage ? smartVOCModules : isCollectionStageActive ? collectionModules : []}
                        onModuleJump={(mid) => {
                            if (isSmartVOCStage) {
                                scrollToModule(mid, 'smartvoc');
                            } else if (isCollectionStageActive) {
                                scrollToModule(mid, 'cognitive');
                            }
                        }}
                        stages={typedResearch.stages || []}
                        onDraftSaveComplete={() => queryClient.invalidateQueries({ queryKey: researchKeys.detail(id!) })}
                        onLiveTest={isEyeTrackingModule ? () => setIsLiveTestOpen(true) : undefined}
                    />
                </div>
            )}

            {/* Content Area */}
            <div className="flex-1 min-h-0 overflow-auto">
                {isAttentionPrediction && stimulusId && typedResearch && (
                    <AttentionPredictionView
                        research={typedResearch}
                        stimulusId={stimulusId}
                    />
                )}

                {isInsightsFinding && stimulusId && typedResearch && (
                    <InsightsFindingView
                        research={typedResearch}
                        fileId={stimulusId}
                    />
                )}

                {isClientsBenchmark && stimulusId && typedResearch && (
                    <ClientsBenchmarkView
                        research={typedResearch}
                        stimulusId={stimulusId}
                    />
                )}

                {isWebsiteTracking && typedResearch && (
                    <WebsiteTrackingConfig research={typedResearch} />
                )}

                {isSettings && <ResearchSettingsView research={typedResearch} />}

                {/* Smart VOC Stage: Show all modules in the same view */}
                {!isFileBasedResearch && isSmartVOCStage && smartVOCStage && (
                    <SmartVOCStageView
                        smartVOCStage={smartVOCStage}
                        smartVOCModules={smartVOCModules}
                        activeModuleId={activeModuleId}
                        researchId={id!}
                        enabledDemographics={enabledDemographics}
                        studyModulesWithOptions={studyModulesWithOptions}
                        linkableModules={linkableModules}
                        moduleQuestionNumbers={moduleQuestionNumbers}
                        smartVOCModuleRefs={smartVOCModuleRefs}
                        smartVOCModuleElementRefs={smartVOCModuleElementRefs}
                        onSave={handleSaveModule}
                        onDelete={handleDeleteModule}
                        onMoveModule={handleMoveModule}
                        onOpenTemplateModal={handleOpenTemplateModal}
                    />
                )}

                {/* Cognitive Tasks Stage: Show all modules in the same view (same structure as Smart VOC) */}
                {!isFileBasedResearch && isCollectionStageActive && collectionStage && (
                    <CollectionStageView
                        collectionStage={collectionStage}
                        collectionModules={collectionModules}
                        activeModuleId={activeModuleId}
                        researchId={id!}
                        enabledDemographics={enabledDemographics}
                        studyModulesWithOptions={studyModulesWithOptions}
                        linkableModules={linkableModules}
                        moduleQuestionNumbers={moduleQuestionNumbers}
                        collectionModuleRefs={collectionModuleRefs}
                        collectionModuleElementRefs={collectionModuleElementRefs}
                        onSave={handleSaveModule}
                        onDelete={handleDeleteModule}
                        onMoveModule={handleMoveModule}
                        onOpenTemplateModal={handleOpenTemplateModal}
                    />
                )}

                {/* Regular module view: Show single module */}
                {!isFileBasedResearch && !isSmartVOCStage && !isCollectionStageActive && !isResearchConfigModule && activeModule && (
                    <div className="space-y-6">
                        <div className="rounded-lg shadow-sm border border-gray-100 p-4">
                            <ModuleContentEditor
                                components={components}
                                componentValues={componentValues}
                                onValueChange={handleComponentValueChange}
                                researchId={id}
                                moduleName={activeModule?.name}
                            />
                        </div>
                    </div>
                )}

                {/* Research Configuration module: Show custom component */}
                {!isFileBasedResearch && !isSmartVOCStage && !isCollectionStageActive && isResearchConfigModule && activeModule && (
                    <div>
                        <div>
                            <ResearchConfigurationModule
                                config={{
                                    ...transformResearchConfigComponentValues(componentValues),
                                    participationMode: componentValues.participationMode || (activeModule.config?.participationMode as string) || 'panel',
                                    ...(!componentValues.studyLogo && activeModule.config?.studyLogo ? { studyLogo: activeModule.config.studyLogo } : {}),
                                }}
                                researchStatus={research?.status}
                                researchName={research?.name}
                                onChange={(newConfig) => {
                                    Object.keys(newConfig).forEach(key => {
                                        if (key === 'demographics') {
                                            Object.entries(newConfig[key] as Record<string, unknown>).forEach(([subKey, val]) => {
                                                const valueToSave = typeof val === 'object' ? JSON.stringify(val) : String(val);
                                                handleComponentValueChange(subKey, valueToSave);
                                            });
                                        } else if (key === 'linkConfig') {
                                            Object.entries(newConfig[key] as Record<string, boolean>).forEach(([subKey, val]) => {
                                                handleComponentValueChange(subKey, String(val));
                                            });
                                        } else if (key === 'backlinks') {
                                            Object.entries(newConfig[key] as Record<string, string>).forEach(([subKey, val]) => {
                                                handleComponentValueChange(subKey, val);
                                            });
                                        } else {
                                            const val = newConfig[key];
                                            handleComponentValueChange(key, typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val));
                                        }
                                    });
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Module Template Selection Modal */}
            <ModuleTemplateSelectionModal
                isOpen={isTemplateModalOpen}
                onClose={() => {
                    setIsTemplateModalOpen(false);
                    setSelectedStage(null);
                }}
                onSelect={handleCreateModuleFromTemplate}
                stageType={selectedStage?.stage_type}
                stageName={selectedStage?.name}
                existingModuleNames={(selectedStage?.modules || []).map((m: Module) => m.name)}
            />
            {isEyeTrackingModule && id && (
                <EyeTrackingLiveTestModal
                    isOpen={isLiveTestOpen}
                    onClose={() => setIsLiveTestOpen(false)}
                    researchId={id}
                />
            )}
        </div>
    );
};
