import pool from '../../config/database';
import { computeAoiMetrics, type AoiFixation, type AoiMetrics, type AoiRect } from '../analytics/aoi-metrics';
import type { EmotionSample } from '../analytics/emotion-metrics';
import { parseSessionSamples } from './tracking-emotion.analytics';
import { dropLowQuality, hasLowQualityGaze } from './tracking-gaze.analytics';
import { getTrackingConfig, type TrackingZone } from './tracking.service';

export interface TrackingZoneMetrics extends TrackingZone, AoiMetrics {
    visits: number;
}

interface ZoneFixation extends AoiFixation {
    zones: Record<string, AoiRect>;
}

interface SessionGaze {
    sessionId: string;
    pagePath: string;
    fixations: ZoneFixation[];
    isLowQuality: boolean;
    emotions: EmotionSample[];
}

const toPagePath = (pageUrl: string): string => {
    try {
        return new URL(pageUrl).pathname;
    } catch {
        return pageUrl;
    }
};

const toRect = (value: unknown): AoiRect | null => {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) return null;
    const [x, y, width, height] = value as number[];
    return width > 0 && height > 0 ? { x, y, width, height } : null;
};

const toZoneFixation = (raw: unknown, sessionId: string): ZoneFixation | null => {
    if (!raw || typeof raw !== 'object') return null;
    const sample = raw as Record<string, unknown>;
    if (sample.type !== 'fixation') return null;
    if (![sample.x, sample.y, sample.duration, sample.timestamp].every(Number.isFinite)) return null;
    const zones: Record<string, AoiRect> = {};
    if (sample.zones && typeof sample.zones === 'object') {
        for (const [zoneId, value] of Object.entries(sample.zones as Record<string, unknown>)) {
            const rect = toRect(value);
            if (rect) zones[zoneId] = rect;
        }
    }
    return {
        participantId: sessionId,
        x: sample.x as number,
        y: sample.y as number,
        duration: sample.duration as number,
        timestamp: sample.timestamp as number,
        zones,
    };
};

const parseSessionGaze = (row: { id: string; page_url: string; gaze_samples: string | unknown[] | null; emotion_samples: string | unknown[] | null }): SessionGaze => {
    let samples: unknown[] = [];
    try {
        const parsed = typeof row.gaze_samples === 'string' ? JSON.parse(row.gaze_samples) : row.gaze_samples;
        samples = Array.isArray(parsed) ? parsed : [];
    } catch {
        samples = [];
    }
    return {
        sessionId: row.id,
        pagePath: toPagePath(row.page_url),
        fixations: samples.flatMap((sample) => toZoneFixation(sample, row.id) ?? []),
        isLowQuality: hasLowQualityGaze(samples),
        emotions: parseSessionSamples(row.emotion_samples),
    };
};

export async function getTrackingZoneData(researchId: string): Promise<{ zones: TrackingZoneMetrics[] }> {
    const { zones } = await getTrackingConfig(researchId);
    if (zones.length === 0) return { zones: [] };

    const result = await pool.query(
        `SELECT id, page_url, gaze_samples, emotion_samples
         FROM tracking_sessions
         WHERE research_id = ? AND gaze_samples IS NOT NULL`,
        [researchId],
    );
    const sessions = (result.rows as Array<{ id: string; page_url: string; gaze_samples: string | unknown[] | null; emotion_samples: string | unknown[] | null }>)
        .map(parseSessionGaze)
        .filter((session) => session.fixations.length > 0);

    return {
        zones: zones.map((zone) => {
            const pageSessions = dropLowQuality(sessions.filter((session) => session.pagePath === toPagePath(zone.pageUrl)));
            const fixations = pageSessions.flatMap((session) => session.fixations);
            return {
                ...zone,
                visits: pageSessions.length,
                ...computeAoiMetrics({
                    fixations,
                    rectFor: (fixation) => (fixation as ZoneFixation).zones[zone.id],
                    allRectsFor: (fixation) => Object.values((fixation as ZoneFixation).zones),
                    emotionsByParticipant: new Map(pageSessions.map((session) => [session.sessionId, session.emotions])),
                }),
            };
        }),
    };
}
