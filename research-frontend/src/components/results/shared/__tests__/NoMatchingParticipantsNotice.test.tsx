import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getScreenerResults = vi.hoisted(() => vi.fn(async () => ({
  totalResponses: 0, qualified: 0, disqualified: 0, overquota: 0, questionText: '',
  choiceDistribution: [], dailyDistribution: [], bestDay: null, slowestDay: null, weeklyTimeSeries: [],
})));
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
  getScreenerResults: getScreenerResults,
}));
vi.mock('../Filters', () => ({ Filters: () => <p>Filters panel</p> }));
vi.mock('../../smart-voc/components/Filters', () => ({ Filters: () => <p>Filters panel</p> }));
vi.mock('../../smart-voc/components/TrustFlowChart', () => ({ TrustFlowChart: () => null }));

import { SmartVOCResults } from '../../smart-voc/SmartVOCResults';
import { CognitiveTaskResults } from '../../cognitive-task/CognitiveTaskResults';
import { EyeTrackingResults } from '../../eye-tracking/EyeTrackingResults';
import { ScreenerResults } from '../../screener/ScreenerResults';

const views = [
  { name: 'SmartVOC', element: <SmartVOCResults researchId="research-1" />, contentText: 'No SmartVOC data available yet' },
  { name: 'Cognitive Tasks', element: <CognitiveTaskResults researchId="research-1" />, contentText: 'No cognitive task data available yet' },
  { name: 'Eye Tracking', element: <EyeTrackingResults researchId="research-1" />, contentText: 'No Eye Tracking modules found' },
  { name: 'Screener', element: <ScreenerResults researchId="research-1" />, contentText: 'Entrevistas completas' },
];

describe('results views when the filters match nobody', () => {
  beforeEach(() => {
    filterScope.filteredParticipantIds = null;
  });

  it.each(views)('$name shows the notice and keeps the filters panel', async ({ element, contentText }) => {
    filterScope.filteredParticipantIds = new Set();
    render(element);
    expect(await screen.findByText('Ningún participante cumple los filtros activos')).toBeInTheDocument();
    expect(screen.getByText('Filters panel')).toBeInTheDocument();
    expect(screen.queryByText(contentText)).not.toBeInTheDocument();
  });

  it.each(views)('$name keeps its content when no filter is active', async ({ element, contentText }) => {
    render(element);
    expect(await screen.findByText(contentText)).toBeInTheDocument();
    expect(screen.queryByText('Ningún participante cumple los filtros activos')).not.toBeInTheDocument();
  });

  it('Screener asks the backend for the filtered participants only', async () => {
    filterScope.filteredParticipantIds = new Set(['p-1', 'p-2']);
    render(<ScreenerResults researchId="research-1" />);
    expect(await screen.findByText('Entrevistas completas')).toBeInTheDocument();
    expect(getScreenerResults).toHaveBeenLastCalledWith('research-1', ['p-1', 'p-2']);
  });
});
