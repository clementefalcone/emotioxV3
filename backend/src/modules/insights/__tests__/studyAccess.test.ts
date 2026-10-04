import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../../utils/auth.local', () => ({ requireAuth: vi.fn() }));
vi.mock('../../../utils/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn().mockResolvedValue({ id: 'u1', role: 'researcher' }) }));
vi.mock('../insights.service', () => ({ analyzeInsights: vi.fn() }));
vi.mock('../../cerulean/client', () => ({ isEnabled: vi.fn(), getApiUrl: vi.fn() }));
vi.mock('../../cerulean/integration.service', () => ({ certifyResearch: vi.fn(), recordAuditEvent: vi.fn() }));
vi.mock('../../research/research-access', () => ({
    canAccessResearch: vi.fn(),
    researchNotFound: vi.fn((researchId: string) => ({ statusCode: 404, body: `Research ${researchId} not found`, headers: {} })),
}));

import { handleInsightsRoutes } from '../insights.controller';
import { handleCeruleanRoutes } from '../../cerulean/cerulean.controller';
import * as authLocal from '../../../utils/auth.local';
import * as auth from '../../../utils/auth';
import { canAccessResearch } from '../../research/research-access';
import * as integrationService from '../../cerulean/integration.service';
import pool from '../../../config/database';

const event = (httpMethod: string, path: string) => ({ httpMethod, path, headers: {}, body: '{}' }) as unknown as APIGatewayProxyEvent;

describe('insights and cerulean — study access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(authLocal.requireAuth).mockResolvedValue({ sub: 's1', role: 'researcher' } as never);
        vi.mocked(auth.requireAuth).mockResolvedValue({ sub: 's1', role: 'researcher' } as never);
        vi.mocked(canAccessResearch).mockResolvedValue(false);
    });

    it('does not start insights analysis on a foreign study', async () => {
        const res = await handleInsightsRoutes(event('POST', '/insights/research/foreign/analyze/f1'));

        expect(res.statusCode).toBe(404);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('does not certify or read the certificate of a foreign study', async () => {
        const certify = await handleCeruleanRoutes(event('POST', '/cerulean/research/foreign/certify'));
        const certificate = await handleCeruleanRoutes(event('GET', '/cerulean/research/foreign/certificate'));

        expect(certify.statusCode).toBe(404);
        expect(certificate.statusCode).toBe(404);
        expect(integrationService.recordAuditEvent).not.toHaveBeenCalled();
    });

    it('keeps viewers read-only', async () => {
        vi.mocked(authLocal.requireAuth).mockResolvedValue({ sub: 'v1', role: 'viewer' } as never);

        const res = await handleInsightsRoutes(event('POST', '/insights/research/r1/analyze/f1'));

        expect(res.statusCode).toBe(403);
    });
});
