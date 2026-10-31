import { describe, it, expect } from 'vitest';
import { readAccessTokenCookie } from '../auth.local';

describe('readAccessTokenCookie', () => {
    it('reads the access token among other cookies', () => {
        expect(readAccessTokenCookie('theme=light; accessToken=abc.def ; refreshToken=xyz')).toBe('abc.def');
    });

    it('returns null when the cookie is missing or empty', () => {
        expect(readAccessTokenCookie(undefined)).toBeNull();
        expect(readAccessTokenCookie('refreshToken=xyz')).toBeNull();
        expect(readAccessTokenCookie('accessToken=')).toBeNull();
    });
});
