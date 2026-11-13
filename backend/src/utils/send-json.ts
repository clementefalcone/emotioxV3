import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';

const gzipAsync = promisify(gzip);
const MIN_COMPRESSED_BYTES = 1024;

export const isJsonText = (text: string): boolean => {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
};

export const sendJson = async (req: Request, res: Response, statusCode: number, json: string): Promise<void> => {
    res.status(statusCode).type('application/json; charset=utf-8').vary('Accept-Encoding');
    if (Buffer.byteLength(json) < MIN_COMPRESSED_BYTES || !req.acceptsEncodings('gzip')) {
        res.send(json);
        return;
    }
    res.setHeader('Content-Encoding', 'gzip');
    res.send(await gzipAsync(json));
};
