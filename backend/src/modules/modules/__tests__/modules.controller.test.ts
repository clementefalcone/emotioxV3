import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../utils/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 'sub-1', role: 'researcher' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn().mockResolvedValue({ id: 'user-1', role: 'researcher' }) }));
vi.mock('../../../utils/request', () => ({ getRequestOrigin: vi.fn().mockReturnValue('http://localhost') }));
vi.mock('../modules.service', () => ({
    create: vi.fn().mockResolvedValue({ id: 'm-new' }),
    update: vi.fn().mockResolvedValue({ id: 'm1' }),
    deleteModule: vi.fn().mockResolvedValue({ message: 'deleted' }),
    reorder: vi.fn().mockResolvedValue({ message: 'reordered' }),
}));

import { handleModulesRoutes } from '../modules.controller';
import pool from '../../../config/database';
import { create, update, deleteModule, reorder } from '../modules.service';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const request = (httpMethod: string, path: string, body?: unknown) =>
    handleModulesRoutes({ httpMethod, path, headers: {}, body: body ? JSON.stringify(body) : null } as unknown as APIGatewayProxyEvent);

const routeQueries = (answers: Record<string, unknown[]>) =>
    mockQuery.mockImplementation(async (sql: string) => {
        const key = Object.keys(answers).find((fragment) => sql.includes(fragment));
        return { rows: key ? answers[key] : [] };
    });

describe('modules routes — study access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('does not delete a module of a study the user cannot access', async () => {
        routeQueries({ 'FROM modules WHERE id': [{ research_id: 'foreign' }], 'FROM researches r': [] });

        const res = await request('DELETE', '/modules/m1');

        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('Research foreign not found');
        expect(deleteModule).not.toHaveBeenCalled();
    });

    it('does not edit or reorder modules of a foreign study', async () => {
        routeQueries({ 'FROM modules WHERE id': [{ research_id: 'foreign' }], 'FROM researches r': [] });

        expect((await request('PUT', '/modules/m1', { name: 'x' })).statusCode).toBe(404);
        expect((await request('POST', '/modules/foreign/reorder', { modules: [] })).statusCode).toBe(404);
        expect(update).not.toHaveBeenCalled();
        expect(reorder).not.toHaveBeenCalled();
    });

    it('does not create a module in a foreign study or under a stage of another study', async () => {
        routeQueries({ 'FROM researches r': [] });
        expect((await request('POST', '/modules', { research_id: 'foreign', name: 'x' })).statusCode).toBe(404);

        routeQueries({ 'FROM researches r': [{ 1: 1 }], 'FROM stages': [] });
        const res = await request('POST', '/modules', { research_id: 'own', stage_id: 'stage-of-other', name: 'x' });
        expect(res.statusCode).toBe(400);
        expect(create).not.toHaveBeenCalled();
    });

    it('answers 404 for a module that does not exist', async () => {
        routeQueries({});

        const res = await request('DELETE', '/modules/missing');

        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('Module missing not found');
    });

    it('lets the owner edit and delete their module', async () => {
        routeQueries({ 'FROM modules WHERE id': [{ research_id: 'own' }], 'FROM researches r': [{ 1: 1 }] });

        expect((await request('PUT', '/modules/m1', { name: 'x' })).statusCode).toBe(200);
        expect((await request('DELETE', '/modules/m1')).statusCode).toBe(200);
        expect(deleteModule).toHaveBeenCalledWith('m1');
    });
});
