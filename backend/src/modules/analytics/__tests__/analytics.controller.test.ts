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

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockGetMe = getMe as ReturnType<typeof vi.fn>;

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
