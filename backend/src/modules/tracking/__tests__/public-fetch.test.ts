import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertPublicUrl, fetchPublicUrl, BlockedUrlError } from '../public-fetch';

describe('assertPublicUrl', () => {
    it.each([
        'http://127.0.0.1:2083/',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.5/',
        'http://172.20.1.1/',
        'http://192.168.1.1/',
        'http://[::1]/',
        'http://[::ffff:127.0.0.1]/',
        'http://[::ffff:a9fe:a9fe]/',
        'http://localhost:3306/',
        'file:///etc/passwd',
    ])('blocks %s', async (url) => {
        await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(BlockedUrlError);
    });

    it('allows a public address', async () => {
        await expect(assertPublicUrl('https://93.184.216.34/style.css')).resolves.toBeInstanceOf(URL);
    });
});

describe('fetchPublicUrl', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('refuses to follow a redirect into the private network', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchPublicUrl('https://93.184.216.34/font.woff2')).rejects.toBeInstanceOf(BlockedUrlError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns the final response of a public redirect chain', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/v2/font.woff2' } }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await fetchPublicUrl('https://93.184.216.34/font.woff2');

        expect(response.status).toBe(200);
        expect(String(fetchMock.mock.calls[1][0])).toBe('https://93.184.216.34/v2/font.woff2');
    });
});
