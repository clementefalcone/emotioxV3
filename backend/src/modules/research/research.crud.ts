import pool from '../../config/database';
import cache, { CacheKeys } from '../../config/cache';
import { buildOwnershipClause, ResearchData } from './research.helpers';
import { getMediaPath } from '../../config/local-storage';
import fs from 'fs';
import path from 'path';

export const list = async (userId: string, role?: string) => {
    try {
        console.log('[Research Service] list() called for userId:', userId, 'role:', role);
        const ownership = buildOwnershipClause(userId, role);
        const query = `
        SELECT r.id, r.name, r.description, r.status, r.research_type_id, r.created_by, r.created_at, r.updated_at, r.archived_at,
               rt.name as research_type_name,
               rtech.name as research_technique_name,
               e.name as enterprise_name,
               u.first_name as creator_first_name, u.last_name as creator_last_name, u.email as creator_email
        FROM researches r
        LEFT JOIN research_types rt ON r.research_type_id = rt.id
        LEFT JOIN research_techniques rtech ON r.research_technique_id = rtech.id
        LEFT JOIN enterprises e ON r.enterprise_id = e.id
        LEFT JOIN users u ON r.created_by = u.id
        WHERE ${ownership.clause} AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC
      `;
        console.log('[Research Service] Executing query with userId:', userId);
        const result = await pool.query(query, [...ownership.params]);
        return result.rows.map((research: Record<string, unknown>) => ({
            ...research,
            stages: research.stages || []
        }));
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('[Research Service] Error in list():', {
            userId,
            error: errorMessage,
            stack: errorStack
        });
        throw error;
    }
};

export const listByEnterprise = async (enterpriseId: string, userId: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role);
    const query = `
        SELECT r.id, r.name, r.description, r.status, r.config, r.created_at, r.updated_at,
               r.enterprise_id,
               e.name as enterprise_name,
               rt.name as research_type_name,
               u.first_name as creator_first_name, u.last_name as creator_last_name, u.email as creator_email
        FROM researches r
        LEFT JOIN enterprises e ON e.id = r.enterprise_id
        LEFT JOIN research_types rt ON r.research_type_id = rt.id
        LEFT JOIN users u ON r.created_by = u.id
        WHERE ${ownership.clause} AND r.enterprise_id = ? AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC
    `;
    const result = await pool.query(query, [...ownership.params, enterpriseId]);
    return result.rows.map((row: Record<string, unknown>) => {
        let settings = row.config;
        if (typeof settings === 'string') {
            try { settings = JSON.parse(settings as string); } catch { settings = {}; }
        }
        const { config, ...rest } = row;
        return { ...rest, settings: settings || {} };
    });
};

export const getById = async (researchId: string, userId: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role);
    // MySQL uses 'config' instead of 'settings', map it to 'settings' for frontend compatibility
    const query = `
    SELECT r.id, r.name, r.description, r.status, r.research_type_id, r.research_technique_id, r.created_by, r.config, r.created_at, r.updated_at,
           rt.name as research_type_name,
           rtech.name as research_technique_name,
           rtech.default_stages as technique_default_stages,
           e.name as enterprise_name,
           u.first_name as creator_first_name, u.last_name as creator_last_name, u.email as creator_email
    FROM researches r
    LEFT JOIN research_types rt ON r.research_type_id = rt.id
    LEFT JOIN research_techniques rtech ON r.research_technique_id = rtech.id
    LEFT JOIN enterprises e ON r.enterprise_id = e.id
    LEFT JOIN users u ON r.created_by = u.id
    WHERE r.id = ? AND ${ownership.clause} AND r.deleted_at IS NULL
  `;
    const result = await pool.query(query, [researchId, ...ownership.params]);

    if (result.rows.length === 0) {
        throw new Error('Research not found');
    }

    const rawResearch = result.rows[0] as Record<string, unknown>;
    // Map config to settings for frontend compatibility
    let settings = rawResearch.config;
    if (typeof settings === 'string') {
        try {
            settings = JSON.parse(settings);
        } catch (parseError) {
            console.warn('[Research Service] Failed to parse config JSON in getById:', parseError);
            settings = {};
        }
    }
    // Parse technique_default_stages from MySQL JSON string
    let techniqueDefaultStages = rawResearch.technique_default_stages;
    if (typeof techniqueDefaultStages === 'string') {
        try {
            techniqueDefaultStages = JSON.parse(techniqueDefaultStages);
        } catch {
            techniqueDefaultStages = null;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { config: _cfg, technique_default_stages: _tds, ...researchWithoutConfig } = rawResearch;
    const research = {
        ...researchWithoutConfig,
        settings: settings || {},
        technique_default_stages: techniqueDefaultStages || null,
    } as Record<string, unknown>;

    // Get stages with modules and questions (MySQL-compatible - split into multiple queries)
    // Step 1: Check if stage_type column exists
    const columnCheckQuery = `
      SELECT COUNT(*) as count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stages'
      AND COLUMN_NAME = 'stage_type'
    `;
    const columnCheckResult = await pool.query(columnCheckQuery);
    const hasStageTypeColumn = (columnCheckResult.rows[0] as { count: number }).count > 0;

    // Step 2: Get all stages (with or without stage_type depending on column existence)
    const stagesQuery = hasStageTypeColumn
        ? `SELECT id, name, description, display_order as order_index, stage_type
           FROM stages
           WHERE research_id = ?
           ORDER BY display_order`
        : `SELECT id, name, description, display_order as order_index, 'module_collection' as stage_type
           FROM stages
           WHERE research_id = ?
           ORDER BY display_order`;
    const stagesResult = await pool.query(stagesQuery, [researchId]);

    if (stagesResult.rows.length === 0) {
        research.stages = [];
    } else {
        // Step 2: Get all modules for these stages
        const stageIds = stagesResult.rows.map((s: Record<string, unknown>) => s.id);
        const modulesQuery = `
          SELECT id, stage_id, name, description, order_index, is_from_template, config
          FROM modules
          WHERE stage_id IN (${stageIds.map(() => '?').join(',')})
          ORDER BY order_index
        `;
        const modulesResult = await pool.query(modulesQuery, stageIds);

        // Step 3: Get all questions for these modules
        const moduleIds = modulesResult.rows.map((m: Record<string, unknown>) => m.id);
        let questionsResult: { rows: Array<Record<string, unknown>> } = { rows: [] };
        if (moduleIds.length > 0) {
            const questionsQuery = `
              SELECT id, module_id, question_type, question_text, order_index, config, validation, required
              FROM questions
              WHERE module_id IN (${moduleIds.map(() => '?').join(',')})
              ORDER BY order_index
            `;
            questionsResult = await pool.query(questionsQuery, moduleIds);
        }

        // Group questions by module_id
        const questionsByModule = new Map<string, Array<Record<string, unknown>>>();
        for (const q of questionsResult.rows) {
            const moduleId = q.module_id as string;
            if (!questionsByModule.has(moduleId)) {
                questionsByModule.set(moduleId, []);
            }
            questionsByModule.get(moduleId)!.push(q);
        }

        // Group modules by stage_id
        const modulesByStage = new Map<string, Array<Record<string, unknown>>>();
        for (const m of modulesResult.rows) {
            const stageId = m.stage_id as string;
            if (!modulesByStage.has(stageId)) {
                modulesByStage.set(stageId, []);
            }
            modulesByStage.get(stageId)!.push(m);
        }

        // Assemble the structure
        research.stages = stagesResult.rows.map((stage: Record<string, unknown>) => {
            const stageId = stage.id as string;
            const stageModules = modulesByStage.get(stageId) || [];

            return {
                id: stageId,
                name: stage.name,
                description: stage.description,
                order_index: stage.order_index,
                stage_type: stage.stage_type,
                modules: stageModules.map((mod: Record<string, unknown>) => {
                    const modId = mod.id as string;
                    const modQuestions = questionsByModule.get(modId) || [];

                    // Parse config safely - MySQL may return JSON as string
                    let config = mod.config;
                    if (typeof config === 'string') {
                        try {
                            config = JSON.parse(config);
                        } catch (e) {
                            console.error('Error parsing module config:', e);
                            config = {};
                        }
                    }

                    return {
                        id: modId,
                        name: mod.name,
                        description: mod.description,
                        order_index: mod.order_index,
                        is_from_template: mod.is_from_template,
                        config: config || {},
                        questions: modQuestions.map((q: Record<string, unknown>) => {
                            let qConfig = q.config;
                            let qValidation = q.validation;
                            if (typeof qConfig === 'string') {
                                try { qConfig = JSON.parse(qConfig); } catch (_e) { qConfig = {}; }
                            }
                            if (typeof qValidation === 'string') {
                                try { qValidation = JSON.parse(qValidation); } catch (_e) { qValidation = {}; }
                            }
                            return {
                                id: q.id,
                                type: q.question_type,
                                text: q.question_text,
                                order: q.order_index,
                                config: qConfig,
                                validation: qValidation,
                                required: q.required
                            };
                        })
                    };
                })
            };
        });
    }

    return research;
};

export const update = async (researchId: string, userId: string, data: Partial<ResearchData>, role?: string) => {
    const { name, description, settings } = data;

    // MySQL compatible: use ? placeholders directly
    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
    }
    if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
    }
    if (settings !== undefined) {
        // MySQL uses 'config' instead of 'settings'
        updates.push('config = ?');
        values.push(JSON.stringify(settings));
    }

    if (updates.length === 0) {
        throw new Error('No fields to update');
    }

    const ownership = buildOwnershipClause(userId, role, '');
    values.push(researchId, ...ownership.params);

    const query = `
    UPDATE researches
    SET ${updates.join(', ')}
    WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL
  `;

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
        throw new Error('Research not found');
    }

    // Fetch updated record (MySQL doesn't support RETURNING)
    // Map 'config' to 'settings' for frontend compatibility
    const selectResult = await pool.query(
        'SELECT id, name, description, status, config, updated_at FROM researches WHERE id = ?',
        [researchId]
    );
    const rawResearch = selectResult.rows[0] as Record<string, unknown>;
    // Map config to settings for frontend compatibility
    let parsedSettings = rawResearch.config;
    if (typeof parsedSettings === 'string') {
        try {
            parsedSettings = JSON.parse(parsedSettings);
        } catch (parseError) {
            console.warn('[Research Service] Failed to parse config JSON in update:', parseError);
            parsedSettings = {};
        }
    }
    const { config, ...researchWithoutConfig } = rawResearch;
    return {
        ...researchWithoutConfig,
        settings: parsedSettings || {}
    } as typeof rawResearch & { settings: Record<string, unknown> };
};

export const updateStatus = async (researchId: string, userId: string, status: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role, '');
    // MySQL compatible: no RETURNING clause
    const query = `
    UPDATE researches
    SET status = ?
    WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL
  `;
    const result = await pool.query(query, [status, researchId, ...ownership.params]);

    if (result.rowCount === 0) {
        throw new Error('Research not found');
    }

    // Fetch updated record
    const selectResult = await pool.query(
        'SELECT id, name, status, updated_at FROM researches WHERE id = ?',
        [researchId]
    );
    return selectResult.rows[0];
};

/**
 * Activa una investigación cambiando su estado a 'active'
 * @param researchId - ID de la investigación
 * @param userId - ID del usuario propietario
 * @returns Investigación actualizada
 */
export const activate = async (researchId: string, userId: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role, '');
    // MySQL compatible: no RETURNING clause
    const query = `
    UPDATE researches
    SET status = 'active', updated_at = NOW()
    WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL
  `;
    const result = await pool.query(query, [researchId, ...ownership.params]);

    if (result.rowCount === 0) {
        throw new Error('Research not found');
    }

    // Invalidate public cache for this research
    cache.delete(`${CacheKeys.PUBLIC_RESEARCH}:${researchId}`);

    // Fetch updated record
    const selectResult = await pool.query(
        'SELECT id, name, status, updated_at FROM researches WHERE id = ?',
        [researchId]
    );
    return selectResult.rows[0];
};

/**
 * Collect all media s3Key paths referenced by a research (modules + settings).
 */
const collectResearchMediaPaths = async (researchId: string): Promise<string[]> => {
    const paths: string[] = [];

    // 1. From module configs (file-upload components with s3Key)
    const modulesResult = await pool.query(
        `SELECT m.config FROM modules m
         JOIN stages s ON m.stage_id = s.id
         WHERE s.research_id = ?`,
        [researchId]
    );
    for (const row of modulesResult.rows) {
        const configStr = typeof row.config === 'string' ? row.config : JSON.stringify(row.config);
        // Extract all s3Key values from JSON
        const matches = configStr.matchAll(/"s3Key"\s*:\s*"([^"]+)"/g);
        for (const m of matches) paths.push(m[1]);
    }

    // 2. From research settings (stimuli array with s3Key/url)
    const researchResult = await pool.query(
        'SELECT config FROM researches WHERE id = ?',
        [researchId]
    );
    if (researchResult.rows[0]?.config) {
        const configStr = typeof researchResult.rows[0].config === 'string'
            ? researchResult.rows[0].config
            : JSON.stringify(researchResult.rows[0].config);
        const matches = configStr.matchAll(/"s3Key"\s*:\s*"([^"]+)"/g);
        for (const m of matches) paths.push(m[1]);
    }

    // Deduplicate
    return [...new Set(paths)];
};

/**
 * Check if a media path is referenced by any OTHER active research.
 */
const isMediaPathReferencedElsewhere = async (mediaPath: string, excludeResearchId: string): Promise<boolean> => {
    // Escape for LIKE query
    const escaped = mediaPath.replace(/%/g, '\\%').replace(/_/g, '\\_');

    // Check module configs of active researches
    const moduleCheck = await pool.query(
        `SELECT 1 FROM modules m
         JOIN stages s ON m.stage_id = s.id
         JOIN researches r ON s.research_id = r.id
         WHERE r.deleted_at IS NULL AND r.id != ?
         AND m.config LIKE ?
         LIMIT 1`,
        [excludeResearchId, `%${escaped}%`]
    );
    if (moduleCheck.rows.length > 0) return true;

    // Check research settings of active researches
    const settingsCheck = await pool.query(
        `SELECT 1 FROM researches
         WHERE deleted_at IS NULL AND id != ?
         AND config LIKE ?
         LIMIT 1`,
        [excludeResearchId, `%${escaped}%`]
    );
    if (settingsCheck.rows.length > 0) return true;

    // Check responses of active researches
    const responseCheck = await pool.query(
        `SELECT 1 FROM responses r
         JOIN researches res ON r.research_id = res.id
         WHERE res.deleted_at IS NULL AND r.research_id != ?
         AND r.value LIKE ?
         LIMIT 1`,
        [excludeResearchId, `%${escaped}%`]
    );
    return responseCheck.rows.length > 0;
};

/**
 * Safely move orphaned media files to _trash/ instead of deleting.
 * Only moves files that:
 *   1. Are NOT referenced by any other active research
 *   2. Belong to this research's own directory (path starts with research/{id}/)
 * Files in _trash/ can be purged manually after verification.
 */
const cleanupResearchMedia = async (researchId: string): Promise<{ moved: number; skipped: number }> => {
    let moved = 0;
    let skipped = 0;

    try {
        const mediaPaths = await collectResearchMediaPaths(researchId);
        const expectedPrefix = `research/${researchId}/`;

        for (const mediaPath of mediaPaths) {
            try {
                // Safety: only touch files inside this research's own directory
                if (!mediaPath.startsWith(expectedPrefix)) {
                    console.warn(`[deleteResearch] Skipping cross-research media path: ${mediaPath}`);
                    skipped++;
                    continue;
                }

                const isReferenced = await isMediaPathReferencedElsewhere(mediaPath, researchId);
                if (isReferenced) {
                    console.log(`[deleteResearch] Preserving shared file: ${mediaPath}`);
                    skipped++;
                    continue;
                }

                const fullPath = getMediaPath(mediaPath);
                if (!fs.existsSync(fullPath)) continue;

                // Move to _trash/ preserving path structure
                const trashPath = getMediaPath(`_trash/${mediaPath}`);
                const trashDir = path.dirname(trashPath);
                if (!fs.existsSync(trashDir)) {
                    fs.mkdirSync(trashDir, { recursive: true });
                }
                fs.renameSync(fullPath, trashPath);
                moved++;
            } catch (err) {
                console.error(`[deleteResearch] Failed to move ${mediaPath}:`, err);
                skipped++;
            }
        }

        // Remove research directory if empty
        try {
            const dirPath = getMediaPath(`research/${researchId}`);
            if (fs.existsSync(dirPath)) {
                const remaining = fs.readdirSync(dirPath);
                if (remaining.length === 0) {
                    fs.rmdirSync(dirPath);
                }
            }
        } catch { /* directory not empty or doesn't exist */ }
    } catch (err) {
        console.error(`[deleteResearch] Media cleanup failed for ${researchId}:`, err);
    }

    return { moved, skipped };
};

export const deleteResearch = async (researchId: string, userId: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role, '');
    // MySQL compatible: no RETURNING clause
    // Note: MySQL CHECK constraint only allows: 'draft','active','paused','completed','archived'
    // We use 'archived' instead of 'deleted' to comply with the constraint
    // The deleted_at timestamp is the actual indicator of deletion
    const query = `
    UPDATE researches
    SET deleted_at = NOW(), status = 'archived'
    WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL
  `;
    const result = await pool.query(query, [researchId, ...ownership.params]);

    if (result.rowCount === 0) {
        throw new Error('Research not found');
    }

    // Invalidate public cache for this research
    cache.delete(`${CacheKeys.PUBLIC_RESEARCH}:${researchId}`);

    // Move orphaned media files to _trash/ (best-effort, recoverable)
    const cleanup = await cleanupResearchMedia(researchId);
    console.log(`[deleteResearch] Media cleanup for ${researchId}: ${cleanup.moved} moved to _trash/, ${cleanup.skipped} preserved (referenced elsewhere)`);

    return { message: 'Research deleted successfully' };
};
