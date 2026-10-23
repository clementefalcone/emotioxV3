import { useState, useEffect, useCallback } from 'react';
import { Trash2, Plus, PenTool, Sparkles } from 'lucide-react';
import type { ComponentConfig } from '../../types/moduleBuilder.types';
import {
    isImplicitAssociationModuleName,
    partitionImplicitAssociationTargets,
    type IatTargetColumn,
} from '../../utils/implicitAssociationBuilder';
import { EditableComponent } from './EditableComponent';
import { CustomSelect } from '../ui/CustomSelect';
import { AOIDrawer, type AOI } from './AOIDrawer';
import { resolveMediaUrl, analyzeStimulusComplexity, type StimulusComplexityResult } from '../../services/media.service';
import { IATFlowchart } from './IATFlowchart';
import { buildShelfAois, buildShelfColumns } from '../../utils/shelfLayout';

interface ModuleContentEditorProps {
    components: ComponentConfig[];
    componentValues: Record<string, string>;
    onValueChange: (componentId: string, value: string) => void;
    onAddChoiceComponent?: (groupLabel: string, siblingComponent: ComponentConfig) => void;
    onRemoveChoiceComponent?: (componentId: string) => void;
    onAddIatTarget?: (prefix: string, nextIndex: number) => void;
    onRemoveIatTarget?: (componentIds: string[]) => void;
    researchId?: string; // For S3 upload in file-upload components
    /** When "Screener", first input + select + checkbox row renders on one line (Question, Choice Type, Enable last). */
    moduleName?: string;
}

type ProcessedItem =
    | { type: 'group'; groupLabel: string; components: ComponentConfig[] }
    | { type: 'single'; component: ComponentConfig }
    | { type: 'screener-header'; components: [ComponentConfig, ComponentConfig, ComponentConfig] }
    | { type: 'iat-targets-row'; columns: IatTargetColumn[] };

/**
 * Finds the Screener header controls by component type (not JSON array order).
 * Uses the first input, first select, and first checkbox by `order` among visible components.
 * @param components - Visible module components (already sorted by order)
 * @returns [Question input, Choice Type select, Enable checkbox] or null if any type is missing
 */
function findScreenerHeaderTriplet(
    components: ComponentConfig[]
): [ComponentConfig, ComponentConfig, ComponentConfig] | null {
    const sorted = [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const input = sorted.find((c) => c.type === 'input');
    const select = sorted.find((c) => c.type === 'select');
    const checkbox = sorted.find((c) => c.type === 'checkbox');
    if (!input || !select || !checkbox) {
        return null;
    }
    return [input, select, checkbox];
}

/**
 * Groups components into singles and choice groups (same logic as builder list).
 * @param visibleComponents - Filtered visible components
 * @returns Processed items for rendering
 */
function buildProcessedItems(visibleComponents: ComponentConfig[]): ProcessedItem[] {
    const processedComponents: ProcessedItem[] = [];
    let currentGroup: { groupLabel: string; components: ComponentConfig[] } | null = null;

    visibleComponents.forEach((component) => {
        const groupLabel = component.settings?.groupLabel;
        const isChoice = component.settings?.isChoice;

        if (groupLabel && isChoice) {
            if (currentGroup && currentGroup.groupLabel === groupLabel) {
                currentGroup.components.push(component);
            } else {
                if (currentGroup) {
                    processedComponents.push({
                        type: 'group',
                        groupLabel: currentGroup.groupLabel,
                        components: currentGroup.components,
                    });
                }
                currentGroup = { groupLabel, components: [component] };
            }
        } else {
            if (currentGroup) {
                processedComponents.push({
                    type: 'group',
                    groupLabel: currentGroup.groupLabel,
                    components: currentGroup.components,
                });
                currentGroup = null;
            }
            processedComponents.push({ type: 'single', component });
        }
    });

    if (currentGroup !== null) {
        const groupToAdd: { groupLabel: string; components: ComponentConfig[] } = currentGroup;
        processedComponents.push({ type: 'group', groupLabel: groupToAdd.groupLabel, components: groupToAdd.components });
    }

    return processedComponents;
}

/**
 * Editor de contenido de módulo
 * Renderiza todos los componentes editables del módulo
 */
export const ModuleContentEditor = ({
    components,
    componentValues,
    onValueChange,
    onAddChoiceComponent,
    onRemoveChoiceComponent,
    onAddIatTarget,
    onRemoveIatTarget,
    researchId,
    moduleName,
}: ModuleContentEditorProps) => {
    const [aoiModalOpen, setAoiModalOpen] = useState(false);
    const [aoiModalVisible, setAoiModalVisible] = useState(false);
    const [complexitySuggestion, setComplexitySuggestion] = useState<StimulusComplexityResult | null>(null);
    const [complexityLoading, setComplexityLoading] = useState(false);
    const [lastAnalyzedKey, setLastAnalyzedKey] = useState('');

    const normalizedModuleName_ = moduleName?.trim().toLowerCase() ?? '';
    const isEyeTracking_ = normalizedModuleName_ === 'eye tracking';
    const stimuliCompId = isEyeTracking_ ? components.find(c => !c.hidden && c.type === 'file-upload')?.id : undefined;
    const stimuliRawForEffect = stimuliCompId ? (componentValues[stimuliCompId] || '') : '';

    useEffect(() => {
        if (!isEyeTracking_) return;
        let s3Key = '';
        try {
            const parsed = JSON.parse(stimuliRawForEffect);
            if (Array.isArray(parsed) && parsed.length > 0) {
                s3Key = parsed[0]?.s3Key || parsed[0]?.url || '';
            }
        } catch { /* ignore */ }
        if (!s3Key || s3Key === lastAnalyzedKey) return;
        setLastAnalyzedKey(s3Key);
        setComplexityLoading(true);
        setComplexitySuggestion(null);
        analyzeStimulusComplexity(s3Key)
            .then(setComplexitySuggestion)
            .catch(() => setComplexitySuggestion(null))
            .finally(() => setComplexityLoading(false));
    }, [isEyeTracking_, stimuliRawForEffect, lastAnalyzedKey]);

    const openAoiModal = useCallback(() => {
        setAoiModalOpen(true);
        requestAnimationFrame(() => setAoiModalVisible(true));
    }, []);

    const closeAoiModal = useCallback(() => {
        setAoiModalVisible(false);
        setTimeout(() => setAoiModalOpen(false), 200);
    }, []);

    useEffect(() => {
        if (!aoiModalOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAoiModal(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [aoiModalOpen, closeAoiModal]);

    const visibleComponents = components
        .filter(c => !c.hidden && !c.settings?.hidden)
        .sort((a, b) => {
            const orderA = a.order ?? 0;
            const orderB = b.order ?? 0;
            return orderA - orderB;
        });

    if (visibleComponents.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                <p className="text-gray-500">No components configured for this module.</p>
            </div>
        );
    }

    const isScreener = moduleName?.trim().toLowerCase() === 'screener';
    const headerTriplet = isScreener ? findScreenerHeaderTriplet(visibleComponents) : null;
    const headerIds = headerTriplet
        ? new Set([headerTriplet[0].id, headerTriplet[1].id, headerTriplet[2].id])
        : null;
    const componentsForList = headerIds
        ? visibleComponents.filter((c) => !headerIds.has(c.id))
        : visibleComponents;

    const isIatModule = isImplicitAssociationModuleName(moduleName);
    const { columns: iatColumns, rest: componentsAfterIat } = isIatModule
        ? partitionImplicitAssociationTargets(visibleComponents)
        : { columns: [], rest: visibleComponents };

    let displayItems: ProcessedItem[];
    if (headerTriplet) {
        displayItems = [
            { type: 'screener-header', components: headerTriplet },
            ...buildProcessedItems(componentsForList),
        ];
    } else if (isIatModule && iatColumns.length > 0) {
        displayItems = [{ type: 'iat-targets-row', columns: iatColumns }, ...buildProcessedItems(componentsAfterIat)];
    } else {
        displayItems = buildProcessedItems(visibleComponents);
    }

    const normalizedModuleName = moduleName?.trim().toLowerCase() ?? '';
    const isEyeTracking = normalizedModuleName === 'eye tracking';
    const isAttributeTesting = normalizedModuleName === 'attribute testing';
    const isComparingAttribute = normalizedModuleName === 'comparing attribute';
    const isObjectsComparing = normalizedModuleName === 'objects comparing' || normalizedModuleName === 'object comparing';
    const hasIatNotes = isAttributeTesting || isComparingAttribute || isObjectsComparing;

    // IAT target limits per paradigm
    const iatMinTargets = isAttributeTesting ? 2 : isComparingAttribute ? 1 : isObjectsComparing ? 2 : 0;
    const iatMaxTargets = isAttributeTesting ? 5 : isComparingAttribute ? 5 : isObjectsComparing ? 7 : 0;
    const iatTargetPrefix = isComparingAttribute ? 'object' : 'target';

    // Extract IAT target options for the criteria editor (target selector)
    // Always show "Target 1", "Target 2", etc. — not the object name (which may be empty)
    const iatTargetOptions = isIatModule
        ? iatColumns.map((col) => {
              const heading =
                  col.components[0]?.settings?.groupLabel != null
                      ? String(col.components[0].settings.groupLabel)
                      : `Target ${col.index}`;
              return { id: heading, name: heading };
          })
        : [];

    const builderContent = (
        <div className="space-y-6">
            {/* IAT internal title — hidden from participants, used in reports */}
            {isIatModule && (
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label htmlFor="iat-test-title" className="block text-sm font-medium text-gray-700">
                            Título del test <span className="font-normal text-gray-400">(interno, visible solo en reportes)</span>
                        </label>
                        <input
                            id="iat-test-title"
                            type="text"
                            value={componentValues['test-title'] || ''}
                            onChange={(e) => onValueChange('test-title', e.target.value)}
                            placeholder="ej. Percepción de Marca Q2 2026"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div className="space-y-1">
                        <label htmlFor="iat-trial-repetitions" className="block text-sm font-medium text-gray-700">
                            Repeticiones del estímulo <span className="font-normal text-gray-400">(cada estímulo se muestra N veces, se promedian los resultados)</span>
                        </label>
                        <select
                            id="iat-trial-repetitions"
                            value={componentValues['trial-repetitions'] || '4'}
                            onChange={(e) => onValueChange('trial-repetitions', e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                            <option value="2">2x</option>
                            <option value="3">3x</option>
                            <option value="4">4x (por defecto)</option>
                            <option value="5">5x</option>
                        </select>
                    </div>
                </div>
            )}
            {displayItems.map((item, index) => {
                if (item.type === 'iat-targets-row' && item.columns.length > 0) {
                    const colCount = item.columns.length;
                    const rowGridClass =
                        colCount <= 3
                            ? 'grid grid-cols-1 gap-4 md:grid-cols-3 md:items-start'
                            : colCount <= 4
                              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 md:items-start'
                              : 'grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 md:items-start';
                    const canRemoveTarget = !!onRemoveIatTarget && colCount > iatMinTargets;
                    const canAddTarget = !!onAddIatTarget && colCount < iatMaxTargets;
                    const nextIndex = item.columns.length > 0
                        ? Math.max(...item.columns.map(c => c.index)) + 1
                        : 1;
                    return (
                        <div key={`iat-targets-${index}`} className="space-y-4">
                            <div className={rowGridClass}>
                                {item.columns.map((col) => {
                                    const heading =
                                        col.components[0]?.settings?.groupLabel != null
                                            ? String(col.components[0].settings.groupLabel)
                                            : `${isComparingAttribute ? 'Objeto' : 'Target'} ${col.index}`;
                                    return (
                                        <div
                                            key={col.index}
                                            className="min-w-0 space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                                        >
                                            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                                                <span className="text-sm font-semibold text-gray-800">
                                                    {heading}
                                                </span>
                                                {canRemoveTarget && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onRemoveIatTarget!(col.components.map(c => c.id))}
                                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                                        title={`Eliminar ${heading}`}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                            {col.components.map((comp) => (
                                                <div key={comp.id} className="min-w-0 space-y-2">
                                                    <EditableComponent
                                                        component={comp}
                                                        value={componentValues[comp.id] || ''}
                                                        onChange={(value) => onValueChange(comp.id, value)}
                                                        researchId={researchId}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                            {canAddTarget && (
                                <button
                                    type="button"
                                    onClick={() => onAddIatTarget!(iatTargetPrefix, nextIndex)}
                                    className="w-full py-2 px-4 text-sm font-medium text-gray-600 bg-gray-50 border border-dashed border-gray-300 rounded-lg hover:bg-gray-100 hover:text-gray-800 transition-colors"
                                >
                                    <Plus className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                                    Agregar {isComparingAttribute ? 'objeto' : 'target'}
                                </button>
                            )}
                        </div>
                    );
                }
                if (item.type === 'group' && item.components) {
                    const canModifyChoices = !!onAddChoiceComponent && !!onRemoveChoiceComponent;
                    const choiceRows = item.components;
                    const showRemoveRow =
                        canModifyChoices &&
                        item.components.length > 2;
                    return (
                        <div key={`group-${index}`} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                            <label className="block text-sm font-medium text-gray-700 mb-4">
                                {item.groupLabel}
                            </label>
                            <div className="space-y-3">
                                {choiceRows.map((component) => {
                                    const componentValue = componentValues[component.id] || '';
                                    return (
                                        <div key={component.id} className="flex items-start gap-2">
                                            <div className="flex-1">
                                                <EditableComponent
                                                    component={component}
                                                    value={componentValue}
                                                    onChange={(value) => onValueChange(component.id, value)}
                                                    researchId={researchId}
                                                                                                                                                        />
                                            </div>
                                            {showRemoveRow && (
                                                <button
                                                    onClick={() => onRemoveChoiceComponent(component.id)}
                                                    className="mt-1 p-2 text-red-500 hover:bg-red-50 rounded transition-colors"
                                                    title="Eliminar opción"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                                {canModifyChoices && (
                                    <button
                                        onClick={() => onAddChoiceComponent(item.groupLabel, item.components[item.components.length - 1])}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-600 border border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:text-gray-700 transition-colors"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Agregar otra opción
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                } else if (item.type === 'screener-header') {
                    const [questionComp, choiceTypeComp, enableComp] = item.components;
                    return (
                        <div
                            key="screener-header-row"
                            className="flex min-w-0 flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-center lg:gap-6"
                        >
                            <div className="min-w-0 flex-1">
                                <EditableComponent
                                    component={questionComp}
                                    value={componentValues[questionComp.id] || ''}
                                    onChange={(value) => onValueChange(questionComp.id, value)}
                                    researchId={researchId}
                                    fieldLayout="inline"
                                                                                                        />
                            </div>
                            <div className="min-w-0 shrink-0 sm:max-w-xs">
                                <EditableComponent
                                    component={choiceTypeComp}
                                    value={componentValues[choiceTypeComp.id] || ''}
                                    onChange={(value) => onValueChange(choiceTypeComp.id, value)}
                                    researchId={researchId}
                                    fieldLayout="inline"
                                                                                                        />
                            </div>
                            <div className="shrink-0 lg:ml-auto">
                                <EditableComponent
                                    component={enableComp}
                                    value={componentValues[enableComp.id] || ''}
                                    onChange={(value) => onValueChange(enableComp.id, value)}
                                    researchId={researchId}
                                    fieldLayout="inline"
                                                                                                        />
                            </div>
                        </div>
                    );
                } else if (item.type === 'single' && item.component) {
                    const componentValue = componentValues[item.component.id] || '';
                    return (
                        <div key={item.component.id} className="space-y-2">
                            <EditableComponent
                                component={item.component}
                                value={componentValue}
                                onChange={(value) => onValueChange(item.component!.id, value)}
                                researchId={researchId}
                                                                                                iatTargets={iatTargetOptions}
                                iatHideTargetSelector={isComparingAttribute || isAttributeTesting || isObjectsComparing}
                            />
                        </div>
                    );
                }
                return null;
            })}
        </div>
    );

    // Eye Tracking: 3-column layout — stimuli (left), config (center), notes (right)
    if (isEyeTracking) {
        const instructionComp = visibleComponents.find(c => c.id === 'task-instructions');
        const stimuliComp = visibleComponents.find(c => c.type === 'file-upload');
        const toggleComps = visibleComponents.filter(c => c.type === 'checkbox' && c.id !== 'randomize-stimuli');
        const primingComp = visibleComponents.find(c => c.id === 'priming-time');

        // AOI state: parse from component value, serialize back on change
        const aoisRaw = componentValues['aois'] || '[]';
        let parsedAois: AOI[] = [];
        try { parsedAois = JSON.parse(aoisRaw); } catch { /* keep empty */ }

        // Resolve stimulus image URLs for AOI drawing and shelf preview
        const stimuliRaw = stimuliComp ? (componentValues[stimuliComp.id] || '') : '';
        let firstStimulusUrl = '';
        let allStimulusUrls: string[] = [];
        try {
            const parsed = JSON.parse(stimuliRaw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                allStimulusUrls = parsed
                    .map((item: { url?: string; s3Key?: string }) => {
                        const raw = item.url || item.s3Key || '';
                        return raw ? resolveMediaUrl(raw) : '';
                    })
                    .filter(Boolean);
                firstStimulusUrl = allStimulusUrls[0] || '';
            }
        } catch { /* no stimulus yet */ }

        const shelfCount = parseInt(componentValues['shelf-count'] || '2', 10);
        const itemsPerShelf = parseInt(componentValues['shelf-items'] || '5', 10);
        const shelfRepetitions = parseInt(componentValues['shelf-repetitions'] || '1', 10);
        const shelfColumnUrls = buildShelfColumns(allStimulusUrls, itemsPerShelf, shelfRepetitions);

        // Auto-detect shelf mode: >1 image = shelf
        const isShelfMode = allStimulusUrls.length > 1;

        const regenerateShelfAois = (shelfItems: number, repetitions: number, stimuliValue?: string) => {
            const raw = stimuliValue ?? stimuliRaw;
            try {
                const items = JSON.parse(raw);
                if (!Array.isArray(items)) return;
                const validItems = items.filter((i: { url?: string; s3Key?: string }) => i.url || i.s3Key);
                if (validItems.length <= 1) return;
                const productLabels = validItems.map((item: { name?: string; s3Key?: string }, index: number) =>
                    item.name || item.s3Key?.split('/').pop() || `Image ${index + 1}`);
                onValueChange('aois', JSON.stringify(buildShelfAois(productLabels, shelfItems, repetitions)));
            } catch { /* ignore */ }
        };

        return (
            <div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-[280px_1fr_240px]">
                {/* Instruction + Draw AOI button */}
                {instructionComp && (
                    <div className="lg:col-span-2 flex items-end gap-2">
                        <div className="flex-1">
                            <EditableComponent
                                component={{ ...instructionComp, type: 'input' }}
                                value={componentValues[instructionComp.id] || ''}
                                onChange={(value) => onValueChange(instructionComp.id, value)}
                                researchId={researchId}
                            />
                        </div>
                        {firstStimulusUrl && !isShelfMode && (
                            <button
                                type="button"
                                onClick={openAoiModal}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border text-gray-600 border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap"
                            >
                                <PenTool className="h-3.5 w-3.5" />
                                Draw AOI
                                {parsedAois.length > 0 && (
                                    <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded-full">
                                        {parsedAois.length}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* Left: Stimuli upload + file list + AOI */}
                    <div className="space-y-3">
                        {stimuliComp && (
                            <EditableComponent
                                component={{ ...stimuliComp, settings: { ...stimuliComp.settings, listOnly: true } }}
                                value={componentValues[stimuliComp.id] || ''}
                                onChange={(value) => {
                                    onValueChange(stimuliComp.id, value);
                                    // Auto-sync display-mode + AOIs based on image count
                                    try {
                                        const items = JSON.parse(value);
                                        const count = Array.isArray(items) ? items.filter((i: { url?: string; s3Key?: string }) => i.url || i.s3Key).length : 0;
                                        const newMode = count > 1 ? 'shelf' : 'stand_alone';
                                        if (componentValues['display-mode'] !== newMode) {
                                            onValueChange('display-mode', newMode);
                                        }
                                        if (count > 1) {
                                            regenerateShelfAois(itemsPerShelf, shelfRepetitions, value);
                                        }
                                    } catch { /* not valid JSON yet */ }
                                }}
                                researchId={researchId}
                            />
                        )}
                        {/* For Shelf only: Randomize */}
                        {isShelfMode && (
                        <div className="pt-2 border-t border-gray-100 space-y-3">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-blue-600"
                                    checked={componentValues['randomize-stimuli'] === 'true'}
                                    onChange={(e) => onValueChange('randomize-stimuli', e.target.checked ? 'true' : 'false')}
                                />
                                <span className="font-medium">Randomize options (images)</span>
                            </label>
                        </div>
                        )}
                    </div>

                    {/* Center: Task configuration + Priming + Shelf */}
                    <div className="space-y-5">
                        <div className="flex items-center gap-3">
                            <h4 className="text-sm font-semibold text-gray-900">Task configuration</h4>
                            <span className="text-xs text-gray-400">Please select</span>
                        </div>
                        {/* Checkboxes (not toggles) */}
                        <div className="space-y-3">
                            {toggleComps.map(comp => (
                                <label key={comp.id} className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="rounded border-gray-300 text-blue-600 h-4 w-4"
                                        checked={componentValues[comp.id] === 'true'}
                                        onChange={(e) => onValueChange(comp.id, e.target.checked ? 'true' : 'false')}
                                    />
                                    {comp.label}
                                </label>
                            ))}
                        </div>
                        {/* Priming display time as tab buttons */}
                        {primingComp && (
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700">{primingComp.label}</label>
                                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                                    {(primingComp.options || []).map((opt: { label: string; value: string }) => {
                                        const selected = (componentValues[primingComp.id] || primingComp.value || '10') === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => onValueChange(primingComp.id, opt.value)}
                                                className={`px-4 py-2 text-sm font-medium transition-colors ${
                                                    selected
                                                        ? 'bg-blue-600 text-white'
                                                        : 'bg-white text-gray-700 hover:bg-gray-50'
                                                } border-r border-gray-200 last:border-r-0`}
                                            >
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {complexityLoading && (
                                    <p className="text-xs text-gray-400 mt-2 flex items-center gap-1.5">
                                        <Sparkles className="h-3 w-3 animate-pulse" />
                                        Analyzing image complexity...
                                    </p>
                                )}
                                {complexitySuggestion && !complexityLoading && (
                                    <button
                                        type="button"
                                        onClick={() => onValueChange(primingComp.id, String(complexitySuggestion.suggestedSeconds))}
                                        className="mt-2 flex items-start gap-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors group"
                                    >
                                        <Sparkles className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                        <span>
                                            <span className="font-medium group-hover:underline">
                                                AI suggests {complexitySuggestion.suggestedSeconds}s
                                            </span>
                                            <span className="text-gray-400 ml-1">— {complexitySuggestion.reason}</span>
                                        </span>
                                    </button>
                                )}
                            </div>
                        )}
                        {/* Shelf configuration — visible only in shelf mode (auto-detected: >1 image) */}
                        {isShelfMode && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4" style={{ width: 390, minHeight: 352 }}>
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Shelf configuration</h4>
                            <div className="w-full rounded-lg border-2 border-dashed border-gray-300 bg-white overflow-hidden" style={{ minHeight: 220 }}>
                                {allStimulusUrls.length > 0 ? (
                                    <div
                                        className="grid gap-1 p-2 h-full"
                                        style={{
                                            gridTemplateColumns: `repeat(${itemsPerShelf}, 1fr)`,
                                            gridTemplateRows: `repeat(${shelfCount}, 1fr)`,
                                        }}
                                    >
                                        {Array.from({ length: shelfCount * itemsPerShelf }, (_, i) => {
                                            const col = i % itemsPerShelf;
                                            const url = shelfColumnUrls[col];
                                            return (
                                                <div
                                                    key={i}
                                                    className="rounded border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center"
                                                >
                                                    {url ? (
                                                        <img
                                                            src={url}
                                                            alt={`Shelf item ${col + 1}`}
                                                            className="w-full h-full object-contain"
                                                        />
                                                    ) : (
                                                        <div className="text-gray-300 text-xs text-center p-1">
                                                            {col + 1}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-full" style={{ minHeight: 220 }}>
                                        <div className="text-center text-gray-400">
                                            <svg className="mx-auto h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                                            </svg>
                                            <p className="text-sm">Shelf preview</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-4 mt-4">
                                <div className="flex-1">
                                    <CustomSelect
                                        label="Filas"
                                        value={componentValues['shelf-count'] || '2'}
                                        onChange={(val) => onValueChange('shelf-count', val)}
                                        options={[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: String(n) }))}
                                    />
                                </div>
                                <div className="flex-1">
                                    <CustomSelect
                                        label="Columnas"
                                        value={componentValues['shelf-items'] || '5'}
                                        onChange={(val) => {
                                            onValueChange('shelf-items', val);
                                            regenerateShelfAois(parseInt(val, 10), shelfRepetitions);
                                        }}
                                        options={[3, 4, 5, 6, 7, 8, 10].map(n => ({ value: String(n), label: String(n) }))}
                                    />
                                </div>
                                <div className="flex-1">
                                    <CustomSelect
                                        label="Repeticiones"
                                        value={componentValues['shelf-repetitions'] || '1'}
                                        onChange={(val) => {
                                            onValueChange('shelf-repetitions', val);
                                            regenerateShelfAois(itemsPerShelf, parseInt(val, 10));
                                        }}
                                        options={[1, 2, 3, 4, 5, 6].map(n => ({ value: String(n), label: `${n}x` }))}
                                    />
                                </div>
                            </div>
                        </div>
                        )}
                    </div>

                    {/* Right: Techniques notes panel */}
                    <aside className="space-y-4 lg:row-start-1 lg:col-start-3 lg:row-span-3">
                        <div className="bg-blue-600 text-white rounded-lg p-4">
                            <h4 className="text-sm font-bold mb-1">Techniques</h4>
                            <p className="text-xs text-blue-100">
                                Get started with notes for better consumer neurosciences research
                            </p>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                            <p className="text-sm font-semibold text-gray-900">Biometrics:</p>
                            <p className="text-sm text-gray-700">Eye Tracking</p>
                            <p className="text-xs font-semibold text-red-600 mt-2">Notes:</p>
                            <p className="text-xs text-gray-600">
                                All Eye Tracking tasks include Emotion and Attention measurement.
                            </p>
                            <p className="text-xs text-gray-600">
                                <strong>Webcam-based attention tracking</strong> identifies which zones of a stimulus attract attention. Best suited for comparing broad regions (left vs right, top vs bottom) across participants at scale.
                            </p>
                            <p className="text-xs text-gray-600">
                                <strong>Zone-level accuracy.</strong> Results show relative attention distribution, not pixel-precise fixations. Use large AOIs for reliable metrics. Combine with Emotion Recognition for richer insights.
                            </p>
                        </div>
                    </aside>
                </div>
                {/* AOI Modal */}
                {aoiModalOpen && firstStimulusUrl && !isShelfMode && (
                    <div
                        className={`fixed inset-0 z-50 flex items-center justify-center transition-colors duration-200 ${aoiModalVisible ? 'bg-black/40' : 'bg-black/0'}`}
                        onClick={closeAoiModal}
                    >
                        <div
                            className={`bg-white rounded-xl shadow-lg w-[90vw] max-w-4xl max-h-[85vh] flex flex-col transition-all duration-200 ${aoiModalVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                                <h3 className="text-sm font-semibold text-gray-900">Areas of Interest (AOI)</h3>
                                <button onClick={closeAoiModal} className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5">
                                <AOIDrawer
                                    imageUrl={firstStimulusUrl}
                                    aois={parsedAois}
                                    onChange={(newAois) => onValueChange('aois', JSON.stringify(newAois))}
                                    maxHeight={500}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (!hasIatNotes) {
        return builderContent;
    }

    // Extract live data for the flowchart
    const flowchartTestType: 'attribute_testing' | 'comparing_attribute' | 'objects_comparing' =
        isComparingAttribute ? 'comparing_attribute'
        : isObjectsComparing ? 'objects_comparing'
        : 'attribute_testing';
    const flowchartPrefix = isComparingAttribute ? 'object' : 'target';
    const flowchartTargets: { name: string; imageUrl?: string }[] = [];
    for (let i = 1; i <= 20; i++) {
        const name = componentValues[`${flowchartPrefix}-${i}-name`];
        if (!name) continue;
        flowchartTargets.push({ name });
    }
    let flowchartCriteria: { label: string; hidden?: boolean; targetId?: string }[] = [];
    const criteriaRaw = componentValues['criteria'];
    if (criteriaRaw) {
        try {
            const parsed = JSON.parse(criteriaRaw);
            if (Array.isArray(parsed)) flowchartCriteria = parsed;
        } catch { /* ignore */ }
    }
    const flowchartPriming = parseInt(componentValues['priming-time'] || '400', 10) || 400;
    const flowchartDims = isComparingAttribute
        ? { left: componentValues['dimension-1'] || 'Yes', right: componentValues['dimension-2'] || 'No' }
        : undefined;
    const flowchartCats = isObjectsComparing
        ? { left: componentValues['criteria-1'] || 'Positive', right: componentValues['criteria-2'] || 'Negative' }
        : undefined;

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
            {builderContent}
            <aside className="space-y-4">
                <IATFlowchart
                    testType={flowchartTestType}
                    targets={flowchartTargets}
                    criteria={flowchartCriteria}
                    primingTime={flowchartPriming}
                    dimensions={flowchartDims}
                    criteriaCategories={flowchartCats}
                />
            </aside>
        </div>
    );
};

