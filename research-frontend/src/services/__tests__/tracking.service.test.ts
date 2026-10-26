/**
 * Tests for tracking.service.ts
 * Verifies each API function calls the correct endpoint with correct params.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import apiClient from '../api/client';
import {
    getOverview,
    getTrackedPages,
    getClickHeatmap,
    getElementClicks,
    getSessions,
    verifyInstallation,
    getEmbedSnippet,
    getTrackingConfig,
    updateConfig,
    savePageScreenshot,
    getScrollDepth,
    getSessionReplay,
    getRrwebReplay,
    getFunnels,
    getFunnelDropoff,
    getExportData,
    getFrictionSummary,
    getSessionFrictionTags,
    getPageSnapshot,
    getAttentionHeatmap,
    getVisitorJourneys,
    getLiveSessions,
    getTrackingReport,
    generateTrackingReport,
    getTrackingEmotions,
    getTrackingGaze,
} from '../tracking.service';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPut = vi.mocked(apiClient.put);

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── Overview / Pages ────────────────────────────────────────────────

describe('Overview & Pages', () => {
    it('getOverview calls GET /tracking/:id/overview without date params', async () => {
        const mockData = { totalSessions: 10, uniqueVisitors: 5, pagesTracked: 2, totalEvents: 100, avgSessionDuration: 60 };
        mockGet.mockResolvedValue(mockData);

        const result = await getOverview('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/overview', { params: {} });
        expect(result).toEqual(mockData);
    });

    it('getOverview passes from/to date params when provided', async () => {
        mockGet.mockResolvedValue({});
        await getOverview('r1', '2026-01-01', '2026-01-31');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/overview', {
            params: { from: '2026-01-01', to: '2026-01-31' },
        });
    });

    it('getTrackedPages calls GET /tracking/:id/pages and unwraps pages array', async () => {
        const pages = [{ id: 'p1', pageUrl: 'https://example.com' }];
        mockGet.mockResolvedValue({ pages });

        const result = await getTrackedPages('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/pages');
        expect(result).toEqual(pages);
    });
});

// ─── Heatmaps ────────────────────────────────────────────────────────

describe('Heatmaps', () => {
    it('getClickHeatmap calls GET /tracking/:id/heatmap without params', async () => {
        mockGet.mockResolvedValue({ clicks: [], totalClicks: 0, sessions: 0 });
        await getClickHeatmap('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/heatmap', { params: {} });
    });

    it('getClickHeatmap passes page and device params', async () => {
        mockGet.mockResolvedValue({ clicks: [], totalClicks: 0, sessions: 0 });
        await getClickHeatmap('r1', 'https://example.com', 'desktop');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/heatmap', {
            params: { page: 'https://example.com', device: 'desktop' },
        });
    });

    it('getElementClicks calls GET /tracking/:id/element-clicks', async () => {
        mockGet.mockResolvedValue({ clicks: [] });
        await getElementClicks('r1', 'https://example.com', 'mobile');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/element-clicks', {
            params: { page: 'https://example.com', device: 'mobile' },
        });
    });

    it('getAttentionHeatmap calls GET /tracking/:id/attention', async () => {
        mockGet.mockResolvedValue({ points: [], totalSessions: 0, maxDwell: 0 });
        await getAttentionHeatmap('r1', 'https://example.com', 'tablet');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/attention', {
            params: { page: 'https://example.com', device: 'tablet' },
        });
    });

    it('getAttentionHeatmap omits empty params', async () => {
        mockGet.mockResolvedValue({ points: [], totalSessions: 0, maxDwell: 0 });
        await getAttentionHeatmap('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/attention', { params: {} });
    });
});

// ─── Sessions ────────────────────────────────────────────────────────

describe('Sessions', () => {
    it('getSessions calls GET /tracking/:id/sessions with default limit/offset', async () => {
        mockGet.mockResolvedValue({ sessions: [] });
        const result = await getSessions('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/sessions', {
            params: { limit: 50, offset: 0 },
        });
        expect(result).toEqual([]);
    });

    it('getSessions passes custom limit and offset', async () => {
        mockGet.mockResolvedValue({ sessions: [] });
        await getSessions('r1', 10, 20);
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/sessions', {
            params: { limit: 10, offset: 20 },
        });
    });

    it('getSessionReplay calls GET /tracking/:id/sessions/:sid/events', async () => {
        const mockReplay = { session: {}, events: [] };
        mockGet.mockResolvedValue(mockReplay);
        const result = await getSessionReplay('r1', 's1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/sessions/s1/events');
        expect(result).toEqual(mockReplay);
    });

    it('getRrwebReplay calls GET /tracking/:id/sessions/:sid/rrweb', async () => {
        const mockData = { session: {}, events: [] };
        mockGet.mockResolvedValue(mockData);
        const result = await getRrwebReplay('r1', 's1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/sessions/s1/rrweb');
        expect(result).toEqual(mockData);
    });

    it('getVisitorJourneys calls GET /tracking/:id/visitors with defaults', async () => {
        mockGet.mockResolvedValue({ visitors: [], totalVisitors: 0 });
        await getVisitorJourneys('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/visitors', {
            params: { limit: 20, offset: 0 },
        });
    });

    it('getVisitorJourneys passes custom limit/offset', async () => {
        mockGet.mockResolvedValue({ visitors: [], totalVisitors: 0 });
        await getVisitorJourneys('r1', 5, 10);
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/visitors', {
            params: { limit: 5, offset: 10 },
        });
    });

    it('getLiveSessions calls GET /tracking/:id/live', async () => {
        mockGet.mockResolvedValue({ sessions: [] });
        const result = await getLiveSessions('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/live');
        expect(result).toEqual({ sessions: [] });
    });
});

// ─── Config ──────────────────────────────────────────────────────────

describe('Config', () => {
    it('getTrackingConfig calls GET /tracking/:id/config', async () => {
        const config = { captureClicks: true };
        mockGet.mockResolvedValue(config);
        const result = await getTrackingConfig('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/config');
        expect(result).toEqual(config);
    });

    it('updateConfig calls PUT /tracking/:id/config', async () => {
        mockPut.mockResolvedValue(undefined);
        await updateConfig('r1', { captureClicks: false });
        expect(mockPut).toHaveBeenCalledWith('/tracking/r1/config', { captureClicks: false });
    });

    it('getEmbedSnippet calls GET /tracking/:id/snippet and unwraps', async () => {
        mockGet.mockResolvedValue({ snippet: '<script>...</script>' });
        const result = await getEmbedSnippet('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/snippet');
        expect(result).toBe('<script>...</script>');
    });

    it('verifyInstallation calls GET /tracking/:id/verify with default since', async () => {
        mockGet.mockResolvedValue({ count: 5, hasData: true });
        const result = await verifyInstallation('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/verify', {
            params: { since: 120 },
        });
        expect(result).toEqual({ count: 5, hasData: true });
    });

    it('verifyInstallation passes custom sinceSeconds', async () => {
        mockGet.mockResolvedValue({ count: 0, hasData: false });
        await verifyInstallation('r1', 60);
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/verify', {
            params: { since: 60 },
        });
    });
});

// ─── Scroll / Friction ───────────────────────────────────────────────

describe('Scroll & Friction', () => {
    it('getScrollDepth calls GET /tracking/:id/scroll without page param', async () => {
        mockGet.mockResolvedValue({ depths: [], totalSessions: 0 });
        await getScrollDepth('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/scroll', { params: {} });
    });

    it('getScrollDepth passes page param', async () => {
        mockGet.mockResolvedValue({ depths: [], totalSessions: 0 });
        await getScrollDepth('r1', 'https://example.com/about');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/scroll', {
            params: { page: 'https://example.com/about' },
        });
    });

    it('getFrictionSummary calls GET /tracking/:id/friction', async () => {
        mockGet.mockResolvedValue({ tags: { 'rage-click': 3 } });
        const result = await getFrictionSummary('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/friction');
        expect(result).toEqual({ tags: { 'rage-click': 3 } });
    });

    it('getSessionFrictionTags calls GET /tracking/:id/friction/sessions', async () => {
        mockGet.mockResolvedValue({ sessionTags: {} });
        const result = await getSessionFrictionTags('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/friction/sessions');
        expect(result).toEqual({ sessionTags: {} });
    });
});

// ─── Export ──────────────────────────────────────────────────────────

describe('Export', () => {
    it('getExportData calls GET /tracking/:id/export', async () => {
        mockGet.mockResolvedValue({ sessions: [], events: [] });
        const result = await getExportData('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/export');
        expect(result).toEqual({ sessions: [], events: [] });
    });
});

// ─── Funnels ─────────────────────────────────────────────────────────

describe('Funnels', () => {
    it('getFunnels calls GET /tracking/:id/funnels', async () => {
        mockGet.mockResolvedValue({ totalVisitors: 0, topPages: [], transitions: [] });
        const result = await getFunnels('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/funnels');
        expect(result).toEqual({ totalVisitors: 0, topPages: [], transitions: [] });
    });

    it('getFunnelDropoff calls GET /tracking/:id/funnels/:funnelId', async () => {
        const dropoff = { funnel: { id: 'f1', name: 'Checkout' }, steps: [], totalVisitors: 100, conversionRate: 50 };
        mockGet.mockResolvedValue(dropoff);
        const result = await getFunnelDropoff('r1', 'f1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/funnels/f1');
        expect(result).toEqual(dropoff);
    });
});

// ─── Snapshots ───────────────────────────────────────────────────────

describe('Snapshots', () => {
    it('getPageSnapshot calls GET /tracking/:id/snapshot and unwraps html', async () => {
        mockGet.mockResolvedValue({ html: '<div>snapshot</div>' });
        const result = await getPageSnapshot('r1', 'https://example.com');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/snapshot', {
            params: { page: 'https://example.com' },
        });
        expect(result).toBe('<div>snapshot</div>');
    });

    it('getPageSnapshot returns null when no snapshot', async () => {
        mockGet.mockResolvedValue({ html: null });
        const result = await getPageSnapshot('r1', 'https://example.com');
        expect(result).toBeNull();
    });

    it('savePageScreenshot calls POST /tracking/:id/pages/screenshot', async () => {
        mockPost.mockResolvedValue(undefined);
        await savePageScreenshot('r1', 'https://example.com', 'screenshots/s1.png');
        expect(mockPost).toHaveBeenCalledWith('/tracking/r1/pages/screenshot', {
            pageUrl: 'https://example.com',
            screenshotS3Key: 'screenshots/s1.png',
        });
    });
});

// ─── Report ──────────────────────────────────────────────────────────

describe('Report', () => {
    it('getTrackingReport calls GET /tracking/:id/report and unwraps', async () => {
        const report = { generatedAt: '2026-01-01', overview: 'test', keyFindings: [], recommendations: [], usabilityScore: 80, engagementAnalysis: '', frictionAnalysis: '', scrollBehavior: '', funnelAnalysis: '', topIssues: [], analyzedSections: [] };
        mockGet.mockResolvedValue({ report });
        const result = await getTrackingReport('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/report');
        expect(result).toEqual(report);
    });

    it('getTrackingReport returns null when no report', async () => {
        mockGet.mockResolvedValue({ report: null });
        const result = await getTrackingReport('r1');
        expect(result).toBeNull();
    });

    it('generateTrackingReport calls POST /tracking/:id/report and unwraps', async () => {
        const report = { generatedAt: '2026-01-01', overview: 'test', keyFindings: [], recommendations: [], usabilityScore: 80, engagementAnalysis: '', frictionAnalysis: '', scrollBehavior: '', funnelAnalysis: '', topIssues: [], analyzedSections: [] };
        mockPost.mockResolvedValue({ report });
        const result = await generateTrackingReport('r1', { sessions: true });
        expect(mockPost).toHaveBeenCalledWith('/tracking/r1/report', { sections: { sessions: true } });
        expect(result).toEqual(report);
    });
});

// ─── Emotions / Gaze ─────────────────────────────────────────────────

describe('Emotions & Gaze', () => {
    it('getTrackingEmotions calls GET /tracking/:id/emotions without page', async () => {
        mockGet.mockResolvedValue({ totalSessions: 0 });
        await getTrackingEmotions('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/emotions', { params: {} });
    });

    it('getTrackingEmotions passes page param', async () => {
        mockGet.mockResolvedValue({ totalSessions: 0 });
        await getTrackingEmotions('r1', 'https://example.com');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/emotions', {
            params: { page: 'https://example.com' },
        });
    });

    it('getTrackingGaze calls GET /tracking/:id/gaze without page', async () => {
        mockGet.mockResolvedValue({ totalSessions: 0 });
        await getTrackingGaze('r1');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/gaze', { params: {} });
    });

    it('getTrackingGaze passes page param', async () => {
        mockGet.mockResolvedValue({ totalSessions: 0 });
        await getTrackingGaze('r1', 'https://example.com');
        expect(mockGet).toHaveBeenCalledWith('/tracking/r1/gaze', {
            params: { page: 'https://example.com' },
        });
    });
});
