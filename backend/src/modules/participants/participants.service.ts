import pool from '../../config/database';
import { sendInvitation, SendResult } from '../email/email.service';

// --- Types ---

export interface Participant {
  id: string;
  research_id: string;
  participant_id: string;
  email: string | null;
  name: string | null;
  external_id: string | null;
  status: 'pending' | 'responded' | 'disqualified' | 'overquota';
  invited_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRow {
  email?: string;
  name?: string;
  externalId?: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  participants: Participant[];
}

// --- Service ---

/**
 * Lists all participants for a research.
 */
export const listByResearch = async (researchId: string): Promise<Participant[]> => {
  const query = `
    SELECT id, research_id, participant_id, email, name, external_id, status,
           invited_at, responded_at, created_at, updated_at
    FROM participants
    WHERE research_id = ?
    ORDER BY created_at ASC
  `;
  const result = await pool.query(query, [researchId]);
  return result.rows as Participant[];
};

/**
 * Imports participants from parsed CSV rows.
 * Generates participant_id as `panel-N` (incremental per research).
 * Skips duplicates by email within the same research.
 */
export const importParticipants = async (
  researchId: string,
  rows: ImportRow[]
): Promise<ImportResult> => {
  // Validate research exists
  const researchQuery = `SELECT id FROM researches WHERE id = ? AND deleted_at IS NULL`;
  const researchResult = await pool.query(researchQuery, [researchId]);
  if (researchResult.rows.length === 0) {
    throw new Error('Research not found');
  }

  // Get existing participants to skip duplicates
  const existingQuery = `
    SELECT email, participant_id FROM participants WHERE research_id = ?
  `;
  const existingResult = await pool.query(existingQuery, [researchId]);
  const existingEmails = new Set(
    (existingResult.rows as Array<{ email: string | null }>)
      .map(r => r.email?.toLowerCase())
      .filter((e): e is string => !!e)
  );

  // Get max panel-N number for incremental IDs
  const maxIdQuery = `
    SELECT participant_id FROM participants
    WHERE research_id = ? AND participant_id LIKE 'panel-%'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const maxIdResult = await pool.query(maxIdQuery, [researchId]);
  let nextNumber = 1;
  if (maxIdResult.rows.length > 0) {
    const lastId = (maxIdResult.rows[0] as { participant_id: string }).participant_id;
    const num = Number.parseInt(lastId.replace('panel-', ''), 10);
    if (!Number.isNaN(num)) nextNumber = num + 1;
  }

  const imported: Participant[] = [];
  const skipped: number[] = [];
  const errors: string[] = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Validate: at least email or name
      if (!row.email && !row.name) {
        errors.push(`Row ${i + 1}: missing email and name`);
        continue;
      }

      // Skip duplicate emails
      if (row.email && existingEmails.has(row.email.toLowerCase())) {
        skipped.push(i + 1);
        continue;
      }

      const participantId = row.externalId || `panel-${nextNumber}`;
      nextNumber++;

      const id = crypto.randomUUID();
      const insertQuery = `
        INSERT INTO participants (id, research_id, participant_id, email, name, external_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())
      `;
      await client.query(insertQuery, [
        id,
        researchId,
        participantId,
        row.email || null,
        row.name || null,
        row.externalId || null,
      ]);

      if (row.email) {
        existingEmails.add(row.email.toLowerCase());
      }

      imported.push({
        id,
        research_id: researchId,
        participant_id: participantId,
        email: row.email || null,
        name: row.name || null,
        external_id: row.externalId || null,
        status: 'pending',
        invited_at: null,
        responded_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (skipped.length > 0) {
    errors.push(`Skipped ${skipped.length} duplicate(s) by email`);
  }

  return {
    imported: imported.length,
    skipped: skipped.length,
    errors,
    participants: imported,
  };
};

/**
 * Deletes a single participant by ID.
 */
export const deleteParticipant = async (researchId: string, participantDbId: string): Promise<boolean> => {
  const query = `DELETE FROM participants WHERE id = ? AND research_id = ?`;
  const result = await pool.query(query, [participantDbId, researchId]);
  return (result.rowCount ?? 0) > 0;
};

/**
 * Deletes all participants for a research.
 */
export const deleteAllByResearch = async (researchId: string): Promise<number> => {
  const query = `DELETE FROM participants WHERE research_id = ?`;
  const result = await pool.query(query, [researchId]);
  return result.rowCount ?? 0;
};

/**
 * Updates a participant's status. Called when responses are saved.
 */
export const updateStatus = async (
  researchId: string,
  participantId: string,
  status: 'responded' | 'disqualified' | 'overquota'
): Promise<void> => {
  const updateFields = status === 'responded'
    ? `status = ?, responded_at = NOW()`
    : `status = ?`;

  const query = `
    UPDATE participants
    SET ${updateFields}, updated_at = NOW()
    WHERE research_id = ? AND participant_id = ?
  `;
  await pool.query(query, [status, researchId, participantId]);
};

// --- Email sending ---

interface SendEmailsParams {
  researchId: string;
  baseUrl: string; // e.g. "https://emotio.cx/participant/#/research/UUID"
  researchName: string;
}

/**
 * Sends invitation emails to all pending participants with email.
 * Updates invited_at on success. Does not stop on individual failures.
 */
export const sendEmailsToAll = async (params: SendEmailsParams): Promise<{
  sent: number;
  failed: number;
  results: SendResult[];
}> => {
  const query = `
    SELECT id, participant_id, email, name
    FROM participants
    WHERE research_id = ? AND email IS NOT NULL AND email != '' AND status = 'pending'
    ORDER BY created_at ASC
  `;
  const result = await pool.query(query, [params.researchId]);
  const participants = result.rows as Array<{ id: string; participant_id: string; email: string; name: string | null }>;

  if (participants.length === 0) {
    return { sent: 0, failed: 0, results: [] };
  }

  const results: SendResult[] = [];
  for (const p of participants) {
    const participantUrl = `${params.baseUrl}?participantId=${encodeURIComponent(p.participant_id)}`;
    const sendResult = await sendInvitation({
      to: p.email,
      participantName: p.name,
      participantId: p.participant_id,
      participantUrl,
      researchName: params.researchName,
    });
    results.push(sendResult);

    if (sendResult.success) {
      await pool.query(
        `UPDATE participants SET invited_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [p.id]
      );
    }
  }

  return {
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
};

/**
 * Sends invitation email to a single participant by DB id.
 */
export const sendEmailToOne = async (
  researchId: string,
  participantDbId: string,
  params: Omit<SendEmailsParams, 'researchId'>
): Promise<SendResult> => {
  const query = `
    SELECT id, participant_id, email, name
    FROM participants
    WHERE id = ? AND research_id = ?
  `;
  const result = await pool.query(query, [participantDbId, researchId]);
  const rows = result.rows as Array<{ id: string; participant_id: string; email: string | null; name: string | null }>;

  if (rows.length === 0) {
    return { participantId: '', email: '', success: false, error: 'Participant not found' };
  }

  const p = rows[0];
  if (!p.email) {
    return { participantId: p.participant_id, email: '', success: false, error: 'Participant has no email' };
  }

  const participantUrl = `${params.baseUrl}?participantId=${encodeURIComponent(p.participant_id)}`;
  const sendResult = await sendInvitation({
    to: p.email,
    participantName: p.name,
    participantId: p.participant_id,
    participantUrl,
    researchName: params.researchName,
  });

  if (sendResult.success) {
    await pool.query(
      `UPDATE participants SET invited_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [p.id]
    );
  }

  return sendResult;
};
