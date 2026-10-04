/**
 * Unit tests for tracking.service.ts
 * Mocks the database pool to test business logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database pool before importing the service
const mockQuery = vi.fn();
vi.mock('../../../config/database', () => ({
    default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Mock uuid
vi.mock('uuid', () => ({
    v4: () => 'mock-uuid-1234',
}));

// Mock filesystem for screenshot/video functions
vi.mock('fs', () => ({
    default: {
        writeFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
    },
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
}));
vi.mock('../../../config/local-storage', () => ({
    getMediaPath: vi.fn((p: string) => `/media/${p}`),
    ensureDirectoryExists: vi.fn(),
}));

// Now import the service (uses mocked pool)
import {
    createSession,
    saveEvents,
    getTrackingConfig,
    getClickHeatmapData,
    getOverviewMetrics,
    getTrackedPages,
    getScrollDepthData,
    getSessionEvents,
    getPageFunnels,
    getExportData,
    savePageScreenshot,
    saveTrackingConfig,
    getElementClickData,
    getRecentSessionCount,
    getSessions,
    savePageSnapshot,
    getFrictionSummary,
    getSessionFrictionTags,
    getPageSnapshotHtml,
    getAttentionHeatmapData,
    getVisitorJourneys,
    getLiveSessions,
    savePageScreenshotFromBase64,
    appendRrwebEvents,
    getRrwebEvents,
    computeFunnelDropoff,
    appendEmotionSamples,
    appendGazeSamples,
    saveEmotionVideo,
    getSessionEmotionSamples,
} from '../tracking.service';

beforeEach(() => {
    mockQuery.mockReset();
});

// ─── createSession ───────────────────────────────────────────────────

describe('createSession', () => {
    it('creates session and returns sessionId', async () => {
        // Research exists and is active
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'active', config: '{}' }] })  // research check
            .mockResolvedValueOnce({ rows: [] })   // INSERT session
            .mockResolvedValueOnce({ rows: [] });  // INSERT IGNORE tracking_pages

        const result = await createSession({
            researchId: 'r1',
            visitorId: 'v1',
            pageUrl: 'https://example.com',
            viewportWidth: 1920,
            viewportHeight: 1080,
        });

        expect(result.sessionId).toBe('mock-uuid-1234');
        expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('throws when research not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await expect(createSession({
            researchId: 'bad-id',
            visitorId: 'v1',
            pageUrl: 'https://example.com',
            viewportWidth: 1920,
            viewportHeight: 1080,
        })).rejects.toThrow('Research not found');
    });

    it('throws when research not active', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'draft' }] });

        await expect(createSession({
            researchId: 'r1',
            visitorId: 'v1',
            pageUrl: 'https://example.com',
            viewportWidth: 1920,
            viewportHeight: 1080,
        })).rejects.toThrow('Research is not active');
    });
});

// ─── saveEvents ──────────────────────────────────────────────────────

describe('saveEvents', () => {
    it('batch inserts events and returns count', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1' }] })  // session exists
            .mockResolvedValueOnce({ rows: [] })               // INSERT events
            .mockResolvedValueOnce({ rows: [] });              // UPDATE ended_at

        const result = await saveEvents('s1', [
            { eventType: 'click', x: 100, y: 200, timestampMs: 1000 },
            { eventType: 'click', x: 300, y: 400, timestampMs: 2000 },
        ]);

        expect(result.saved).toBe(2);
    });

    it('returns 0 for empty events array', async () => {
        const result = await saveEvents('s1', []);
        expect(result.saved).toBe(0);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('throws when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await expect(saveEvents('bad-session', [
            { eventType: 'click', x: 100, y: 200, timestampMs: 1000 },
        ])).rejects.toThrow('Session not found');
    });

    it('caps at 50 events per flush', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const manyEvents = Array.from({ length: 100 }, (_, i) => ({
            eventType: 'click' as const,
            x: i,
            y: i,
            timestampMs: 1000 + i,
        }));

        const result = await saveEvents('s1', manyEvents);
        expect(result.saved).toBe(50);
    });
});

// ─── getTrackingConfig ───────────────────────────────────────────────

describe('getTrackingConfig', () => {
    it('returns config with defaults', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{ config: JSON.stringify({ trackingConfig: { captureClicks: true } }), status: 'active' }],
        });

        const config = await getTrackingConfig('r1');

        expect(config.captureClicks).toBe(true);
        expect(config.captureScroll).toBe(false); // default
        expect(config.consentRequired).toBe(true); // default
        expect(config.flushIntervalMs).toBe(2000);
    });

    it('throws when research not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await expect(getTrackingConfig('bad')).rejects.toThrow('Research not found');
    });

    // Deliberate: script.js must be servable while the research is still a draft so
    // researchers can verify the snippet installation. createSession enforces the
    // active-status requirement independently, so no data is collected early.
    it('returns config regardless of research status', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ config: '{}', status: 'paused' }] });
        const config = await getTrackingConfig('r1');
        expect(config.captureClicks).toBe(true);
    });
});

// ─── getClickHeatmapData ─────────────────────────────────────────────

describe('getClickHeatmapData', () => {
    it('returns aggregated clicks and totals', async () => {
        mockQuery
            .mockResolvedValueOnce({
                rows: [
                    { x: 100, y: 200, count: 5 },
                    { x: 300, y: 400, count: 3 },
                ],
            })
            .mockResolvedValueOnce({
                rows: [{ totalClicks: 8, sessions: 2 }],
            });

        const result = await getClickHeatmapData('r1');

        expect(result.clicks).toHaveLength(2);
        expect(result.clicks[0]).toEqual({ x: 100, y: 200, count: 5 });
        expect(result.totalClicks).toBe(8);
        expect(result.sessions).toBe(2);
    });

    it('filters by pageUrl when provided', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ totalClicks: 0, sessions: 0 }] });

        await getClickHeatmapData('r1', 'https://example.com/page');

        // Second param of first call should include pageUrl
        expect(mockQuery.mock.calls[0][1]).toContain('https://example.com/page');
    });
});

// ─── getOverviewMetrics ──────────────────────────────────────────────

describe('getOverviewMetrics', () => {
    it('returns overview metrics', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                totalSessions: 10,
                uniqueVisitors: 5,
                pagesTracked: 3,
                totalEvents: 150,
                avgSessionDuration: 45.7,
            }],
        });

        const result = await getOverviewMetrics('r1');

        expect(result.totalSessions).toBe(10);
        expect(result.uniqueVisitors).toBe(5);
        expect(result.pagesTracked).toBe(3);
        expect(result.totalEvents).toBe(150);
        expect(result.avgSessionDuration).toBe(46); // rounded
    });
});

// ─── getScrollDepthData ──────────────────────────────────────────────

describe('getScrollDepthData', () => {
    it('returns cumulative scroll depth buckets', async () => {
        // Each session lands in exactly one bucket (the query takes MAX depth per
        // session), so the total is the sum of the buckets: 10 + 7 + 3 = 20.
        mockQuery.mockResolvedValueOnce({
            rows: [
                { depth_bucket: 0, session_count: 10 },
                { depth_bucket: 50, session_count: 7 },
                { depth_bucket: 100, session_count: 3 },
            ],
        });

        const result = await getScrollDepthData('r1');

        expect(result.totalSessions).toBe(20);
        expect(result.depths.length).toBe(11); // 0, 10, 20, ..., 100
        expect(result.depths[0].depthPct).toBe(0);
        // Cumulative: everyone who scrolled at all reached 0%
        expect(result.depths[0].sessions).toBe(20);
        // Half the buckets sit at or above 50%: 7 + 3 = 10
        expect(result.depths[5].depthPct).toBe(50);
        expect(result.depths[5].sessions).toBe(10);
        // 100% bucket: only sessions at depth_bucket >= 100
        const last = result.depths[result.depths.length - 1];
        expect(last.depthPct).toBe(100);
        expect(last.sessions).toBe(3);
    });
});

// ─── getPageFunnels ──────────────────────────────────────────────────

describe('getPageFunnels', () => {
    it('returns top pages and transitions', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                { visitor_id: 'v1', page_url: '/home', first_visit: '2026-01-01' },
                { visitor_id: 'v1', page_url: '/pricing', first_visit: '2026-01-01' },
                { visitor_id: 'v2', page_url: '/home', first_visit: '2026-01-01' },
                { visitor_id: 'v2', page_url: '/about', first_visit: '2026-01-01' },
            ],
        });

        const result = await getPageFunnels('r1');

        expect(result.totalVisitors).toBe(2);
        expect(result.topPages.length).toBeGreaterThan(0);
        expect(result.topPages[0].pageUrl).toBe('/home'); // most visited
        expect(result.transitions.length).toBeGreaterThan(0);
    });
});

// ─── getExportData ───────────────────────────────────────────────────

describe('getExportData', () => {
    it('returns sessions and events arrays', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1' }, { id: 's2' }] })
            .mockResolvedValueOnce({ rows: [{ session_id: 's1', event_type: 'click' }] });

        const result = await getExportData('r1');

        expect(result.sessions).toHaveLength(2);
        expect(result.events).toHaveLength(1);
    });
});

// ─── savePageScreenshot ──────────────────────────────────────────────

describe('savePageScreenshot', () => {
    it('updates tracking_pages with s3key', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await savePageScreenshot('r1', 'https://example.com', 'screenshots/r1/page.png');

        expect(mockQuery).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE tracking_pages'),
            ['screenshots/r1/page.png', 'r1', 'https://example.com']
        );
    });
});

// ─── saveTrackingConfig ──────────────────────────────────────────────

describe('saveTrackingConfig', () => {
    it('merges new config into existing', async () => {
        mockQuery
            .mockResolvedValueOnce({
                rows: [{ config: JSON.stringify({ trackingConfig: { captureClicks: true } }) }],
            })
            .mockResolvedValueOnce({ rows: [] });

        await saveTrackingConfig('r1', { captureScroll: true });

        const savedConfig = JSON.parse(mockQuery.mock.calls[1][1][0]);
        expect(savedConfig.trackingConfig.captureClicks).toBe(true);
        expect(savedConfig.trackingConfig.captureScroll).toBe(true);
    });

    it('throws when research not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await expect(saveTrackingConfig('bad', {})).rejects.toThrow('Research not found');
    });
});

// ─── getElementClickData ────────────────────────────────────────────

describe('getElementClickData', () => {
    it('returns element-level click aggregation', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                { selector: 'button.cta', offsetX: 20, offsetY: 10, elementWidth: 100, elementHeight: 40, x: 50, y: 30, count: 7 },
                { selector: 'a.nav', offsetX: 5, offsetY: 3, elementWidth: 80, elementHeight: 20, x: 10, y: 5, count: 3 },
            ],
        });

        const result = await getElementClickData('r1');

        expect(result.clicks).toHaveLength(2);
        expect(result.clicks[0].selector).toBe('button.cta');
        expect(result.clicks[0].count).toBe(7);
        expect(result.clicks[1].offsetX).toBe(5);
    });

    it('filters by pageUrl and device', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await getElementClickData('r1', 'https://example.com', 'mobile');

        expect(mockQuery.mock.calls[0][1]).toContain('https://example.com');
        // Device filter adds viewport_width params
        expect(mockQuery.mock.calls[0][1]).toContain(0);   // mobile min
        expect(mockQuery.mock.calls[0][1]).toContain(767); // mobile max
    });
});

// ─── getRecentSessionCount ──────────────────────────────────────────

describe('getRecentSessionCount', () => {
    it('returns count and hasData true when sessions exist', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 5 }] });

        const result = await getRecentSessionCount('r1', 60);

        expect(result.count).toBe(5);
        expect(result.hasData).toBe(true);
    });

    it('returns 0 count and hasData false when no sessions', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

        const result = await getRecentSessionCount('r1', 120);

        expect(result.count).toBe(0);
        expect(result.hasData).toBe(false);
    });

    it('caps sinceSeconds at 300', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

        await getRecentSessionCount('r1', 9999);

        // Second param should be capped to 300
        expect(mockQuery.mock.calls[0][1][1]).toBe(300);
    });
});

// ─── getTrackedPages ────────────────────────────────────────────────

describe('getTrackedPages', () => {
    it('returns pages with session/event counts and snapshot flag', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 'p1', page_url: '/home', page_title: 'Home', screenshot_s3_key: 'key.png',
                    screenshot_devices: null, hasSnapshot: 1, viewport_width: 1920, viewport_height: 1080,
                    sessionCount: 10, eventCount: 150, lastVisitedAt: '2026-01-01',
                },
            ],
        });

        const pages = await getTrackedPages('r1');

        expect(pages).toHaveLength(1);
        expect(pages[0].pageUrl).toBe('/home');
        expect(pages[0].hasSnapshot).toBe(true);
        expect(pages[0].sessionCount).toBe(10);
        expect(pages[0].eventCount).toBe(150);
    });

    it('parses screenshot_devices JSON string', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 'p1', page_url: '/about', page_title: null, screenshot_s3_key: null,
                screenshot_devices: JSON.stringify({ desktop: 'path.png' }),
                hasSnapshot: 0, viewport_width: 1024, viewport_height: 768,
                sessionCount: 0, eventCount: 0, lastVisitedAt: null,
            }],
        });

        const pages = await getTrackedPages('r1');

        expect(pages[0].screenshotDevices).toEqual({ desktop: 'path.png' });
        expect(pages[0].hasSnapshot).toBe(false);
    });
});

// ─── getSessions ────────────────────────────────────────────────────

describe('getSessions', () => {
    it('returns sessions with default limit/offset', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 's1', visitor_id: 'v1', page_url: '/home', page_title: 'Home',
                    viewport_width: 1920, viewport_height: 1080, user_agent: 'Mozilla',
                    referrer: null, started_at: '2026-01-01', ended_at: '2026-01-01',
                    hasRrweb: 1, eventCount: 20,
                },
            ],
        });

        const sessions = await getSessions('r1');

        expect(sessions).toHaveLength(1);
        expect(sessions[0].id).toBe('s1');
        expect(sessions[0].hasRrweb).toBe(true);
        expect(sessions[0].eventCount).toBe(20);
        // Default limit=50, offset=0
        expect(mockQuery.mock.calls[0][1]).toEqual(['r1', 50, 0]);
    });

    it('passes custom limit and offset', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await getSessions('r1', 10, 20);

        expect(mockQuery.mock.calls[0][1]).toEqual(['r1', 10, 20]);
    });
});

// ─── savePageSnapshot ───────────────────────────────────────────────

describe('savePageSnapshot', () => {
    it('saves snapshot when page exists without one', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 'p1', page_snapshot: null }] }) // SELECT
            .mockResolvedValueOnce({ rows: [] }); // UPDATE

        await savePageSnapshot('r1', '/home', '<html>snapshot</html>');

        expect(mockQuery).toHaveBeenCalledTimes(2);
        expect(mockQuery.mock.calls[1][1]).toEqual(['<html>snapshot</html>', 'r1', '/home']);
    });

    it('does not overwrite existing snapshot', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', page_snapshot: '<html>old</html>' }] });

        await savePageSnapshot('r1', '/home', '<html>new</html>');

        // Only the SELECT query, no UPDATE
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('does nothing when page not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await savePageSnapshot('r1', '/nonexistent', '<html>x</html>');

        expect(mockQuery).toHaveBeenCalledTimes(1);
    });
});

// ─── getFrictionSummary ─────────────────────────────────────────────

describe('getFrictionSummary', () => {
    it('aggregates friction tags from metadata', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                { metadata: JSON.stringify({ friction: 'rage-click' }), cnt: 5 },
                { metadata: JSON.stringify({ friction: 'dead-click' }), cnt: 3 },
            ],
        });
        mockQuery.mockResolvedValueOnce({
            rows: [
                { friction_type: 'rage-click', target_selector: '#buy', target_text: 'Buy', cnt: 4 },
            ],
        });

        const result = await getFrictionSummary('r1');

        expect(result.tags['rage-click']).toBe(5);
        expect(result.tags['dead-click']).toBe(3);
        expect(result.topElements['rage-click']).toEqual([{ selector: '#buy', text: 'Buy', count: 4 }]);
    });

    it('returns empty tags when no friction events', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getFrictionSummary('r1');

        expect(result.tags).toEqual({});
        expect(result.topElements).toEqual({});
    });
});

// ─── getSessionFrictionTags ─────────────────────────────────────────

describe('getSessionFrictionTags', () => {
    it('returns per-session friction tags', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                { session_id: 's1', friction_tags: 'rage-click,dead-click' },
                { session_id: 's2', friction_tags: 'speed-browsing' },
            ],
        });

        const result = await getSessionFrictionTags('r1');

        expect(result.sessionTags['s1']).toEqual(['rage-click', 'dead-click']);
        expect(result.sessionTags['s2']).toEqual(['speed-browsing']);
    });

    it('returns empty when no friction events', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getSessionFrictionTags('r1');

        expect(result.sessionTags).toEqual({});
    });
});

// ─── getPageSnapshotHtml ────────────────────────────────────────────

describe('getPageSnapshotHtml', () => {
    it('returns snapshot HTML when exists', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ page_snapshot: '<html>snapshot</html>' }] });

        const html = await getPageSnapshotHtml('r1', '/home');

        expect(html).toBe('<html>snapshot</html>');
    });

    it('returns null when no snapshot', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ page_snapshot: null }] });

        const html = await getPageSnapshotHtml('r1', '/home');

        expect(html).toBeNull();
    });

    it('returns null when page not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const html = await getPageSnapshotHtml('r1', '/nonexistent');

        expect(html).toBeNull();
    });
});

// ─── getAttentionHeatmapData ────────────────────────────────────────

describe('getAttentionHeatmapData', () => {
    it('computes dwell time heatmap from scroll events', async () => {
        // First query: scroll/pageview events
        mockQuery.mockResolvedValueOnce({
            rows: [
                { session_id: 's1', viewport_height: 900, viewport_width: 1920, scroll_y: 0, timestamp_ms: 1000, event_type: 'pageview' },
                { session_id: 's1', viewport_height: 900, viewport_width: 1920, scroll_y: 500, timestamp_ms: 6000, event_type: 'scroll' },
            ],
        });
        // Second query: session end times
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 's1', ended_ms: 11000 }],
        });

        const result = await getAttentionHeatmapData('r1');

        expect(result.totalSessions).toBe(1);
        expect(result.points.length).toBeGreaterThan(0);
        // All points should have x=50 (center)
        for (const pt of result.points) {
            expect(pt.x).toBe(50);
        }
        expect(result.maxDwell).toBeGreaterThan(0);
    });

    it('returns empty when no scroll events', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getAttentionHeatmapData('r1', '/page');

        expect(result.points).toEqual([]);
        expect(result.totalSessions).toBe(0);
        expect(result.maxDwell).toBe(0);
    });
});

// ─── getVisitorJourneys ─────────────────────────────────────────────

describe('getVisitorJourneys', () => {
    it('groups sessions into visits and excludes idle ones', async () => {
        const now = new Date('2026-01-01T12:00:00Z');
        const later = new Date('2026-01-01T12:05:00Z');

        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 's1', visitor_id: 'v1', page_url: '/home', page_title: 'Home',
                    started_at: now, ended_at: later, active_duration_ms: null,
                    rrweb_duration_ms: null, viewport_width: 1920, user_agent: 'Mozilla',
                    hasRrweb: 0, eventCount: 10, clickCount: 5,
                },
                {
                    id: 's2', visitor_id: 'v1', page_url: '/about', page_title: 'About',
                    started_at: later, ended_at: new Date('2026-01-01T12:10:00Z'),
                    active_duration_ms: 120000, rrweb_duration_ms: null,
                    viewport_width: 1920, user_agent: 'Mozilla',
                    hasRrweb: 0, eventCount: 5, clickCount: 2,
                },
            ],
        });

        const result = await getVisitorJourneys('r1');

        expect(result.totalVisitors).toBe(1);
        expect(result.visitors[0].pages).toHaveLength(2);
        expect(result.visitors[0].entryPage).toBe('/home');
    });

    it('excludes visits with zero events', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 's1', visitor_id: 'v1', page_url: '/home', page_title: null,
                started_at: new Date(), ended_at: new Date(), active_duration_ms: null,
                rrweb_duration_ms: null, viewport_width: 1920, user_agent: null,
                hasRrweb: 0, eventCount: 0, clickCount: 0,
            }],
        });

        const result = await getVisitorJourneys('r1');

        expect(result.totalVisitors).toBe(0);
        expect(result.visitors).toHaveLength(0);
    });
});

// ─── getLiveSessions ────────────────────────────────────────────────

describe('getLiveSessions', () => {
    it('returns live sessions grouped by visitor', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 's1', visitor_id: 'v1', page_url: '/home', page_title: 'Home',
                    viewport_width: 1920, user_agent: 'Mozilla', started_at: '2026-01-01',
                    eventCount: 15, lastEventMs: 1000,
                },
                {
                    id: 's2', visitor_id: 'v1', page_url: '/about', page_title: 'About',
                    viewport_width: 1920, user_agent: 'Mozilla', started_at: '2026-01-01',
                    eventCount: 5, lastEventMs: 2000,
                },
            ],
        });

        const result = await getLiveSessions('r1');

        expect(result.sessions).toHaveLength(1); // grouped by visitor
        expect(result.sessions[0].visitorId).toBe('v1');
        expect(result.sessions[0].pages).toHaveLength(2);
        expect(result.sessions[0].lastEventMs).toBe(2000);
    });

    it('returns empty when no live sessions', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getLiveSessions('r1');

        expect(result.sessions).toHaveLength(0);
    });
});

// ─── savePageScreenshotFromBase64 ───────────────────────────────────

describe('savePageScreenshotFromBase64', () => {
    it('saves valid PNG base64 and updates DB', async () => {
        // PNG magic bytes: 89 50 4E 47 ...
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const base64 = pngBuffer.toString('base64');

        // SELECT existing devices, then UPDATE
        mockQuery
            .mockResolvedValueOnce({ rows: [{ screenshot_devices: null }] })
            .mockResolvedValueOnce({ rows: [] });

        const path = await savePageScreenshotFromBase64('r1', '/home', base64, 'desktop');

        expect(path).toContain('research/r1/tracking/screenshot_desktop_');
        expect(path).toMatch(/\.png$/);
    });

    it('strips data URI prefix', async () => {
        const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
        const base64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

        mockQuery
            .mockResolvedValueOnce({ rows: [{ screenshot_devices: null }] })
            .mockResolvedValueOnce({ rows: [] });

        const path = await savePageScreenshotFromBase64('r1', '/home', base64);

        expect(path).toMatch(/\.jpg$/);
    });

    it('throws for invalid image data', async () => {
        const badBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        const base64 = badBuffer.toString('base64');

        await expect(
            savePageScreenshotFromBase64('r1', '/home', base64)
        ).rejects.toThrow('Invalid image data');
    });
});

// ─── getSessionEvents ───────────────────────────────────────────────

describe('getSessionEvents', () => {
    it('returns session info and normalized events', async () => {
        mockQuery
            .mockResolvedValueOnce({
                rows: [{
                    id: 's1', visitor_id: 'v1', page_url: '/home', page_title: 'Home',
                    viewport_width: 1000, viewport_height: 800, screenshot_s3_key: 'key.png',
                    started_at: '2026-01-01', ended_at: '2026-01-01',
                }],
            })
            .mockResolvedValueOnce({
                rows: [{
                    event_type: 'click', x: 500, y: 200, scroll_y: null,
                    scroll_depth_pct: null, target_selector: 'button', target_text: 'OK',
                    timestamp_ms: 1000, metadata: null,
                }],
            });

        const result = await getSessionEvents('s1');

        expect(result.session.id).toBe('s1');
        expect(result.session.screenshotS3Key).toBe('key.png');
        // x=500 / vpW=1000 * 100 = 50
        expect(result.events[0].x).toBe(50);
        // y=200 / vpW=1000 * 100 = 20
        expect(result.events[0].y).toBe(20);
    });

    it('throws when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await expect(getSessionEvents('bad')).rejects.toThrow('Session not found');
    });
});

// ─── appendRrwebEvents ──────────────────────────────────────────────

describe('appendRrwebEvents', () => {
    it('appends events to existing array', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1', rrweb_events: JSON.stringify([{ type: 1, timestamp: 100 }]) }] })
            .mockResolvedValueOnce({ rows: [] }); // UPDATE

        const result = await appendRrwebEvents('s1', [{ type: 2, timestamp: 200 }]);

        expect(result.saved).toBe(1);
        const savedJson = JSON.parse(mockQuery.mock.calls[1][1][0]);
        expect(savedJson).toHaveLength(2);
    });

    it('returns 0 for empty events', async () => {
        const result = await appendRrwebEvents('s1', []);
        expect(result.saved).toBe(0);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('throws when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await expect(appendRrwebEvents('bad', [{ type: 1 }])).rejects.toThrow('Session not found');
    });

    it('computes rrweb duration from timestamps', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1', rrweb_events: null }] })
            .mockResolvedValueOnce({ rows: [] });

        await appendRrwebEvents('s1', [
            { type: 1, timestamp: 1000 },
            { type: 2, timestamp: 5000 },
        ]);

        // rrwebDurationMs should be 4000
        const rrwebDuration = mockQuery.mock.calls[1][1][1];
        expect(rrwebDuration).toBe(4000);
    });
});

// ─── getRrwebEvents ─────────────────────────────────────────────────

describe('getRrwebEvents', () => {
    it('returns session info and parsed events', async () => {
        const events = [{ type: 1, timestamp: 100 }, { type: 2, timestamp: 200 }];
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 's1', visitor_id: 'v1', page_url: '/home', page_title: 'Home',
                viewport_width: 1920, viewport_height: 1080,
                started_at: '2026-01-01', ended_at: '2026-01-01',
                rrweb_events: JSON.stringify(events),
            }],
        });

        const result = await getRrwebEvents('s1');

        expect(result.session.id).toBe('s1');
        expect(result.events).toHaveLength(2);
    });

    it('throws when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await expect(getRrwebEvents('bad')).rejects.toThrow('Session not found');
    });

    it('returns empty array when no rrweb events stored', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{
                id: 's1', visitor_id: 'v1', page_url: '/', page_title: null,
                viewport_width: 1920, viewport_height: 1080,
                started_at: '2026-01-01', ended_at: null,
                rrweb_events: null,
            }],
        });

        const result = await getRrwebEvents('s1');
        expect(result.events).toEqual([]);
    });
});

// ─── computeFunnelDropoff ───────────────────────────────────────────

describe('computeFunnelDropoff', () => {
    it('computes step-by-step dropoff for a funnel', async () => {
        const config = {
            trackingConfig: {
                funnels: [{
                    id: 'f1',
                    name: 'Signup Funnel',
                    steps: [
                        { url: '/home', label: 'Home' },
                        { url: '/signup', label: 'Signup' },
                        { url: '/confirm', label: 'Confirm' },
                    ],
                }],
            },
        };
        mockQuery
            .mockResolvedValueOnce({ rows: [{ config: JSON.stringify(config) }] })
            .mockResolvedValueOnce({
                rows: [
                    { visitor_id: 'v1', page_url: '/home', first_visit: '2026-01-01' },
                    { visitor_id: 'v1', page_url: '/signup', first_visit: '2026-01-02' },
                    { visitor_id: 'v1', page_url: '/confirm', first_visit: '2026-01-03' },
                    { visitor_id: 'v2', page_url: '/home', first_visit: '2026-01-01' },
                    { visitor_id: 'v2', page_url: '/signup', first_visit: '2026-01-02' },
                ],
            });

        const result = await computeFunnelDropoff('r1', 'f1');

        expect(result.totalVisitors).toBe(2);
        expect(result.steps).toHaveLength(3);
        expect(result.steps[0].visitors).toBe(2); // both hit /home
        expect(result.steps[1].visitors).toBe(2); // both hit /signup
        expect(result.steps[2].visitors).toBe(1); // only v1 hit /confirm
        expect(result.conversionRate).toBe(50);   // 1/2
    });

    it('throws when research not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await expect(computeFunnelDropoff('bad', 'f1')).rejects.toThrow('Research not found');
    });

    it('throws when funnel not found', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{ config: JSON.stringify({ trackingConfig: { funnels: [] } }) }],
        });
        await expect(computeFunnelDropoff('r1', 'nonexistent')).rejects.toThrow('Funnel not found');
    });
});

// ─── appendEmotionSamples ───────────────────────────────────────────

describe('appendEmotionSamples', () => {
    it('appends samples and caps at 1000', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1', emotion_samples: JSON.stringify([{ t: 1 }]) }] })
            .mockResolvedValueOnce({ rows: [] });

        const result = await appendEmotionSamples('s1', [{ t: 2 }, { t: 3 }]);

        expect(result.saved).toBe(2);
        const savedJson = JSON.parse(mockQuery.mock.calls[1][1][0]);
        expect(savedJson).toHaveLength(3);
    });

    it('returns 0 for empty samples', async () => {
        const result = await appendEmotionSamples('s1', []);
        expect(result.saved).toBe(0);
    });

    it('throws when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await expect(appendEmotionSamples('bad', [{ t: 1 }])).rejects.toThrow('Session not found');
    });
});

// ─── appendGazeSamples ──────────────────────────────────────────────

describe('appendGazeSamples', () => {
    it('appends gaze samples to existing', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1', gaze_samples: null }] })
            .mockResolvedValueOnce({ rows: [] });

        const result = await appendGazeSamples('s1', [{ x: 0.5, y: 0.3 }]);

        expect(result.saved).toBe(1);
    });

    it('returns 0 for empty samples', async () => {
        const result = await appendGazeSamples('s1', []);
        expect(result.saved).toBe(0);
    });

    it('throws when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        await expect(appendGazeSamples('bad', [{ x: 1 }])).rejects.toThrow('Session not found');
    });
});

// ─── saveEmotionVideo ───────────────────────────────────────────────

describe('saveEmotionVideo', () => {
    it('saves video buffer and updates DB path', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 's1' }] })  // session check
            .mockResolvedValueOnce({ rows: [] });              // UPDATE

        const videoBuffer = Buffer.from('fake-webm-data');
        const result = await saveEmotionVideo('r1', 's1', videoBuffer);

        expect(result.path).toContain('research/r1/tracking/emotion_s1_');
        expect(result.path).toMatch(/\.webm$/);
    });

    it('throws when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        await expect(
            saveEmotionVideo('r1', 'bad', Buffer.from('data'))
        ).rejects.toThrow('Session not found');
    });
});

// ─── getSessionEmotionSamples ───────────────────────────────────────

describe('getSessionEmotionSamples', () => {
    it('returns parsed emotion samples', async () => {
        const samples = [{ emotion: 'happy', t: 1000 }, { emotion: 'sad', t: 2000 }];
        mockQuery.mockResolvedValueOnce({
            rows: [{ emotion_samples: JSON.stringify(samples) }],
        });

        const result = await getSessionEmotionSamples('s1');

        expect(result).toHaveLength(2);
        expect((result[0] as Record<string, unknown>).emotion).toBe('happy');
    });

    it('returns empty array when session not found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await getSessionEmotionSamples('bad');

        expect(result).toEqual([]);
    });

    it('returns empty array when no samples stored', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ emotion_samples: null }] });

        const result = await getSessionEmotionSamples('s1');

        expect(result).toEqual([]);
    });
});
