import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../utils/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 'sub-1' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn().mockResolvedValue({ id: 'user-1', role: 'researcher' }) }));
vi.mock('../../../utils/request', () => ({ getRequestOrigin: vi.fn().mockReturnValue('http://localhost') }));
vi.mock('../participants.service', () => ({
    listByResearch: vi.fn().mockResolvedValue([]),
    importParticipants: vi.fn().mockResolvedValue({ imported: 1 }),
    deleteParticipant: vi.fn().mockResolvedValue(true),
    deleteAllByResearch: vi.fn().mockResolvedValue(3),
    sendEmailsToAll: vi.fn().mockResolvedValue({ sent: 1 }),
    sendEmailToOne: vi.fn().mockResolvedValue({ success: true }),
}));

import { handleParticipantsRoutes } from '../participants.controller';
import pool from '../../../config/database';
import * as participantsService from '../participants.service';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const request = (httpMethod: string, path: string, body?: unknown) =>
    handleParticipantsRoutes({ httpMethod, path, headers: {}, body: body ? JSON.stringify(body) : null } as unknown as APIGatewayProxyEvent);

describe('participants routes — study access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it.each([
        ['GET', '/participants/foreign'],
        ['DELETE', '/participants/foreign'],
        ['POST', '/participants/foreign/send-emails'],
        ['POST', '/participants/foreign/import'],
        ['DELETE', '/participants/foreign/p1'],
        ['POST', '/participants/foreign/p1/send-email'],
    ])('denies %s %s on a study the user cannot access', async (method, path) => {
        mockQuery.mockResolvedValue({ rows: [] });

        const res = await request(method, path, { baseUrl: 'https://evil.example', researchName: 'x', csv: 'email\na@b.c' });

        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('Research foreign not found');
        for (const fn of Object.values(participantsService)) expect(fn).not.toHaveBeenCalled();
    });

    it('lets the owner list their panel', async () => {
        mockQuery.mockResolvedValue({ rows: [{ 1: 1 }] });

        const res = await request('GET', '/participants/own');

        expect(res.statusCode).toBe(200);
    });
});
