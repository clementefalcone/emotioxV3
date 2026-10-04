/**
 * Website Tracking Service
 * API client for tracking configuration and analytics endpoints.
 */

import apiClient from './api/client';

// ─── Types ───────────────────────────────────────────────────────────

export interface FunnelStep {
    url: string;
    label: string;
}

export interface FunnelDefinition {
    id: string;
    name: string;
    steps: FunnelStep[];
}

export interface TrackingConfig {
    captureClicks: boolean;
    captureScroll: boolean;
    captureMousemove: boolean;
    consentRequired: boolean;
    flushIntervalMs: number;
    maxEventsPerFlush: number;
    allowedDomains: string[];
    consentText: string;
    consentAcceptLabel: string;
    consentDeclineLabel: string;
    consentPosition: 'bottom' | 'top';
    samplingRate: number;
    excludedIPs: string[];
    targetPages: string[];
    excludePages: string[];
    dataRetentionDays: number;
    funnels?: FunnelDefinition[];
    verified?: boolean;
    captureEmotions: boolean;
    emotionVideoEnabled: boolean;
    captureGaze: boolean;
    gazeCalibrationPoints: 5 | 9;
}

export interface FunnelDropoffResult {
    funnel: { id: string; name: string };
    steps: Array<{
        url: string;
        label: string;
        visitors: number;
        percentage: number;
        dropoff: number;
    }>;
    totalVisitors: number;
    conversionRate: number;
}

export interface TrackingOverview {
    totalSessions: number;
    uniqueVisitors: number;
    pagesTracked: number;
    totalEvents: number;
    avgSessionDuration: number;
}

export interface TrackedPage {
    id: string;
    pageUrl: string;
    pageTitle: string | null;
    screenshotS3Key: string | null;
    screenshotDevices: Record<string, string> | null;
    hasSnapshot?: boolean;
    viewportWidth: number | null;
    viewportHeight: number | null;
    sessionCount: number;
    eventCount: number;
    lastVisitedAt: string | null;
}

export interface ClickHeatmapData {
    clicks: Array<{ x: number; y: number; count: number }>;
    totalClicks: number;
    sessions: number;
}

export interface TrackingSession {
    id: string;
    visitorId: string;
    pageUrl: string;
    pageTitle: string | null;
    viewportWidth: number;
    viewportHeight: number;
    userAgent: string | null;
    referrer: string | null;
    startedAt: string;
    endedAt: string | null;
    eventCount: number;
    hasRrweb?: boolean;
}

// ─── API Calls ───────────────────────────────────────────────────────

export const getOverview = async (researchId: string, from?: string, to?: string): Promise<TrackingOverview> => {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    return apiClient.get<TrackingOverview>(`/tracking/${researchId}/overview`, { params });
};

export const getTrackedPages = async (researchId: string): Promise<TrackedPage[]> => {
    const response = await apiClient.get<{ pages: TrackedPage[] }>(`/tracking/${researchId}/pages`);
    return response.pages;
};

export const getClickHeatmap = async (
    researchId: string,
    pageUrl?: string,
    device?: 'mobile' | 'tablet' | 'desktop'
): Promise<ClickHeatmapData> => {
    const params: Record<string, string> = {};
    if (pageUrl) params.page = pageUrl;
    if (device) params.device = device;
    return apiClient.get<ClickHeatmapData>(`/tracking/${researchId}/heatmap`, { params });
};

export interface ElementClick {
    selector: string;
    offsetX: number;
    offsetY: number;
    elementWidth: number;
    elementHeight: number;
    x: number;
    y: number;
    count: number;
}

export const getElementClicks = async (
    researchId: string,
    pageUrl?: string,
    device?: 'mobile' | 'tablet' | 'desktop'
): Promise<{ clicks: ElementClick[] }> => {
    const params: Record<string, string> = {};
    if (pageUrl) params.page = pageUrl;
    if (device) params.device = device;
    return apiClient.get<{ clicks: ElementClick[] }>(`/tracking/${researchId}/element-clicks`, { params });
};

export const getSessions = async (
    researchId: string,
    limit = 50,
    offset = 0
): Promise<TrackingSession[]> => {
    const response = await apiClient.get<{ sessions: TrackingSession[] }>(`/tracking/${researchId}/sessions`, {
        params: { limit, offset },
    });
    return response.sessions;
};

export const verifyInstallation = async (
    researchId: string,
    sinceSeconds = 120
): Promise<{ count: number; hasData: boolean }> => {
    return apiClient.get<{ count: number; hasData: boolean }>(`/tracking/${researchId}/verify`, {
        params: { since: sinceSeconds },
    });
};

export const getEmbedSnippet = async (researchId: string): Promise<string> => {
    const response = await apiClient.get<{ snippet: string }>(`/tracking/${researchId}/snippet`);
    return response.snippet;
};

export const getTrackingConfig = async (researchId: string): Promise<TrackingConfig> => {
    return apiClient.get<TrackingConfig>(`/tracking/${researchId}/config`);
};

export const updateConfig = async (
    researchId: string,
    config: Partial<TrackingConfig>
): Promise<void> => {
    await apiClient.put(`/tracking/${researchId}/config`, config);
};

export const savePageScreenshot = async (
    researchId: string,
    pageUrl: string,
    screenshotS3Key: string
): Promise<void> => {
    await apiClient.post(`/tracking/${researchId}/pages/screenshot`, {
        pageUrl,
        screenshotS3Key,
    });
};

// ─── Scroll Depth ────────────────────────────────────────────────────

export interface ScrollDepthData {
    depths: Array<{ depthPct: number; sessions: number; percentage: number }>;
    totalSessions: number;
}

export const getScrollDepth = async (researchId: string, pageUrl?: string): Promise<ScrollDepthData> => {
    const params = pageUrl ? { page: pageUrl } : {};
    return apiClient.get<ScrollDepthData>(`/tracking/${researchId}/scroll`, { params });
};

// ─── Session Replay ──────────────────────────────────────────────────

export interface SessionReplayEvent {
    eventType: string;
    x: number | null;
    y: number | null;
    scrollY: number | null;
    scrollDepthPct: number | null;
    targetSelector: string | null;
    targetText: string | null;
    timestampMs: number;
    metadata: Record<string, unknown> | null;
}

export interface SessionReplayData {
    session: {
        id: string;
        visitorId: string;
        pageUrl: string;
        pageTitle: string | null;
        viewportWidth: number;
        viewportHeight: number;
        screenshotS3Key: string | null;
        startedAt: string;
        endedAt: string | null;
    };
    events: SessionReplayEvent[];
}

export const getSessionReplay = async (researchId: string, sessionId: string): Promise<SessionReplayData> => {
    return apiClient.get<SessionReplayData>(`/tracking/${researchId}/sessions/${sessionId}/events`);
};

// ─── rrweb Session Replay ───────────────────────────────────────────

export interface RrwebReplayData {
    session: {
        id: string;
        visitorId: string;
        pageUrl: string;
        pageTitle: string | null;
        viewportWidth: number;
        viewportHeight: number;
        startedAt: string;
        endedAt: string | null;
    };
    events: unknown[];
}

export const getRrwebReplay = async (researchId: string, sessionId: string): Promise<RrwebReplayData> => {
    return apiClient.get<RrwebReplayData>(`/tracking/${researchId}/sessions/${sessionId}/rrweb`);
};

// ─── Funnels ─────────────────────────────────────────────────────────

export interface FunnelData {
    totalVisitors: number;
    topPages: Array<{ pageUrl: string; visitors: number; exits?: number }>;
    transitions: Array<{ from: string; to: string; count: number }>;
}

export const getFunnels = async (researchId: string): Promise<FunnelData> => {
    return apiClient.get<FunnelData>(`/tracking/${researchId}/funnels`);
};

export const getFunnelDropoff = async (researchId: string, funnelId: string): Promise<FunnelDropoffResult> => {
    return apiClient.get<FunnelDropoffResult>(`/tracking/${researchId}/funnels/${funnelId}`);
};

// ─── Export ──────────────────────────────────────────────────────────

export interface ExportData {
    sessions: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
}

export const getExportData = async (researchId: string): Promise<ExportData> => {
    return apiClient.get<ExportData>(`/tracking/${researchId}/export`);
};

// ─── Friction ───────────────────────────────────────────────────────

export interface FrictionElement {
    selector: string;
    text: string;
    count: number;
}

export interface FrictionSummary {
    tags: Record<string, number>;
    topElements?: Record<string, FrictionElement[]>;
}

export const getFrictionSummary = async (researchId: string): Promise<FrictionSummary> => {
    return apiClient.get<FrictionSummary>(`/tracking/${researchId}/friction`);
};

export interface FrictionSession {
    sessionId: string;
    visitorId: string;
    tags: string[];
    count: number;
}

export interface FrictionSessionsData {
    sessionTags: Record<string, string[]>;
    sessions?: FrictionSession[];
}

export const getSessionFrictionTags = async (researchId: string): Promise<FrictionSessionsData> => {
    return apiClient.get<FrictionSessionsData>(`/tracking/${researchId}/friction/sessions`);
};

// ─── Page Snapshot ──────────────────────────────────────────────────

export const getPageSnapshot = async (researchId: string, pageUrl: string): Promise<string | null> => {
    const response = await apiClient.get<{ html: string | null }>(`/tracking/${researchId}/snapshot`, {
        params: { page: pageUrl },
    });
    return response.html;
};

// ─── Attention Heatmap ──────────────────────────────────────────────

export interface AttentionHeatmapData {
    points: Array<{ x: number; y: number; dwell: number }>;
    totalSessions: number;
    maxDwell: number;
}

export const getAttentionHeatmap = async (
    researchId: string,
    pageUrl?: string,
    device?: 'mobile' | 'tablet' | 'desktop'
): Promise<AttentionHeatmapData> => {
    const params: Record<string, string> = {};
    if (pageUrl) params.page = pageUrl;
    if (device) params.device = device;
    return apiClient.get<AttentionHeatmapData>(`/tracking/${researchId}/attention`, { params });
};

// ─── Visitor Journeys ───────────────────────────────────────────────

export type CaptureErrorKind = 'camera-denied' | 'camera-unavailable' | 'mediapipe-failed' | 'face-models-failed';

export interface VisitorPage {
    index: number;
    sessionId: string;
    pageUrl: string;
    pageTitle: string | null;
    startedAt: string;
    durationMs: number;
    eventCount: number;
    clickCount: number;
    hasRrweb?: boolean;
    captureErrors: CaptureErrorKind[];
}

export interface VisitorJourney {
    visitorId: string;
    sessionCount: number;
    entryPage: string;
    firstSeen: string;
    lastSeen: string;
    viewportWidth: number;
    userAgent: string | null;
    totalDurationMs: number;
    pages: VisitorPage[];
}

export interface VisitorJourneysResponse {
    visitors: VisitorJourney[];
    totalVisitors: number;
}

export const getVisitorJourneys = async (
    researchId: string,
    limit = 20,
    offset = 0
): Promise<VisitorJourneysResponse> => {
    return apiClient.get<VisitorJourneysResponse>(`/tracking/${researchId}/visitors`, {
        params: { limit, offset },
    });
};

// ─── Live Sessions ──────────────────────────────────────────────────

export interface LiveVisitor {
    visitorId: string;
    pages: Array<{
        sessionId: string;
        pageUrl: string;
        pageTitle: string | null;
        startedAt: string;
        eventCount: number;
    }>;
    viewportWidth: number;
    userAgent: string | null;
    firstSeen: string;
    lastEventMs: number;
}

export interface LiveSessionsResponse {
    sessions: LiveVisitor[];
}

export const getLiveSessions = async (researchId: string): Promise<LiveSessionsResponse> => {
    return apiClient.get<LiveSessionsResponse>(`/tracking/${researchId}/live`);
};

// ─── AI Report ─────────────────────────────────────────────────────

export interface TrackingReport {
    generatedAt: string;
    overview: string;
    keyFindings: string[];
    recommendations: string[];
    usabilityScore: number;
    engagementAnalysis: string;
    frictionAnalysis: string;
    scrollBehavior: string;
    funnelAnalysis: string;
    topIssues: Array<{ issue: string; severity: 'high' | 'medium' | 'low'; suggestion: string }>;
    analyzedSections: string[];
}

export const getTrackingReport = async (researchId: string): Promise<TrackingReport | null> => {
    const res = await apiClient.get<{ report: TrackingReport | null }>(`/tracking/${researchId}/report`);
    return res.report;
};

export const generateTrackingReport = async (researchId: string, sections?: Record<string, boolean> | object): Promise<TrackingReport> => {
    const res = await apiClient.post<{ report: TrackingReport }>(`/tracking/${researchId}/report`, { sections });
    return res.report;
};

// ─── Emotion Analytics ──────────────────────────────────────────────

type EkmanEmotion = 'joy' | 'sadness' | 'surprise' | 'anger' | 'disgust' | 'fear' | 'neutral';

export interface TrackingEmotionData {
    totalSessions: number;
    totalSamples: number;
    distribution: Record<EkmanEmotion, number>;
    dominantEmotion: EkmanEmotion;
    avgConfidence: number;
    timeline: Array<{ timestampS: number; emotion: EkmanEmotion; confidence: number }>;
    perSession: Array<{
        sessionId: string;
        visitorId: string;
        pageUrl: string;
        dominantEmotion: EkmanEmotion;
        sampleCount: number;
        hasVideo: boolean;
    }>;
    valenceArousal: Array<{ timestampS: number; valence: number; arousal: number }>;
}

export const getTrackingEmotions = async (
    researchId: string,
    pageUrl?: string
): Promise<TrackingEmotionData> => {
    const params: Record<string, string> = {};
    if (pageUrl) params.page = pageUrl;
    return apiClient.get<TrackingEmotionData>(`/tracking/${researchId}/emotions`, { params });
};

// ─── Gaze Attention Analytics ────────────────────────────────────────

type GazeQuadrant =
    | 'top-left' | 'top-center' | 'top-right'
    | 'center-left' | 'center' | 'center-right'
    | 'bottom-left' | 'bottom-center' | 'bottom-right';

type AttentionState = 'engaged' | 'distracted' | 'away';

export interface TrackingGazeData {
    totalSessions: number;
    totalSamples: number;
    quadrantDistribution: Record<GazeQuadrant, number>;
    dominantQuadrant: GazeQuadrant;
    attentionDistribution: Record<AttentionState, number>;
    avgAttentionScore: number;
    timeline: Array<{ timestampS: number; quadrant: GazeQuadrant; attention: AttentionState; score: number }>;
    perSession: Array<{
        sessionId: string; visitorId: string; pageUrl: string;
        dominantQuadrant: GazeQuadrant; avgScore: number; sampleCount: number;
    }>;
    dataSource: {
        cursor: number;
        calibratedGaze: number;
        qualityBreakdown: { good: number; fair: number; low: number };
    };
    fixations: Array<{ x: number; y: number; duration: number; timestamp: number }>;
}

export const getTrackingGaze = async (
    researchId: string,
    pageUrl?: string
): Promise<TrackingGazeData> => {
    const params: Record<string, string> = {};
    if (pageUrl) params.page = pageUrl;
    return apiClient.get<TrackingGazeData>(`/tracking/${researchId}/gaze`, { params });
};

// ─── Mouse-Attention Heatmap ────────────────────────────────────────

export interface MouseAttentionHeatmapData {
    points: Array<{ x: number; y: number; weight: number }>;
    totalSamples: number;
    sessions: number;
}

export const getMouseAttentionHeatmap = async (
    researchId: string,
    pageUrl?: string,
    device?: 'mobile' | 'tablet' | 'desktop'
): Promise<MouseAttentionHeatmapData> => {
    const params: Record<string, string> = {};
    if (pageUrl) params.page = pageUrl;
    if (device) params.device = device;
    return apiClient.get<MouseAttentionHeatmapData>(`/tracking/${researchId}/mouse-attention`, { params });
};

// ─── Emotion Video ──────────────────────────────────────────────────

export const getEmotionVideoUrl = (researchId: string, sessionId: string): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = (window as any).__RUNTIME_CONFIG__ as { apiBaseUrl?: string } | undefined;
    const baseUrl = cfg?.apiBaseUrl || '';
    return `${baseUrl}/tracking/${researchId}/sessions/${sessionId}/emotion-video`;
};
