import { describe, it, expect, vi } from 'vitest';
import { denyUnlessAdmin } from '../admin-guard';

describe('denyUnlessAdmin', () => {
    it('lets an admin through', () => {
        expect(denyUnlessAdmin({ id: 'a1', role: 'admin' }, { httpMethod: 'DELETE', path: '/enterprises/e1' }, null)).toBeNull();
    });

    it.each(['researcher', 'viewer'])('answers 403 and logs the decision for a %s', (role) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const res = denyUnlessAdmin({ id: 'u1', role }, { httpMethod: 'PUT', path: '/module-templates/t1' }, null);

        expect(res?.statusCode).toBe(403);
        expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({ event: 'admin_required', userId: 'u1', method: 'PUT', path: '/module-templates/t1' });
        warn.mockRestore();
    });
});
