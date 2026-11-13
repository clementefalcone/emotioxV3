/**
 * Tracking Emotion Analytics
 * Aggregates facial emotion data from Website Tracking sessions.
 */

import pool from '../../config/database';
import { aggregateEmotions, computeVA, detectMicroExpressions, type EkmanEmotion, type EmotionAggregation, type EmotionSample } from '../analytics/emotion-metrics';

const ALL_EMOTIONS: EkmanEmotion[] = ['joy', 'sadness', 'surprise', 'anger', 'disgust', 'fear', 'neutral'];

export interface TrackingEmotionData {
    totalSessions: number;
    emotions: EmotionAggregation;
    perSession: Array<{
        sessionId: string;
        visitorId: string;
        pageUrl: string;
        dominantEmotion: EkmanEmotion;
        sampleCount: number;
    }>;
    valenceArousal: Array<{ timestampS: number; valence: number; arousal: number }>;
}

/**
 * Samples come straight from a browser we do not control, so anything that is
 * not a known emotion with a usable confidence is dropped before it can reach
 * the reported figures. Counting an unrecognized label would inflate
 * totalSamples (pushing the distribution below 100%) and could even surface it
 * as the dominant emotion, which the distribution never lists.
 */
function isValidSample(raw: unknown): raw is EmotionSample {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as Record<string, unknown>;
    // Number.isFinite already rejects non-numbers, so no typeof check is needed.
    return (
        (ALL_EMOTIONS as string[]).includes(s.emotion as string) &&
        Number.isFinite(s.confidence) &&
        Number.isFinite(s.timestamp) &&
        (s.actionUnits === undefined || hasNumericValues(s.actionUnits))
    );
}

function hasNumericValues(value: unknown): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
        Object.values(value as Record<string, unknown>).every(Number.isFinite);
}

export function parseSessionSamples(raw: string | unknown[] | null): EmotionSample[] {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed.filter(isValidSample).sort((a, b) => a.timestamp - b.timestamp) : [];
    } catch {
        return [];
    }
}

function buildValenceArousal(samples: EmotionSample[]): TrackingEmotionData['valenceArousal'] {
    const buckets = new Map<number, EmotionSample[]>();
    for (const sample of samples) {
        const second = Math.floor(sample.timestamp / 1000);
        buckets.set(second, [...(buckets.get(second) ?? []), sample]);
    }
    return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([timestampS, bucket]) => {
        const va = computeVA(bucket);
        return { timestampS, valence: Math.round(va.valence * 100) / 100, arousal: Math.round(va.arousal * 100) / 100 };
    });
}

export async function getTrackingEmotionData(
    researchId: string,
    pageUrl?: string
): Promise<TrackingEmotionData> {
    let query = `SELECT id, visitor_id, page_url, emotion_samples
                 FROM tracking_sessions
                 WHERE research_id = ? AND emotion_samples IS NOT NULL`;
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
        emotion_samples: string | unknown[];
    }>;

    const sessionSamples = sessions
        .map((session) => ({ session, samples: parseSessionSamples(session.emotion_samples) }))
        .filter(({ samples }) => samples.length > 0);

    const emotions = aggregateEmotions(sessionSamples.map(({ session, samples }) => ({
        participantId: session.visitor_id,
        samples,
        microExpressions: detectMicroExpressions(samples),
    })));

    const perSession = sessionSamples.map(({ session, samples }) => {
        const sessionCounts: Record<string, number> = {};
        for (const sample of samples) sessionCounts[sample.emotion] = (sessionCounts[sample.emotion] || 0) + 1;
        return {
            sessionId: session.id,
            visitorId: session.visitor_id,
            pageUrl: session.page_url,
            dominantEmotion: (Object.entries(sessionCounts).sort((a, b) => b[1] - a[1])[0][0] as EkmanEmotion),
            sampleCount: samples.length,
        };
    });

    return {
        totalSessions: perSession.length,
        emotions,
        perSession,
        valenceArousal: buildValenceArousal(sessionSamples.flatMap(({ samples }) => samples)),
    };
}
