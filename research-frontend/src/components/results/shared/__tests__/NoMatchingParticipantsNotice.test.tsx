import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const filterScope = vi.hoisted(() => ({ filteredParticipantIds: null as Set<string> | null }));

vi.mock('../../../../hooks/useResultsFilter', () => ({
  useResultsFilter: () => ({
    demographicData: null,
    demographicFilters: {},
    setDemographicFilters: vi.fn(),
    userIdFilter: '',
    setUserIdFilter: vi.fn(),
    completionMin: 100,
    setCompletionMin: vi.fn(),
    filteredParticipantIds: filterScope.filteredParticipantIds,
    filterByParticipant: <T,>(items: T[]) => items,
    sentimentFilter: [],
    setSentimentFilter: vi.fn(),
  }),
}));
vi.mock('../../../../hooks/useSmartVOCAnalytics', () => ({
  useSmartVOCAnalytics: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn(), isLive: true }),
}));
vi.mock('../../../../hooks/useCognitiveTaskResults', () => ({
  useCognitiveTaskResults: () => ({ data: { modules: [] }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../../hooks/useResearchQuery', () => ({ useResearch: () => ({ data: null }) }));
vi.mock('../../../../services/analytics.service', () => ({
  getEyeTrackingResults: vi.fn(async () => ({ stimuli: [] })),
}));
vi.mock('../Filters', () => ({ Filters: () => <p>Filters panel</p> }));
vi.mock('../../smart-voc/components/Filters', () => ({ Filters: () => <p>Filters panel</p> }));
vi.mock('../../smart-voc/components/TrustFlowChart', () => ({ TrustFlowChart: () => null }));

import { SmartVOCResults } from '../../smart-voc/SmartVOCResults';
import { CognitiveTaskResults } from '../../cognitive-task/CognitiveTaskResults';
import { EyeTrackingResults } from '../../eye-tracking/EyeTrackingResults';

const views = [
  { name: 'SmartVOC', element: <SmartVOCResults researchId="research-1" />, emptyStudyText: 'No SmartVOC data available yet' },
  { name: 'Cognitive Tasks', element: <CognitiveTaskResults researchId="research-1" />, emptyStudyText: 'No cognitive task data available yet' },
  { name: 'Eye Tracking', element: <EyeTrackingResults researchId="research-1" />, emptyStudyText: 'No Eye Tracking modules found' },
];

describe('results views when the filters match nobody', () => {
  beforeEach(() => {
    filterScope.filteredParticipantIds = null;
  });

  it.each(views)('$name shows the notice and keeps the filters panel', async ({ element, emptyStudyText }) => {
    filterScope.filteredParticipantIds = new Set();
    render(element);
    expect(await screen.findByText('Ningún participante cumple los filtros activos')).toBeInTheDocument();
    expect(screen.getByText('Filters panel')).toBeInTheDocument();
    expect(screen.queryByText(emptyStudyText)).not.toBeInTheDocument();
  });

  it.each(views)('$name keeps its content when no filter is active', async ({ element, emptyStudyText }) => {
    render(element);
    expect(await screen.findByText(emptyStudyText)).toBeInTheDocument();
    expect(screen.queryByText('Ningún participante cumple los filtros activos')).not.toBeInTheDocument();
  });
});
