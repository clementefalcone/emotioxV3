import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { readClientAddress } from '../public-rate-limit';

const requestFrom = (forwardedFor: string | undefined, socketAddress = '10.0.0.1') =>
    ({ headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }, socket: { remoteAddress: socketAddress } }) as unknown as Request;

describe('readClientAddress', () => {
    it('keys on the address the proxy appended, not on one the client wrote', () => {
        expect(readClientAddress(requestFrom('1.1.1.1, 203.0.113.7'))).toBe('203.0.113.7');
    });

    it('uses the single forwarded address the proxy set', () => {
        expect(readClientAddress(requestFrom('203.0.113.7'))).toBe('203.0.113.7');
    });

    it('falls back to the socket address without a forwarded header', () => {
        expect(readClientAddress(requestFrom(undefined))).toBe('10.0.0.1');
    });
});

describe('publicRateLimit', () => {
    it('answers 429 after 1000 public requests from one address in a minute, counting each address apart', async () => {
        const express = (await import('express')).default;
        const { publicRateLimit } = await import('../public-rate-limit');
        const app = express();
        app.use('/public', publicRateLimit);
        app.get('/public/ping', (_req, res) => { res.json({ ok: true }); });
        const server = app.listen(0);
        const port = (server.address() as { port: number }).port;
        const get = (address: string) => fetch(`http://127.0.0.1:${port}/public/ping`, { headers: { 'x-forwarded-for': address } });
        try {
            for (let i = 0; i < 1000; i++) await get('203.0.113.7');
            const blocked = await get('203.0.113.7');
            const otherVisitor = await get('198.51.100.9');
            expect(blocked.status).toBe(429);
            expect(((await blocked.json()) as { message: string }).message).toContain('the limit is 1000 per minute per address');
            expect(otherVisitor.status).toBe(200);
        } finally {
            server.close();
        }
    }, 30_000);
});
