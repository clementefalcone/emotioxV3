import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getEyeTrackingResults, type EyeTrackingStimulus, type FixationParameters } from '../../../services/analytics.service';

interface ScopedEyeTrackingRequest {
  researchId: string;
  stageId?: string;
  moduleId: string;
  includedParticipantIds: readonly string[];
  fixationParameters: FixationParameters | null;
}

export function useScopedEyeTrackingStimulus({ researchId, stageId, moduleId, includedParticipantIds, fixationParameters }: ScopedEyeTrackingRequest): EyeTrackingStimulus | null {
  const participantIds = [...includedParticipantIds].sort();
  const { data } = useQuery({
    queryKey: ['eye-tracking-scoped', researchId, stageId, moduleId, participantIds.join(','), fixationParameters],
    queryFn: async () => {
      const results = await getEyeTrackingResults(researchId, stageId, { moduleId, participantIds, fixationParameters });
      return results.stimuli[0] ?? null;
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  return data ?? null;
}
