import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../config/local-storage', () => ({
    getMediaPath: vi.fn(), getMediaUrl: vi.fn(), ensureDirectoryExists: vi.fn(), initializeMediaDirectory: vi.fn(),
}));

import { generateUploadUrl, isValidUploadSignature } from '../media.service.local';

const parseUploadUrl = (url: string) => Object.fromEntries(new URL(url, 'https://emotio.cx').searchParams);

describe('signed media upload URLs', () => {
    beforeEach(() => { vi.stubEnv('JWT_SECRET', 'test-secret'); });

    it('accepts the exact URL the backend handed out', async () => {
        const { upload_url } = await generateUploadUrl('res-1', 'photo.png', 'image/png');
        const q = parseUploadUrl(upload_url);

        expect(isValidUploadSignature(q.research_id, q.media_path, q.expires, q.signature)).toBe(true);
    });

    it('rejects an upload without a signature, to another study or another path', async () => {
        const { upload_url } = await generateUploadUrl('res-1', 'photo.png', 'image/png');
        const q = parseUploadUrl(upload_url);

        expect(isValidUploadSignature(q.research_id, q.media_path, undefined, undefined)).toBe(false);
        expect(isValidUploadSignature('res-2', q.media_path, q.expires, q.signature)).toBe(false);
        expect(isValidUploadSignature(q.research_id, 'research/res-1/evil.html', q.expires, q.signature)).toBe(false);
    });

    it('rejects an expired URL', async () => {
        const { upload_url } = await generateUploadUrl('res-1', 'photo.png', 'image/png');
        const q = parseUploadUrl(upload_url);
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 3601_000);

        expect(isValidUploadSignature(q.research_id, q.media_path, q.expires, q.signature)).toBe(false);
        vi.useRealTimers();
    });
});
