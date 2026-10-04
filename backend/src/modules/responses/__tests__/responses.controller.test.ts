import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../utils/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 'sub-1' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn().mockResolvedValue({ id: 'user-1', role: 'researcher' }) }));
vi.mock('../responses.service', () => ({
    getByResearch: vi.fn().mockResolvedValue([]),
    getByParticipant: vi.fn().mockResolvedValue([]),
}));

import { handleResponsesRoutes } from '../responses.controller';
import pool from '../../../config/database';
import { getByResearch, getByParticipant } from '../responses.service';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const request = (path: string) =>
    handleResponsesRoutes({ httpMethod: 'GET', path, headers: {} } as unknown as APIGatewayProxyEvent);

describe('responses routes — study access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('does not return the answers of a study the user cannot access', async () => {
        mockQuery.mockResolvedValue({ rows: [] });

        expect((await request('/responses/research/foreign')).statusCode).toBe(404);
        expect((await request('/responses/research/foreign/participant/p1')).statusCode).toBe(404);
        expect(getByResearch).not.toHaveBeenCalled();
        expect(getByParticipant).not.toHaveBeenCalled();
    });

    it('returns the answers of an accessible study', async () => {
        mockQuery.mockResolvedValue({ rows: [{ 1: 1 }] });

        const res = await request('/responses/research/own');

        expect(res.statusCode).toBe(200);
        expect(getByResearch).toHaveBeenCalledWith('own', 5000, 0);
    });
});
