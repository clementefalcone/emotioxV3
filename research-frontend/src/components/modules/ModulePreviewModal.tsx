import { Modal } from '../ui/Modal';
import { PreviewComponent } from './PreviewComponent';
import { Pencil } from 'lucide-react';
import type { ModuleTemplate } from '../../services/moduleTemplates.service';
import type { ComponentConfig } from '../../types/moduleBuilder.types';

interface ModulePreviewModalProps {
    module: ModuleTemplate | null;
    isOpen: boolean;
    onClose: () => void;
    onEdit?: () => void;
}

const getComponentLabel = (type: string): string => {
    switch (type) {
        case 'textarea': return 'Long Text';
        case 'input': return 'Short Text';
        case 'select': return 'Select / Dropdown';
        case 'checkbox': return 'Checkbox';
        case 'radio': return 'Radio Buttons';
        case 'file-upload': return 'File Upload';
        case 'choices': return 'Choices';
        default: return type.replace('-', ' ');
    }
};

export const ModulePreviewModal = ({ module, isOpen, onClose, onEdit }: ModulePreviewModalProps) => {
    if (!module) return null;

    // Parse the structure to get components array
    const structure = module.structure as { components?: ComponentConfig[] } | undefined;
    const components = structure?.components ?? [];
    const visibleComponents = components
        .filter(c => !c.hidden)
        .sort((a, b) => {
            const orderA = a.order ?? 0;
            const orderB = b.order ?? 0;
            return orderA - orderB;
        });

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Preview: ${module.name}`}
            size="lg"
        >
            <div className="space-y-6">
                {onEdit && (
                    <div className="flex justify-end">
                        <button
                            onClick={onEdit}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            <Pencil className="w-4 h-4" />
                            Edit Module
                        </button>
                    </div>
                )}

                {/* Module Description */}
                {module.description && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800">{module.description}</p>
                    </div>
                )}

                {/* Preview Info */}
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-xs text-gray-600">
                        <strong>Preview Mode:</strong> This is how <strong>participants</strong> will see this module.
                        Components are fully interactive for testing.
                    </p>
                </div>

                {/* Components Preview */}
                {components.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                        <p className="text-gray-500">This module has no components yet.</p>
                    </div>
                ) : (() => {
                    // Group components that have groupLabel in settings, maintaining order
                    type ProcessedComponent = 
                        | { type: 'group'; groupLabel: string; components: ComponentConfig[]; index: number }
                        | { type: 'single'; component: ComponentConfig; index: number };
                    
                    const processedComponents: ProcessedComponent[] = [];
                    let currentGroup: { groupLabel: string; components: ComponentConfig[]; startIndex: number } | null = null;
                    let componentIndex = 0;

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
                                        index: currentGroup.startIndex
                                    });
                                }
                                currentGroup = { groupLabel, components: [component], startIndex: componentIndex };
                            }
                        } else {
                            if (currentGroup) {
                                processedComponents.push({ 
                                    type: 'group', 
                                    groupLabel: currentGroup.groupLabel, 
                                    components: currentGroup.components,
                                    index: currentGroup.startIndex
                                });
                                currentGroup = null;
                            }
                            processedComponents.push({ type: 'single', component, index: componentIndex });
                        }
                        componentIndex++;
                    });

                    if (currentGroup !== null) {
                        const groupToAdd: { groupLabel: string; components: ComponentConfig[]; startIndex: number } = currentGroup;
                        processedComponents.push({ 
                            type: 'group', 
                            groupLabel: groupToAdd.groupLabel, 
                            components: groupToAdd.components,
                            index: groupToAdd.startIndex
                        });
                    }

                    return (
                        <div className="space-y-6">
                            {processedComponents.map((item, itemIndex) => {
                                if (item.type === 'group' && item.components) {
                                    return (
                                        <div
                                            key={`group-${itemIndex}`}
                                            className="p-4 bg-white border border-gray-200 rounded-lg"
                                        >
                                            <div className="flex items-center gap-2 mb-3">
                                                <span className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold">
                                                    {item.index + 1}
                                                </span>
                                                <span className="text-xs text-gray-500 uppercase tracking-wide">
                                                    {getComponentLabel(item.components[0].type)}
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="block text-sm font-medium text-gray-700 mb-3">
                                                    {item.groupLabel}
                                                </label>
                                                <div className="space-y-3">
                                                    {item.components.map((component) => (
                                                        <PreviewComponent key={component.id} component={component} />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                } else if (item.type === 'single' && item.component) {
                                    return (
                                        <div
                                            key={item.component.id}
                                            className="p-4 bg-white border border-gray-200 rounded-lg"
                                        >
                                            <div className="flex items-center gap-2 mb-3">
                                                <span className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold">
                                                    {item.index + 1}
                                                </span>
                                                <span className="text-xs text-gray-500 uppercase tracking-wide">
                                                    {getComponentLabel(item.component.type)}
                                                </span>
                                            </div>
                                            <PreviewComponent component={item.component} />
                                        </div>
                                    );
                                }
                                return null;
                            })}
                        </div>
                    );
                })()}
            </div>
        </Modal>
    );
};
