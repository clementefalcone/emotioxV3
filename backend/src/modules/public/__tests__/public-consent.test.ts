import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createHash } from 'crypto';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../index', () => ({}));
vi.mock('../../media/media.service', () => ({}));

import pool from '../../../config/database';
import { handlePublicRoutes } from '../public.controller';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const validRecord = {
    subjectId: 'participant-1',
    context: 'eye_tracking',
    decision: 'accepted',
    text: 'Cámara y biometría. Si aceptas, guardamos dónde miras.',
    locale: 'es',
};

const postConsent = (body: unknown) =>
    handlePublicRoutes({
        httpMethod: 'POST',
        path: '/public/research/research-1/consent',
        headers: {},
        body: JSON.stringify(body),
    } as unknown as APIGatewayProxyEvent);

describe('POST /public/research/:id/consent', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    it('stores the exact text, its hash and the decision', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 'research-1' }] }).mockResolvedValueOnce({ rows: [] });
        const response = await postConsent(validRecord);
        expect(response.statusCode).toBe(201);
        const [sql, params] = mockQuery.mock.calls[1];
        expect(sql).toContain('INSERT INTO consent_records');
        expect(params).toEqual([
            'research-1', 'participant-1', 'eye_tracking', 'accepted', validRecord.text,
            createHash('sha256').update(validRecord.text).digest('hex'), 'es',
        ]);
    });

    it('rejects a decision outside the dictionary without touching the database', async () => {
        const response = await postConsent({ ...validRecord, decision: 'maybe' });
        expect(response.statusCode).toBe(400);
        expect(response.body).toContain('decision');
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects a missing consent text', async () => {
        const response = await postConsent({ ...validRecord, text: '' });
        expect(response.statusCode).toBe(400);
        expect(response.body).toContain('text');
    });

    it('returns 404 for an unknown research', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        const response = await postConsent(validRecord);
        expect(response.statusCode).toBe(404);
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });
});
