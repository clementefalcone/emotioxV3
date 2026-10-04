import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../utils/auth.local', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 'sub-1', role: 'researcher' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn().mockResolvedValue({ id: 'user-1', role: 'researcher' }) }));
vi.mock('../../../utils/request', () => ({ getRequestOrigin: vi.fn().mockReturnValue('http://localhost') }));
vi.mock('../stimulus-complexity.service', () => ({ analyzeStimulusComplexity: vi.fn().mockResolvedValue({ score: 1 }) }));
vi.mock('../media.service.local', () => ({
    generateUploadUrl: vi.fn().mockResolvedValue({ upload_url: '/api/media/upload-direct?signed' }),
    saveMetadata: vi.fn().mockResolvedValue({ id: 'media-new' }),
    getMediaUrlByPath: vi.fn().mockResolvedValue({ url: '/api/media/x' }),
    getMediaUrlById: vi.fn().mockResolvedValue({ url: '/api/media/x' }),
    deleteMedia: vi.fn().mockResolvedValue({ deleted: true }),
}));

import { handleMediaRoutes } from '../media.controller';
import pool from '../../../config/database';
import * as mediaService from '../media.service.local';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const request = (httpMethod: string, path: string, opts: { body?: unknown; query?: Record<string, string> } = {}) =>
    handleMediaRoutes({
        httpMethod, path, headers: {},
        body: opts.body ? JSON.stringify(opts.body) : null,
        queryStringParameters: opts.query ?? null,
    } as unknown as APIGatewayProxyEvent);

const accessibleStudies = (studies: string[], mediaOwners: Record<string, string[]> = {}, mediaById: Record<string, string> = {}) =>
    mockQuery.mockImplementation(async (sql: string, params: string[]) => {
        if (sql.includes('FROM researches r')) return { rows: studies.includes(params[0]) ? [{ 1: 1 }] : [] };
        if (sql.includes('SELECT DISTINCT research_id FROM media')) return { rows: (mediaOwners[params[0]] ?? []).map((research_id) => ({ research_id })) };
        if (sql.includes('FROM media WHERE id')) return { rows: mediaById[params[0]] ? [{ research_id: mediaById[params[0]] }] : [] };
        return { rows: [] };
    });

describe('media routes — study access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('does not hand out a signed upload URL for a foreign study', async () => {
        accessibleStudies(['own']);

        const res = await request('POST', '/media/upload', { body: { research_id: 'foreign', file_name: 'a.png', content_type: 'image/png' } });

        expect(res.statusCode).toBe(404);
        expect(mediaService.generateUploadUrl).not.toHaveBeenCalled();
    });

    it('signs uploads for an accessible study', async () => {
        accessibleStudies(['own']);

        const res = await request('POST', '/media/upload', { body: { research_id: 'own', file_name: 'a.png', content_type: 'image/png' } });

        expect(res.statusCode).toBe(200);
    });

    it('does not delete media of a foreign study', async () => {
        accessibleStudies(['own'], {}, { m1: 'foreign' });

        const res = await request('DELETE', '/media/m1');

        expect(res.statusCode).toBe(404);
        expect(mediaService.deleteMedia).not.toHaveBeenCalled();
    });

    it('rejects registering a file that lives outside the study folder', async () => {
        accessibleStudies(['own']);

        const res = await request('POST', '/media', { body: { research_id: 'own', s3_key: 'research/foreign/stimulus.png' } });

        expect(res.statusCode).toBe(400);
        expect(mediaService.saveMetadata).not.toHaveBeenCalled();
    });

    it('lets a collaborator of a duplicated study read a file kept in the original folder', async () => {
        accessibleStudies(['copy'], { 'research/original/stimulus.png': ['original', 'copy'] });

        const res = await request('GET', '/media/by-key', { query: { s3_key: 'research/original/stimulus.png' } });

        expect(res.statusCode).toBe(200);
    });

    it('hides a file of a foreign study', async () => {
        accessibleStudies(['own'], { 'research/foreign/stimulus.png': ['foreign'] });

        const res = await request('GET', '/media/by-key', { query: { s3_key: 'research/foreign/stimulus.png' } });

        expect(res.statusCode).toBe(404);
    });

    it('keeps viewers read-only', async () => {
        const { requireAuth } = await import('../../../utils/auth.local');
        vi.mocked(requireAuth).mockResolvedValueOnce({ sub: 'v1', role: 'viewer' } as never);

        const res = await request('DELETE', '/media/m1');

        expect(res.statusCode).toBe(403);
    });
});
