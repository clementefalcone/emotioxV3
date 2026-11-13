/**
 * Emotion Analysis Analytics
 * Aggregates emotion data from standalone Emotion Analysis modules
 * (component_id = 'emotion-analysis').
 */

import pool from '../../config/database';
import { computeMeanIntensity } from './emotion-metrics';

type EkmanEmotion = 'joy' | 'sadness' | 'surprise' | 'anger' | 'disgust' | 'fear' | 'neutral';

interface EmotionSample {
    timestamp: number;
    emotion: EkmanEmotion;
    confidence: number;
    actionUnits: Record<string, number>;
}

interface MicroExpression {
    emotion: string;
    durationMs: number;
    startTimestamp: number;
    endTimestamp: number;
    peakConfidence: number;
    category: 'brief' | 'micro';
}

interface StimulusEmotionResult {
    stimulusIndex: number;
    stimulusUrl: string;
    participantCount: number;
    totalSamples: number;
    dominantEmotion: EkmanEmotion;
    distribution: Record<EkmanEmotion, number>;
    meanIntensity: Record<EkmanEmotion, number>;
    avgConfidence: number;
    avgActionUnits: Record<string, number>;
    microExpressions: {
        total: number;
        briefCount: number;
        microCount: number;
        byEmotion: Record<string, number>;
    };
    timeline: EmotionSample[];
}

export interface EmotionAnalysisResults {
    moduleId: string;
    moduleName: string;
    totalParticipants: number;
    totalSamples: number;
    stimuli: StimulusEmotionResult[];
}

export async function getEmotionAnalysisResults(researchId: string): Promise<EmotionAnalysisResults[]> {
    const result = await pool.query(
        `SELECT r.participant_id, r.module_id, r.value, m.name AS module_name
         FROM responses r
         JOIN modules m ON m.id = r.module_id
         WHERE r.research_id = ? AND r.component_id IN ('emotion-analysis', 'eye-tracking-data')
         ORDER BY r.created_at`,
        [researchId]
    );

    const moduleMap = new Map<string, { name: string; rows: Array<{ participant_id: string; value: unknown }> }>();

    for (const row of result.rows) {
        const r = row as { participant_id: string; module_id: string; value: unknown; module_name: string };
        if (!moduleMap.has(r.module_id)) {
            moduleMap.set(r.module_id, { name: r.module_name, rows: [] });
        }
        moduleMap.get(r.module_id)!.rows.push({ participant_id: r.participant_id, value: r.value });
    }

    const results: EmotionAnalysisResults[] = [];

    for (const [moduleId, { name, rows }] of moduleMap) {
        const stimuliMap = new Map<number, {
            url: string;
            participants: Set<string>;
            allSamples: EmotionSample[];
            allMicros: MicroExpression[];
        }>();

        for (const row of rows) {
            try {
                const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
                const payload = parsed as Record<string, unknown>;

                if (Array.isArray(payload.stimuli)) {
                    const stimuli = payload.stimuli as Array<{ stimulusIndex: number; stimulusUrl: string; emotionSamples?: EmotionSample[]; microExpressions?: MicroExpression[] }>;
                    for (const stim of stimuli) {
                        if (!stimuliMap.has(stim.stimulusIndex)) {
                            stimuliMap.set(stim.stimulusIndex, { url: stim.stimulusUrl, participants: new Set(), allSamples: [], allMicros: [] });
                        }
                        const entry = stimuliMap.get(stim.stimulusIndex)!;
                        entry.participants.add(row.participant_id);
                        entry.allSamples.push(...(stim.emotionSamples ?? []));
                        entry.allMicros.push(...(stim.microExpressions ?? []));
                    }
                } else if (Array.isArray(payload.emotions)) {
                    const stimIdx = 0;
                    if (!stimuliMap.has(stimIdx)) {
                        stimuliMap.set(stimIdx, { url: (payload.stimulusUrl as string) ?? '', participants: new Set(), allSamples: [], allMicros: [] });
                    }
                    const entry = stimuliMap.get(stimIdx)!;
                    entry.participants.add(row.participant_id);
                    entry.allSamples.push(...(payload.emotions as EmotionSample[]));
                    entry.allMicros.push(...((payload.microExpressions as MicroExpression[]) ?? []));
                }
            } catch { /* skip malformed */ }
        }

        const stimuliResults: StimulusEmotionResult[] = [];

        for (const [index, data] of Array.from(stimuliMap.entries()).sort((a, b) => a[0] - b[0])) {
            const samples = data.allSamples;
            const emptyDist = (): Record<EkmanEmotion, number> => ({ joy: 0, sadness: 0, surprise: 0, anger: 0, disgust: 0, fear: 0, neutral: 0 });

            if (samples.length === 0) {
                stimuliResults.push({
                    stimulusIndex: index,
                    stimulusUrl: data.url,
                    participantCount: data.participants.size,
                    totalSamples: 0,
                    dominantEmotion: 'neutral',
                    distribution: emptyDist(),
                    meanIntensity: emptyDist(),
                    avgConfidence: 0,
                    avgActionUnits: {},
                    microExpressions: { total: 0, briefCount: 0, microCount: 0, byEmotion: {} },
                    timeline: [],
                });
                continue;
            }

            // Distribution
            const counts = emptyDist();
            let totalConf = 0;
            const auSums: Record<string, number> = {};
            let auCount = 0;

            for (const s of samples) {
                counts[s.emotion]++;
                totalConf += s.confidence;
                if (s.actionUnits) {
                    for (const [k, v] of Object.entries(s.actionUnits)) {
                        auSums[k] = (auSums[k] || 0) + v;
                    }
                    auCount++;
                }
            }

            const total = samples.length;
            const distribution = emptyDist();
            for (const [e, c] of Object.entries(counts)) {
                distribution[e as EkmanEmotion] = Math.round((c / total) * 10000) / 100;
            }

            const dominantEmotion = (Object.entries(counts) as [EkmanEmotion, number][])
                .reduce((best, [e, c]) => c > best[1] ? [e, c] : best, ['neutral' as EkmanEmotion, 0])[0];

            const avgAUs: Record<string, number> = {};
            if (auCount > 0) {
                for (const [k, v] of Object.entries(auSums)) {
                    avgAUs[k] = Math.round((v / auCount) * 1000) / 1000;
                }
            }

            // Timeline (1s buckets)
            const bucketMs = 1000;
            const buckets = new Map<number, EmotionSample[]>();
            for (const s of samples) {
                const key = Math.floor(s.timestamp / bucketMs) * bucketMs;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key)!.push(s);
            }

            const timeline: EmotionSample[] = [];
            for (const [ts, bucket] of Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])) {
                const bCounts: Record<string, number> = {};
                for (const s of bucket) bCounts[s.emotion] = (bCounts[s.emotion] || 0) + 1;
                const bDom = Object.entries(bCounts).sort((a, b) => b[1] - a[1])[0][0] as EkmanEmotion;
                const bConf = bucket.reduce((sum, s) => sum + s.confidence, 0) / bucket.length;
                const bAUs: Record<string, number> = {};
                for (const s of bucket) {
                    if (!s.actionUnits) continue;
                    for (const [k, v] of Object.entries(s.actionUnits)) bAUs[k] = (bAUs[k] || 0) + v;
                }
                for (const k of Object.keys(bAUs)) bAUs[k] /= bucket.length;
                timeline.push({ timestamp: ts, emotion: bDom, confidence: bConf, actionUnits: bAUs });
            }

            // Micro-expressions
            const micros = data.allMicros;
            const microByEmotion: Record<string, number> = {};
            let briefCount = 0, microCount = 0;
            for (const m of micros) {
                microByEmotion[m.emotion] = (microByEmotion[m.emotion] || 0) + 1;
                if (m.category === 'brief') briefCount++;
                else microCount++;
            }

            stimuliResults.push({
                stimulusIndex: index,
                stimulusUrl: data.url,
                participantCount: data.participants.size,
                totalSamples: total,
                dominantEmotion,
                distribution,
                meanIntensity: computeMeanIntensity(samples),
                avgConfidence: Math.round((totalConf / total) * 1000) / 1000,
                avgActionUnits: avgAUs,
                microExpressions: { total: micros.length, briefCount, microCount, byEmotion: microByEmotion },
                timeline,
            });
        }

        results.push({
            moduleId,
            moduleName: name,
            totalParticipants: new Set(rows.map(r => r.participant_id)).size,
            totalSamples: stimuliResults.reduce((sum, s) => sum + s.totalSamples, 0),
            stimuli: stimuliResults,
        });
    }

    return results;
}
