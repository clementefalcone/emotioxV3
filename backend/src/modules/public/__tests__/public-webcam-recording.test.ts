import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'fs';
import path from 'path';

const mediaDir = vi.hoisted(() => {
    const dir = `${process.env.TMPDIR ?? '/tmp'}/webcam-recording-test-${Date.now()}`;
    process.env.MEDIA_BASE_DIR = dir;
    return dir;
});

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));

import pool from '../../../config/database';
import { saveWebcamRecording, WebcamRecordingRejectedError } from '../public.webcam-recording';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const enabledConfig = JSON.stringify({ structure: { components: [{ id: 'webcam-recording', value: 'true' }] } });

const upload = (overrides: Partial<Parameters<typeof saveWebcamRecording>[0]> = {}) => ({
    researchId: 'research-1',
    moduleId: 'module-1',
    participantId: 'kiosk-1',
    contentType: 'video/webm;codecs=vp9',
    data: Buffer.from('webm-bytes'),
    ...overrides,
});

const rejection = async (promise: Promise<unknown>) => {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebcamRecordingRejectedError);
    return error as WebcamRecordingRejectedError;
};

describe('saveWebcamRecording', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    afterAll(() => {
        rmSync(mediaDir, { recursive: true, force: true });
    });

    it('stores the video under the research webcam folder with an unguessable name', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ config: enabledConfig }] }).mockResolvedValueOnce({ rows: [{ 1: 1 }] });
        const { mediaPath } = await saveWebcamRecording(upload());
        expect(mediaPath).toMatch(/^research\/research-1\/webcam\/[0-9a-f-]{36}\.webm$/);
        expect(readFileSync(path.join(mediaDir, mediaPath), 'utf8')).toBe('webm-bytes');
    });

    it('rejects modules where the researcher did not enable recording', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ config: { structure: { components: [] } } }] });
        expect((await rejection(saveWebcamRecording(upload()))).statusCode).toBe(422);
    });

    it('rejects participants without an accepted eye tracking consent', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ config: enabledConfig }] }).mockResolvedValueOnce({ rows: [] });
        expect((await rejection(saveWebcamRecording(upload()))).statusCode).toBe(403);
    });

    it('rejects unknown modules or inactive research', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        expect((await rejection(saveWebcamRecording(upload()))).statusCode).toBe(404);
    });

    it('rejects non-video bodies and unsafe participant ids before touching the database', async () => {
        expect((await rejection(saveWebcamRecording(upload({ contentType: 'image/png' })))).statusCode).toBe(400);
        expect((await rejection(saveWebcamRecording(upload({ participantId: '../etc' })))).statusCode).toBe(400);
        expect((await rejection(saveWebcamRecording(upload({ data: Buffer.alloc(0) })))).statusCode).toBe(400);
        expect(mockQuery).not.toHaveBeenCalled();
    });
});
