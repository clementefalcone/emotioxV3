import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../../utils/auth', () => ({ requireAuth: vi.fn().mockResolvedValue({ sub: 'sub-1' }) }));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn() }));
vi.mock('../../email/email.service', () => ({ sendViewerInvitation: vi.fn() }));
vi.mock('../../../utils/request', () => ({ getRequestOrigin: vi.fn().mockReturnValue('http://localhost') }));
vi.mock('../users.service', () => ({
    getAllUsers: vi.fn().mockResolvedValue([]),
    getUserById: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn().mockResolvedValue({ id: 'u2', role: 'researcher' }),
    deleteUser: vi.fn(),
}));

import { handleUsersRoutes } from '../users.controller';
import { getMe } from '../../auth/auth.service';
import { updateUser, getAllUsers } from '../users.service';
import pool from '../../../config/database';

const mockGetMe = getMe as ReturnType<typeof vi.fn>;

const request = (httpMethod: string, path: string, body?: unknown) =>
    handleUsersRoutes({ httpMethod, path, headers: {}, body: body ? JSON.stringify(body) : null } as unknown as APIGatewayProxyEvent);

describe('users routes — admin only', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('stops a researcher from promoting themselves to admin', async () => {
        mockGetMe.mockResolvedValue({ id: 'u1', role: 'researcher' });

        const res = await request('PUT', '/users/u1', { role: 'admin' });

        expect(res.statusCode).toBe(403);
        expect(updateUser).not.toHaveBeenCalled();
    });

    it('stops a researcher from listing every user', async () => {
        mockGetMe.mockResolvedValue({ id: 'u1', role: 'researcher' });

        const res = await request('GET', '/users');

        expect(res.statusCode).toBe(403);
        expect(getAllUsers).not.toHaveBeenCalled();
    });

    it('still lets a researcher list viewers to share studies', async () => {
        mockGetMe.mockResolvedValue({ id: 'u1', role: 'researcher' });

        const res = await request('GET', '/users/viewers');

        expect(res.statusCode).toBe(200);
    });

    it('lists only the viewers each user invited, all of them for an admin', async () => {
        vi.mocked(pool.query).mockResolvedValue({
            rows: [
                { id: 'v1', email: 'mine@x.com', metadata: JSON.stringify({ invited_by: 'u1' }) },
                { id: 'v2', email: 'other@x.com', metadata: JSON.stringify({ invited_by: 'u9' }) },
            ],
        } as never);
        const emailsFor = async (role: string) => {
            mockGetMe.mockResolvedValue({ id: 'u1', role });
            const res = await request('GET', '/users/viewers');
            return JSON.parse(res.body).viewers.map((viewer: { email: string }) => viewer.email);
        };

        expect(await emailsFor('researcher')).toEqual(['mine@x.com']);
        expect(await emailsFor('viewer')).toEqual(['mine@x.com']);
        expect(await emailsFor('admin')).toEqual(['mine@x.com', 'other@x.com']);
    });

    it('rejects a role outside admin, researcher and viewer', async () => {
        mockGetMe.mockResolvedValue({ id: 'admin-1', role: 'admin' });

        const res = await request('PUT', '/users/u2', { role: 'superuser' });

        expect(res.statusCode).toBe(400);
        expect(updateUser).not.toHaveBeenCalled();
    });

    it('lets an admin change a role', async () => {
        mockGetMe.mockResolvedValue({ id: 'admin-1', role: 'admin' });

        const res = await request('PUT', '/users/u2', { role: 'researcher' });

        expect(res.statusCode).toBe(200);
        expect(updateUser).toHaveBeenCalledWith('u2', expect.objectContaining({ role: 'researcher' }));
    });
});
