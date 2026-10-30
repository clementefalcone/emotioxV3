import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('../index', () => ({ getParticipantResponses: vi.fn().mockResolvedValue([{ module_id: 'm-1', value: 'gaze' }]) }));
vi.mock('../../media/media.service', () => ({}));

import { handlePublicRoutes } from '../public.controller';
import { getParticipantResponses } from '../index';
import { signParticipantReviewToken } from '../../../utils/auth';

const requestResponses = (participantId: string, token?: string) =>
    handlePublicRoutes({
        httpMethod: 'GET',
        path: `/public/research/research-1/participant/${participantId}/responses`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    } as unknown as APIGatewayProxyEvent);

describe('GET /public/research/:id/participant/:pid/responses', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects a request without a review token', async () => {
        const response = await requestResponses('p-1');
        expect(response.statusCode).toBe(401);
        expect(getParticipantResponses).not.toHaveBeenCalled();
    });

    it('rejects a review token issued for another participant', async () => {
        const response = await requestResponses('p-1', signParticipantReviewToken('research-1', 'p-2'));
        expect(response.statusCode).toBe(401);
        expect(getParticipantResponses).not.toHaveBeenCalled();
    });

    it('rejects a researcher session token', async () => {
        const jwt = await import('jsonwebtoken');
        const sessionToken = jwt.default.sign({ sub: 'user-1', researchId: 'research-1', participantId: 'p-1' }, process.env.JWT_SECRET || 'change-this-secret-in-production');
        const response = await requestResponses('p-1', sessionToken);
        expect(response.statusCode).toBe(401);
    });

    it('returns the responses for a valid review token', async () => {
        const response = await requestResponses('p-1', signParticipantReviewToken('research-1', 'p-1'));
        expect(response.statusCode).toBe(200);
        expect(getParticipantResponses).toHaveBeenCalledWith('research-1', 'p-1');
    });
});
