/**
 * Text Analysis Service
 * Reuses the GPT-4o analysis pipeline from Insights Finding to generate
 * themes and keywords for text responses within a research study
 * (SmartVOC VOC, Cognitive Short/Long Text).
 *
 * Results are cached in `researches.config.textAnalysis.<moduleId>`.
 */

import pool from '../../config/database';
import type { InsightsAnalysis } from '../insights/insights.service';

// ---------------------------------------------------------------------------
// Read / write cache helpers
// ---------------------------------------------------------------------------

const getCachedAnalysis = async (
    researchId: string,
    moduleId: string,
): Promise<InsightsAnalysis | null> => {
    const result = await pool.query(
        'SELECT config FROM researches WHERE id = ? AND deleted_at IS NULL',
        [researchId],
    );
    if (result.rows.length === 0) return null;

    let config = result.rows[0].config;
    if (typeof config === 'string') {
        try { config = JSON.parse(config); } catch { return null; }
    }
    if (!config || typeof config !== 'object') return null;

    const ta = (config as Record<string, unknown>).textAnalysis as Record<string, unknown> | undefined;
    if (!ta) return null;

    const entry = ta[moduleId] as { analysis: InsightsAnalysis; analyzedAt: string } | undefined;
    return entry?.analysis ?? null;
};

const saveCachedAnalysis = async (
    researchId: string,
    moduleId: string,
    analysis: InsightsAnalysis,
): Promise<void> => {
    // Read current config
    const result = await pool.query(
        'SELECT config FROM researches WHERE id = ? AND deleted_at IS NULL',
        [researchId],
    );
    if (result.rows.length === 0) return;

    let config = result.rows[0].config;
    if (typeof config === 'string') {
        try { config = JSON.parse(config); } catch { config = {}; }
    }
    if (!config || typeof config !== 'object') config = {};

    const rec = config as Record<string, unknown>;
    const ta = (rec.textAnalysis as Record<string, unknown>) ?? {};
    ta[moduleId] = { analysis, analyzedAt: new Date().toISOString() };
    rec.textAnalysis = ta;

    await pool.query(
        'UPDATE researches SET config = ? WHERE id = ? AND deleted_at IS NULL',
        [JSON.stringify(rec), researchId],
    );
};

// ---------------------------------------------------------------------------
// Fetch text responses (VOC or Cognitive Short/Long Text)
// ---------------------------------------------------------------------------

const fetchTextEntries = async (
    researchId: string,
    moduleId: string,
    participantIds?: string[],
): Promise<Array<{ text: string; mood: string }>> => {
    let query = `
        SELECT r.value, r.metadata
        FROM responses r
        WHERE r.research_id = ?
          AND r.module_id = ?
          AND r.component_id IN ('answer', 'text')
    `;
    const params: unknown[] = [researchId, moduleId];
    if (participantIds && participantIds.length > 0) {
        query += ` AND r.participant_id IN (${participantIds.map(() => '?').join(',')})`;
        params.push(...participantIds);
    }
    query += ` ORDER BY r.created_at DESC`;
    const result = await pool.query(query, params);

    const { analyzeSentiment } = await import('../sentiment/sentiment.service');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.rows.map((row: any) => {
        const text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
        let mood = '';
        try {
            const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            mood = meta?.sentiment ?? '';
        } catch { /* ignore */ }
        if (!mood && text.trim().length > 0) {
            mood = analyzeSentiment(text).sentiment;
        }
        return { text, mood };
    }).filter((e: { text: string }) => e.text.trim().length > 0);
};

/**
 * For SmartVOC VOC: responses use component_id 'text' via getSmartVOCResults.
 * We also need to support a virtual "voc" moduleId that collects VOC from all
 * SmartVOC modules. We pass the actual module IDs from the frontend.
 */
const fetchVOCEntries = async (
    researchId: string,
    participantIds?: string[],
): Promise<Array<{ text: string; mood: string }>> => {
    let query = `
        SELECT r.value, r.metadata
        FROM responses r
        JOIN modules m ON m.id = r.module_id
        WHERE r.research_id = ?
          AND m.name LIKE '%VOC%'
          AND m.name NOT LIKE '%CSAT%'
          AND m.name NOT LIKE '%NPS%'
          AND m.name NOT LIKE '%CES%'
          AND m.name NOT LIKE '%CV%'
          AND m.name NOT LIKE '%NEV%'
          AND r.component_id = 'text'
    `;
    const params: unknown[] = [researchId];
    if (participantIds && participantIds.length > 0) {
        query += ` AND r.participant_id IN (${participantIds.map(() => '?').join(',')})`;
        params.push(...participantIds);
    }
    query += ` ORDER BY r.created_at DESC`;
    const result = await pool.query(query, params);

    const { analyzeSentiment } = await import('../sentiment/sentiment.service');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.rows.map((row: any) => {
        const text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
        let mood = '';
        try {
            const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            mood = meta?.sentiment ?? '';
        } catch { /* ignore */ }
        if (!mood && text.trim().length > 0) {
            mood = analyzeSentiment(text).sentiment;
        }
        return { text, mood };
    }).filter((e: { text: string }) => e.text.trim().length > 0);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns cached analysis if available, null otherwise.
 */
export const getTextAnalysis = async (
    researchId: string,
    moduleId: string,
): Promise<InsightsAnalysis | null> => {
    return getCachedAnalysis(researchId, moduleId);
};

/**
 * Runs GPT-4o analysis for text responses of a specific module, caches it and returns it.
 * - moduleId = UUID → Cognitive Short/Long Text module
 * - moduleId = "voc" → all SmartVOC VOC responses across the research
 */
export const triggerTextAnalysis = async (
    researchId: string,
    moduleId: string,
    participantIds?: string[],
    selectedTexts?: Array<{ text: string; mood: string }>,
): Promise<InsightsAnalysis> => {
    // If frontend sent pre-selected texts, use those directly (skip DB fetch)
    const entries = selectedTexts && selectedTexts.length > 0
        ? selectedTexts.filter(e => e.text && e.text.trim().length > 0)
        : moduleId === 'voc'
            ? await fetchVOCEntries(researchId, participantIds)
            : await fetchTextEntries(researchId, moduleId, participantIds);

    if (entries.length === 0) {
        const emptyAnalysis: InsightsAnalysis = {
            sentiment: { summary: '', description: '', actionables: [] },
            themes: [],
            keywords: [],
        };
        await saveCachedAnalysis(researchId, moduleId, emptyAnalysis);
        return emptyAnalysis;
    }

    // Reuse exact same analysis logic from insights service
    const { analyzeInsights } = await import('../insights/insights.service');
    const analysis = await analyzeInsights(entries, `module-${moduleId}`);
    await saveCachedAnalysis(researchId, moduleId, analysis);
    return analysis;
};
