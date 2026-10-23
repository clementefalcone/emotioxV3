import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useMemo } from 'react';
import { useModuleComponents } from '../../hooks/useModuleComponents';
import { ModuleContentEditor } from './ModuleContentEditor';
import type { Module } from '../../services/research.service';
import type { ComponentConfig } from '../../types/moduleBuilder.types';
import type { EnabledDemographic } from '../../pages/research/research-builder';
import { Toggle } from '../ui/Toggle';
import { ConditionalityModal } from './ConditionalityModal';
import type { StudyModuleOption, LinkableModule } from './ConditionalityModal';
import { getModuleConditionality, getModuleConditionalityConfig, getModuleHidden, getModuleRequired, isDemographicCondition, isModuleCondition, isLinkedModuleCondition } from '../../utils/moduleRequired';
import type { ConditionalityConfig } from '../../utils/moduleRequired';
import { isImplicitAssociationModuleName } from '../../utils/implicitAssociationBuilder';
import { IATPreviewModal } from './IATPreviewModal';
import { EyeTrackingPreviewModal } from './EyeTrackingPreviewModal';
import { EyeTrackingLiveTestModal } from './EyeTrackingLiveTestModal';
import { Play, Eye } from 'lucide-react';

export interface CognitiveTaskModuleCardRef {
    getComponentValues: () => Record<string, string>;
    getComponents: () => ComponentConfig[];
    getRequired: () => boolean;
    getHidden: () => boolean;
    getConditionality: () => boolean;
    getConditionalityConfig: () => ConditionalityConfig | null;
}

interface CognitiveTaskModuleCardProps {
    module: Module;
    researchId?: string;
    onSave?: () => void;
    onDelete?: (moduleId: string) => void;
    isActive?: boolean;
    enabledDemographics?: EnabledDemographic[];
    studyModules?: StudyModuleOption[];
    linkableModules?: LinkableModule[];
    globalOrderIndex?: number;
    questionNumber?: number;
}

/**
 * Card component para mostrar un módulo de Cognitive Task
 * Estructura idéntica a SmartVOCModuleCard para consistencia
 */
export const CognitiveTaskModuleCard = forwardRef<CognitiveTaskModuleCardRef, CognitiveTaskModuleCardProps>(
    ({ module, researchId, onDelete, isActive = false, enabledDemographics = [], studyModules = [], linkableModules = [], globalOrderIndex, questionNumber }, ref) => {
    const conditionalityDisabled = !enabledDemographics.length && !studyModules.length && !linkableModules.length;
    const { components, setComponents, componentValues, setComponentValues } = useModuleComponents(module);

    const cardRef = useRef<HTMLDivElement>(null);

    // Derive initial values from props
    const initialRequired = useMemo(() => getModuleRequired(module.config), [module.config]);
    const initialHidden = useMemo(() => getModuleHidden(module.config), [module.config]);
    const initialConditionality = useMemo(() => getModuleConditionality(module.config), [module.config]);
    const initialConditionalityConfig = useMemo(() => getModuleConditionalityConfig(module.config), [module.config]);

    const [isRequired, setIsRequired] = useState<boolean>(initialRequired);
    const [isHidden, setIsHidden] = useState<boolean>(initialHidden);
    const [isConditionality, setIsConditionality] = useState<boolean>(initialConditionality);
    const [conditionalityConfig, setConditionalityConfig] = useState<ConditionalityConfig | null>(initialConditionalityConfig);
    const [isConditionalityModalOpen, setIsConditionalityModalOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isLiveTestOpen, setIsLiveTestOpen] = useState(false);

    const isIatModule = isImplicitAssociationModuleName(module.name);
    const isEtModule = module.name.trim().toLowerCase() === 'eye tracking';

    useEffect(() => {
        if (!isIatModule || components.length === 0) return;
        const missing: { id: string; label: string; defaultValue: string }[] = [];
        if (!components.some(c => c.id === 'response-keys')) {
            missing.push({ id: 'response-keys', label: 'Response Keys', defaultValue: 'letters' });
        }
        if (!components.some(c => c.id === 'trial-repetitions')) {
            missing.push({ id: 'trial-repetitions', label: 'Trial Repetitions', defaultValue: '4' });
        }
        if (missing.length === 0) return;
        const newComps = missing.map((m, i) => ({
            id: m.id,
            type: 'input' as const,
            label: m.label,
            hidden: true,
            order: 9998 + i,
        }));
        setComponents(prev => [...prev, ...newComps]);
        setComponentValues(prev => {
            const next = { ...prev };
            for (const m of missing) { next[m.id] = prev[m.id] || m.defaultValue; }
            return next;
        });
    }, [isIatModule, components, setComponents, setComponentValues]);

    // Reset state when config changes
    useEffect(() => {
        setIsRequired(initialRequired);
        setIsHidden(initialHidden);
        setIsConditionality(initialConditionality);
        setConditionalityConfig(initialConditionalityConfig);
    }, [initialRequired, initialHidden, initialConditionality, initialConditionalityConfig]);

    // Scroll to this module when it becomes active
    useEffect(() => {
        if (isActive && cardRef.current) {
            setTimeout(() => {
                cardRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                });
            }, 100);
        }
    }, [isActive]);

    // Expose component values to parent via ref
    useImperativeHandle(ref, () => ({
        getComponentValues: () => componentValues,
        getComponents: () => components,
        getRequired: () => isRequired,
        getHidden: () => isHidden,
        getConditionality: () => isConditionality,
        getConditionalityConfig: () => conditionalityConfig,
    }));

    const handleComponentValueChange = (componentId: string, value: string): void => {
        setComponentValues(prev => ({
            ...prev,
            [componentId]: value,
        }));
    };

    const handleAddChoiceComponent = (groupLabel: string, siblingComponent: ComponentConfig): void => {
        const newId = `choice-${Date.now()}`;
        const siblingOrder = siblingComponent.order ?? 0;
        const newComponent: ComponentConfig = {
            id: newId,
            type: 'input',
            label: '',
            settings: {
                ...siblingComponent.settings,
                isChoice: true,
                groupLabel,
            },
            placeholder: siblingComponent.placeholder,
            order: siblingOrder + 0.5,
        };
        setComponents(prev => [...prev, newComponent]);
        setComponentValues(prev => ({ ...prev, [newId]: '' }));
    };

    const handleRemoveChoiceComponent = (componentId: string): void => {
        setComponents(prev => prev.filter(c => c.id !== componentId));
        setComponentValues(prev => {
            const next = { ...prev };
            delete next[componentId];
            return next;
        });
    };

    const handleAddIatTarget = (prefix: string, nextIndex: number): void => {
        const groupLabel = `${prefix === 'object' ? 'Object' : 'Target'} ${nextIndex}`;
        const nameId = `${prefix}-${nextIndex}-name`;
        const imageId = `${prefix}-${nextIndex}-image`;
        const maxOrder = Math.max(0, ...components.map(c => c.order ?? 0));
        const nameComp: ComponentConfig = {
            id: nameId,
            type: 'input',
            label: 'Name of the object',
            placeholder: { enabled: true, text: 'Text the name here' },
            order: maxOrder + 1,
            settings: { groupLabel, description: 'You can use an image or a name for this.' },
        };
        const imageComp: ComponentConfig = {
            id: imageId,
            type: 'file-upload',
            label: `${groupLabel} Image`,
            order: maxOrder + 2,
            settings: { groupLabel },
        };
        setComponents(prev => [...prev, nameComp, imageComp]);
        setComponentValues(prev => ({ ...prev, [nameId]: '', [imageId]: '' }));
    };

    const handleRemoveIatTarget = (componentIds: string[]): void => {
        const idsToRemove = new Set(componentIds);
        setComponents(prev => prev.filter(c => !idsToRemove.has(c.id)));
        setComponentValues(prev => {
            const next = { ...prev };
            componentIds.forEach(id => delete next[id]);
            return next;
        });
    };

    /**
     * Handles toggling the module required flag.
     * @param next - Next checked value
     */
    const handleRequiredChange = (next: boolean): void => {
        setIsRequired(next);
    };

    /**
     * Handles toggling the local-only hidden flag.
     * @param next - Next checked value
     */
    const handleHiddenChange = (next: boolean): void => {
        setIsHidden(next);
    };

    const handleConditionalityChange = (next: boolean): void => {
        setIsConditionality(next);
        if (next) {
            setIsConditionalityModalOpen(true);
        } else {
            setConditionalityConfig(null);
        }
    };

    return (
        <div
            ref={cardRef}
            id={`module-${module.id}`}
            className={`rounded-lg shadow-sm border bg-white transition-all ${isActive ? 'border-blue-400 shadow-md' : 'border-gray-200'
                }`}
        >
            <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center gap-4">
                    <h3 className="text-base font-semibold text-gray-900">{questionNumber ? `${questionNumber}. ` : ''}{module.name}</h3>
                    <div className="flex items-center gap-4 ml-auto">
                        {isEtModule && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setIsLiveTestOpen(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors"
                                >
                                    <Eye className="h-3.5 w-3.5" />
                                    Prueba en vivo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsPreviewOpen(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                                >
                                    <Play className="h-3.5 w-3.5" />
                                    Vista previa
                                </button>
                            </>
                        )}
                        {isIatModule && (
                            <>
                                <div className="flex items-center gap-1 bg-gray-100 rounded-md p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => handleComponentValueChange('response-keys', 'letters')}
                                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${(componentValues['response-keys'] || 'letters') === 'letters' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        A / L
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleComponentValueChange('response-keys', 'arrows')}
                                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${componentValues['response-keys'] === 'arrows' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        ← / →
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsPreviewOpen(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                                >
                                    <Play className="h-3.5 w-3.5" />
                                    Vista previa
                                </button>
                            </>
                        )}
                        <Toggle
                            checked={isRequired}
                            onChange={(e) => handleRequiredChange(Boolean(e.target.checked))}
                            label="Requerido"
                        />
                        <Toggle
                            checked={isHidden}
                            onChange={(e) => handleHiddenChange(Boolean(e.target.checked))}
                            label="Ocultar"
                        />
                        <Toggle
                            checked={isConditionality}
                            onChange={(e) => handleConditionalityChange(Boolean(e.target.checked))}
                            label="Condicionalidad"
                            disabled={conditionalityDisabled}
                        />
                        {onDelete && (
                            <button
                                type="button"
                                onClick={() => setIsDeleteConfirmOpen(true)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Eliminar módulo"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
                {module.description && (
                    <p className="text-sm text-gray-500 mt-1">{module.description}</p>
                )}
                {isConditionality && conditionalityConfig && (
                    <button
                        type="button"
                        onClick={() => setIsConditionalityModalOpen(true)}
                        className="mt-2 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                        {isDemographicCondition(conditionalityConfig)
                            ? `Condition: Show if ${conditionalityConfig.demographicKey} = ${conditionalityConfig.demographicValue}`
                            : isModuleCondition(conditionalityConfig)
                                ? `Condition: Show if ${studyModules.find(m => m.id === conditionalityConfig.sourceModuleId)?.name || 'Unknown'} = ${conditionalityConfig.selectedValues.map(v => studyModules.find(m => m.id === conditionalityConfig.sourceModuleId)?.options.find(o => o.id === v)?.label || v).join(', ')}`
                                : isLinkedModuleCondition(conditionalityConfig)
                                    ? `Condition: Linked with ${linkableModules.find(m => m.id === conditionalityConfig.linkedModuleId)?.name || 'Unknown'}`
                                    : 'Condition configured'}
                    </button>
                )}
            </div>
            <div className="p-6">
                {!isHidden && (
                    <ModuleContentEditor
                        components={components}
                        componentValues={componentValues}
                        onValueChange={handleComponentValueChange}
                        onAddChoiceComponent={handleAddChoiceComponent}
                        onRemoveChoiceComponent={handleRemoveChoiceComponent}
                        onAddIatTarget={handleAddIatTarget}
                        onRemoveIatTarget={handleRemoveIatTarget}
                        researchId={researchId}
                        moduleName={module.name}
                    />
                )}
            </div>
            <ConditionalityModal
                isOpen={isConditionalityModalOpen}
                onClose={() => {
                    setIsConditionalityModalOpen(false);
                    if (!conditionalityConfig) setIsConditionality(false);
                }}
                onSave={(cfg) => {
                    setConditionalityConfig(cfg);
                    setIsConditionalityModalOpen(false);
                }}
                initialConfig={conditionalityConfig}
                moduleName={module.name}
                demographics={enabledDemographics}
                studyModules={studyModules}
                linkableModules={linkableModules}
                currentModuleOrderIndex={globalOrderIndex ?? module.order_index}
            />
            {isDeleteConfirmOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Eliminar módulo</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            ¿Estás seguro de eliminar <strong>{module.name}</strong>? Esta acción no se puede deshacer y todas las respuestas de este módulo se perderán.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setIsDeleteConfirmOpen(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsDeleteConfirmOpen(false);
                                    onDelete?.(module.id);
                                }}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                            >
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {isEtModule && isLiveTestOpen && researchId && (
                <EyeTrackingLiveTestModal
                    isOpen={true}
                    onClose={() => setIsLiveTestOpen(false)}
                    researchId={researchId}
                />
            )}
            {isEtModule && isPreviewOpen && (() => {
                let etStimuli: Array<{ url?: string; s3Key?: string; name?: string }> = [];
                try { etStimuli = JSON.parse(componentValues['stimuli'] || '[]'); } catch { /* ignore */ }
                let etAois: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }> = [];
                try { etAois = JSON.parse(componentValues['aois'] || '[]'); } catch { /* ignore */ }
                return (
                    <EyeTrackingPreviewModal
                        isOpen={true}
                        onClose={() => setIsPreviewOpen(false)}
                        stimuli={etStimuli}
                        aois={etAois}
                        displayMode={componentValues['display-mode'] === 'shelf' ? 'shelf' : 'stand_alone'}
                        primingTimeS={parseInt(componentValues['priming-time'] || '10', 10) || 10}
                        shelfCount={parseInt(componentValues['shelf-count'] || '2', 10)}
                        itemsPerShelf={parseInt(componentValues['shelf-items'] || '5', 10)}
                        shelfRepetitions={parseInt(componentValues['shelf-repetitions'] || '1', 10)}
                        taskInstructions={componentValues['task-instructions'] || ''}
                        emotionRecognition={componentValues['emotion-recognition'] === 'true'}
                        attentionPrediction={componentValues['attention-prediction'] === 'true'}
                    />
                );
            })()}
            {isIatModule && isPreviewOpen && (() => {
                const moduleName = module.name.trim().toLowerCase();
                const testType: 'attribute_testing' | 'comparing_attribute' | 'objects_comparing' =
                    moduleName.includes('comparing attribute') ? 'comparing_attribute'
                    : (moduleName.includes('objects comparing') || moduleName.includes('object comparing')) ? 'objects_comparing'
                    : 'attribute_testing';
                const prefix = testType === 'comparing_attribute' ? 'object' : 'target';
                const previewTargets: { id: string; name: string; imageUrl?: string }[] = [];
                for (let i = 1; i <= 20; i++) {
                    const name = componentValues[`${prefix}-${i}-name`];
                    if (!name) continue;
                    previewTargets.push({ id: `${prefix}-${i}`, name, imageUrl: componentValues[`${prefix}-${i}-image`] || undefined });
                }
                let previewCriteria: { id: string; label: string; targetId?: string; hidden?: boolean }[] = [];
                const criteriaRaw = componentValues['criteria'];
                if (criteriaRaw) {
                    try {
                        const parsed = JSON.parse(criteriaRaw);
                        previewCriteria = Array.isArray(parsed) ? parsed : [];
                    } catch { /* ignore */ }
                }
                const primingTime = parseInt(componentValues['priming-time'] || '400', 10) || 400;
                const dims = testType === 'comparing_attribute'
                    ? { left: componentValues['dimension-1'] || 'Yes', right: componentValues['dimension-2'] || 'No' }
                    : undefined;
                const cats = testType === 'objects_comparing'
                    ? { left: componentValues['criteria-1'] || 'Positive', right: componentValues['criteria-2'] || 'Negative' }
                    : undefined;
                return (
                    <IATPreviewModal
                        isOpen={true}
                        onClose={() => setIsPreviewOpen(false)}
                        testType={testType}
                        targets={previewTargets}
                        criteria={previewCriteria}
                        primingTime={primingTime}
                        dimensions={dims}
                        criteriaCategories={cats}
                        exerciseInstructions={componentValues['exercise-instructions']}
                        testInstructions={componentValues['test-instructions']}
                    />
                );
            })()}
        </div>
    );
});
