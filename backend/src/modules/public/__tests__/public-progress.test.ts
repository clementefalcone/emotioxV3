import { describe, it, expect, vi } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../index', () => ({}));
vi.mock('../../media/media.service', () => ({}));
vi.mock('../../research/research-in-progress.service', () => ({
    getOverviewMetricsInternal: vi.fn().mockResolvedValue({ totalModules: 3 }),
    getParticipantsWithStatusInternal: vi.fn().mockResolvedValue([
        { id: 'ana@example.com', name: 'Ana Pérez', email: 'ana@example.com', status: 'Completed', progress: 100, duration: '5 min', lastActivity: 'hoy' },
        { id: 'p-2', name: 'p-2', email: null, status: 'In progress', progress: 40, duration: '1 min', lastActivity: 'ayer' },
    ]),
}));

import { handlePublicRoutes } from '../public.controller';

const requestProgress = async (researchId: string) => {
    const response = await handlePublicRoutes({ httpMethod: 'GET', path: `/public/research/${researchId}/progress`, headers: {} } as unknown as APIGatewayProxyEvent);
    return { statusCode: response.statusCode, body: response.body, participants: JSON.parse(response.body).participants as Array<Record<string, unknown>> };
};

describe('GET /public/research/:id/progress', () => {
    it('shows progress without names, emails or real participant ids', async () => {
        const { statusCode, body, participants } = await requestProgress('research-1');

        expect(statusCode).toBe(200);
        expect(body).not.toContain('Ana');
        expect(body).not.toContain('ana@example.com');
        expect(body).not.toContain('p-2');
        expect(participants[0]).toMatchObject({ status: 'Completed', progress: 100, email: '' });
        expect(participants[0].name).toBe(`Participante ${participants[0].id}`);
        expect(participants[0].id).not.toBe(participants[1].id);
    });

    it('gives each participant the same alias on every load', async () => {
        const first = await requestProgress('research-1');
        const second = await requestProgress('research-1');
        expect(second.participants.map(p => p.id)).toEqual(first.participants.map(p => p.id));
    });
});
