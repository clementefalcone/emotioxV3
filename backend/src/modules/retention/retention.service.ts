import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import { createGzip } from 'zlib';
import { once } from 'events';
import pool from '../../config/database';
import { parseJsonRecord } from '../public/public.types';

export const DEFAULT_TRACKING_RETENTION_DAYS = 90;
export const DEFAULT_BIOMETRIC_RETENTION_MONTHS = 12;
const BACKUP_RETENTION_DAYS = 7;
const SESSION_BATCH_SIZE = 50;
const BIOMETRIC_MODULE_NAMES = ['Eye Tracking', 'Emotion Analysis'];
const DAY_MS = 86_400_000;

interface BackupWriter {
    write: (table: string, row: Record<string, unknown>) => Promise<void>;
    close: () => Promise<void>;
}

const openBackup = (filePath: string): BackupWriter => {
    const gzip = createGzip();
    const finished = new Promise<void>((resolve, reject) => {
        const file = createWriteStream(filePath);
        file.on('finish', resolve).on('error', reject);
        gzip.on('error', reject).pipe(file);
    });
    return {
        write: async (table, row) => {
            if (!gzip.write(`${JSON.stringify({ table, row })}\n`)) await once(gzip, 'drain');
        },
        close: async () => { gzip.end(); await finished; },
    };
};

export const readTrackingRetentionDays = (config: unknown): number => {
    const days = Number(parseJsonRecord(parseJsonRecord(config).trackingConfig).dataRetentionDays);
    return days > 0 ? days : DEFAULT_TRACKING_RETENTION_DAYS;
};

export const readBiometricRetentionMonths = (config: unknown): number => {
    const months = Number(parseJsonRecord(config).biometricDataRetentionMonths);
    return months > 0 ? months : DEFAULT_BIOMETRIC_RETENTION_MONTHS;
};

const purgeTrackingSessions = async (researchId: string, retentionDays: number, now: Date, backup: BackupWriter): Promise<number> => {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    let purged = 0;
    for (;;) {
        const sessions = await pool.query(
            'SELECT * FROM tracking_sessions WHERE research_id = ? AND started_at < ? LIMIT ?',
            [researchId, cutoff, SESSION_BATCH_SIZE],
        );
        if (sessions.rows.length === 0) return purged;
        const ids = sessions.rows.map(row => row.id as string);
        const events = await pool.query(`SELECT * FROM tracking_events WHERE session_id IN (${ids.map(() => '?').join(',')})`, ids);
        for (const row of sessions.rows) await backup.write('tracking_sessions', row);
        for (const row of events.rows) await backup.write('tracking_events', row);
        await pool.query(`DELETE FROM tracking_sessions WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
        purged += ids.length;
    }
};

const purgeBiometricResponses = async (researchId: string, retentionMonths: number, now: Date, backup: BackupWriter): Promise<number> => {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);
    const placeholders = BIOMETRIC_MODULE_NAMES.map(() => '?').join(',');
    const expired = await pool.query(
        `SELECT r.* FROM responses r JOIN modules m ON m.id = r.module_id
         WHERE r.research_id = ? AND m.name IN (${placeholders}) AND r.created_at < ?`,
        [researchId, ...BIOMETRIC_MODULE_NAMES, cutoff],
    );
    if (expired.rows.length === 0) return 0;
    const ids = expired.rows.map(row => row.id as string);
    for (const row of expired.rows) await backup.write('responses', row);
    await pool.query(`DELETE FROM responses WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    return ids.length;
};

const removeOldBackups = async (backupDir: string, now: Date): Promise<string[]> => {
    const removed: string[] = [];
    for (const name of await fs.readdir(backupDir)) {
        if (!name.startsWith('retention-')) continue;
        const filePath = join(backupDir, name);
        const { mtime } = await fs.stat(filePath);
        if (now.getTime() - mtime.getTime() < BACKUP_RETENTION_DAYS * DAY_MS) continue;
        await fs.unlink(filePath);
        removed.push(name);
    }
    return removed;
};

export interface RetentionSummary {
    trackingSessions: number;
    biometricResponses: number;
    backupFile: string | null;
    removedBackups: string[];
}

export const purgeExpiredData = async (backupDir: string, now: Date = new Date()): Promise<RetentionSummary> => {
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = join(backupDir, `retention-${now.toISOString().replace(/[:.]/g, '-')}.ndjson.gz`);
    const backup = openBackup(backupPath);
    let trackingSessions = 0;
    let biometricResponses = 0;
    try {
        const trackingStudies = await pool.query(
            'SELECT r.id, r.config FROM researches r WHERE EXISTS (SELECT 1 FROM tracking_sessions s WHERE s.research_id = r.id)',
        );
        for (const study of trackingStudies.rows) {
            trackingSessions += await purgeTrackingSessions(study.id, readTrackingRetentionDays(study.config), now, backup);
        }
        const biometricStudies = await pool.query(
            `SELECT DISTINCT r.id, r.config FROM researches r JOIN modules m ON m.research_id = r.id
             WHERE m.name IN (${BIOMETRIC_MODULE_NAMES.map(() => '?').join(',')})`,
            BIOMETRIC_MODULE_NAMES,
        );
        for (const study of biometricStudies.rows) {
            biometricResponses += await purgeBiometricResponses(study.id, readBiometricRetentionMonths(study.config), now, backup);
        }
    } finally {
        await backup.close();
    }
    const hasBackup = trackingSessions + biometricResponses > 0;
    if (!hasBackup) await fs.unlink(backupPath);
    const removedBackups = await removeOldBackups(backupDir, now);
    return { trackingSessions, biometricResponses, backupFile: hasBackup ? backupPath : null, removedBackups };
};
