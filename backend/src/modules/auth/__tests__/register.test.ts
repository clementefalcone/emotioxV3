import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('bcrypt', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed') } }));

import { handleAuthRoutes } from '../auth.controller';
import pool from '../../../config/database';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const register = (body: Record<string, unknown>) =>
    handleAuthRoutes({ httpMethod: 'POST', path: '/auth/register', headers: {}, body: JSON.stringify(body) } as unknown as APIGatewayProxyEvent);

describe('POST /auth/register', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('always creates a researcher, ignoring a role sent by the caller', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'new@x.com', role: 'researcher' }] });

        const res = await register({ email: 'new@x.com', password: 'longenough', role: 'admin' });

        expect(res.statusCode).toBe(201);
        const insert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO users'));
        expect(insert?.[1][2]).toBe('researcher');
    });

    it('rejects an existing email with 409 and never touches that account', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 'google-user' }] });

        const res = await register({ email: 'owner@x.com', password: 'attackerpass' });

        expect(res.statusCode).toBe(409);
        expect(res.body).toContain('User owner@x.com already exists');
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });
});
