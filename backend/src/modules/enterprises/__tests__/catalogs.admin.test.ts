import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../../utils/auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({ sub: 's1' }),
    isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../auth/auth.service', () => ({ getMe: vi.fn() }));
vi.mock('../enterprises.service', () => ({
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'e1' }),
    update: vi.fn(),
    deleteEnterprise: vi.fn(),
    remove: vi.fn(),
}));
vi.mock('../../module-templates/module-templates.service', () => ({
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn(),
    remove: vi.fn(),
    deleteTemplate: vi.fn(),
}));

import { handleEnterprisesRoutes } from '../enterprises.controller';
import { handleModuleTemplatesRoutes } from '../../module-templates/module-templates.controller';
import { getMe } from '../../auth/auth.service';
import * as enterprisesService from '../enterprises.service';
import * as templatesService from '../../module-templates/module-templates.service';

const event = (httpMethod: string, path: string, body?: unknown) =>
    ({ httpMethod, path, headers: {}, body: body ? JSON.stringify(body) : null }) as unknown as APIGatewayProxyEvent;

describe('global catalogs and enterprises — admin only for writes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('stops a researcher from creating an enterprise or a module template', async () => {
        vi.mocked(getMe).mockResolvedValue({ id: 'u1', role: 'researcher' } as never);

        const enterprise = await handleEnterprisesRoutes(event('POST', '/enterprises', { name: 'Acme' }));
        const template = await handleModuleTemplatesRoutes(event('POST', '/module-templates', { name: 'NPS' }));

        expect(enterprise.statusCode).toBe(403);
        expect(template.statusCode).toBe(403);
        expect(enterprisesService.create).not.toHaveBeenCalled();
        expect(templatesService.create).not.toHaveBeenCalled();
    });

    it('still lets a researcher read them', async () => {
        vi.mocked(getMe).mockResolvedValue({ id: 'u1', role: 'researcher' } as never);

        expect((await handleEnterprisesRoutes(event('GET', '/enterprises'))).statusCode).toBe(200);
        expect((await handleModuleTemplatesRoutes(event('GET', '/module-templates'))).statusCode).toBe(200);
    });

    it('lets an admin create an enterprise', async () => {
        vi.mocked(getMe).mockResolvedValue({ id: 'a1', role: 'admin' } as never);

        const res = await handleEnterprisesRoutes(event('POST', '/enterprises', { name: 'Acme' }));

        expect(res.statusCode).toBe(201);
    });
});
