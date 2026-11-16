import { Settings, Boxes, Save, Eye } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import type { Research, Module, Stage } from '../../services/research.service';
import { PendingDraftsDropdown } from './PendingDraftsDropdown';

interface ResearchBuilderHeaderProps {
    research: Research;
    activeModule: Module | null;
    isSettings: boolean;
    isSaving: boolean;
    onSave: () => void;
    isSmartVOCStage?: boolean;
    smartVOCStageName?: string;
    /** Generic collection stage (Cognitive Tasks, Implicit Association, etc.) */
    isCollectionStage?: boolean;
    collectionStageName?: string;
    // Legacy props — mapped internally
    isCognitiveTasksStage?: boolean;
    cognitiveTasksStageName?: string;
    modules?: Module[];
    onModuleJump?: (moduleId: string) => void;
    stages?: Stage[];
    onDraftSaveComplete?: () => void;
    isReadOnly: boolean;
    onLiveTest?: () => void;
}

/**
 * Header component para Research Builder
 * Muestra el título y botones de acción según el contexto
 */
export const ResearchBuilderHeader = ({
    research,
    activeModule,
    isSettings,
    isSaving,
    onSave,
    isSmartVOCStage = false,
    smartVOCStageName,
    isCollectionStage: isCollectionStageProp,
    collectionStageName: collectionStageNameProp,
    isCognitiveTasksStage = false,
    cognitiveTasksStageName,
    modules = [],
    onModuleJump,
    stages = [],
    onDraftSaveComplete,
    isReadOnly,
    onLiveTest,
}: ResearchBuilderHeaderProps) => {
    // Support both new generic props and legacy Cognitive Tasks props
    const isCollectionStage = isCollectionStageProp ?? isCognitiveTasksStage;
    const collectionStageName = collectionStageNameProp ?? cognitiveTasksStageName ?? 'Module Collection';

    const isMultiModuleStage = isSmartVOCStage || isCollectionStage;

    return (
        <div className="mb-3 border-b border-gray-200 pb-3">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        {isSettings ? (
                            <>
                                <Settings className="h-6 w-6 text-gray-400" />
                                Research Configuration
                            </>
                        ) : isSmartVOCStage ? (
                            <>
                                <Boxes className="h-6 w-6 text-gray-400" />
                                {smartVOCStageName || 'Smart VOC'}
                            </>
                        ) : isCollectionStage ? (
                            <>
                                <Boxes className="h-6 w-6 text-gray-400" />
                                {collectionStageName}
                            </>
                        ) : activeModule ? (
                            <>
                                <Boxes className="h-6 w-6 text-gray-400" />
                                {activeModule.name}
                            </>
                        ) : (
                            research.name
                        )}
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        {isSettings
                            ? 'Manage general settings and information'
                            : isSmartVOCStage
                                ? 'Configure all Smart VOC questions in a unified view'
                                : isCollectionStage
                                    ? `Configure all ${collectionStageName} modules in a unified view`
                                    : activeModule
                                        ? activeModule.description || 'Configure this module'
                                        : 'Research Builder'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {isMultiModuleStage && modules.length > 0 && onModuleJump && (
                        <div className="w-48">
                            <Select
                                placeholder="Jump to module..."
                                options={modules.map(m => ({ value: m.id, label: m.name }))}
                                onChange={(e) => onModuleJump(e.target.value)}
                                value=""
                            />
                        </div>
                    )}
                    {!isReadOnly && stages.length > 0 && research.id && onDraftSaveComplete && (
                        <PendingDraftsDropdown
                            stages={stages}
                            researchId={research.id}
                            onSaveComplete={onDraftSaveComplete}
                        />
                    )}
                    {onLiveTest && (
                        <button
                            type="button"
                            onClick={onLiveTest}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors"
                        >
                            <Eye className="h-3.5 w-3.5" />
                            Live Test
                        </button>
                    )}
                    {!isReadOnly && (activeModule || isMultiModuleStage) && (
                        <Button onClick={onSave} isLoading={isSaving} disabled={isSaving}>
                            <Save className="h-4 w-4 mr-2" />
                            Save Changes
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};
