import pool from '../../config/database';
import { buildOwnershipClause } from './research.helpers';
import { PARTICIPANT_DATA_TABLES } from './research-in-progress.service';

type Row = Record<string, unknown>;

export interface ParticipantDataExport {
    researchId: string;
    participantId: string;
    exportedAt: string;
    tables: Record<string, Row[]>;
}

export const exportParticipantData = async (researchId: string, participantId: string, userId: string, role?: string): Promise<ParticipantDataExport> => {
    const ownership = buildOwnershipClause(userId, role, '');
    const research = await pool.query(
        `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
        [researchId, ...ownership.params]
    );
    if (research.rows.length === 0) throw new Error('Research not found');

    const tables: Record<string, Row[]> = {};
    for (const table of PARTICIPANT_DATA_TABLES) {
        tables[table] = (await pool.query(`SELECT * FROM ${table} WHERE research_id = ? AND participant_id = ?`, [researchId, participantId])).rows as Row[];
    }
    tables.consent_records = (await pool.query(
        'SELECT * FROM consent_records WHERE research_id = ? AND subject_id = ? ORDER BY created_at',
        [researchId, participantId]
    )).rows as Row[];

    if (Object.values(tables).every(rows => rows.length === 0)) {
        throw new Error(`Participant not found: ${participantId} in research ${researchId}`);
    }
    return { researchId, participantId, exportedAt: new Date().toISOString(), tables };
};
