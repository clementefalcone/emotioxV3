import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../../utils/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 's1' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn().mockResolvedValue({ id: 'u1', role: 'researcher' }) }));
vi.mock('../../public/index', () => ({}));
vi.mock('../research-tags.service', () => ({
    getTagsForResearch: vi.fn().mockResolvedValue([]),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    archiveResearch: vi.fn(),
    unarchiveResearch: vi.fn(),
}));
vi.mock('../research-activity.service', () => ({ listAccessibleResearchActivity: vi.fn().mockResolvedValue([]) }));
vi.mock('../research-access', () => ({
    canAccessResearch: vi.fn(),
    researchAccessFor: (httpMethod: string) => (httpMethod === 'GET' ? 'read' : 'write'),
    researchNotFound: vi.fn((researchId: string) => ({ statusCode: 404, body: `Research ${researchId} not found`, headers: {} })),
}));

import pool from '../../../config/database';
import { getMe } from '../../auth/auth.service';
import { handleResearchRoutes } from '../research.controller';
import { canAccessResearch } from '../research-access';
import * as tags from '../research-tags.service';
import { listAccessibleResearchActivity } from '../research-activity.service';

const request = (httpMethod: string, path: string, body?: unknown) =>
    handleResearchRoutes({ httpMethod, path, headers: {}, body: body ? JSON.stringify(body) : null } as unknown as APIGatewayProxyEvent);

describe('research routes — tags, archive and activity access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(canAccessResearch).mockResolvedValue(false);
        vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    });

    it.each([
        ['POST', '/research/foreign/archive'],
        ['POST', '/research/foreign/unarchive'],
        ['POST', '/research/foreign/tags'],
        ['DELETE', '/research/foreign/tags/urgent'],
        ['GET', '/research/foreign/tags'],
    ])('denies %s %s on a foreign study', async (method, path) => {
        const res = await request(method, path, { tag: 'x' });

        expect(res.statusCode).toBe(404);
        for (const fn of Object.values(tags)) expect(fn).not.toHaveBeenCalled();
    });

    it.each([
        ['GET', '/research/r1/tags', 'read'],
        ['POST', '/research/r1/archive', 'write'],
    ])('checks %s %s with %s access', async (method, path, access) => {
        await request(method, path, { tag: 'x' });

        expect(canAccessResearch).toHaveBeenCalledWith('r1', 's1', access);
    });

    it('rejects a collaborator permission outside viewer and editor', async () => {
        vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: 'r1', created_by: 'u1', config: '{}', count: 0 }] } as never);
        const res = await request('POST', '/research/r1/collaborators', { email: 'a@x.com', permission: 'owner' });

        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Invalid permission');
    });

    it('refuses a viewer the personal data export of a participant', async () => {
        vi.mocked(getMe).mockResolvedValueOnce({ id: 'v1', role: 'viewer' } as never);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const res = await request('GET', '/research/r1/participants/p1/data-export');

        expect(res.statusCode).toBe(403);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('lists only the activity of studies the user can access', async () => {
        await request('GET', '/research/activity');

        expect(listAccessibleResearchActivity).toHaveBeenCalledWith('u1', 'researcher');
    });
});
