import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../utils/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 'sub-1' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn() }));
vi.mock('../index', () => ({ getSmartVOCResults: vi.fn().mockResolvedValue({ totalResponses: 3 }) }));
vi.mock('../../../utils/request', () => ({ getRequestOrigin: vi.fn().mockReturnValue('http://localhost') }));

import { handleAnalyticsRoutes } from '../analytics.controller';
import pool from '../../../config/database';
import { getMe } from '../../auth/auth.service';
import { getSmartVOCResults } from '../index';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockGetMe = getMe as ReturnType<typeof vi.fn>;
const mockGetSmartVOC = getSmartVOCResults as ReturnType<typeof vi.fn>;

const requestEnterpriseSmartVOC = () =>
    handleAnalyticsRoutes({ httpMethod: 'GET', path: '/analytics/enterprise/ent-1/smartvoc', headers: {} } as unknown as APIGatewayProxyEvent);

describe('GET /analytics/enterprise/:id/smartvoc', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuery.mockResolvedValue({ rows: [{ id: 'res-1', name: 'Study', enterprise_name: 'Acme' }] });
    });

    it('only consolidates studies of the enterprise the user owns or collaborates on', async () => {
        mockGetMe.mockResolvedValue({ id: 'user-1', role: 'researcher' });

        const res = await requestEnterpriseSmartVOC();

        expect(res.statusCode).toBe(200);
        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toContain('r.enterprise_id = ? AND (r.created_by = ? OR r.id IN (SELECT research_id FROM research_collaborators WHERE user_id = ?))');
        expect(params).toEqual(['ent-1', 'user-1', 'user-1']);
    });

    it('lets an admin consolidate every study of the enterprise', async () => {
        mockGetMe.mockResolvedValue({ id: 'admin-1', role: 'admin' });

        await requestEnterpriseSmartVOC();

        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toContain('r.enterprise_id = ? AND 1=1');
        expect(params).toEqual(['ent-1']);
    });
});

const request = (path: string) =>
    handleAnalyticsRoutes({ httpMethod: 'GET', path, headers: {} } as unknown as APIGatewayProxyEvent);

describe('research-scoped analytics access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetMe.mockResolvedValue({ id: 'user-1', role: 'researcher' });
    });

    it('answers 404 without reading results when the user has no access to the study', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const res = await request('/analytics/research/foreign-1/smartvoc');

        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('Research foreign-1 not found');
        expect(mockGetSmartVOC).not.toHaveBeenCalled();
        const [sql, params] = mockQuery.mock.calls[0];
        expect(sql).toContain('r.id = ? AND (r.created_by = ? OR r.id IN (SELECT research_id FROM research_collaborators WHERE user_id = ?))');
        expect(params).toEqual(['foreign-1', 'user-1', 'user-1']);
        expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ event: 'analytics_access_denied', researchId: 'foreign-1' });
        warn.mockRestore();
    });

    it('returns the results when the user owns or collaborates on the study', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

        const res = await request('/analytics/research/own-1/smartvoc');

        expect(res.statusCode).toBe(200);
        expect(mockGetSmartVOC).toHaveBeenCalledWith('own-1');
    });

    it('guards the benchmark route with the same rule', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const res = await request('/analytics/benchmark/foreign-2');

        expect(res.statusCode).toBe(404);
    });
});
