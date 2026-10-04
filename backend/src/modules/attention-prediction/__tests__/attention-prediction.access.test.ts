import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../../utils/auth.local', async (importOriginal) => ({ ...(await importOriginal<object>()), requireAuth: vi.fn() }));
vi.mock('../../research/research-access', () => ({
    canAccessResearch: vi.fn(),
    researchNotFound: vi.fn((researchId: string) => ({ statusCode: 404, body: `Research ${researchId} not found`, headers: {} })),
}));
vi.mock('../ai-analysis.service', () => ({ analyzeAttentionWithAI: vi.fn(), generateHybridSaliency: vi.fn(), parseManualAois: vi.fn() }));
vi.mock('../video-prediction.service', () => ({ predictVideoFrames: vi.fn(), predictVideoFramesTased: vi.fn(), renderVideoHeatmap: vi.fn(), extractVideoFrame: vi.fn() }));

import { handleAttentionPredictionRoutes } from '../attention-prediction.controller';
import { AuthError, requireAuth } from '../../../utils/auth.local';
import { canAccessResearch } from '../../research/research-access';
import { analyzeAttentionWithAI } from '../ai-analysis.service';
import pool from '../../../config/database';

const request = (path: string) =>
    handleAttentionPredictionRoutes({ httpMethod: 'POST', path, headers: {}, body: '{}' } as unknown as APIGatewayProxyEvent);

describe('attention prediction — study access', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('does not run predictions or AI analysis on a study the user cannot access', async () => {
        vi.mocked(requireAuth).mockResolvedValue({ sub: 's1', role: 'researcher' } as never);
        vi.mocked(canAccessResearch).mockResolvedValue(false);

        const predict = await request('/attention-prediction/research/foreign/predict/m1');
        const analyze = await request('/attention-prediction/research/foreign/analyze/m1');

        expect(predict.statusCode).toBe(404);
        expect(analyze.statusCode).toBe(404);
        expect(pool.query).not.toHaveBeenCalled();
        expect(analyzeAttentionWithAI).not.toHaveBeenCalled();
    });

    it('keeps viewers from starting paid jobs', async () => {
        vi.mocked(requireAuth).mockResolvedValue({ sub: 'v1', role: 'viewer' } as never);

        const res = await request('/attention-prediction/research/r1/video-predict');

        expect(res.statusCode).toBe(403);
        expect(canAccessResearch).not.toHaveBeenCalled();
    });

    it('answers 401 when the token is missing', async () => {
        vi.mocked(requireAuth).mockRejectedValue(new AuthError('No token provided', 'NO_TOKEN'));

        const res = await request('/attention-prediction/research/r1/predict/m1');

        expect(res.statusCode).toBe(401);
    });
});
