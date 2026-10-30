import { useMemo, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Filters } from '../shared/Filters';
import { NoMatchingParticipantsNotice } from '../shared/NoMatchingParticipantsNotice';
import { VOCComments } from '../smart-voc/components/VOCComments';
import { cn } from '../../../lib/utils';
import { useCognitiveTaskResults } from '../../../hooks/useCognitiveTaskResults';
import { useResultsFilter } from '../../../hooks/useResultsFilter';
import { useResearch } from '../../../hooks/useResearchQuery';
import { ResultsStateHandler } from '../shared/ResultsStateHandler';
import { NavigationFlowResultsWrapper } from './NavigationFlowResultsWrapper';
import { PreferenceTestResultsWrapper } from './PreferenceTestResultsWrapper';
import { ChoiceResultsWrapper } from './ChoiceResultsWrapper';
import { ScaleResultsWrapper } from './ScaleResultsWrapper';
import { RankingResultsWrapper } from './RankingResultsWrapper';

interface CognitiveTaskResultsProps {
  researchId: string;
  stageId?: string;
  className?: string;
}

interface ModuleData {
  moduleId: string;
  moduleName: string;
  questionText?: string;
  description: string;
  totalResponses: number;
  responses: Array<{
    participantId: string;
    value?: string | unknown;
    responseData?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    moduleId?: string;
    createdAt: string;
  }>;
}

interface TextResponseFormatted {
  text: string;
  mood: string;
}

export const CognitiveTaskResults = ({ researchId, stageId, className }: CognitiveTaskResultsProps) => {
  const { data, isLoading, error, refetch } = useCognitiveTaskResults(researchId);
  const { data: research } = useResearch(researchId);

  const stageModuleIds = useMemo(() => {
    if (!stageId || !research?.stages) return null;
    const stage = research.stages.find((s: { id: string }) => s.id === stageId);
    if (!stage) return null;
    return new Set(stage.modules.map((m: { id: string }) => m.id));
  }, [stageId, research]);
  const {
    demographicData,
    demographicFilters,
    setDemographicFilters,
    userIdFilter,
    setUserIdFilter,
    completionMin,
    setCompletionMin,
    filteredParticipantIds,
    sentimentFilter,
    setSentimentFilter,
  } = useResultsFilter(researchId);

  const modulesToRender = useMemo(() => {
    const list = data?.modules?.filter((m) => {
      if (stageModuleIds && !stageModuleIds.has(m.moduleId)) return false;
      const normalized = m.moduleName.toLowerCase();
      if (normalized.includes('research configuration') || normalized.includes('welcome screen') || normalized.includes('thank you screen') ||
          normalized.includes('csat') || normalized.includes('nps') || normalized.includes('ces') || normalized.includes('voc') ||
          normalized.includes('net emotional value') || normalized.includes('nev') || normalized.includes('smart voc')) return false;
      return (normalized.includes('navigation flow') || normalized.includes('preference test') || normalized.includes('short text') ||
              normalized.includes('long text') || normalized.includes('single choice') || normalized.includes('multiple choice') ||
              normalized.includes('linear scale') || normalized.includes('ranking'));
    }) ?? [];

    if (!filteredParticipantIds) return list;
    return list.map((module) => ({
      ...module,
      responses: module.responses.filter((r) => filteredParticipantIds.has(r.participantId)),
      totalResponses: module.responses.filter((r) => filteredParticipantIds.has(r.participantId)).length,
    }));
  }, [data?.modules, filteredParticipantIds, stageModuleIds]);

  // Module visibility filter
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string> | null>(null);
  const [moduleFilterOpen, setModuleFilterOpen] = useState(false);

  const visibleModules = useMemo(() => {
    if (!selectedModuleIds) return modulesToRender;
    return modulesToRender.filter(m => selectedModuleIds.has(m.moduleId));
  }, [modulesToRender, selectedModuleIds]);

  const toggleModuleId = (moduleId: string) => {
    setSelectedModuleIds(prev => {
      const current = prev ?? new Set(modulesToRender.map(m => m.moduleId));
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      // If all selected, reset to null (show all)
      if (next.size === modulesToRender.length) return null;
      return next;
    });
  };

  const toggleAllModules = () => {
    if (!selectedModuleIds || selectedModuleIds.size === modulesToRender.length) {
      setSelectedModuleIds(new Set());
    } else {
      setSelectedModuleIds(null);
    }
  };

  // Helper to detect module type
  const detectModuleType = (moduleName: string): string => {
    const normalized = moduleName.toLowerCase();
    if (normalized.includes('navigation flow') || normalized.includes('navigation_flow')) return 'navigation_flow';
    if (normalized.includes('preference test') || normalized.includes('preference_test')) return 'preference_test';
    if (normalized.includes('short text') || normalized.includes('short_text')) return 'short_text';
    if (normalized.includes('long text') || normalized.includes('long_text')) return 'long_text';
    if (normalized.includes('single choice') || normalized.includes('single_choice')) return 'single_choice';
    if (normalized.includes('multiple choice') || normalized.includes('multiple_choice')) return 'multiple_choice';
    if (normalized.includes('linear scale') || normalized.includes('linear_scale')) return 'linear_scale';
    if (normalized.includes('ranking')) return 'ranking';
    return 'unknown';
  };

  // Renderizar cada módulo según su tipo
  const renderModuleResults = (module: ModuleData, index: number) => {
    const moduleType = detectModuleType(module.moduleName);
    const questionNumber = `3.${index + 1}`;
    // Use questionText from module config if available, otherwise fall back to moduleName
    const displayName = module.questionText || module.moduleName;

    switch (moduleType) {
      case 'navigation_flow':
        return (
          <NavigationFlowResultsWrapper
            key={module.moduleId}
            researchId={researchId}
            moduleId={module.moduleId}
            moduleName={displayName}
            questionNumber={questionNumber}
            filteredParticipantIds={filteredParticipantIds}
          />
        );

      case 'preference_test':
        return (
          <PreferenceTestResultsWrapper
            key={module.moduleId}
            researchId={researchId}
            moduleId={module.moduleId}
            moduleName={displayName}
            questionNumber={questionNumber}
            filteredParticipantIds={filteredParticipantIds}
          />
        );

      case 'short_text':
      case 'long_text': {
        const textResponses = module.responses
          .map((r): TextResponseFormatted | null => {
            try {
              const value = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
              const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
              return { text: value, mood: meta?.sentiment || '' };
            } catch {
              return null;
            }
          })
          .filter((r): r is TextResponseFormatted => r !== null)
          .filter(r => sentimentFilter.length === 0 || sentimentFilter.includes(r.mood || 'indeterminate'));

        const cognitiveExportRows = module.responses.map(r => {
          const participantId = (r as { participantId?: string; participant_id?: string }).participantId
            ?? (r as { participant_id?: string }).participant_id ?? '';
          const value = (r as { value?: unknown }).value ?? (r as { responseData?: { value?: unknown } }).responseData?.value;
          const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
          return { participantId, text };
        });

        return (
          <VOCComments
            key={module.moduleId}
            questionNumber={questionNumber}
            questionText={displayName}
            comments={textResponses.length > 0 ? textResponses : [{ text: 'No responses yet', mood: 'gray' }]}
            researchId={researchId}
            cognitiveExportRows={cognitiveExportRows.length > 0 ? cognitiveExportRows : undefined}
            moduleId={module.moduleId}
            filteredParticipantIds={filteredParticipantIds}
          />
        );
      }

      case 'single_choice':
        return (
          <ChoiceResultsWrapper
            key={module.moduleId}
            researchId={researchId}
            moduleId={module.moduleId}
            moduleName={displayName}
            questionNumber={questionNumber}
            isSingleChoice={true}
            filteredParticipantIds={filteredParticipantIds}
          />
        );

      case 'multiple_choice':
        return (
          <ChoiceResultsWrapper
            key={module.moduleId}
            researchId={researchId}
            moduleId={module.moduleId}
            moduleName={displayName}
            questionNumber={questionNumber}
            isSingleChoice={false}
            filteredParticipantIds={filteredParticipantIds}
          />
        );

      case 'linear_scale':
        return (
          <ScaleResultsWrapper
            key={module.moduleId}
            researchId={researchId}
            moduleId={module.moduleId}
            moduleName={displayName}
            questionNumber={questionNumber}
            filteredParticipantIds={filteredParticipantIds}
          />
        );

      case 'ranking':
        return (
          <RankingResultsWrapper
            key={module.moduleId}
            researchId={researchId}
            moduleId={module.moduleId}
            moduleName={displayName}
            questionNumber={questionNumber}
            filteredParticipantIds={filteredParticipantIds}
          />
        );

      // Otros tipos se mostrarán en la siguiente fase
      default:
        return (
          <Card key={module.moduleId} className="p-6">
            <h3 className="text-lg font-semibold">{questionNumber}- {displayName}</h3>
            <p className="text-sm text-gray-500 mt-2">Type: {moduleType}</p>
            <p className="text-sm text-gray-600 mt-1">{module.totalResponses} responses</p>
          </Card>
        );
    }
  };

  return (
    <ResultsStateHandler
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      loadingSkeleton={
        <div className="p-6 space-y-6 animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      }
    >
      <div className={cn(className)}>
        {/* Main Content + Sidebar */}
        <div className="flex gap-6">
          {/* Left: Main Content */}
          <div className="flex-1 space-y-6">
            {filteredParticipantIds?.size === 0 ? (
              <NoMatchingParticipantsNotice />
            ) : (
              <>
                {/* Module selector */}
                {modulesToRender.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setModuleFilterOpen(prev => !prev)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                        selectedModuleIds && selectedModuleIds.size < modulesToRender.length
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      <ListFilter className="h-4 w-4" />
                      {selectedModuleIds && selectedModuleIds.size < modulesToRender.length
                        ? `${selectedModuleIds.size} of ${modulesToRender.length} modules`
                        : `All modules (${modulesToRender.length})`}
                    </button>

                    {moduleFilterOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setModuleFilterOpen(false)} />
                        <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-2 w-80 max-h-72 overflow-y-auto">
                          {/* Select all */}
                          <label className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100 mb-1">
                            <input
                              type="checkbox"
                              checked={!selectedModuleIds || selectedModuleIds.size === modulesToRender.length}
                              onChange={toggleAllModules}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-xs font-medium text-gray-700">Select all</span>
                          </label>
                          {modulesToRender.map((mod) => {
                            const checked = !selectedModuleIds || selectedModuleIds.has(mod.moduleId);
                            return (
                              <label key={mod.moduleId} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleModuleId(mod.moduleId)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs text-gray-700 truncate block">{(mod as ModuleData).questionText || mod.moduleName}</span>
                                  <span className="text-[10px] text-gray-400">{mod.totalResponses} responses</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Dynamic Module Rendering */}
                {visibleModules.length > 0 ? (
                  visibleModules.map((module, index) => renderModuleResults(module, index))
                ) : (
                  <Card className="p-12 text-center bg-gray-50">
                    <div className="flex items-center justify-center mb-4">
                      <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                    </div>
                    <p className="text-gray-700 font-medium mb-2">No cognitive task data available yet</p>
                    <p className="text-gray-500 text-sm">
                      Cognitive task results will appear here once participants complete the tasks.
                    </p>
                  </Card>
                )}
              </>
            )}
          </div>

          {/* Right: Filters Sidebar */}
          <div className="w-80 shrink-0 sticky top-4 self-start max-h-[calc(100vh-8rem)] overflow-y-auto">
            <Filters
              researchId={researchId}
              demographicData={demographicData}
              selectedFilters={demographicFilters}
              onFilterChange={setDemographicFilters}
              userIdFilter={userIdFilter}
              onUserIdFilterChange={setUserIdFilter}
              completionMin={completionMin}
              onCompletionMinChange={setCompletionMin}
              sentimentFilter={sentimentFilter}
              onSentimentFilterChange={setSentimentFilter}
            />
          </div>
        </div>
      </div>
    </ResultsStateHandler>
  );
};
