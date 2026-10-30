/**
 * Website Tracking Controller
 * Handles public endpoints (script, session, events) and authenticated endpoints (analytics, config).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { requireAuth } from '../../utils/auth.local';
import { getRequestOrigin } from '../../utils/request';
import {
    createSession,
    saveEvents,
    getTrackingConfig,
    getClickHeatmapData,
    getElementClickData,
    getScrollDepthData,
    getOverviewMetrics,
    getTrackedPages,
    getSessionEvents,
    getPageFunnels,
    computeFunnelDropoff,
    getExportData,
    saveTrackingConfig,
    isTrackingZone,
    getRecentSessionCount,
    getVisitorJourneys,
    getLiveSessions,
    getAttentionHeatmapData,
    savePageSnapshot,
    getPageSnapshotHtml,
    getFrictionSummary,
    getSessionFrictionTags,
    appendRrwebEvents,
    MAX_RRWEB_JSON_LENGTH,
    getRrwebEvents,
    appendEmotionSamples,
    appendGazeSamples,
    recordCaptureError,
    TrackingRejectedError,
} from './tracking.service';
import { isCaptureErrorKind, CAPTURE_ERROR_KINDS } from './capture-errors';
import { generateTrackingSnippet, generateEmbedSnippet } from './tracking-snippet';
import { fetchPublicUrl, BlockedUrlError } from './public-fetch';
import { fetchProxiedAsset, renderInertPage, type ProxiedAsset } from './proxy-rewrite';
import { canAccessResearch, researchNotFound } from '../research/research-access';

// ─── CORS helpers for public tracking (accepts ANY origin) ───────────

const TRACKING_CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

const trackingSuccess = <T>(data: T, statusCode = 200): APIGatewayProxyResult => ({
    statusCode,
    headers: TRACKING_CORS_HEADERS,
    body: JSON.stringify(data),
});

const trackingError = (message: string, statusCode = 400): APIGatewayProxyResult => ({
    statusCode,
    headers: TRACKING_CORS_HEADERS,
    body: JSON.stringify({ message }),
});

const proxiedAssetResponse = (asset: ProxiedAsset, allowOrigin: string): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: {
        'Content-Type': asset.contentType,
        'Access-Control-Allow-Origin': allowOrigin,
        'Cache-Control': 'public, max-age=86400',
        ...(asset.isBinary ? { 'X-Binary': '1' } : {}),
    },
    body: asset.body,
    ...(asset.isBinary ? { isBase64Encoded: true } : {}),
});

const inertPageResponse = (html: string, origin: string | null): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "script-src 'none'",
        'Access-Control-Allow-Origin': origin || '*',
        'Cache-Control': 'no-cache',
    },
    body: html,
});

// ─── Public Routes (called by the tracking script, no auth) ──────────

export const handlePublicTrackingRoutes = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;

    // CORS preflight for tracking endpoints (any origin)
    if (httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: TRACKING_CORS_HEADERS, body: '' };
    }

    try {
        // GET /public/tracking/:researchId/script.js — serve the tracking script
        const scriptMatch = path.match(/^\/public\/tracking\/([^/]+)\/script\.js$/);
        if (scriptMatch && (httpMethod === 'GET' || httpMethod === 'HEAD')) {
            const researchId = scriptMatch[1];

            try {
                const config = await getTrackingConfig(researchId);

                // Use env var for reliable API base URL (cPanel/Passenger headers can be inconsistent)
                const apiBaseUrl = process.env.API_BASE_URL || 'https://emotio.cx/api';

                const js = generateTrackingSnippet({
                    researchId,
                    apiBaseUrl,
                    captureClicks: config.captureClicks,
                    captureScroll: config.captureScroll,
                    captureMousemove: config.captureMousemove,
                    consentRequired: config.consentRequired,
                    flushIntervalMs: config.flushIntervalMs,
                    maxEventsPerFlush: config.maxEventsPerFlush,
                    allowedDomains: config.allowedDomains,
                    consentText: config.consentText,
                    consentAcceptLabel: config.consentAcceptLabel,
                    consentDeclineLabel: config.consentDeclineLabel,
                    consentPosition: config.consentPosition,
                    samplingRate: config.samplingRate,
                    targetPages: config.targetPages,
                    excludePages: config.excludePages,
                    emotionsMode: config.emotionsMode,
                    emotionModelBaseUrl: apiBaseUrl + '/media/face-api-models',
                    gazeMode: config.gazeMode,
                    eyeEmbedUrl: (process.env.PARTICIPANT_FRONTEND_URL || 'https://emotio.cx/participant') + '/embed/eye.js',
                    zones: config.zones,
                });

                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/javascript; charset=utf-8',
                        'Cache-Control': 'no-cache',
                        'Access-Control-Allow-Origin': '*',
                    },
                    body: js,
                };
            } catch (err) {
                // Return empty script if research not found/inactive
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/javascript; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                    },
                    body: '/* EmotioX tracking: research not available */',
                };
            }
        }

        // GET /public/tracking/:researchId/config — tracking configuration
        const configMatch = path.match(/^\/public\/tracking\/([^/]+)\/config$/);
        if (configMatch && httpMethod === 'GET') {
            const researchId = configMatch[1];
            const config = await getTrackingConfig(researchId);
            return trackingSuccess(config);
        }

        // POST /public/tracking/:researchId/session — create tracking session
        const sessionMatch = path.match(/^\/public\/tracking\/([^/]+)\/session$/);
        if (sessionMatch && httpMethod === 'POST') {
            const researchId = sessionMatch[1];
            const body = JSON.parse(event.body || '{}');

            if (!body.visitorId || !body.pageUrl || !body.viewportWidth || !body.viewportHeight) {
                return trackingError('Missing required fields: visitorId, pageUrl, viewportWidth, viewportHeight');
            }

            const result = await createSession({
                researchId,
                visitorId: body.visitorId,
                pageUrl: body.pageUrl,
                pageTitle: body.pageTitle,
                viewportWidth: body.viewportWidth,
                viewportHeight: body.viewportHeight,
                screenWidth: body.screenWidth,
                screenHeight: body.screenHeight,
                userAgent: body.userAgent,
                referrer: body.referrer,
                requestOrigin: event.headers.Origin || event.headers.origin || event.headers.Referer || event.headers.referer,
                requestIP: event.headers['X-Forwarded-For']?.split(',')[0]?.trim() || event.headers['x-forwarded-for']?.split(',')[0]?.trim(),
            });

            return trackingSuccess(result, 201);
        }

        // POST /public/tracking/:researchId/events — batch save events
        const eventsMatch = path.match(/^\/public\/tracking\/([^/]+)\/events$/);
        if (eventsMatch && httpMethod === 'POST') {
            let body: Record<string, unknown>;
            try {
                // Support both JSON and sendBeacon blob
                body = JSON.parse(event.body || '{}');
            } catch {
                return trackingError('Invalid JSON');
            }

            const sessionId = body.sessionId as string;
            const events = body.events as Array<Record<string, unknown>>;

            if (!sessionId || !Array.isArray(events)) {
                return trackingError('Missing sessionId or events array');
            }

            const activeDurationMs = typeof body.activeDurationMs === 'number' ? body.activeDurationMs : undefined;

            const result = await saveEvents({ researchId: eventsMatch[1], sessionId }, events.map((e) => ({
                eventType: e.eventType as 'click' | 'scroll' | 'mousemove' | 'resize' | 'pageview',
                x: typeof e.x === 'number' ? e.x : undefined,
                y: typeof e.y === 'number' ? e.y : undefined,
                scrollY: typeof e.scrollY === 'number' ? e.scrollY : undefined,
                scrollDepthPct: typeof e.scrollDepthPct === 'number' ? e.scrollDepthPct : undefined,
                targetSelector: typeof e.targetSelector === 'string' ? e.targetSelector : undefined,
                targetText: typeof e.targetText === 'string' ? e.targetText : undefined,
                timestampMs: typeof e.timestampMs === 'number' ? e.timestampMs : Date.now(),
                elementOffsetX: typeof e.elementOffsetX === 'number' ? e.elementOffsetX : undefined,
                elementOffsetY: typeof e.elementOffsetY === 'number' ? e.elementOffsetY : undefined,
                elementWidth: typeof e.elementWidth === 'number' ? e.elementWidth : undefined,
                elementHeight: typeof e.elementHeight === 'number' ? e.elementHeight : undefined,
                metadata: typeof e.metadata === 'object' ? e.metadata as Record<string, unknown> : undefined,
            })), activeDurationMs);

            return trackingSuccess(result, 201);
        }

        // POST /public/tracking/:researchId/rrweb-events — append rrweb recording events
        const rrwebMatch = path.match(/^\/public\/tracking\/([^/]+)\/rrweb-events$/);
        if (rrwebMatch && httpMethod === 'POST') {
            let body: Record<string, unknown>;
            try { body = JSON.parse(event.body || '{}'); } catch { return trackingError('Invalid JSON'); }
            const sessionId = body.sessionId as string;
            const rrwebEvts = body.events as unknown[];
            if (!sessionId || !Array.isArray(rrwebEvts)) {
                return trackingError('Missing sessionId or events array');
            }
            const result = await appendRrwebEvents({ researchId: rrwebMatch[1], sessionId }, rrwebEvts);
            if (result.isTruncated) {
                console.warn(JSON.stringify({ event: 'tracking_rrweb_truncated', researchId: rrwebMatch[1], sessionId, droppedEvents: rrwebEvts.length }));
                return trackingError(`rrweb recording of session ${sessionId} exceeds ${MAX_RRWEB_JSON_LENGTH} characters`, 413);
            }
            return trackingSuccess(result, 201);
        }

        // POST /public/tracking/:researchId/snapshot — save DOM snapshot for a page
        const snapshotMatch = path.match(/^\/public\/tracking\/([^/]+)\/snapshot$/);
        if (snapshotMatch && httpMethod === 'POST') {
            const researchId = snapshotMatch[1];
            let body: Record<string, unknown>;
            try { body = JSON.parse(event.body || '{}'); } catch { return trackingError('Invalid JSON'); }
            const pageUrl = body.pageUrl as string;
            const html = body.html as string;
            if (!pageUrl || !html) return trackingError('Missing pageUrl or html');
            if (html.length > 4194304) return trackingError('Snapshot too large', 413);
            await savePageSnapshot(researchId, pageUrl, html);
            return trackingSuccess({ saved: true }, 201);
        }

        // POST /public/tracking/:researchId/emotions — save emotion samples for a session
        const emotionsMatch = path.match(/^\/public\/tracking\/([^/]+)\/emotions$/);
        if (emotionsMatch && httpMethod === 'POST') {
            let body: Record<string, unknown>;
            try { body = JSON.parse(event.body || '{}'); } catch { return trackingError('Invalid JSON'); }
            const sessionId = body.sessionId as string;
            const samples = body.samples as unknown[];
            if (!sessionId || !Array.isArray(samples)) {
                return trackingError('Missing sessionId or samples array');
            }
            if (samples.length > 1000) return trackingError('Too many samples (max 1000)', 413);
            const result = await appendEmotionSamples({ researchId: emotionsMatch[1], sessionId }, samples);
            return trackingSuccess(result, 201);
        }

        // POST /public/tracking/:researchId/gaze — append gaze attention samples
        const gazeMatch = path.match(/^\/public\/tracking\/([^/]+)\/gaze$/);
        if (gazeMatch && httpMethod === 'POST') {
            let body: Record<string, unknown>;
            try { body = JSON.parse(event.body || '{}'); } catch { return trackingError('Invalid JSON'); }
            const sessionId = body.sessionId as string;
            const samples = body.samples as unknown[];
            if (!sessionId || !Array.isArray(samples)) {
                return trackingError('Missing sessionId or samples array');
            }
            if (samples.length > 2000) return trackingError('Too many samples (max 2000)', 413);
            const result = await appendGazeSamples({ researchId: gazeMatch[1], sessionId }, samples);
            return trackingSuccess(result, 201);
        }

        const captureErrorMatch = path.match(/^\/public\/tracking\/([^/]+)\/capture-error$/);
        if (captureErrorMatch && httpMethod === 'POST') {
            const researchId = captureErrorMatch[1];
            let body: Record<string, unknown>;
            try { body = JSON.parse(event.body || '{}'); } catch { return trackingError('Invalid JSON'); }
            const sessionId = body.sessionId;
            const kind = body.kind;
            if (typeof sessionId !== 'string' || !sessionId) return trackingError('Missing sessionId');
            if (!isCaptureErrorKind(kind)) return trackingError(`Invalid kind: expected one of ${CAPTURE_ERROR_KINDS.join(', ')}`);
            const { found } = await recordCaptureError(researchId, sessionId, kind);
            if (!found) return trackingError(`Session ${sessionId} not found in research ${researchId}`, 404);
            console.warn(JSON.stringify({ event: 'tracking_capture_error', researchId, sessionId, kind }));
            return trackingSuccess({ recorded: true }, 201);
        }

        const publicProxyAssetMatch = path.match(/^\/public\/tracking\/([^/]+)\/proxy-asset$/);
        if (publicProxyAssetMatch && httpMethod === 'GET') {
            const assetUrl = event.queryStringParameters?.url
                ? decodeURIComponent(event.queryStringParameters.url)
                : null;
            if (!assetUrl) return trackingError('Missing url parameter');
            await getTrackingConfig(publicProxyAssetMatch[1]);

            try {
                const asset = await fetchProxiedAsset(assetUrl, `/api/public/tracking/${publicProxyAssetMatch[1]}/proxy-asset?url=`);
                return proxiedAssetResponse(asset, '*');
            } catch (err) {
                if (err instanceof BlockedUrlError) return trackingError(err.message);
                return trackingError('Failed to fetch asset');
            }
        }

        return trackingError('Route not found', 404);
    } catch (err: unknown) {
        if (err instanceof TrackingRejectedError) {
            console.warn(JSON.stringify({ event: 'tracking_session_rejected', reason: err.message }));
            return trackingError(err.message, 403);
        }
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Tracking Public] Error:', err);
        if (msg.includes('not found') || msg.includes('not active')) {
            return trackingError(msg, 404);
        }
        return trackingError(msg, 500);
    }
};

// ─── Authenticated Routes (research-frontend) ───────────────────────

export const handleTrackingRoutes = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // Support token in query param (for iframe src where headers aren't available)
        if (event.queryStringParameters?.token && !event.headers.Authorization && !event.headers.authorization) {
            event.headers.Authorization = `Bearer ${event.queryStringParameters.token}`;
        }
        const decoded = await requireAuth(event);

        if (decoded.role === 'viewer' && httpMethod !== 'GET') {
            return error('Viewer role is read-only', 403, undefined, origin);
        }

        const scopedResearch = path.match(/^\/tracking\/([^/]+)/);
        if (scopedResearch && !(await canAccessResearch(scopedResearch[1], decoded.sub))) {
            return researchNotFound(scopedResearch[1], decoded.sub, path, origin);
        }

        // GET /tracking/:researchId/config — get tracking config (authenticated)
        const configGetMatch = path.match(/^\/tracking\/([^/]+)\/config$/);
        if (configGetMatch && httpMethod === 'GET') {
            const researchId = configGetMatch[1];
            const config = await getTrackingConfig(researchId);
            return success(config, 200, undefined, origin);
        }

        // GET /tracking/:researchId/verify — check for recent sessions (for installation verification)
        const verifyMatch = path.match(/^\/tracking\/([^/]+)\/verify$/);
        if (verifyMatch && httpMethod === 'GET') {
            const researchId = verifyMatch[1];
            const sinceSeconds = parseInt(event.queryStringParameters?.since || '120', 10);
            const result = await getRecentSessionCount(researchId, sinceSeconds);
            return success(result, 200, undefined, origin);
        }

        // GET /tracking/:researchId/overview — overview metrics
        const overviewMatch = path.match(/^\/tracking\/([^/]+)\/overview$/);
        if (overviewMatch && httpMethod === 'GET') {
            const researchId = overviewMatch[1];
            const from = event.queryStringParameters?.from;
            const to = event.queryStringParameters?.to;
            const metrics = await getOverviewMetrics(researchId, from, to);
            return success(metrics, 200, undefined, origin);
        }

        // GET /tracking/:researchId/pages — list tracked pages
        const pagesMatch = path.match(/^\/tracking\/([^/]+)\/pages$/);
        if (pagesMatch && httpMethod === 'GET') {
            const researchId = pagesMatch[1];
            const pages = await getTrackedPages(researchId);
            return success({ pages }, 200, undefined, origin);
        }

        // GET /tracking/:researchId/proxy-page?url=URL — proxy page for same-origin iframe rendering
        const proxyPageMatch = path.match(/^\/tracking\/([^/]+)\/proxy-page$/);
        if (proxyPageMatch && httpMethod === 'GET') {
            const pageUrl = event.queryStringParameters?.url
                ? decodeURIComponent(event.queryStringParameters.url)
                : null;
            if (!pageUrl) return error('Missing url parameter', 400, undefined, origin);

            try {
                const response = await fetchPublicUrl(pageUrl);
                const apiBase = process.env.API_BASE_URL || 'https://emotio.cx/api';
                const html = renderInertPage(await response.text(), pageUrl, `${apiBase}/tracking/${proxyPageMatch[1]}/proxy-asset?url=`);
                return inertPageResponse(html, origin);
            } catch (err) {
                if (err instanceof BlockedUrlError) return error(err.message, 400, undefined, origin);
                return error('Failed to fetch page', 502, undefined, origin);
            }
        }

        // GET /tracking/:researchId/proxy-asset?url=URL — proxy fonts/images to avoid CORS
        const proxyAssetMatch = path.match(/^\/tracking\/([^/]+)\/proxy-asset$/);
        if (proxyAssetMatch && httpMethod === 'GET') {
            const assetUrl = event.queryStringParameters?.url
                ? decodeURIComponent(event.queryStringParameters.url)
                : null;
            if (!assetUrl) return error('Missing url parameter', 400, undefined, origin);

            try {
                const asset = await fetchProxiedAsset(assetUrl, `/api/tracking/${proxyAssetMatch[1]}/proxy-asset?url=`);
                return proxiedAssetResponse(asset, origin || '*');
            } catch (err) {
                if (err instanceof BlockedUrlError) return error(err.message, 400, undefined, origin);
                return error('Failed to fetch asset', 502, undefined, origin);
            }
        }

        // GET /tracking/:researchId/heatmap?page=URL — click heatmap data
        const heatmapMatch = path.match(/^\/tracking\/([^/]+)\/heatmap$/);
        if (heatmapMatch && httpMethod === 'GET') {
            const researchId = heatmapMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            const device = event.queryStringParameters?.device as 'mobile' | 'tablet' | 'desktop' | undefined;
            const data = await getClickHeatmapData(researchId, pageUrl, device);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/element-clicks?page=URL — element-based click data for live iframe
        const elementClicksMatch = path.match(/^\/tracking\/([^/]+)\/element-clicks$/);
        if (elementClicksMatch && httpMethod === 'GET') {
            const researchId = elementClicksMatch[1];
            const pageUrl = event.queryStringParameters?.page ? decodeURIComponent(event.queryStringParameters.page) : undefined;
            const device = event.queryStringParameters?.device as 'mobile' | 'tablet' | 'desktop' | undefined;
            const data = await getElementClickData(researchId, pageUrl, device);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/scroll?page=URL — scroll depth data
        const scrollMatch = path.match(/^\/tracking\/([^/]+)\/scroll$/);
        if (scrollMatch && httpMethod === 'GET') {
            const researchId = scrollMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            const data = await getScrollDepthData(researchId, pageUrl);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/sessions/:sessionId/events — session replay data
        const sessionEventsMatch = path.match(/^\/tracking\/([^/]+)\/sessions\/([^/]+)\/events$/);
        if (sessionEventsMatch && httpMethod === 'GET') {
            const data = await getSessionEvents(sessionEventsMatch[1], sessionEventsMatch[2]);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/sessions/:sessionId/rrweb — rrweb recording data for replay
        const rrwebGetMatch = path.match(/^\/tracking\/([^/]+)\/sessions\/([^/]+)\/rrweb$/);
        if (rrwebGetMatch && httpMethod === 'GET') {
            const data = await getRrwebEvents(rrwebGetMatch[1], rrwebGetMatch[2]);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/funnels/:funnelId — custom funnel drop-off
        const funnelDetailMatch = path.match(/^\/tracking\/([^/]+)\/funnels\/([^/]+)$/);
        if (funnelDetailMatch && httpMethod === 'GET') {
            const researchId = funnelDetailMatch[1];
            const funnelId = funnelDetailMatch[2];
            const data = await computeFunnelDropoff(researchId, funnelId);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/funnels — page transition funnels
        const funnelsMatch = path.match(/^\/tracking\/([^/]+)\/funnels$/);
        if (funnelsMatch && httpMethod === 'GET') {
            const researchId = funnelsMatch[1];
            const data = await getPageFunnels(researchId);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/export — CSV export data
        const exportMatch = path.match(/^\/tracking\/([^/]+)\/export$/);
        if (exportMatch && httpMethod === 'GET') {
            const researchId = exportMatch[1];
            const data = await getExportData(researchId);
            return success(data, 200, undefined, origin);
        }

        // PUT /tracking/:researchId/config — update tracking config
        const configUpdateMatch = path.match(/^\/tracking\/([^/]+)\/config$/);
        if (configUpdateMatch && httpMethod === 'PUT') {
            const researchId = configUpdateMatch[1];
            const body = JSON.parse(event.body || '{}');
            if (body.zones !== undefined && !(Array.isArray(body.zones) && body.zones.every(isTrackingZone))) {
                return error('Invalid zones: each zone needs a non-empty id, label, pageUrl and selector', 400, undefined, origin);
            }
            await saveTrackingConfig(researchId, body);
            return success({ updated: true }, 200, undefined, origin);
        }

        // GET /tracking/:researchId/friction — friction event summary
        const frictionMatch = path.match(/^\/tracking\/([^/]+)\/friction$/);
        if (frictionMatch && httpMethod === 'GET') {
            const researchId = frictionMatch[1];
            const data = await getFrictionSummary(researchId);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/friction/sessions — friction tags per session
        const frictionSessionsMatch = path.match(/^\/tracking\/([^/]+)\/friction\/sessions$/);
        if (frictionSessionsMatch && httpMethod === 'GET') {
            const researchId = frictionSessionsMatch[1];
            const data = await getSessionFrictionTags(researchId);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/snapshot?page=URL — get page DOM snapshot HTML (JSON)
        const snapshotGetMatch = path.match(/^\/tracking\/([^/]+)\/snapshot$/);
        if (snapshotGetMatch && httpMethod === 'GET') {
            const researchId = snapshotGetMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            if (!pageUrl) return error('Missing page parameter', 400, undefined, origin);
            const html = await getPageSnapshotHtml(researchId, pageUrl);
            return success({ html }, 200, undefined, origin);
        }

        // GET /tracking/:researchId/snapshot-html?page=URL — serve snapshot as raw HTML (for iframe backdrop)
        const snapshotHtmlMatch = path.match(/^\/tracking\/([^/]+)\/snapshot-html$/);
        if (snapshotHtmlMatch && httpMethod === 'GET') {
            const researchId = snapshotHtmlMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            if (!pageUrl) return error('Missing page parameter', 400, undefined, origin);
            const html = await getPageSnapshotHtml(researchId, pageUrl);
            if (!html) return error('No snapshot available', 404, undefined, origin);

            const apiBase = process.env.API_BASE_URL || 'https://emotio.cx/api';
            return inertPageResponse(renderInertPage(html, pageUrl, `${apiBase}/public/tracking/${snapshotHtmlMatch[1]}/proxy-asset?url=`), origin);
        }

        // GET /tracking/:researchId/attention?page=URL — attention (dwell time) heatmap
        const attentionMatch = path.match(/^\/tracking\/([^/]+)\/attention$/);
        if (attentionMatch && httpMethod === 'GET') {
            const researchId = attentionMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            const device = event.queryStringParameters?.device as 'mobile' | 'tablet' | 'desktop' | undefined;
            const data = await getAttentionHeatmapData(researchId, pageUrl, device);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/visitors — visitor journeys with page breakdown
        const visitorsMatch = path.match(/^\/tracking\/([^/]+)\/visitors$/);
        if (visitorsMatch && httpMethod === 'GET') {
            const researchId = visitorsMatch[1];
            const limit = parseInt(event.queryStringParameters?.limit || '20', 10);
            const offset = parseInt(event.queryStringParameters?.offset || '0', 10);
            const data = await getVisitorJourneys(researchId, limit, offset);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/live — live sessions (active in last 5 min)
        const liveMatch = path.match(/^\/tracking\/([^/]+)\/live$/);
        if (liveMatch && httpMethod === 'GET') {
            const researchId = liveMatch[1];
            const data = await getLiveSessions(researchId);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/emotions — aggregated emotion analytics
        const emotionsAuthMatch = path.match(/^\/tracking\/([^/]+)\/emotions$/);
        if (emotionsAuthMatch && httpMethod === 'GET') {
            const researchId = emotionsAuthMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            const { getTrackingEmotionData } = await import('./tracking-emotion.analytics');
            const data = await getTrackingEmotionData(researchId, pageUrl);
            return success(data, 200, undefined, origin);
        }

        const zonesAuthMatch = path.match(/^\/tracking\/([^/]+)\/zones$/);
        if (zonesAuthMatch && httpMethod === 'GET') {
            const { getTrackingZoneData } = await import('./tracking-zones.analytics');
            const data = await getTrackingZoneData(zonesAuthMatch[1]);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/gaze — aggregated gaze attention analytics
        const gazeAuthMatch = path.match(/^\/tracking\/([^/]+)\/gaze$/);
        if (gazeAuthMatch && httpMethod === 'GET') {
            const researchId = gazeAuthMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            const { getTrackingGazeData } = await import('./tracking-gaze.analytics');
            const data = await getTrackingGazeData(researchId, pageUrl);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/snippet — get embed snippet
        const snippetMatch = path.match(/^\/tracking\/([^/]+)\/snippet$/);
        if (snippetMatch && httpMethod === 'GET') {
            const researchId = snippetMatch[1];
            const apiBaseUrl = process.env.API_BASE_URL || 'https://emotio.cx/api';
            const snippet = generateEmbedSnippet(researchId, apiBaseUrl);
            return success({ snippet }, 200, undefined, origin);
        }

        // POST /tracking/:researchId/report — generate AI report
        const reportPostMatch = path.match(/^\/tracking\/([^/]+)\/report$/);
        if (reportPostMatch && httpMethod === 'POST') {
            const researchId = reportPostMatch[1];
            const body = JSON.parse(event.body || '{}');
            const { generateTrackingReport } = await import('./tracking-report.service');
            const report = await generateTrackingReport(researchId, body.sections);
            return success({ report }, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        const isAuthError = msg.includes('Unauthorized') || msg.includes('token') || msg.includes('jwt') || msg.includes('No token');
        if (isAuthError) {
            return error('Unauthorized', 401, undefined, origin);
        }
        if (/^Session \S+ not found in research \S+$/.test(msg)) {
            return error(msg, 404, undefined, origin);
        }
        console.error('[Tracking] Error:', err);
        return error(msg, 500, undefined, origin);
    }
};
