/**
 * Insights Controller
 * Handles HTTP routes for LLM-based text analysis.
 * Fire-and-forget pattern to avoid proxy timeout.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth.local';
import { getRequestOrigin } from '../../utils/request';
import { analyzeInsights } from './insights.service';
import pool from '../../config/database';
import { canAccessResearch, researchNotFound } from '../research/research-access';

interface FileItem {
    mediaId: string;
    name: string;
    entries?: Array<{ text: string; mood: string }>;
    analysis?: unknown;
    totalCount?: number;
    processedAt?: string;
}

/**
 * Runs LLM analysis in background and saves result to research config.
 */
const runAnalysisAsync = async (
    researchId: string,
    fileMediaId: string
): Promise<void> => {
    try {
        console.log(`[Insights] Starting analysis for file ${fileMediaId}...`);

        // Read current config
        const result = await pool.query(
            'SELECT config FROM researches WHERE id = ? AND deleted_at IS NULL',
            [researchId]
        );
        if (result.rows.length === 0) return;

        let config: Record<string, unknown> = {};
        try {
            const raw = result.rows[0].config;
            config = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        } catch { config = {}; }

        const stimuli = (config.stimuli as FileItem[]) || [];
        const file = stimuli.find(s => s.mediaId === fileMediaId);
        if (!file || !file.entries || file.entries.length === 0) {
            console.error(`[Insights] File ${fileMediaId} not found or has no entries`);
            return;
        }

        // Run LLM analysis (with optional custom prompt from research config)
        const customPrompt = typeof config.insightsPrompt === 'string' ? config.insightsPrompt : undefined;
        const analysis = await analyzeInsights(file.entries, file.name, customPrompt);

        // Save analysis back to config
        const updatedStimuli = stimuli.map(s =>
            s.mediaId === fileMediaId
                ? { ...s, analysis, analyzedAt: new Date().toISOString() }
                : s
        );
        config.stimuli = updatedStimuli;

        await pool.query(
            'UPDATE researches SET config = ? WHERE id = ?',
            [JSON.stringify(config), researchId]
        );

        console.log(`[Insights] Analysis complete for file ${fileMediaId}`);
    } catch (err) {
        console.error(`[Insights] Analysis failed for file ${fileMediaId}:`, err);
    }
};

export const handleInsightsRoutes = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        const decoded = await requireAuth(event);

        if (decoded.role === 'viewer' && httpMethod !== 'GET') {
            return error('Viewer role is read-only', 403, undefined, origin);
        }

        const scopedResearch = path.match(/^\/insights\/research\/([^/]+)/);
        if (scopedResearch && !(await canAccessResearch(scopedResearch[1], decoded.sub))) {
            return researchNotFound(scopedResearch[1], decoded.sub, path, origin);
        }

        // POST /insights/research/:researchId/analyze/:fileMediaId
        const analyzeMatch = path.match(
            /^\/insights\/research\/([^/]+)\/analyze\/([^/]+)$/
        );
        if (analyzeMatch && httpMethod === 'POST') {
            const researchId = analyzeMatch[1];
            const fileMediaId = analyzeMatch[2];

            // Fire and forget
            void runAnalysisAsync(researchId, fileMediaId);

            return success(
                { status: 'processing', fileMediaId, message: 'Analysis started.' },
                202, undefined, origin
            );
        }

        // GET /insights/research/:researchId/status/:fileMediaId
        const statusMatch = path.match(
            /^\/insights\/research\/([^/]+)\/status\/([^/]+)$/
        );
        if (statusMatch && httpMethod === 'GET') {
            const researchId = statusMatch[1];
            const fileMediaId = statusMatch[2];

            const result = await pool.query(
                'SELECT config FROM researches WHERE id = ? AND deleted_at IS NULL',
                [researchId]
            );
            if (result.rows.length === 0) {
                return error('Research not found', 404, undefined, origin);
            }

            let config: Record<string, unknown> = {};
            try {
                const raw = result.rows[0].config;
                config = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
            } catch { config = {}; }

            const stimuli = (config.stimuli as FileItem[]) || [];
            const file = stimuli.find(s => s.mediaId === fileMediaId);

            if (!file) {
                return error('File not found', 404, undefined, origin);
            }

            const ready = !!file.analysis;
            return success(
                { fileMediaId, status: ready ? 'complete' : 'processing', analyzedAt: (file as unknown as Record<string, unknown>).analyzedAt || null },
                200, undefined, origin
            );
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        if (isAuthError(err)) return error(err.message, err.statusCode, undefined, origin);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Insights] Error:', err);
        return error(msg, 500, undefined, origin);
    }
};
