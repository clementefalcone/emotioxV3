/**
 * Tracking Gaze Analytics
 * Aggregates iris-based attention data from Website Tracking sessions.
 */

import pool from '../../config/database';

type GazeQuadrant =
    | 'top-left' | 'top-center' | 'top-right'
    | 'center-left' | 'center' | 'center-right'
    | 'bottom-left' | 'bottom-center' | 'bottom-right';

type AttentionState = 'engaged' | 'distracted' | 'away';

const ALL_QUADRANTS: GazeQuadrant[] = [
    'top-left', 'top-center', 'top-right',
    'center-left', 'center', 'center-right',
    'bottom-left', 'bottom-center', 'bottom-right',
];

const ALL_ATTENTION: AttentionState[] = ['engaged', 'distracted', 'away'];

interface GazeSample {
    timestamp: number;
    quadrant: GazeQuadrant;
    quadrantProbs?: Partial<Record<GazeQuadrant, number>>;
    attention: AttentionState;
    score: number;
    cursorX: number;
    cursorY: number;
    pageX?: number;
    pageY?: number;
    gazeQuality?: 'good' | 'fair' | 'low';
    gazeRmse?: number;
}

export interface TrackingGazeData {
    totalSessions: number;
    totalSamples: number;
    /** % of samples in each quadrant (3×3 grid) */
    quadrantDistribution: Record<GazeQuadrant, number>;
    /** Most looked-at quadrant */
    dominantQuadrant: GazeQuadrant;
    /** % of time in each attention state */
    attentionDistribution: Record<AttentionState, number>;
    /** Average attention score 0-1 */
    avgAttentionScore: number;
    /** 1-second bucketed timeline */
    timeline: Array<{
        timestampS: number;
        quadrant: GazeQuadrant;
        attention: AttentionState;
        score: number;
    }>;
    /** Per-session summary */
    perSession: Array<{
        sessionId: string;
        visitorId: string;
        pageUrl: string;
        dominantQuadrant: GazeQuadrant;
        avgScore: number;
        sampleCount: number;
    }>;
    dataSource: {
        cursor: number;
        calibratedGaze: number;
        qualityBreakdown: { good: number; fair: number; low: number };
        lowQualitySessions: number;
        excludedLowQualitySessions: number;
    };
    fixations: Array<{ x: number; y: number; duration: number; timestamp: number }>;
}

interface GazeFixation {
    type: 'fixation';
    x: number;
    y: number;
    duration: number;
    timestamp: number;
}

function isFixationEvent(raw: unknown): raw is GazeFixation {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as Record<string, unknown>;
    return s.type === 'fixation' && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.duration);
}

export const hasLowQualityGaze = (samples: unknown[]): boolean => {
    const qualities = samples
        .map((sample) => (sample && typeof sample === 'object' ? (sample as Record<string, unknown>).gazeQuality : undefined))
        .filter((quality): quality is string => typeof quality === 'string');
    return qualities.length > 0 && qualities[qualities.length - 1] === 'low';
};

export const dropLowQuality = <T extends { isLowQuality: boolean }>(sessions: T[]): T[] => {
    const usable = sessions.filter((session) => !session.isLowQuality);
    return usable.length > 0 ? usable : sessions;
};

function isValidGazeSample(raw: unknown): raw is GazeSample {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as Record<string, unknown>;
    return (
        s.type !== 'fixation' &&
        Number.isFinite(s.timestamp) &&
        typeof s.quadrant === 'string' &&
        (ALL_ATTENTION as string[]).includes(s.attention as string) &&
        Number.isFinite(s.score)
    );
}

export async function getTrackingGazeData(
    researchId: string,
    pageUrl?: string
): Promise<TrackingGazeData> {
    let query = `SELECT id, visitor_id, page_url, gaze_samples
                 FROM tracking_sessions
                 WHERE research_id = ? AND gaze_samples IS NOT NULL`;
    const params: unknown[] = [researchId];

    if (pageUrl) {
        query += ' AND page_url = ?';
        params.push(pageUrl);
    }

    const result = await pool.query(query, params);
    const sessions = result.rows as Array<{
        id: string;
        visitor_id: string;
        page_url: string;
        gaze_samples: string | unknown[];
    }>;

    const quadrantCounts = Object.fromEntries(
        ALL_QUADRANTS.map(q => [q, 0])
    ) as Record<GazeQuadrant, number>;
    const attentionCounts = Object.fromEntries(
        ALL_ATTENTION.map(a => [a, 0])
    ) as Record<AttentionState, number>;

    let totalSamples = 0;
    let totalScore = 0;
    let cursorSamples = 0;
    let gazeSamples = 0;
    const qualityCounts = { good: 0, fair: 0, low: 0 };
    const allSamples: GazeSample[] = [];
    const allFixations: GazeFixation[] = [];
    const perSession: TrackingGazeData['perSession'] = [];

    const parsedSessions = sessions.map((session) => {
        let raw: unknown[] = [];
        try {
            const parsed = typeof session.gaze_samples === 'string' ? JSON.parse(session.gaze_samples) : session.gaze_samples;
            raw = Array.isArray(parsed) ? parsed : [];
        } catch { raw = []; }
        return { session, samples: raw.filter(isValidGazeSample), fixations: raw.filter(isFixationEvent), isLowQuality: hasLowQualityGaze(raw) };
    }).filter(({ samples }) => samples.length > 0);
    const positionSessions = new Set(dropLowQuality(parsedSessions));
    let positionSamples = 0;

    for (const parsedSession of parsedSessions) {
        const { session, samples } = parsedSession;
        const isPositionSession = positionSessions.has(parsedSession);
        if (isPositionSession) {
            allFixations.push(...parsedSession.fixations);
            positionSamples += samples.length;
        }

        const sessionQuadrants: Record<string, number> = {};
        let sessionScore = 0;
        for (const s of samples) {
            if (s.quadrantProbs && typeof s.quadrantProbs === 'object') {
                for (const q of ALL_QUADRANTS) {
                    const p = s.quadrantProbs[q] || 0;
                    if (isPositionSession) quadrantCounts[q] += p;
                    sessionQuadrants[q] = (sessionQuadrants[q] || 0) + p;
                }
            } else if ((ALL_QUADRANTS as string[]).includes(s.quadrant)) {
                if (isPositionSession) quadrantCounts[s.quadrant as GazeQuadrant]++;
                sessionQuadrants[s.quadrant] = (sessionQuadrants[s.quadrant] || 0) + 1;
            }
            attentionCounts[s.attention]++;
            totalScore += s.score;
            sessionScore += s.score;
            if (s.gazeQuality && s.gazeQuality in qualityCounts) {
                gazeSamples++;
                qualityCounts[s.gazeQuality as keyof typeof qualityCounts]++;
            } else {
                cursorSamples++;
            }
        }
        totalSamples += samples.length;
        allSamples.push(...samples);

        const dominant = Object.entries(sessionQuadrants)
            .sort((a, b) => b[1] - a[1])[0]?.[0] as GazeQuadrant || 'center';

        perSession.push({
            sessionId: session.id,
            visitorId: session.visitor_id,
            pageUrl: session.page_url,
            dominantQuadrant: dominant,
            avgScore: Math.round((sessionScore / samples.length) * 100) / 100,
            sampleCount: samples.length,
        });
    }

    const quadrantDistribution = Object.fromEntries(
        ALL_QUADRANTS.map(q => [q, positionSamples > 0 ? Math.round(quadrantCounts[q] / positionSamples * 1000) / 10 : 0])
    ) as Record<GazeQuadrant, number>;

    const attentionDistribution = Object.fromEntries(
        ALL_ATTENTION.map(a => [a, totalSamples > 0 ? Math.round(attentionCounts[a] / totalSamples * 1000) / 10 : 0])
    ) as Record<AttentionState, number>;

    const dominantQuadrant: GazeQuadrant = positionSamples === 0
        ? 'center'
        : (Object.entries(quadrantCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as GazeQuadrant) || 'center';

    // Timeline: 1-second buckets
    const timeline: TrackingGazeData['timeline'] = [];
    if (allSamples.length > 0) {
        allSamples.sort((a, b) => a.timestamp - b.timestamp);
        const bucketMs = 1000;
        let bucketStart = allSamples[0].timestamp;
        let bucket: GazeSample[] = [];

        for (const s of allSamples) {
            if (s.timestamp - bucketStart >= bucketMs && bucket.length > 0) {
                timeline.push(summarizeBucket(bucket, bucketStart));
                bucket = [];
                bucketStart = s.timestamp;
            }
            bucket.push(s);
        }
        if (bucket.length > 0) {
            timeline.push(summarizeBucket(bucket, bucketStart));
        }
    }

    return {
        totalSessions: perSession.length,
        totalSamples,
        quadrantDistribution,
        dominantQuadrant,
        attentionDistribution,
        avgAttentionScore: totalSamples > 0 ? Math.round(totalScore / totalSamples * 100) / 100 : 0,
        timeline,
        perSession,
        dataSource: {
            cursor: cursorSamples,
            calibratedGaze: gazeSamples,
            qualityBreakdown: qualityCounts,
            lowQualitySessions: parsedSessions.filter(({ isLowQuality }) => isLowQuality).length,
            excludedLowQualitySessions: parsedSessions.length - positionSessions.size,
        },
        fixations: allFixations.map(f => ({ x: f.x, y: f.y, duration: f.duration, timestamp: f.timestamp })),
    };
}

function summarizeBucket(bucket: GazeSample[], bucketStart: number) {
    const qCounts: Record<string, number> = {};
    let scoreSum = 0;
    const aCounts: Record<string, number> = {};
    for (const s of bucket) {
        qCounts[s.quadrant] = (qCounts[s.quadrant] || 0) + 1;
        aCounts[s.attention] = (aCounts[s.attention] || 0) + 1;
        scoreSum += s.score;
    }
    const quadrant = Object.entries(qCounts).sort((a, b) => b[1] - a[1])[0][0] as GazeQuadrant;
    const attention = Object.entries(aCounts).sort((a, b) => b[1] - a[1])[0][0] as AttentionState;
    return {
        timestampS: Math.round(bucketStart / 1000),
        quadrant,
        attention,
        score: Math.round(scoreSum / bucket.length * 100) / 100,
    };
}
