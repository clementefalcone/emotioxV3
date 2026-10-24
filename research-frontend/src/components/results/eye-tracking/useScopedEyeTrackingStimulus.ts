import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getEyeTrackingResults, type EyeTrackingStimulus } from '../../../services/analytics.service';

interface ScopedEyeTrackingRequest {
  researchId: string;
  stageId?: string;
  moduleId: string;
  includedParticipantIds: readonly string[];
}

export function useScopedEyeTrackingStimulus({ researchId, stageId, moduleId, includedParticipantIds }: ScopedEyeTrackingRequest): EyeTrackingStimulus | null {
  const participantIds = [...includedParticipantIds].sort();
  const { data } = useQuery({
    queryKey: ['eye-tracking-scoped', researchId, stageId, moduleId, participantIds.join(',')],
    queryFn: async () => {
      const results = await getEyeTrackingResults(researchId, stageId, { moduleId, participantIds });
      return results.stimuli[0] ?? null;
    },
    placeholderData: keepPreviousData,
  });
  return data ?? null;
}
