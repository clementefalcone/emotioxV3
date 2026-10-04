import { describe, it, expect, vi } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../config/database', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

import { route } from '../router';
import pool from '../config/database';

const get = (path: string) =>
    route({ httpMethod: 'GET', path, headers: { Authorization: 'Bearer leaked-token' } } as unknown as APIGatewayProxyEvent);

describe('router — debug endpoints', () => {
    it('does not echo request headers', async () => {
        const res = await get('/debug-headers');

        expect(res.statusCode).not.toBe(200);
        expect(res.body).not.toContain('leaked-token');
    });

    it('does not read study modules without authentication', async () => {
        const res = await get('/debug/ranking-module');

        expect(res.statusCode).not.toBe(200);
        expect(pool.query).not.toHaveBeenCalled();
    });
});
