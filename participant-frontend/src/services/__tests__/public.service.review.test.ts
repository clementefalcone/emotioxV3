import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../config.service', () => ({ configService: { getBaseUrl: () => 'https://api.test' } }));

import { publicService, ReviewPassRejectedError } from '../public.service';

describe('getParticipantResponses', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports an expired or invalid review pass as its own error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
        await expect(publicService.getParticipantResponses('r-1', 'p-1', 'old-pass')).rejects.toBeInstanceOf(ReviewPassRejectedError);
    });

    it('reports other failures with the status', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
        const failure = publicService.getParticipantResponses('r-1', 'p-1', 'pass');
        await expect(failure).rejects.not.toBeInstanceOf(ReviewPassRejectedError);
        await expect(failure).rejects.toThrow('HTTP 500');
    });
});
