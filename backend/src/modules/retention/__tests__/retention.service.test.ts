import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';

vi.mock('../../../config/database', () => ({ default: { query: vi.fn() } }));

import pool from '../../../config/database';
import { purgeExpiredData, readBiometricRetentionMonths, readTrackingRetentionDays } from '../retention.service';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const NOW = new Date('2026-10-30T12:00:00Z');

const respondTo = (handlers: Array<[RegExp, (params: unknown[]) => unknown[]]>) => {
    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
        const handler = handlers.find(([pattern]) => pattern.test(sql));
        return { rows: handler ? handler[1](params) : [] };
    });
};

const readBackup = (filePath: string) =>
    gunzipSync(readFileSync(filePath)).toString().trim().split('\n').map(line => JSON.parse(line) as { table: string; row: { id: string } });

describe('retention settings', () => {
    it('uses the study tracking retention and falls back to 90 days', () => {
        expect(readTrackingRetentionDays(JSON.stringify({ trackingConfig: { dataRetentionDays: 30 } }))).toBe(30);
        expect(readTrackingRetentionDays({})).toBe(90);
        expect(readTrackingRetentionDays({ trackingConfig: { dataRetentionDays: 0 } })).toBe(90);
    });

    it('uses the study biometric retention and falls back to 12 months', () => {
        expect(readBiometricRetentionMonths({ biometricDataRetentionMonths: 6 })).toBe(6);
        expect(readBiometricRetentionMonths(null)).toBe(12);
    });
});

describe('purgeExpiredData', () => {
    let backupDir: string;

    beforeEach(() => {
        backupDir = mkdtempSync(join(tmpdir(), 'retention-'));
        mockQuery.mockReset();
    });

    afterEach(() => {
        rmSync(backupDir, { recursive: true, force: true });
    });

    it('backs up and deletes expired tracking sessions and biometric responses using each study cutoff', async () => {
        let sessionBatches = 0;
        respondTo([
            [/FROM researches r WHERE EXISTS/, () => [{ id: 'web-1', config: { trackingConfig: { dataRetentionDays: 30 } } }]],
            [/FROM tracking_sessions WHERE research_id/, () => (sessionBatches++ === 0 ? [{ id: 's-old', research_id: 'web-1' }] : [])],
            [/FROM tracking_events/, () => [{ id: 'e-1', session_id: 's-old' }]],
            [/SELECT DISTINCT r.id, r.config/, () => [{ id: 'study-1', config: {} }]],
            [/SELECT r\.\* FROM responses/, () => [{ id: 'resp-old', research_id: 'study-1' }]],
        ]);

        const summary = await purgeExpiredData(backupDir, NOW);

        expect(summary).toMatchObject({ trackingSessions: 1, biometricResponses: 1, removedBackups: [] });
        expect(readBackup(summary.backupFile as string)).toEqual([
            { table: 'tracking_sessions', row: { id: 's-old', research_id: 'web-1' } },
            { table: 'tracking_events', row: { id: 'e-1', session_id: 's-old' } },
            { table: 'responses', row: { id: 'resp-old', research_id: 'study-1' } },
        ]);
        const sessionCutoff = mockQuery.mock.calls.find(([sql]) => /FROM tracking_sessions WHERE research_id/.test(sql))?.[1][1] as Date;
        expect(sessionCutoff.toISOString()).toBe('2026-09-30T12:00:00.000Z');
        const responseCutoff = mockQuery.mock.calls.find(([sql]) => /SELECT r\.\* FROM responses/.test(sql))?.[1].at(-1) as Date;
        expect(responseCutoff.toISOString()).toBe('2025-10-30T12:00:00.000Z');
        const deletes = mockQuery.mock.calls.filter(([sql]) => /^DELETE/.test(sql)).map(([sql, params]) => [sql.split(' WHERE')[0], params]);
        expect(deletes).toEqual([['DELETE FROM tracking_sessions', ['s-old']], ['DELETE FROM responses', ['resp-old']]]);
    });

    it('leaves no backup file when nothing expired and removes backups older than 7 days', async () => {
        const oldBackup = join(backupDir, 'retention-old.ndjson.gz');
        const recentBackup = join(backupDir, 'retention-recent.ndjson.gz');
        writeFileSync(oldBackup, '');
        writeFileSync(recentBackup, '');
        utimesSync(oldBackup, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-20T00:00:00Z'));
        utimesSync(recentBackup, new Date('2026-10-28T00:00:00Z'), new Date('2026-10-28T00:00:00Z'));
        respondTo([]);

        const summary = await purgeExpiredData(backupDir, NOW);

        expect(summary).toEqual({ trackingSessions: 0, biometricResponses: 0, backupFile: null, removedBackups: ['retention-old.ndjson.gz'] });
        expect(readdirSync(backupDir)).toEqual(['retention-recent.ndjson.gz']);
        expect(mockQuery.mock.calls.some(([sql]) => /^DELETE/.test(sql))).toBe(false);
    });
});
