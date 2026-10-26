import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({
    default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockCreate = vi.fn();
vi.mock('openai', () => {
    const create = (...args: unknown[]) => mockCreate(...args);
    return {
        default: class {
            chat = { completions: { create } };
        },
    };
});

const mockGetOverviewMetrics = vi.fn();
const mockGetTrackedPages = vi.fn();
const mockGetScrollDepthData = vi.fn();
const mockGetFrictionSummary = vi.fn();
const mockGetVisitorJourneys = vi.fn();
const mockGetTrackingConfig = vi.fn();

vi.mock('../tracking.service', () => ({
    getOverviewMetrics: (...args: unknown[]) => mockGetOverviewMetrics(...args),
    getTrackedPages: (...args: unknown[]) => mockGetTrackedPages(...args),
    getScrollDepthData: (...args: unknown[]) => mockGetScrollDepthData(...args),
    getFrictionSummary: (...args: unknown[]) => mockGetFrictionSummary(...args),
    getVisitorJourneys: (...args: unknown[]) => mockGetVisitorJourneys(...args),
    getTrackingConfig: (...args: unknown[]) => mockGetTrackingConfig(...args),
}));

import { generateTrackingReport } from '../tracking-report.service';

const RESEARCH_ID = 'res-123';

const defaultOverview = {
    uniqueVisitors: 100,
    totalSessions: 200,
    pagesTracked: 5,
    totalEvents: 1500,
    avgSessionDuration: 45,
};

const defaultPages = [
    { pageUrl: '/home', pageTitle: 'Home', sessionCount: 80, eventCount: 400 },
    { pageUrl: '/pricing', pageTitle: 'Pricing', sessionCount: 50, eventCount: 200 },
];

const defaultScrollData = {
    depths: [{ depthPct: 50, sessions: 15, percentage: 75 }],
    totalSessions: 20,
};

const defaultFrictionData = {
    tags: { 'rage-click': 5, 'dead-click': 12 },
};

const defaultVisitorsData = {
    visitors: [{ visitorId: 'v1', sessionCount: 3, entryPage: '/home', pages: [] }],
    totalVisitors: 1,
};

const defaultTrackingConfig = {
    funnels: [{ id: 'f1', name: 'Signup', steps: [{ url: '/signup', label: 'Start' }] }],
};

const llmResponse = {
    overview: 'Test analysis',
    keyFindings: ['Finding 1'],
    recommendations: ['Rec 1'],
    usabilityScore: 72,
    engagementAnalysis: 'Good',
    frictionAnalysis: 'Some friction',
    scrollBehavior: 'Average',
    funnelAnalysis: 'Needs work',
    topIssues: [{ issue: 'Issue 1', severity: 'high', suggestion: 'Fix it' }],
};

function setupServiceMocks() {
    mockGetOverviewMetrics.mockResolvedValue(defaultOverview);
    mockGetTrackedPages.mockResolvedValue(defaultPages);
    mockGetScrollDepthData.mockResolvedValue(defaultScrollData);
    mockGetFrictionSummary.mockResolvedValue(defaultFrictionData);
    mockGetVisitorJourneys.mockResolvedValue(defaultVisitorsData);
    mockGetTrackingConfig.mockResolvedValue(defaultTrackingConfig);
}

function setupLlmMock() {
    mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(llmResponse) } }],
    });
}

function setupCacheMock(existingConfig: Record<string, unknown> = {}) {
    mockQuery.mockResolvedValue({ rows: [{ config: existingConfig }] });
}

beforeEach(() => {
    mockQuery.mockReset();
    mockCreate.mockReset();
    mockGetOverviewMetrics.mockReset();
    mockGetTrackedPages.mockReset();
    mockGetScrollDepthData.mockReset();
    mockGetFrictionSummary.mockReset();
    mockGetVisitorJourneys.mockReset();
    mockGetTrackingConfig.mockReset();
});

describe('generateTrackingReport', () => {
    it('gathers overview + pages always', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, {});

        expect(mockGetOverviewMetrics).toHaveBeenCalledWith(RESEARCH_ID);
        expect(mockGetTrackedPages).toHaveBeenCalledWith(RESEARCH_ID);
    });

    it('conditionally fetches scroll/friction when heatmap sections selected', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, { heatmaps_click: true });

        expect(mockGetScrollDepthData).toHaveBeenCalledWith(RESEARCH_ID);
        expect(mockGetFrictionSummary).toHaveBeenCalledWith(RESEARCH_ID);
    });

    it('does not fetch scroll/friction when heatmap sections not selected', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, { sessions: true });

        expect(mockGetScrollDepthData).not.toHaveBeenCalled();
        expect(mockGetFrictionSummary).not.toHaveBeenCalled();
    });

    it('conditionally fetches visitors when sessions section selected', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, { sessions: true });

        expect(mockGetVisitorJourneys).toHaveBeenCalledWith(RESEARCH_ID, 50, 0);
    });

    it('does not fetch visitors when sessions not selected', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, { heatmaps_click: true });

        expect(mockGetVisitorJourneys).not.toHaveBeenCalled();
    });

    it('conditionally fetches config when funnels section selected', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, { funnels_custom: true });

        expect(mockGetTrackingConfig).toHaveBeenCalledWith(RESEARCH_ID);
    });

    it('does not fetch config when funnels not selected', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, { sessions: true });

        expect(mockGetTrackingConfig).not.toHaveBeenCalled();
    });

    it('builds correct analyzedSections for overview only', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        const result = await generateTrackingReport(RESEARCH_ID, {});

        expect(result.analyzedSections).toEqual(['Overview']);
    });

    it('builds correct analyzedSections for all sections', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        const result = await generateTrackingReport(RESEARCH_ID, {
            funnels_custom: true,
            heatmaps_click: true,
            sessions: true,
            live: true,
        });

        expect(result.analyzedSections).toContain('Overview');
        expect(result.analyzedSections).toContain('Funnels');
        expect(result.analyzedSections).toContain('Heatmaps');
        expect(result.analyzedSections).toContain('Sessions');
        expect(result.analyzedSections).toContain('Live');
    });

    it('calls OpenAI with correct model and temperature', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, {});

        expect(mockCreate).toHaveBeenCalledTimes(1);
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.model).toBeDefined();
        expect(callArgs.temperature).toBe(0.3);
        expect(callArgs.response_format).toEqual({ type: 'json_object' });
        expect(callArgs.messages).toHaveLength(1);
        expect(callArgs.messages[0].role).toBe('user');
    });

    it('parses LLM JSON response correctly', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        const result = await generateTrackingReport(RESEARCH_ID, {});

        expect(result.overview).toBe('Test analysis');
        expect(result.keyFindings).toEqual(['Finding 1']);
        expect(result.recommendations).toEqual(['Rec 1']);
        expect(result.usabilityScore).toBe(72);
        expect(result.engagementAnalysis).toBe('Good');
        expect(result.frictionAnalysis).toBe('Some friction');
        expect(result.scrollBehavior).toBe('Average');
        expect(result.funnelAnalysis).toBe('Needs work');
        expect(result.topIssues).toEqual([{ issue: 'Issue 1', severity: 'high', suggestion: 'Fix it' }]);
    });

    it('falls back gracefully on empty LLM response', async () => {
        setupServiceMocks();
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: '{}' } }],
        });
        setupCacheMock();

        const result = await generateTrackingReport(RESEARCH_ID, {});

        expect(result.overview).toBe('No analysis available.');
        expect(result.keyFindings).toEqual([]);
        expect(result.recommendations).toEqual([]);
        expect(result.usabilityScore).toBe(50);
        expect(result.engagementAnalysis).toBe('');
        expect(result.frictionAnalysis).toBe('');
        expect(result.scrollBehavior).toBe('');
        expect(result.funnelAnalysis).toBe('');
        expect(result.topIssues).toEqual([]);
    });

    it('caches report in research config', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID, {});

        const updateCall = mockQuery.mock.calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('UPDATE')
        );
        expect(updateCall).toBeDefined();
        const savedConfig = JSON.parse(updateCall![1][0]);
        expect(savedConfig.trackingReport).toBeDefined();
        expect(savedConfig.trackingReport.overview).toBe('Test analysis');
    });

    it('preserves existing config when caching', async () => {
        setupServiceMocks();
        setupLlmMock();
        mockQuery.mockResolvedValue({
            rows: [{ config: { existingKey: 'preserved', otherData: 42 } }],
        });

        await generateTrackingReport(RESEARCH_ID, {});

        const updateCall = mockQuery.mock.calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('UPDATE')
        );
        expect(updateCall).toBeDefined();
        const savedConfig = JSON.parse(updateCall![1][0]);
        expect(savedConfig.existingKey).toBe('preserved');
        expect(savedConfig.otherData).toBe(42);
        expect(savedConfig.trackingReport).toBeDefined();
    });

    it('returns TrackingReport with all required fields', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        const result = await generateTrackingReport(RESEARCH_ID, { heatmaps_click: true });

        expect(result).toHaveProperty('generatedAt');
        expect(result).toHaveProperty('overview');
        expect(result).toHaveProperty('keyFindings');
        expect(result).toHaveProperty('recommendations');
        expect(result).toHaveProperty('usabilityScore');
        expect(result).toHaveProperty('engagementAnalysis');
        expect(result).toHaveProperty('frictionAnalysis');
        expect(result).toHaveProperty('scrollBehavior');
        expect(result).toHaveProperty('funnelAnalysis');
        expect(result).toHaveProperty('topIssues');
        expect(result).toHaveProperty('analyzedSections');
        expect(typeof result.generatedAt).toBe('string');
        expect(Array.isArray(result.analyzedSections)).toBe(true);
    });

    it('with no sections selected, only overview data is gathered', async () => {
        setupServiceMocks();
        setupLlmMock();
        setupCacheMock();

        await generateTrackingReport(RESEARCH_ID);

        expect(mockGetOverviewMetrics).toHaveBeenCalledWith(RESEARCH_ID);
        expect(mockGetTrackedPages).toHaveBeenCalledWith(RESEARCH_ID);
        expect(mockGetScrollDepthData).not.toHaveBeenCalled();
        expect(mockGetFrictionSummary).not.toHaveBeenCalled();
        expect(mockGetVisitorJourneys).not.toHaveBeenCalled();
        expect(mockGetTrackingConfig).not.toHaveBeenCalled();
    });

    it('handles config as string when caching', async () => {
        setupServiceMocks();
        setupLlmMock();
        mockQuery.mockResolvedValue({
            rows: [{ config: JSON.stringify({ existingFromString: true }) }],
        });

        await generateTrackingReport(RESEARCH_ID, {});

        const updateCall = mockQuery.mock.calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('UPDATE')
        );
        expect(updateCall).toBeDefined();
        const savedConfig = JSON.parse(updateCall![1][0]);
        expect(savedConfig.existingFromString).toBe(true);
        expect(savedConfig.trackingReport).toBeDefined();
    });
});
