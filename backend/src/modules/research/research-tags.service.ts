import pool from '../../config/database';

export interface ResearchTag {
    id: string;
    researchId: string;
    tag: string;
    createdAt: string;
}

export const getTagsForResearch = async (researchId: string): Promise<string[]> => {
    const result = await pool.query(
        'SELECT tag FROM research_tags WHERE research_id = ? ORDER BY tag ASC',
        [researchId]
    );
    return result.rows.map((r) => (r as { tag: string }).tag);
};

export const addTag = async (researchId: string, tag: string): Promise<void> => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    await pool.query(
        'INSERT IGNORE INTO research_tags (research_id, tag) VALUES (?, ?)',
        [researchId, trimmed]
    );
};

export const removeTag = async (researchId: string, tag: string): Promise<void> => {
    await pool.query(
        'DELETE FROM research_tags WHERE research_id = ? AND tag = ?',
        [researchId, tag.trim().toLowerCase()]
    );
};

export const archiveResearch = async (researchId: string): Promise<void> => {
    await pool.query(
        'UPDATE researches SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL',
        [researchId]
    );
};

export const unarchiveResearch = async (researchId: string): Promise<void> => {
    await pool.query(
        'UPDATE researches SET archived_at = NULL WHERE id = ?',
        [researchId]
    );
};
