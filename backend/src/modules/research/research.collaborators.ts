import pool from '../../config/database';

// ── Research Collaborators ──────────────────────────────────────────────

export const listCollaborators = async (researchId: string) => {
    const result = await pool.query(
        `SELECT rc.id, rc.permission, rc.created_at,
                u.id as user_id, u.email, u.first_name, u.last_name
         FROM research_collaborators rc
         JOIN users u ON rc.user_id = u.id
         WHERE rc.research_id = ? AND u.deleted_at IS NULL
         ORDER BY rc.created_at DESC`,
        [researchId]
    );
    return result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.email,
        firstName: row.first_name || null,
        lastName: row.last_name || null,
        permission: row.permission,
        createdAt: row.created_at,
    }));
};

export const COLLABORATOR_PERMISSIONS = ['viewer', 'editor'];

export const addCollaborator = async (researchId: string, email: string, invitedBy: string, permission: string) => {
    // Find the user by email
    const userResult = await pool.query(
        'SELECT id, email, first_name, last_name FROM users WHERE email = ? AND deleted_at IS NULL',
        [email]
    );
    if (userResult.rows.length === 0) {
        throw new Error('User not found. They must have an EmotioX account first.');
    }
    const targetUser = userResult.rows[0];

    // Cannot add the owner as collaborator
    const researchResult = await pool.query(
        'SELECT created_by FROM researches WHERE id = ?',
        [researchId]
    );
    if (researchResult.rows.length > 0 && researchResult.rows[0].created_by === targetUser.id) {
        throw new Error('Cannot add the research owner as a collaborator');
    }

    // Check if already a collaborator
    const existing = await pool.query(
        'SELECT id FROM research_collaborators WHERE research_id = ? AND user_id = ?',
        [researchId, targetUser.id]
    );
    if (existing.rows.length > 0) {
        throw new Error('User is already a collaborator on this research');
    }

    const id = crypto.randomUUID();
    await pool.query(
        'INSERT INTO research_collaborators (id, research_id, user_id, permission, invited_by) VALUES (?, ?, ?, ?, ?)',
        [id, researchId, targetUser.id, permission, invitedBy]
    );

    return {
        id,
        userId: targetUser.id,
        email: targetUser.email,
        firstName: targetUser.first_name || null,
        lastName: targetUser.last_name || null,
        permission,
    };
};

export const removeCollaborator = async (collaboratorId: string, researchId: string) => {
    const result = await pool.query(
        'DELETE FROM research_collaborators WHERE id = ? AND research_id = ?',
        [collaboratorId, researchId]
    );
    if (result.rowCount === 0) {
        throw new Error('Collaborator not found');
    }
};
