import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { sendJson } from '../send-json';

const largeJson = JSON.stringify({ items: Array.from({ length: 500 }, (_, index) => ({ index, label: 'fixation' })) });
const app = express();
app.get('/large', (req, res) => { void sendJson(req, res, 200, largeJson); });
app.get('/small', (req, res) => { void sendJson(req, res, 201, '{"ok":true}'); });
const server = app.listen(0);
afterAll(() => { server.close(); });

const fetchRaw = (path: string, acceptEncoding?: string) => new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    request({ port, path, headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {} }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
});

describe('sendJson', () => {
    it('gzips large JSON when the client accepts gzip', async () => {
        const response = await fetchRaw('/large', 'gzip, deflate, br');
        expect(response.headers['content-encoding']).toBe('gzip');
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body.length).toBeLessThan(Buffer.byteLength(largeJson) / 5);
        expect(gunzipSync(response.body).toString()).toBe(largeJson);
    });

    it('sends plain JSON to clients without gzip and for small bodies', async () => {
        const plain = await fetchRaw('/large');
        expect(plain.headers['content-encoding']).toBeUndefined();
        expect(plain.body.toString()).toBe(largeJson);

        const small = await fetchRaw('/small', 'gzip');
        expect(small.status).toBe(201);
        expect(small.headers['content-encoding']).toBeUndefined();
        expect(small.body.toString()).toBe('{"ok":true}');
    });
});
