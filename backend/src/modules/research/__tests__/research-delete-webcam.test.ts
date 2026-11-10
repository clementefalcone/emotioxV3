import { describe, it, expect, vi, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

const mediaDir = vi.hoisted(() => {
    const dir = `${process.env.TMPDIR ?? '/tmp'}/research-delete-webcam-${Date.now()}`;
    process.env.MEDIA_BASE_DIR = dir;
    return dir;
});

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));

import pool from '../../../config/database';
import { deleteResearch } from '../research.crud';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const webcamPath = 'research/r1/webcam/6f1c2a3e-0000-4000-8000-000000000000.webm';

describe('deleteResearch', () => {
    afterAll(() => {
        rmSync(mediaDir, { recursive: true, force: true });
    });

    it('moves the webcam recordings stored in its responses to _trash', async () => {
        mkdirSync(path.join(mediaDir, 'research/r1/webcam'), { recursive: true });
        writeFileSync(path.join(mediaDir, webcamPath), 'video');
        mockQuery.mockImplementation(async (sql: string) => {
            if (sql.includes('UPDATE researches')) return { rows: [], rowCount: 1 };
            if (sql.includes('FROM responses') && sql.includes("component_id = 'eye-tracking-data'")) {
                return { rows: [{ value: JSON.stringify({ webcamRecording: { mediaPath: webcamPath, offsetMs: 3 } }) }] };
            }
            return { rows: [] };
        });

        await deleteResearch('r1', 'user-1', 'admin');

        expect(existsSync(path.join(mediaDir, webcamPath))).toBe(false);
        expect(existsSync(path.join(mediaDir, '_trash', webcamPath))).toBe(true);
    });
});
