import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../utils/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 's1' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn().mockResolvedValue({ id: 'u1', role: 'researcher' }) }));
vi.mock('../../public/index', () => ({}));
vi.mock('..', () => ({ getById: vi.fn() }));
vi.mock('../research-access', () => ({
    canAccessResearch: vi.fn(),
    researchNotFound: vi.fn((researchId: string) => ({ statusCode: 404, body: `Research ${researchId} not found`, headers: {} })),
}));

import pool from '../../../config/database';
import { getById } from '..';
import { handleResearchRoutes } from '../research.controller';

const request = (path: string) =>
    handleResearchRoutes({ httpMethod: 'GET', path, headers: {}, body: null } as unknown as APIGatewayProxyEvent);

describe('GET /research/:id/consent-records', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('lists the consent records of an accessible study, newest first', async () => {
        vi.mocked(getById).mockResolvedValue({ id: 'r-1' } as never);
        vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: 'c-2', decision: 'withdrawn' }, { id: 'c-1', decision: 'accepted' }] } as never);

        const res = await request('/research/r-1/consent-records');

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ records: [{ id: 'c-2' }, { id: 'c-1' }] });
        expect(vi.mocked(pool.query).mock.calls[0]).toEqual([expect.stringContaining('WHERE research_id = ? ORDER BY created_at DESC'), ['r-1']]);
    });

    it('answers 404 and reads nothing for a study the user cannot access', async () => {
        vi.mocked(getById).mockRejectedValue(new Error('Research not found'));

        const res = await request('/research/foreign/consent-records');

        expect(res.statusCode).toBe(404);
        expect(pool.query).not.toHaveBeenCalled();
    });
});
