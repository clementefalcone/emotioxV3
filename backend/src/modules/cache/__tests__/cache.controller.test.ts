import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../utils/auth', async () => {
    const actual = await vi.importActual<typeof import('../../../utils/auth')>('../../../utils/auth');
    return { ...actual, requireAuth: vi.fn() };
});
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn() }));
vi.mock('../cache.service', () => ({ getStats: vi.fn().mockReturnValue({}), clearAll: vi.fn(), clearByPattern: vi.fn() }));
vi.mock('../../../utils/request', () => ({ getRequestOrigin: vi.fn().mockReturnValue('http://localhost') }));

import { handleCacheRoutes } from '../cache.controller';
import { requireAuth, AuthError } from '../../../utils/auth';
import { getMe } from '../../auth/auth.service';
import { clearAll } from '../cache.service';

const clearCache = () =>
    handleCacheRoutes({ httpMethod: 'DELETE', path: '/cache/clear', headers: {} } as unknown as APIGatewayProxyEvent);

describe('cache routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('rejects a request without a session', async () => {
        vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 'NO_TOKEN'));

        const res = await clearCache();

        expect(res.statusCode).toBe(401);
        expect(clearAll).not.toHaveBeenCalled();
    });

    it('rejects a researcher', async () => {
        vi.mocked(requireAuth).mockResolvedValue({ sub: 's1' } as never);
        vi.mocked(getMe).mockResolvedValue({ id: 'u1', role: 'researcher' } as never);

        const res = await clearCache();

        expect(res.statusCode).toBe(403);
        expect(clearAll).not.toHaveBeenCalled();
    });

    it('lets an admin clear the cache', async () => {
        vi.mocked(requireAuth).mockResolvedValue({ sub: 's1' } as never);
        vi.mocked(getMe).mockResolvedValue({ id: 'a1', role: 'admin' } as never);

        const res = await clearCache();

        expect(res.statusCode).toBe(200);
        expect(clearAll).toHaveBeenCalledTimes(1);
    });
});
