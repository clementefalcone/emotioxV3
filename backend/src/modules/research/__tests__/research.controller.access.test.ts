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
    getAllTags: vi.fn(),
}));
vi.mock('../research-activity.service', () => ({ listAccessibleResearchActivity: vi.fn().mockResolvedValue([]) }));
vi.mock('../research-access', () => ({
    canAccessResearch: vi.fn(),
    researchNotFound: vi.fn((researchId: string) => ({ statusCode: 404, body: `Research ${researchId} not found`, headers: {} })),
}));

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

    it('lists only the activity of studies the user can access', async () => {
        await request('GET', '/research/activity');

        expect(listAccessibleResearchActivity).toHaveBeenCalledWith('u1', 'researcher');
    });
});
