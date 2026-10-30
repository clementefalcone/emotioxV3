import { useState, useEffect, useCallback, useMemo } from 'react';
import { Eye } from 'lucide-react';
import { ResultsStateHandler } from '../shared/ResultsStateHandler';
import { Filters } from '../shared/Filters';
import { NoMatchingParticipantsNotice } from '../shared/NoMatchingParticipantsNotice';
import { useResultsFilter } from '../../../hooks/useResultsFilter';
import * as analyticsService from '../../../services/analytics.service';
import { StimulusCard } from './StimulusCard';

interface EyeTrackingResultsProps {
  researchId: string;
  stageId?: string;
  className?: string;
}

export const EyeTrackingResults = ({ researchId, stageId, className }: EyeTrackingResultsProps) => {
  const [data, setData] = useState<analyticsService.EyeTrackingResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const {
    demographicData,
    demographicFilters,
    setDemographicFilters,
    userIdFilter,
    setUserIdFilter,
    completionMin,
    setCompletionMin,
    filteredParticipantIds,
  } = useResultsFilter(researchId);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const results = await analyticsService.getEyeTrackingResults(researchId, stageId);
      setData(results);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load eye tracking results'));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [researchId, stageId]);

  const refreshData = useCallback(() => fetchData(true), [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter stimulus data by participant IDs
  const filteredStimuli = useMemo(() => {
    if (!data?.stimuli || !filteredParticipantIds) return data?.stimuli ?? [];
    return data.stimuli.map(stimulus => {
      const filteredParticipants = stimulus.participants.filter(p => filteredParticipantIds.has(p.participantId));
      return {
        ...stimulus,
        fixations: stimulus.fixations.filter(f => filteredParticipantIds.has(f.participantId)),
        participants: filteredParticipants,
        uniqueParticipants: filteredParticipants.length,
        emotions: {
          ...stimulus.emotions,
          perParticipant: stimulus.emotions.perParticipant.filter(p => filteredParticipantIds.has(p.participantId)),
        },
        // Filter video gaze timeline by participant
        gazeTimeline: stimulus.gazeTimeline?.filter(p => filteredParticipantIds.has(p.participantId)),
        // Filter V3 heatmap per-participant data (grid stays aggregated — frontend re-filters AOI display)
        v3Heatmap: stimulus.v3Heatmap ? {
          ...stimulus.v3Heatmap,
          perParticipant: stimulus.v3Heatmap.perParticipant.filter(p => filteredParticipantIds.has(p.participantId)),
          participantCount: stimulus.v3Heatmap.perParticipant.filter(p => filteredParticipantIds.has(p.participantId)).length,
        } : undefined,
      };
    });
  }, [data?.stimuli, filteredParticipantIds]);

  const loadingSkeleton = (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="h-96 bg-gray-200 rounded-xl" />
      <div className="h-96 bg-gray-200 rounded-xl" />
    </div>
  );

  return (
    <ResultsStateHandler
      isLoading={isLoading}
      error={error}
      onRetry={fetchData}
      loadingSkeleton={loadingSkeleton}
    >
      {data && (
        <div className={`flex gap-6 ${className ?? ''}`}>
          <div className="flex-1 min-w-0">
            {filteredParticipantIds?.size === 0 ? (
              <NoMatchingParticipantsNotice />
            ) : (
              <>
                {filteredStimuli.length === 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                    <Eye className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-lg font-medium text-gray-900 mb-2">No Eye Tracking modules found</p>
                    <p className="text-sm text-gray-500">
                      This research does not have Eye Tracking stimuli configured.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {filteredStimuli.map(stimulus => (
                      <StimulusCard key={stimulus.moduleId} stimulus={stimulus} researchId={researchId} stageId={stageId} onRefresh={refreshData} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="w-80 shrink-0 sticky top-0 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
            <Filters
              researchId={researchId}
              demographicData={demographicData}
              selectedFilters={demographicFilters}
              onFilterChange={setDemographicFilters}
              userIdFilter={userIdFilter}
              onUserIdFilterChange={setUserIdFilter}
              completionMin={completionMin}
              onCompletionMinChange={setCompletionMin}
            />
          </div>
        </div>
      )}
    </ResultsStateHandler>
  );
};
