import { useQuery } from '@tanstack/react-query';
import * as analyticsService from '../services/analytics.service';

export const useCognitiveTaskResults = (researchId: string) => {
    const { data = null, isLoading, error, refetch } = useQuery({
        queryKey: ['cognitive-task-results', researchId],
        queryFn: () => analyticsService.getCognitiveTaskResults(researchId),
        enabled: !!researchId,
        staleTime: 0,
    });

    return {
        data,
        isLoading,
        error,
        refetch,
    };
};
