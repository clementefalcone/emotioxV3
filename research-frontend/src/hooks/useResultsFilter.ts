import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as analyticsService from '../services/analytics.service';
import apiClient from '../services/api/client';
import { initialResultsFilters, useResultsFilterStore, type DemographicFiltersState, type SentimentFilter } from '../stores/useResultsFilterStore';

const EMPTY_PROGRESS: ReadonlyMap<string, number> = new Map();

const fetchParticipantProgress = async (researchId: string): Promise<ReadonlyMap<string, number>> => {
  const res = await apiClient.get<Array<{ id: string; progress: number }>>(`/research/${researchId}/participants/status`);
  const participants = Array.isArray(res) ? res : (res as unknown as { data: Array<{ id: string; progress: number }> }).data ?? [];
  return new Map(participants.map(participant => [participant.id, participant.progress]));
};

const matchesDemographics = (demographics: Record<string, string>, demographicFilters: DemographicFiltersState): boolean =>
  Object.entries(demographicFilters).every(([type, selected]) => {
    if (selected.length === 0) return true;
    const value = demographics[type];
    return selected.includes(value != null && value !== '' ? String(value) : '—');
  });

export function useResultsFilter(researchId: string) {
  const { data: demographicData = null } = useQuery({
    queryKey: ['results-demographics', researchId],
    queryFn: () => analyticsService.getDemographicResponses(researchId),
    enabled: !!researchId,
    staleTime: 0,
  });
  const { data: progressMap = EMPTY_PROGRESS } = useQuery({
    queryKey: ['results-participant-progress', researchId],
    queryFn: () => fetchParticipantProgress(researchId),
    enabled: !!researchId,
    staleTime: 0,
  });
  const savedFilters = useResultsFilterStore(state => state.filtersByResearch[researchId]);
  const updateFilters = useResultsFilterStore(state => state.updateFilters);
  const defaultFilters = useMemo(() => initialResultsFilters(researchId), [researchId]);
  const { demographicFilters, userIdFilter, completionMin, sentimentFilter } = savedFilters ?? defaultFilters;

  const setDemographicFilters = useCallback((next: DemographicFiltersState) => updateFilters(researchId, { demographicFilters: next }), [researchId, updateFilters]);
  const setUserIdFilter = useCallback((next: string) => updateFilters(researchId, { userIdFilter: next }), [researchId, updateFilters]);
  const setCompletionMin = useCallback((next: number) => updateFilters(researchId, { completionMin: next }), [researchId, updateFilters]);
  const setSentimentFilter = useCallback((next: SentimentFilter) => updateFilters(researchId, { sentimentFilter: next }), [researchId, updateFilters]);

  const filteredParticipantIds = useMemo(() => {
    const userId = userIdFilter.trim().toLowerCase();
    const hasAnyFilter = Object.values(demographicFilters).some(selected => selected.length > 0) || userId !== '' || completionMin > 0;
    if (!hasAnyFilter) return null;
    const demographicsById = new Map((demographicData?.participants ?? []).map(participant => [participant.participantId, participant.demographics]));
    const allParticipantIds = new Set([...demographicsById.keys(), ...progressMap.keys()]);
    return new Set([...allParticipantIds].filter(participantId =>
      matchesDemographics(demographicsById.get(participantId) ?? {}, demographicFilters)
      && (userId === '' || participantId.toLowerCase().includes(userId))
      && (completionMin === 0 || (progressMap.get(participantId) ?? 0) >= completionMin),
    ));
  }, [demographicData?.participants, demographicFilters, userIdFilter, completionMin, progressMap]);

  const filterByParticipant = <T extends { participantId?: string }>(items: T[]): T[] => {
    if (!filteredParticipantIds) return items;
    return items.filter((item) => item.participantId && filteredParticipantIds.has(item.participantId));
  };

  /** Filter items by sentiment/mood. Only applies when sentimentFilter is non-empty. */
  const filterBySentiment = <T extends { mood?: string; sentiment?: string }>(items: T[]): T[] => {
    if (sentimentFilter.length === 0) return items;
    return items.filter((item) => {
      const mood = (item.mood || item.sentiment || '').toLowerCase();
      return sentimentFilter.includes(mood);
    });
  };

  return {
    demographicData,
    demographicFilters,
    setDemographicFilters,
    userIdFilter,
    setUserIdFilter,
    completionMin,
    setCompletionMin,
    filteredParticipantIds,
    filterByParticipant,
    sentimentFilter,
    setSentimentFilter,
    filterBySentiment,
  };
}
