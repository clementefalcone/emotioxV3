import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../tracking.service', () => ({
    createSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    saveEvents: vi.fn().mockResolvedValue({ saved: 3 }),
    getTrackingConfig: vi.fn().mockResolvedValue({
        captureClicks: true,
        captureScroll: true,
        captureMousemove: false,
        consentRequired: false,
        flushIntervalMs: 2000,
        maxEventsPerFlush: 50,
        allowedDomains: ['example.com'],
        consentText: '',
        consentAcceptLabel: '',
        consentDeclineLabel: '',
        consentPosition: 'bottom',
        samplingRate: 100,
        targetPages: [],
        excludePages: [],
        captureEmotions: false,
        emotionVideoEnabled: false,
    }),
    getClickHeatmapData: vi.fn().mockResolvedValue({ clicks: [] }),
    getElementClickData: vi.fn().mockResolvedValue({ elements: [] }),
    getScrollDepthData: vi.fn().mockResolvedValue({ depths: [] }),
    getOverviewMetrics: vi.fn().mockResolvedValue({ sessions: 10 }),
    getTrackedPages: vi.fn().mockResolvedValue(['/home']),
    getSessions: vi.fn().mockResolvedValue([{ id: 's1' }]),
    getSessionEvents: vi.fn().mockResolvedValue([{ type: 'click' }]),
    getPageFunnels: vi.fn().mockResolvedValue({ funnels: [] }),
    computeFunnelDropoff: vi.fn().mockResolvedValue({ steps: [] }),
    getExportData: vi.fn().mockResolvedValue({ csv: 'data' }),
    savePageScreenshot: vi.fn().mockResolvedValue(undefined),
    savePageScreenshotFromBase64: vi.fn().mockResolvedValue(undefined),
    saveTrackingConfig: vi.fn().mockResolvedValue(undefined),
    getRecentSessionCount: vi.fn().mockResolvedValue({ count: 5 }),
    getVisitorJourneys: vi.fn().mockResolvedValue({ visitors: [] }),
    getLiveSessions: vi.fn().mockResolvedValue([]),
    getAttentionHeatmapData: vi.fn().mockResolvedValue({ points: [] }),
    savePageSnapshot: vi.fn().mockResolvedValue(undefined),
    getPageSnapshotHtml: vi.fn().mockResolvedValue('<html><head></head><body><img src=x onerror="alert(1)"></body></html>'),
    getFrictionSummary: vi.fn().mockResolvedValue({ tags: [] }),
    getSessionFrictionTags: vi.fn().mockResolvedValue([]),
    appendRrwebEvents: vi.fn().mockResolvedValue({ appended: 5 }),
    getRrwebEvents: vi.fn().mockResolvedValue([]),
    appendEmotionSamples: vi.fn().mockResolvedValue({ appended: 10 }),
    appendGazeSamples: vi.fn().mockResolvedValue({ appended: 20 }),
    saveEmotionVideo: vi.fn().mockResolvedValue({ saved: true }),
    recordCaptureError: vi.fn().mockResolvedValue({ found: true }),
}));

vi.mock('../tracking-snippet', () => ({
    generateTrackingSnippet: vi.fn().mockReturnValue('/* tracking script */'),
    generateEmbedSnippet: vi.fn().mockReturnValue('<script src="..."></script>'),
}));

vi.mock('../tracking-emotion.analytics', () => ({
    getTrackingEmotionData: vi.fn().mockResolvedValue({ emotions: [] }),
}));

vi.mock('../tracking-gaze.analytics', () => ({
    getTrackingGazeData: vi.fn().mockResolvedValue({ gaze: [] }),
}));

vi.mock('../tracking-report.service', () => ({
    getTrackingReport: vi.fn().mockResolvedValue({ sections: [] }),
    generateTrackingReport: vi.fn().mockResolvedValue({ sections: ['overview'] }),
}));

vi.mock('../../../utils/response', () => ({
    success: vi.fn((data: unknown, code?: number, _?: unknown, origin?: string) => ({
        statusCode: code || 200,
        body: JSON.stringify(data),
        headers: origin ? { 'Access-Control-Allow-Origin': origin } : {},
    })),
    error: vi.fn((msg: string, code?: number, _?: unknown, origin?: string) => ({
        statusCode: code || 400,
        body: JSON.stringify({ message: msg }),
        headers: origin ? { 'Access-Control-Allow-Origin': origin } : {},
    })),
}));

vi.mock('../../../utils/auth.local', () => ({
    requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('../../../utils/request', () => ({
    getRequestOrigin: vi.fn().mockReturnValue('http://localhost'),
}));

import { handlePublicTrackingRoutes, handleTrackingRoutes } from '../tracking.controller';
import {
    createSession,
    saveEvents,
    getTrackingConfig,
    getClickHeatmapData,
    getElementClickData,
    getScrollDepthData,
    getOverviewMetrics,
    getTrackedPages,
    getSessions,
    getSessionEvents,
    getPageFunnels,
    computeFunnelDropoff,
    getExportData,
    savePageScreenshot,
    saveTrackingConfig,
    getRecentSessionCount,
    getVisitorJourneys,
    getLiveSessions,
    getAttentionHeatmapData,
    getPageSnapshotHtml,
    getFrictionSummary,
    getSessionFrictionTags,
    appendRrwebEvents,
    getRrwebEvents,
    appendEmotionSamples,
    appendGazeSamples,
    saveEmotionVideo,
    savePageSnapshot,
    savePageScreenshotFromBase64,
    recordCaptureError,
} from '../tracking.service';
import { generateTrackingSnippet, generateEmbedSnippet } from '../tracking-snippet';
import { requireAuth } from '../../../utils/auth.local';

const mockEvent = (
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> },
): APIGatewayProxyEvent =>
    ({
        httpMethod: method,
        path,
        body: opts?.body ? JSON.stringify(opts.body) : null,
        queryStringParameters: opts?.query || null,
        headers: opts?.headers || {},
    }) as unknown as APIGatewayProxyEvent;

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── handlePublicTrackingRoutes ─────────────────────────────────────

describe('handlePublicTrackingRoutes', () => {
    it('OPTIONS returns 204 with CORS headers', async () => {
        const res = await handlePublicTrackingRoutes(mockEvent('OPTIONS', '/public/tracking/r1/session'));
        expect(res.statusCode).toBe(204);
        expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
        expect(res.headers?.['Access-Control-Allow-Methods']).toContain('POST');
    });

    it('GET script.js calls getTrackingConfig and generateTrackingSnippet', async () => {
        const res = await handlePublicTrackingRoutes(mockEvent('GET', '/public/tracking/r1/script.js'));
        expect(res.statusCode).toBe(200);
        expect(res.headers?.['Content-Type']).toContain('application/javascript');
        expect(getTrackingConfig).toHaveBeenCalledWith('r1');
        expect(generateTrackingSnippet).toHaveBeenCalledWith(
            expect.objectContaining({ researchId: 'r1' }),
        );
        expect(res.body).toBe('/* tracking script */');
    });

    it('GET script.js returns empty comment on error', async () => {
        vi.mocked(getTrackingConfig).mockRejectedValueOnce(new Error('not found'));
        const res = await handlePublicTrackingRoutes(mockEvent('GET', '/public/tracking/r1/script.js'));
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('research not available');
    });

    it('GET config returns tracking config JSON', async () => {
        const res = await handlePublicTrackingRoutes(mockEvent('GET', '/public/tracking/r1/config'));
        expect(res.statusCode).toBe(200);
        expect(getTrackingConfig).toHaveBeenCalledWith('r1');
        const body = JSON.parse(res.body);
        expect(body.captureClicks).toBe(true);
    });

    it('POST session validates required fields', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/session', { body: { visitorId: 'v1' } }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing required fields');
    });

    it('POST session calls createSession with correct params', async () => {
        const body = {
            visitorId: 'v1',
            pageUrl: 'https://example.com',
            viewportWidth: 1920,
            viewportHeight: 1080,
            pageTitle: 'Home',
            userAgent: 'Mozilla/5.0',
        };
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/session', {
                body,
                headers: { Origin: 'https://example.com' },
            }),
        );
        expect(res.statusCode).toBe(201);
        expect(createSession).toHaveBeenCalledWith(
            expect.objectContaining({
                researchId: 'r1',
                visitorId: 'v1',
                pageUrl: 'https://example.com',
                viewportWidth: 1920,
                viewportHeight: 1080,
                pageTitle: 'Home',
                requestOrigin: 'https://example.com',
            }),
        );
    });

    it('POST events validates sessionId and events array', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/events', { body: { sessionId: 's1' } }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing sessionId or events array');
    });

    it('POST events calls saveEvents with mapped event data', async () => {
        const body = {
            sessionId: 's1',
            events: [{ eventType: 'click', x: 100, y: 200, timestampMs: 1000 }],
            activeDurationMs: 5000,
        };
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/events', { body }),
        );
        expect(res.statusCode).toBe(201);
        expect(saveEvents).toHaveBeenCalledWith(
            's1',
            [expect.objectContaining({ eventType: 'click', x: 100, y: 200 })],
            5000,
        );
    });

    it('POST events handles invalid JSON gracefully', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/public/tracking/r1/events',
            body: '{invalid json',
            queryStringParameters: null,
            headers: {},
        } as unknown as APIGatewayProxyEvent;
        const res = await handlePublicTrackingRoutes(event);
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Invalid JSON');
    });

    it('POST rrweb-events validates sessionId and events array', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/rrweb-events', { body: { sessionId: 's1' } }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing sessionId or events array');
    });

    it('POST rrweb-events calls appendRrwebEvents', async () => {
        const body = { sessionId: 's1', events: [{ type: 2, data: {} }] };
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/rrweb-events', { body }),
        );
        expect(res.statusCode).toBe(201);
        expect(appendRrwebEvents).toHaveBeenCalledWith('s1', [{ type: 2, data: {} }]);
    });

    it('POST snapshot validates pageUrl and html', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/snapshot', { body: { pageUrl: 'https://x.com' } }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing pageUrl or html');
    });

    it('POST snapshot rejects payloads > 4MB', async () => {
        const bigHtml = 'x'.repeat(4_194_305);
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/snapshot', {
                body: { pageUrl: 'https://x.com', html: bigHtml },
            }),
        );
        expect(res.statusCode).toBe(413);
        expect(res.body).toContain('Snapshot too large');
    });

    it('POST snapshot saves when valid', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/snapshot', {
                body: { pageUrl: 'https://x.com', html: '<div>hi</div>' },
            }),
        );
        expect(res.statusCode).toBe(201);
        expect(savePageSnapshot).toHaveBeenCalledWith('r1', 'https://x.com', '<div>hi</div>');
    });

    it('POST screenshot validates pageUrl and imageData', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/screenshot', {
                body: { pageUrl: 'https://x.com' },
            }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing pageUrl or imageData');
    });

    it('POST screenshot rejects payloads > 5MB', async () => {
        const bigImg = 'x'.repeat(5_242_881);
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/screenshot', {
                body: { pageUrl: 'https://x.com', imageData: bigImg },
            }),
        );
        expect(res.statusCode).toBe(413);
        expect(res.body).toContain('Screenshot too large');
    });

    it('POST screenshot calls savePageScreenshotFromBase64 with device category', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/screenshot', {
                body: { pageUrl: 'https://x.com', imageData: 'base64data', device: 'mobile' },
            }),
        );
        expect(res.statusCode).toBe(201);
        expect(savePageScreenshotFromBase64).toHaveBeenCalledWith(
            'r1', 'https://x.com', 'base64data', 'mobile',
        );
    });

    it('POST screenshot defaults device to desktop for unknown values', async () => {
        await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/screenshot', {
                body: { pageUrl: 'https://x.com', imageData: 'base64data', device: 'unknown' },
            }),
        );
        expect(savePageScreenshotFromBase64).toHaveBeenCalledWith(
            'r1', 'https://x.com', 'base64data', 'desktop',
        );
    });

    it('POST emotions validates sessionId and samples', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/emotions', { body: { sessionId: 's1' } }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing sessionId or samples array');
    });

    it('POST emotions rejects > 1000 samples', async () => {
        const samples = Array.from({ length: 1001 }, (_, i) => ({ ts: i }));
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/emotions', {
                body: { sessionId: 's1', samples },
            }),
        );
        expect(res.statusCode).toBe(413);
        expect(res.body).toContain('Too many samples (max 1000)');
    });

    it('POST emotions calls appendEmotionSamples', async () => {
        const samples = [{ emotion: 'happy', confidence: 0.9 }];
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/emotions', {
                body: { sessionId: 's1', samples },
            }),
        );
        expect(res.statusCode).toBe(201);
        expect(appendEmotionSamples).toHaveBeenCalledWith('s1', samples);
    });

    it('POST capture-error rejects a kind outside the dictionary', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/capture-error', { body: { sessionId: 's1', kind: 'camera-broken' } }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Invalid kind');
        expect(recordCaptureError).not.toHaveBeenCalled();
    });

    it('POST capture-error returns 404 when the session is not in the research', async () => {
        vi.mocked(recordCaptureError).mockResolvedValueOnce({ found: false });
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/capture-error', { body: { sessionId: 's9', kind: 'camera-denied' } }),
        );
        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('Session s9 not found in research r1');
    });

    it('POST capture-error records the kind and logs it as structured JSON', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/capture-error', { body: { sessionId: 's1', kind: 'mediapipe-failed' } }),
        );
        expect(res.statusCode).toBe(201);
        expect(recordCaptureError).toHaveBeenCalledWith('r1', 's1', 'mediapipe-failed');
        expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
            event: 'tracking_capture_error', researchId: 'r1', sessionId: 's1', kind: 'mediapipe-failed',
        });
        warn.mockRestore();
    });

    it('POST gaze validates sessionId and samples', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/gaze', { body: { sessionId: 's1' } }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing sessionId or samples array');
    });

    it('POST gaze rejects > 2000 samples', async () => {
        const samples = Array.from({ length: 2001 }, (_, i) => ({ ts: i }));
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/gaze', {
                body: { sessionId: 's1', samples },
            }),
        );
        expect(res.statusCode).toBe(413);
        expect(res.body).toContain('Too many samples (max 2000)');
    });

    it('POST gaze calls appendGazeSamples', async () => {
        const samples = [{ x: 0.5, y: 0.3, ts: 100 }];
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/gaze', {
                body: { sessionId: 's1', samples },
            }),
        );
        expect(res.statusCode).toBe(201);
        expect(appendGazeSamples).toHaveBeenCalledWith('s1', samples);
    });

    it('POST emotion-video validates sessionId and video', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/emotion-video', {
                body: { sessionId: 's1' },
            }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing sessionId or video');
    });

    it('POST emotion-video rejects > 15MB', async () => {
        const bigVideo = 'x'.repeat(20_971_521);
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/emotion-video', {
                body: { sessionId: 's1', video: bigVideo },
            }),
        );
        expect(res.statusCode).toBe(413);
        expect(res.body).toContain('Video too large');
    });

    it('POST emotion-video calls saveEmotionVideo', async () => {
        const video = Buffer.from('fake-video').toString('base64');
        const res = await handlePublicTrackingRoutes(
            mockEvent('POST', '/public/tracking/r1/emotion-video', {
                body: { sessionId: 's1', video },
            }),
        );
        expect(res.statusCode).toBe(201);
        expect(saveEmotionVideo).toHaveBeenCalledWith('r1', 's1', expect.any(Buffer));
    });

    it('unknown route returns 404', async () => {
        const res = await handlePublicTrackingRoutes(
            mockEvent('GET', '/public/tracking/r1/unknown'),
        );
        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('Route not found');
    });

    it('error with "not found" message returns 404', async () => {
        vi.mocked(getTrackingConfig).mockRejectedValueOnce(new Error('Research not found'));
        const res = await handlePublicTrackingRoutes(
            mockEvent('GET', '/public/tracking/r1/config'),
        );
        expect(res.statusCode).toBe(404);
    });

    it('error with "not active" message returns 404', async () => {
        vi.mocked(getTrackingConfig).mockRejectedValueOnce(new Error('Research not active'));
        const res = await handlePublicTrackingRoutes(
            mockEvent('GET', '/public/tracking/r1/config'),
        );
        expect(res.statusCode).toBe(404);
    });

    it('unexpected error returns 500', async () => {
        vi.mocked(getTrackingConfig).mockRejectedValueOnce(new Error('DB connection failed'));
        const res = await handlePublicTrackingRoutes(
            mockEvent('GET', '/public/tracking/r1/config'),
        );
        expect(res.statusCode).toBe(500);
    });
});

// ─── handleTrackingRoutes ───────────────────────────────────────────

describe('handleTrackingRoutes', () => {
    it('requires auth and returns 401 on auth error', async () => {
        vi.mocked(requireAuth).mockRejectedValueOnce(new Error('No token provided'));
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/config'),
        );
        expect(res.statusCode).toBe(401);
    });

    it('supports token in query param when no Authorization header', async () => {
        const event = mockEvent('GET', '/tracking/r1/config', {
            query: { token: 'my-jwt' },
        });
        await handleTrackingRoutes(event);
        expect(event.headers.Authorization).toBe('Bearer my-jwt');
        expect(requireAuth).toHaveBeenCalled();
    });

    it('does not override existing Authorization header with query token', async () => {
        const event = mockEvent('GET', '/tracking/r1/config', {
            query: { token: 'query-jwt' },
            headers: { Authorization: 'Bearer header-jwt' },
        });
        await handleTrackingRoutes(event);
        expect(event.headers.Authorization).toBe('Bearer header-jwt');
    });

    it('GET /tracking/:id/config returns config', async () => {
        const res = await handleTrackingRoutes(mockEvent('GET', '/tracking/r1/config'));
        expect(res.statusCode).toBe(200);
        expect(getTrackingConfig).toHaveBeenCalledWith('r1');
    });

    it('GET /tracking/:id/verify parses since query param', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/verify', { query: { since: '300' } }),
        );
        expect(res.statusCode).toBe(200);
        expect(getRecentSessionCount).toHaveBeenCalledWith('r1', 300);
    });

    it('GET /tracking/:id/verify defaults since to 120', async () => {
        await handleTrackingRoutes(mockEvent('GET', '/tracking/r1/verify'));
        expect(getRecentSessionCount).toHaveBeenCalledWith('r1', 120);
    });

    it('GET /tracking/:id/overview passes from/to params', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/overview', {
                query: { from: '2024-01-01', to: '2024-01-31' },
            }),
        );
        expect(res.statusCode).toBe(200);
        expect(getOverviewMetrics).toHaveBeenCalledWith('r1', '2024-01-01', '2024-01-31');
    });

    it('GET /tracking/:id/pages returns tracked pages', async () => {
        const res = await handleTrackingRoutes(mockEvent('GET', '/tracking/r1/pages'));
        expect(res.statusCode).toBe(200);
        expect(getTrackedPages).toHaveBeenCalledWith('r1');
    });

    it('GET /tracking/:id/heatmap passes page and device params', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/heatmap', {
                query: { page: encodeURIComponent('https://example.com'), device: 'mobile' },
            }),
        );
        expect(res.statusCode).toBe(200);
        expect(getClickHeatmapData).toHaveBeenCalledWith('r1', 'https://example.com', 'mobile');
    });

    it('GET /tracking/:id/element-clicks passes page and device', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/element-clicks', {
                query: { page: encodeURIComponent('https://example.com'), device: 'desktop' },
            }),
        );
        expect(res.statusCode).toBe(200);
        expect(getElementClickData).toHaveBeenCalledWith('r1', 'https://example.com', 'desktop');
    });

    it('GET /tracking/:id/sessions parses limit/offset', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/sessions', { query: { limit: '10', offset: '20' } }),
        );
        expect(res.statusCode).toBe(200);
        expect(getSessions).toHaveBeenCalledWith('r1', 10, 20);
    });

    it('GET /tracking/:id/sessions defaults limit=50 offset=0', async () => {
        await handleTrackingRoutes(mockEvent('GET', '/tracking/r1/sessions'));
        expect(getSessions).toHaveBeenCalledWith('r1', 50, 0);
    });

    it('GET /tracking/:id/scroll passes page param', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/scroll', {
                query: { page: encodeURIComponent('https://example.com') },
            }),
        );
        expect(res.statusCode).toBe(200);
        expect(getScrollDepthData).toHaveBeenCalledWith('r1', 'https://example.com');
    });

    it('GET /tracking/:id/sessions/:sid/events returns session events', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/sessions/s1/events'),
        );
        expect(res.statusCode).toBe(200);
        expect(getSessionEvents).toHaveBeenCalledWith('s1');
    });

    it('GET /tracking/:id/sessions/:sid/rrweb returns rrweb events', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/sessions/s1/rrweb'),
        );
        expect(res.statusCode).toBe(200);
        expect(getRrwebEvents).toHaveBeenCalledWith('s1');
    });

    it('GET /tracking/:id/funnels/:funnelId returns funnel dropoff', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/funnels/f1'),
        );
        expect(res.statusCode).toBe(200);
        expect(computeFunnelDropoff).toHaveBeenCalledWith('r1', 'f1');
    });

    it('GET /tracking/:id/funnels returns page funnels', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/funnels'),
        );
        expect(res.statusCode).toBe(200);
        expect(getPageFunnels).toHaveBeenCalledWith('r1');
    });

    it('GET /tracking/:id/export returns export data', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/export'),
        );
        expect(res.statusCode).toBe(200);
        expect(getExportData).toHaveBeenCalledWith('r1');
    });

    it('PUT /tracking/:id/config updates tracking config', async () => {
        const body = { captureClicks: false };
        const res = await handleTrackingRoutes(
            mockEvent('PUT', '/tracking/r1/config', { body }),
        );
        expect(res.statusCode).toBe(200);
        expect(saveTrackingConfig).toHaveBeenCalledWith('r1', body);
    });

    it('GET /tracking/:id/friction returns friction summary', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/friction'),
        );
        expect(res.statusCode).toBe(200);
        expect(getFrictionSummary).toHaveBeenCalledWith('r1');
    });

    it('GET /tracking/:id/friction/sessions returns friction tags', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/friction/sessions'),
        );
        expect(res.statusCode).toBe(200);
        expect(getSessionFrictionTags).toHaveBeenCalledWith('r1');
    });

    it('GET /tracking/:id/snapshot requires page param', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/snapshot'),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing page parameter');
    });

    it('GET /tracking/:id/snapshot returns snapshot html', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/snapshot', {
                query: { page: encodeURIComponent('https://example.com') },
            }),
        );
        expect(res.statusCode).toBe(200);
        expect(getPageSnapshotHtml).toHaveBeenCalledWith('r1', 'https://example.com');
    });

    it('GET /tracking/:id/attention passes page and device', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/attention', {
                query: { page: encodeURIComponent('https://example.com'), device: 'tablet' },
            }),
        );
        expect(res.statusCode).toBe(200);
        expect(getAttentionHeatmapData).toHaveBeenCalledWith('r1', 'https://example.com', 'tablet');
    });

    it('GET /tracking/:id/visitors parses limit/offset', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/visitors', { query: { limit: '5', offset: '10' } }),
        );
        expect(res.statusCode).toBe(200);
        expect(getVisitorJourneys).toHaveBeenCalledWith('r1', 5, 10);
    });

    it('GET /tracking/:id/visitors defaults limit=20 offset=0', async () => {
        await handleTrackingRoutes(mockEvent('GET', '/tracking/r1/visitors'));
        expect(getVisitorJourneys).toHaveBeenCalledWith('r1', 20, 0);
    });

    it('GET /tracking/:id/live returns live sessions', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/live'),
        );
        expect(res.statusCode).toBe(200);
        expect(getLiveSessions).toHaveBeenCalledWith('r1');
    });

    it('GET /tracking/:id/emotions passes page param', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/emotions', {
                query: { page: encodeURIComponent('https://example.com') },
            }),
        );
        expect(res.statusCode).toBe(200);
    });

    it('GET /tracking/:id/gaze passes page param', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/gaze', {
                query: { page: encodeURIComponent('https://example.com') },
            }),
        );
        expect(res.statusCode).toBe(200);
    });

    it('GET /tracking/:id/snippet returns embed snippet', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/snippet'),
        );
        expect(res.statusCode).toBe(200);
        expect(generateEmbedSnippet).toHaveBeenCalledWith('r1', expect.any(String));
    });

    it('POST /tracking/:id/pages/screenshot validates body', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('POST', '/tracking/r1/pages/screenshot', {
                body: { pageUrl: 'https://x.com' },
            }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Missing pageUrl or screenshotS3Key');
    });

    it('POST /tracking/:id/pages/screenshot saves screenshot', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('POST', '/tracking/r1/pages/screenshot', {
                body: { pageUrl: 'https://x.com', screenshotS3Key: 'key.png' },
            }),
        );
        expect(res.statusCode).toBe(200);
        expect(savePageScreenshot).toHaveBeenCalledWith('r1', 'https://x.com', 'key.png');
    });

    it('GET /tracking/:id/report returns cached report', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/report'),
        );
        expect(res.statusCode).toBe(200);
    });

    it('POST /tracking/:id/report generates AI report', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('POST', '/tracking/r1/report', {
                body: { sections: ['overview', 'heatmap'] },
            }),
        );
        expect(res.statusCode).toBe(200);
    });

    it('unknown route returns 404', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/unknown-route'),
        );
        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('Route not found');
    });

    it('auth error with jwt message returns 401', async () => {
        vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Invalid jwt signature'));
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/config'),
        );
        expect(res.statusCode).toBe(401);
    });

    it('auth error with Unauthorized message returns 401', async () => {
        vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Unauthorized'));
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/config'),
        );
        expect(res.statusCode).toBe(401);
    });

    it('non-auth error returns 500', async () => {
        vi.mocked(getTrackingConfig).mockRejectedValueOnce(new Error('Database timeout'));
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/config'),
        );
        expect(res.statusCode).toBe(500);
    });
});

describe('snapshot-html rendering', () => {
    it('forbids script execution in the served snapshot, including inline handlers', async () => {
        const res = await handleTrackingRoutes(
            mockEvent('GET', '/tracking/r1/snapshot-html', { query: { page: 'https://example.com/' } }),
        );
        expect(res.statusCode).toBe(200);
        expect(res.headers?.['Content-Security-Policy']).toBe("script-src 'none'");
    });
});
