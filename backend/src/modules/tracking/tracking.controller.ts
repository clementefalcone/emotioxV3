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
    getSessions,
    getSessionEvents,
    getPageFunnels,
    computeFunnelDropoff,
    getExportData,
    savePageScreenshot,
    savePageScreenshotFromBase64,
    saveTrackingConfig,
    getRecentSessionCount,
    getVisitorJourneys,
    getLiveSessions,
    getAttentionHeatmapData,
    getMouseAttentionHeatmapData,
    savePageSnapshot,
    getPageSnapshotHtml,
    getFrictionSummary,
    getSessionFrictionTags,
    appendRrwebEvents,
    getRrwebEvents,
    appendEmotionSamples,
    appendGazeSamples,
    saveEmotionVideo,
    recordCaptureError,
} from './tracking.service';
import { isCaptureErrorKind, CAPTURE_ERROR_KINDS } from './capture-errors';
import { generateTrackingSnippet, generateEmbedSnippet } from './tracking-snippet';

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
                    captureEmotions: config.captureEmotions,
                    emotionVideoEnabled: config.emotionVideoEnabled,
                    emotionModelBaseUrl: apiBaseUrl + '/media/face-api-models',
                    captureGaze: config.captureGaze,
                    gazeCalibrationPoints: config.gazeCalibrationPoints,
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

            const result = await saveEvents(sessionId, events.map((e) => ({
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
            const result = await appendRrwebEvents(sessionId, rrwebEvts);
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

        // POST /public/tracking/:researchId/screenshot — save client-captured screenshot
        const screenshotPublicMatch = path.match(/^\/public\/tracking\/([^/]+)\/screenshot$/);
        if (screenshotPublicMatch && httpMethod === 'POST') {
            const researchId = screenshotPublicMatch[1];
            let body: Record<string, unknown>;
            try { body = JSON.parse(event.body || '{}'); } catch { return trackingError('Invalid JSON'); }
            const pageUrl = body.pageUrl as string;
            const imageData = body.imageData as string;
            const deviceCategory = (['mobile', 'tablet', 'desktop'].includes(body.device as string)
                ? body.device as 'mobile' | 'tablet' | 'desktop'
                : 'desktop');
            if (!pageUrl || !imageData) return trackingError('Missing pageUrl or imageData');
            // Cap base64 at ~5MB
            if (imageData.length > 5242880) return trackingError('Screenshot too large', 413);
            await savePageScreenshotFromBase64(researchId, pageUrl, imageData, deviceCategory);
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
            const result = await appendEmotionSamples(sessionId, samples);
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
            const result = await appendGazeSamples(sessionId, samples);
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

        // POST /public/tracking/:researchId/emotion-video — upload webcam recording
        const emotionVideoMatch = path.match(/^\/public\/tracking\/([^/]+)\/emotion-video$/);
        if (emotionVideoMatch && httpMethod === 'POST') {
            const researchId = emotionVideoMatch[1];
            let body: Record<string, unknown>;
            try { body = JSON.parse(event.body || '{}'); } catch { return trackingError('Invalid JSON'); }
            const sessionId = body.sessionId as string;
            const videoBase64 = body.video as string;
            if (!sessionId || !videoBase64) return trackingError('Missing sessionId or video');
            // Cap at 15MB base64 (~11MB raw)
            if (videoBase64.length > 20_971_520) return trackingError('Video too large (max 15MB)', 413);
            const videoBuffer = Buffer.from(videoBase64, 'base64');
            const result = await saveEmotionVideo(researchId, sessionId, videoBuffer);
            return trackingSuccess(result, 201);
        }

        const publicProxyAssetMatch = path.match(/^\/public\/tracking\/([^/]+)\/proxy-asset$/);
        if (publicProxyAssetMatch && httpMethod === 'GET') {
            const assetUrl = event.queryStringParameters?.url
                ? decodeURIComponent(event.queryStringParameters.url)
                : null;
            if (!assetUrl) return trackingError('Missing url parameter');

            try {
                const response = await fetch(assetUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EmotioCX/1.0)' },
                    redirect: 'follow',
                });
                const contentType = response.headers.get('content-type') || 'application/octet-stream';
                const isText = contentType.includes('text/') || contentType.includes('css') || contentType.includes('javascript') || contentType.includes('json');

                if (isText) {
                    let text = await response.text();

                    if (contentType.includes('css')) {
                        const proxyBase = `/api/public/tracking/${publicProxyAssetMatch[1]}/proxy-asset?url=`;
                        const cssUrlObj = new URL(assetUrl);
                        const cssOrigin = cssUrlObj.origin;
                        const cssDir = assetUrl.substring(0, assetUrl.lastIndexOf('/') + 1);

                        const resolveRef = (ref: string): string => {
                            if (ref.startsWith('data:') || ref.startsWith('#')) return ref;
                            if (ref.startsWith('http')) return ref;
                            if (ref.startsWith('//')) return 'https:' + ref;
                            if (ref.startsWith('/')) return cssOrigin + ref;
                            return cssDir + ref;
                        };

                        text = text.replace(
                            /url\(\s*['"]?(?!['"]?data:)([^'")]+)\s*['"]?\)/gi,
                            (_m: string, ref: string) => {
                                const resolved = resolveRef(ref.trim());
                                if (resolved === ref.trim()) return _m;
                                return `url('${proxyBase}${encodeURIComponent(resolved)}')`;
                            }
                        );

                        text = text.replace(
                            /@import\s+['"](?!data:)([^'"]+)['"]/gi,
                            (_m: string, ref: string) => {
                                const resolved = resolveRef(ref.trim());
                                return `@import url('${proxyBase}${encodeURIComponent(resolved)}')`;
                            }
                        );
                    }

                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': contentType,
                            'Access-Control-Allow-Origin': '*',
                            'Cache-Control': 'public, max-age=86400',
                        },
                        body: text,
                    };
                }

                const arrayBuf = await response.arrayBuffer();
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'public, max-age=86400',
                        'X-Binary': '1',
                    },
                    body: Buffer.from(arrayBuf).toString('base64'),
                    isBase64Encoded: true,
                };
            } catch {
                return trackingError('Failed to fetch asset');
            }
        }

        return trackingError('Route not found', 404);
    } catch (err: unknown) {
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
        await requireAuth(event);

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
                const response = await fetch(pageUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EmotioCX/1.0)' },
                    redirect: 'follow',
                });
                let html = await response.text();

                // Extract origin for <base> tag
                const urlObj = new URL(pageUrl);
                const baseHref = urlObj.origin + '/';

                // Strip all <script> tags
                html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                html = html.replace(/<script\b[^>]*\/>/gi, '');

                // Strip inline event handlers
                html = html.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '');
                html = html.replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');

                // Inject <base> tag so all relative URLs resolve to the original domain
                if (html.includes('<head>')) {
                    html = html.replace('<head>', `<head><base href="${baseHref}">`);
                } else if (html.includes('<HEAD>')) {
                    html = html.replace('<HEAD>', `<HEAD><base href="${baseHref}">`);
                } else {
                    html = `<base href="${baseHref}">` + html;
                }

                // Rewrite font URLs to go through our proxy (avoids CORS on external fonts)
                // MUST be absolute — <base> tag points to the tracked site's origin
                const apiBase = process.env.API_BASE_URL || 'https://emotio.cx/api';
                const assetProxyBase = `${apiBase}/tracking/${proxyPageMatch[1]}/proxy-asset?url=`;
                html = html.replace(
                    /url\(\s*['"]?([^'")]+\.(?:woff2?|ttf|eot|otf)(?:\?[^'")]*)?)\s*['"]?\)/gi,
                    (match, fontUrl: string) => {
                        const resolved = fontUrl.startsWith('http') ? fontUrl
                            : fontUrl.startsWith('//') ? 'https:' + fontUrl
                            : urlObj.origin + (fontUrl.startsWith('/') ? '' : '/') + fontUrl;
                        return `url('${assetProxyBase}${encodeURIComponent(resolved)}')`;
                    }
                );

                // Rewrite <link rel="stylesheet"> href to proxy through our backend (avoids CORS/Referer blocks)
                html = html.replace(
                    /<link\s([^>]*?)href\s*=\s*['"]([^'"]+)['"]([^>]*?)>/gi,
                    (match, before: string, href: string, after: string) => {
                        const combined = before + after;
                        if (!combined.includes('stylesheet') && !combined.includes('text/css')) return match;
                        const resolved = href.startsWith('http') ? href
                            : href.startsWith('//') ? 'https:' + href
                            : urlObj.origin + (href.startsWith('/') ? '' : '/') + href;
                        return `<link ${before}href="${assetProxyBase}${encodeURIComponent(resolved)}"${after}>`;
                    }
                );

                // Fix media="none" links whose onload was stripped (e.g. Google Fonts lazy-load pattern)
                html = html.replace(/media\s*=\s*["']none["']/gi, 'media="all"');

                // Inject styles to disable interactions
                const disableStyle = `<style>
                    * { pointer-events: none !important; user-select: none !important; }
                    body { overflow: visible !important; }
                </style>`;
                html = html.replace('</head>', disableStyle + '</head>');

                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Access-Control-Allow-Origin': origin || '*',
                        'Cache-Control': 'no-cache',
                    },
                    body: html,
                };
            } catch (e) {
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
                const response = await fetch(assetUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EmotioCX/1.0)' },
                    redirect: 'follow',
                });
                const contentType = response.headers.get('content-type') || 'application/octet-stream';
                const isText = contentType.includes('text/') || contentType.includes('css') || contentType.includes('javascript') || contentType.includes('json');

                if (isText) {
                    let text = await response.text();

                    // CSS: rewrite url() and @import so nested references also proxy through us
                    if (contentType.includes('css')) {
                        const proxyBase = `/api/tracking/${proxyAssetMatch[1]}/proxy-asset?url=`;
                        const cssUrlObj = new URL(assetUrl);
                        const cssOrigin = cssUrlObj.origin;
                        const cssDir = assetUrl.substring(0, assetUrl.lastIndexOf('/') + 1);

                        const resolveRef = (ref: string): string => {
                            if (ref.startsWith('data:') || ref.startsWith('#')) return ref;
                            if (ref.startsWith('http')) return ref;
                            if (ref.startsWith('//')) return 'https:' + ref;
                            if (ref.startsWith('/')) return cssOrigin + ref;
                            return cssDir + ref;
                        };

                        // Rewrite url() — skip data: URIs
                        text = text.replace(
                            /url\(\s*['"]?(?!['"]?data:)([^'")]+)\s*['"]?\)/gi,
                            (_m: string, ref: string) => {
                                const resolved = resolveRef(ref.trim());
                                if (resolved === ref.trim()) return _m;
                                return `url('${proxyBase}${encodeURIComponent(resolved)}')`;
                            }
                        );

                        // Rewrite @import "..." (non-url form)
                        text = text.replace(
                            /@import\s+['"](?!data:)([^'"]+)['"]/gi,
                            (_m: string, ref: string) => {
                                const resolved = resolveRef(ref.trim());
                                return `@import url('${proxyBase}${encodeURIComponent(resolved)}')`;
                            }
                        );
                    }

                    return {
                        statusCode: 200,
                        headers: {
                            'Content-Type': contentType,
                            'Access-Control-Allow-Origin': origin || '*',
                            'Cache-Control': 'public, max-age=86400',
                        },
                        body: text,
                    };
                }

                // Binary assets (fonts, images) — return base64 for Lambda compat
                const arrayBuf = await response.arrayBuffer();
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': origin || '*',
                        'Cache-Control': 'public, max-age=86400',
                        'X-Binary': '1',
                    },
                    body: Buffer.from(arrayBuf).toString('base64'),
                    isBase64Encoded: true,
                };
            } catch {
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

        // GET /tracking/:researchId/sessions — list sessions
        const sessionsMatch = path.match(/^\/tracking\/([^/]+)\/sessions$/);
        if (sessionsMatch && httpMethod === 'GET') {
            const researchId = sessionsMatch[1];
            const limit = parseInt(event.queryStringParameters?.limit || '50', 10);
            const offset = parseInt(event.queryStringParameters?.offset || '0', 10);
            const sessions = await getSessions(researchId, limit, offset);
            return success({ sessions }, 200, undefined, origin);
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
            const sessionId = sessionEventsMatch[2];
            const data = await getSessionEvents(sessionId);
            return success(data, 200, undefined, origin);
        }

        // GET /tracking/:researchId/sessions/:sessionId/rrweb — rrweb recording data for replay
        const rrwebGetMatch = path.match(/^\/tracking\/([^/]+)\/sessions\/([^/]+)\/rrweb$/);
        if (rrwebGetMatch && httpMethod === 'GET') {
            const sessionId = rrwebGetMatch[2];
            const data = await getRrwebEvents(sessionId);
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

            // Inject base tag, proxy CSS/fonts, disable interactions
            const urlObj = new URL(pageUrl);
            const baseHref = urlObj.origin + '/';
            // MUST be absolute — <base> tag points to the tracked site's origin
            const apiBase = process.env.API_BASE_URL || 'https://emotio.cx/api';
            const assetProxyBase = `${apiBase}/public/tracking/${snapshotHtmlMatch[1]}/proxy-asset?url=`;
            let result = html;

            // Proxy CSS stylesheets to avoid CORS/Referer blocks
            result = result.replace(
                /<link\s([^>]*?)href\s*=\s*['"]([^'"]+)['"]([^>]*?)>/gi,
                (match: string, before: string, href: string, after: string) => {
                    const combined = before + after;
                    if (!combined.includes('stylesheet') && !combined.includes('text/css')) return match;
                    const resolved = href.startsWith('http') ? href
                        : href.startsWith('//') ? 'https:' + href
                        : urlObj.origin + (href.startsWith('/') ? '' : '/') + href;
                    return `<link ${before}href="${assetProxyBase}${encodeURIComponent(resolved)}"${after}>`;
                }
            );

            // Proxy font URLs
            result = result.replace(
                /url\(\s*['"]?([^'")]+\.(?:woff2?|ttf|eot|otf)(?:\?[^'")]*)?)\s*['"]?\)/gi,
                (_match: string, fontUrl: string) => {
                    const resolved = fontUrl.startsWith('http') ? fontUrl
                        : fontUrl.startsWith('//') ? 'https:' + fontUrl
                        : urlObj.origin + (fontUrl.startsWith('/') ? '' : '/') + fontUrl;
                    return `url('${assetProxyBase}${encodeURIComponent(resolved)}')`;
                }
            );

            // Fix media="none" links whose onload was stripped (e.g. Google Fonts lazy-load pattern)
            result = result.replace(/media\s*=\s*["']none["']/gi, 'media="all"');

            result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
            result = result.replace(/<script\b[^>]*\/>/gi, '');

            const disableStyle = `<style>* { pointer-events: none !important; user-select: none !important; } body { overflow: visible !important; }</style>`;
            if (result.includes('<head>')) {
                result = result.replace('<head>', `<head><base href="${baseHref}">${disableStyle}`);
            } else if (result.includes('<HEAD>')) {
                result = result.replace('<HEAD>', `<HEAD><base href="${baseHref}">${disableStyle}`);
            } else {
                result = `<base href="${baseHref}">${disableStyle}` + result;
            }

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Access-Control-Allow-Origin': origin || '*',
                    'Cache-Control': 'no-cache',
                },
                body: result,
            };
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

        // GET /tracking/:researchId/mouse-attention?page=URL — cursor heatmap weighted by gaze score
        const mouseAttentionMatch = path.match(/^\/tracking\/([^/]+)\/mouse-attention$/);
        if (mouseAttentionMatch && httpMethod === 'GET') {
            const researchId = mouseAttentionMatch[1];
            const pageUrl = event.queryStringParameters?.page
                ? decodeURIComponent(event.queryStringParameters.page)
                : undefined;
            const device = event.queryStringParameters?.device as 'mobile' | 'tablet' | 'desktop' | undefined;
            const data = await getMouseAttentionHeatmapData(researchId, pageUrl, device);
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

        // GET /tracking/:researchId/sessions/:sessionId/emotion-video — stream webcam recording
        const emotionVideoAuthMatch = path.match(/^\/tracking\/([^/]+)\/sessions\/([^/]+)\/emotion-video$/);
        if (emotionVideoAuthMatch && httpMethod === 'GET') {
            const sessionId = emotionVideoAuthMatch[2];
            const dbPool = (await import('../../config/database')).default;
            const session = await dbPool.query(
                'SELECT emotion_video_path FROM tracking_sessions WHERE id = ?',
                [sessionId]
            );
            const videoPath = session.rows[0]?.emotion_video_path;
            if (!videoPath) return error('No emotion video found', 404, undefined, origin);
            const { getMediaPath } = await import('../../config/local-storage');
            const fs = await import('fs');
            const fullPath = getMediaPath(videoPath);
            if (!fs.existsSync(fullPath)) return error('Video file missing', 404, undefined, origin);
            const videoBuffer = fs.readFileSync(fullPath);
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'video/webm',
                    'Content-Length': String(videoBuffer.length),
                    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
                },
                body: videoBuffer.toString('base64'),
                isBase64Encoded: true,
            };
        }

        // GET /tracking/:researchId/snippet — get embed snippet
        const snippetMatch = path.match(/^\/tracking\/([^/]+)\/snippet$/);
        if (snippetMatch && httpMethod === 'GET') {
            const researchId = snippetMatch[1];
            const apiBaseUrl = process.env.API_BASE_URL || 'https://emotio.cx/api';
            const snippet = generateEmbedSnippet(researchId, apiBaseUrl);
            return success({ snippet }, 200, undefined, origin);
        }

        // POST /tracking/:researchId/pages/screenshot — save screenshot s3key for a page
        const screenshotMatch = path.match(/^\/tracking\/([^/]+)\/pages\/screenshot$/);
        if (screenshotMatch && httpMethod === 'POST') {
            const researchId = screenshotMatch[1];
            const body = JSON.parse(event.body || '{}');
            if (!body.pageUrl || !body.screenshotS3Key) {
                return error('Missing pageUrl or screenshotS3Key', 400, undefined, origin);
            }
            await savePageScreenshot(researchId, body.pageUrl, body.screenshotS3Key);
            return success({ updated: true }, 200, undefined, origin);
        }

        // GET /tracking/:researchId/report — get cached AI report
        const reportGetMatch = path.match(/^\/tracking\/([^/]+)\/report$/);
        if (reportGetMatch && httpMethod === 'GET') {
            const researchId = reportGetMatch[1];
            const { getTrackingReport } = await import('./tracking-report.service');
            const report = await getTrackingReport(researchId);
            return success({ report }, 200, undefined, origin);
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
        console.error('[Tracking] Error:', err);
        return error(msg, 500, undefined, origin);
    }
};
