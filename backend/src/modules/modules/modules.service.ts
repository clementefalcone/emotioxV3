import pool from '../../config/database';

export const create = async (researchId: string, data: Record<string, unknown>) => {
    const { name, description, order_index, config = {}, stage_id } = data;

    // Check if research exists and is not deleted
    const researchCheck = await pool.query('SELECT id FROM researches WHERE id = ? AND deleted_at IS NULL', [researchId]);
    if (researchCheck.rows.length === 0) {
        throw new Error('Research not found or deleted');
    }

    // MySQL compatible: pre-generate UUID and no RETURNING
    const moduleId = crypto.randomUUID();
    const query = `
    INSERT INTO modules (id, research_id, stage_id, name, description, order_index, config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
    await pool.query(query, [moduleId, researchId, stage_id || null, name, description, order_index, JSON.stringify(config)]);
    
    // Fetch created record
    const selectResult = await pool.query(
        'SELECT id, research_id, name, description, order_index, is_from_template, config, created_at FROM modules WHERE id = ?',
        [moduleId]
    );
    return selectResult.rows[0];
};

export const getById = async (moduleId: string) => {
    const result = await pool.query('SELECT * FROM modules WHERE id = ?', [moduleId]);
    return result.rows[0];
};

export const update = async (moduleId: string, data: Record<string, unknown>) => {
    const { name, description, config, order, order_index } = data;
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // MySQL compatible: use ? placeholders
    if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
    }
    if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
    }
    if (config !== undefined) {
        updates.push('config = ?');
        values.push(JSON.stringify(config));
    }
    if (order !== undefined || order_index !== undefined) {
        updates.push('order_index = ?');
        values.push(order !== undefined ? order : order_index);
    }

    if (updates.length === 0) throw new Error('No fields to update');

    values.push(moduleId);
    const query = `UPDATE modules SET ${updates.join(', ')} WHERE id = ?`;
    const result = await pool.query(query, values);
    if (result.rowCount === 0) throw new Error('Module not found');
    
    // Fetch updated record (MySQL doesn't support RETURNING)
    const selectResult = await pool.query('SELECT * FROM modules WHERE id = ?', [moduleId]);
    const updatedModule = selectResult.rows[0];

    if (updatedModule.name === 'Research Configuration' && config !== undefined) {
        const parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
        if (parsedConfig.demographics) {
            const { syncQuotasFromConfig } = await import('../quotas/quota.service');
            await syncQuotasFromConfig(updatedModule.research_id, parsedConfig.demographics);
        }
    }

    return updatedModule;
};

export const deleteModule = async (moduleId: string) => {
    // MySQL compatible: no RETURNING clause
    const query = `DELETE FROM modules WHERE id = ?`;
    const result = await pool.query(query, [moduleId]);
    if (result.rowCount === 0) throw new Error('Module not found');
    return { message: 'Module deleted successfully' };
};

export const reorder = async (researchId: string, moduleOrders: { id: string; order: number }[]) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const { id, order } of moduleOrders) {
            await client.query('UPDATE modules SET order_index = ? WHERE id = ? AND research_id = ?', [order, id, researchId]);
        }
        await client.query('COMMIT');
        return { message: 'Modules reordered successfully' };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
