import pool from '../../config/database';
import { buildOwnershipClause } from './research.helpers';
import { createStageFromTemplateInternal } from './research.create';

/**
 * Crea un nuevo stage en un research
 * @param researchId - ID del research
 * @param userId - ID del usuario
 * @param stageName - Nombre del stage
 * @param description - Descripción opcional del stage
 * @returns Stage creado
 */
export const createStage = async (researchId: string, userId: string, stageName: string, description?: string, role?: string, defaultModuleName?: string) => {
    const client = await pool.connect();
    const ownership = buildOwnershipClause(userId, role, '', 'write');

    try {
        await client.query('BEGIN');

        // Verificar que el research existe y pertenece al usuario (admin bypasses)
        const researchCheck = await client.query(
            `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
            [researchId, ...ownership.params]
        );

        if (researchCheck.rows.length === 0) {
            throw new Error('Research not found');
        }

        // Obtener el máximo display_order para este research (MySQL: stages uses display_order)
        const maxOrderResult = await client.query(
            'SELECT COALESCE(MAX(display_order), 0) as max_order FROM stages WHERE research_id = ?',
            [researchId]
        );
        const nextOrder = (maxOrderResult.rows[0].max_order || 0) + 1;

        // Buscar el stage_template para obtener el stage_type y módulos asociados
        const templateResult = await client.query(
            'SELECT id, type as stage_type FROM stage_templates WHERE name = ? AND is_active = true',
            [stageName]
        );

        let stageType: 'single_module' | 'module_collection' = 'module_collection';
        let stageTemplateId: string | null = null;
        let modulesToClone: Array<{ id: string; name: string; description: string; structure: Record<string, unknown>; display_order: number }> = [];

        if (templateResult.rows.length > 0) {
            stageTemplateId = templateResult.rows[0].id;
            stageType = templateResult.rows[0].stage_type || 'module_collection';

            // Obtener módulos asociados al stage template.
            // Para Implicit Association, solo auto-crear el módulo seleccionado por el usuario (defaultModuleName).
            // Si no se especifica, usa display_order=0 (Attribute Testing por defecto).
            const isImplicitAssociation = stageName === 'Implicit Association';
            let iatFilter = '';
            const queryParams: unknown[] = [stageTemplateId];
            if (isImplicitAssociation) {
                if (defaultModuleName) {
                    iatFilter = ' AND mt.name = ?';
                    queryParams.push(defaultModuleName);
                } else {
                    iatFilter = ' AND stmt.display_order = 0';
                }
            }
            const modulesResult = await client.query(
                `SELECT mt.id, mt.name, mt.description, mt.structure, stmt.display_order
                 FROM stage_templates_module_templates stmt
                 JOIN module_templates mt ON stmt.module_template_id = mt.id
                 WHERE stmt.stage_template_id = ? AND mt.is_active = true${iatFilter}
                 ORDER BY stmt.display_order`,
                queryParams
            );
            modulesToClone = modulesResult.rows as Array<{ id: string; name: string; description: string; structure: Record<string, unknown>; display_order: number }>;
        }

        // Crear el stage con el stage_type del template (MySQL compatible - pre-generate UUID)
        const newStageId = crypto.randomUUID();
        const stageQuery = `
            INSERT INTO stages (id, research_id, name, description, display_order, stage_type)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await client.query(stageQuery, [
            newStageId,
            researchId,
            stageName,
            description || null,
            nextOrder,
            stageType
        ]);
        const newStage = { id: newStageId };

        // Si hay módulos asociados, clonarlos
        if (modulesToClone.length > 0) {
            for (const templateModule of modulesToClone) {
                // Parse structure si es string, o usar directamente si es objeto
                let structure = templateModule.structure;

                // Si es string, parsearlo
                if (typeof structure === 'string') {
                    try {
                        structure = JSON.parse(structure);
                    } catch (e) {
                        console.error(`Error parsing structure for module "${templateModule.name}":`, e);
                        structure = {};
                    }
                }

                // Si no es un objeto válido, usar objeto vacío
                if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
                    structure = {};
                }

                // El config debe tener la estructura { structure: { components: [...] } }
                // para que el frontend lo encuentre correctamente
                const config = {
                    structure: structure
                };

                // MySQL compatible - pre-generate UUID (no RETURNING support)
                const newModuleId = crypto.randomUUID();
                const moduleQuery = `
                    INSERT INTO modules (id, research_id, stage_id, name, description, order_index, is_from_template, config)
                    VALUES (?, ?, ?, ?, ?, ?, true, ?)
                `;
                await client.query(moduleQuery, [
                    newModuleId,
                    researchId,
                    newStage.id,
                    templateModule.name,
                    templateModule.description,
                    templateModule.display_order,
                    JSON.stringify(config),
                ]);

                console.log(`✓ Created module "${templateModule.name}" for stage "${stageName}"`);
            }
        } else {
            console.log(`⚠️  No modules found for stage template "${stageName}"`);
        }

        await client.query('COMMIT');
        return newStage;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Elimina un stage de un research
 * @param researchId - ID del research
 * @param userId - ID del usuario
 * @param stageId - ID del stage a eliminar
 * @returns Mensaje de confirmación
 */
export const deleteStage = async (researchId: string, userId: string, stageId: string, role?: string) => {
    const client = await pool.connect();
    const ownership = buildOwnershipClause(userId, role, '', 'write');

    try {
        await client.query('BEGIN');

        console.log('[ResearchService] Starting stage deletion:', { researchId, userId, stageId });

        // Verificar que el research existe y pertenece al usuario (admin bypasses)
        const researchCheck = await client.query(
            `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
            [researchId, ...ownership.params]
        );

        if (researchCheck.rows.length === 0) {
            console.error('[ResearchService] Research not found:', { researchId, userId });
            throw new Error('Research not found');
        }

        // Verificar que el stage existe y pertenece al research
        const stageCheck = await client.query(
            'SELECT id, name FROM stages WHERE id = ? AND research_id = ?',
            [stageId, researchId]
        );

        if (stageCheck.rows.length === 0) {
            console.error('[ResearchService] Stage not found:', { stageId, researchId });
            throw new Error('Stage not found');
        }

        const stageName = stageCheck.rows[0].name;
        console.log('[ResearchService] Stage found:', { stageId, stageName });

        // Verificar si hay módulos asociados (para logging)
        const modulesCheck = await client.query(
            'SELECT COUNT(*) as count FROM modules WHERE stage_id = ?',
            [stageId]
        );
        const moduleCount = parseInt(modulesCheck.rows[0].count || '0', 10);
        console.log('[ResearchService] Modules to detach from stage:', { stageId, moduleCount });

        // Detach modules from stage (set stage_id = NULL) to prevent orphans
        if (moduleCount > 0) {
            await client.query('UPDATE modules SET stage_id = NULL WHERE stage_id = ?', [stageId]);
            console.log('[ResearchService] Detached', moduleCount, 'modules from stage', stageId);
        }

        // Delete the stage
        const deleteResult = await client.query('DELETE FROM stages WHERE id = ?', [stageId]);

        if (deleteResult.rowCount === 0) {
            console.error('[ResearchService] No rows deleted:', { stageId });
            throw new Error('Failed to delete stage: no rows affected');
        }

        await client.query('COMMIT');
        console.log('[ResearchService] Stage deleted successfully:', { stageId, stageName, moduleCount });
        return { message: 'Stage deleted successfully' };
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('[ResearchService] Error deleting stage:', {
            researchId,
            userId,
            stageId,
            error: errorMessage,
            stack: errorStack
        });

        // Re-throw with more context if it's a database error
        if (error instanceof Error) {
            // Check for common database errors
            if (errorMessage.includes('foreign key') || errorMessage.includes('constraint')) {
                throw new Error(`Cannot delete stage: database constraint violation - ${errorMessage}`);
            }
            if (errorMessage.includes('violates foreign key')) {
                throw new Error('Cannot delete stage: it has dependencies that prevent deletion');
            }
        }

        throw error;
    } finally {
        client.release();
    }
};

/**
 * Actualiza el order_index de múltiples módulos en un stage
 * @param stageId - ID del stage
 * @param userId - ID del usuario
 * @param updates - Array de {moduleId, order_index}
 * @returns Mensaje de confirmación
 */
export const updateModulesOrderInStage = async (
    stageId: string,
    userId: string,
    updates: Array<{ moduleId: string; order_index: number }>,
    role?: string
): Promise<{ message: string }> => {
    const client = await pool.connect();
    const ownership = buildOwnershipClause(userId, role, '', 'write');
    console.log(`[updateModulesOrderInStage] Attempting to update order for ${updates.length} modules in stage ${stageId} by user ${userId}`);

    try {
        await client.query('BEGIN');

        // Verificar que el stage existe y obtener el research_id
        const stageCheck = await client.query(
            'SELECT id, research_id FROM stages WHERE id = ?',
            [stageId]
        );
        if (stageCheck.rows.length === 0) {
            console.warn(`[updateModulesOrderInStage] Stage ${stageId} not found`);
            throw new Error('Stage not found');
        }

        const researchId = stageCheck.rows[0].research_id;

        // Verificar que el research existe y pertenece al usuario (admin bypasses)
        const researchCheck = await client.query(
            `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
            [researchId, ...ownership.params]
        );
        if (researchCheck.rows.length === 0) {
            console.warn(`[updateModulesOrderInStage] Research ${researchId} not found or not owned by user ${userId}`);
            throw new Error('Research not found');
        }

        // Verificar que todos los módulos pertenecen al stage
        const moduleIds = updates.map(u => u.moduleId);
        // MySQL compatible: use IN with dynamic placeholders instead of ANY($1)
        const modulesCheck = await client.query(
            `SELECT id FROM modules WHERE id IN (${moduleIds.map(() => '?').join(',')}) AND stage_id = ?`,
            [...moduleIds, stageId]
        );
        if (modulesCheck.rows.length !== moduleIds.length) {
            console.warn(`[updateModulesOrderInStage] Some modules do not belong to stage ${stageId}`);
            throw new Error('One or more modules not found in this stage');
        }

        // Actualizar el order_index de cada módulo
        for (const { moduleId, order_index } of updates) {
            await client.query(
                'UPDATE modules SET order_index = ? WHERE id = ? AND stage_id = ?',
                [order_index, moduleId, stageId]
            );
            console.log(`[updateModulesOrderInStage] Updated module ${moduleId} to order_index ${order_index}`);
        }

        await client.query('COMMIT');
        console.log(`[updateModulesOrderInStage] Successfully updated order for ${updates.length} modules in stage ${stageId}`);
        return { message: 'Modules order updated successfully' };
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error(`[updateModulesOrderInStage] Transaction rolled back due to error: ${error.message}`, error);
        throw error;
    } finally {
        client.release();
    }
};

export const reorderStages = async (
    researchId: string,
    userId: string,
    updates: Array<{ stageId: string; display_order: number }>,
    role?: string
): Promise<{ message: string }> => {
    const client = await pool.connect();
    const ownership = buildOwnershipClause(userId, role, '', 'write');

    try {
        await client.query('BEGIN');

        const researchCheck = await client.query(
            `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
            [researchId, ...ownership.params]
        );
        if (researchCheck.rows.length === 0) {
            throw new Error('Research not found');
        }

        const stageIds = updates.map(u => u.stageId);
        const stagesCheck = await client.query(
            `SELECT id FROM stages WHERE id IN (${stageIds.map(() => '?').join(',')}) AND research_id = ?`,
            [...stageIds, researchId]
        );
        if (stagesCheck.rows.length !== stageIds.length) {
            throw new Error('One or more stages not found in this research');
        }

        for (const { stageId, display_order } of updates) {
            await client.query(
                'UPDATE stages SET display_order = ? WHERE id = ? AND research_id = ?',
                [display_order, stageId, researchId]
            );
        }

        await client.query('COMMIT');
        return { message: 'Stages order updated successfully' };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Elimina un módulo de un research
 * @param researchId - ID del research
 * @param userId - ID del usuario
 * @param moduleId - ID del módulo a eliminar
 * @returns Mensaje de confirmación
 */
export const deleteModule = async (researchId: string, userId: string, moduleId: string, role?: string) => {
    const client = await pool.connect();
    const ownership = buildOwnershipClause(userId, role, '', 'write');

    try {
        await client.query('BEGIN');

        // Verificar que el research existe y pertenece al usuario (admin bypasses)
        const researchCheck = await client.query(
            `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
            [researchId, ...ownership.params]
        );

        if (researchCheck.rows.length === 0) {
            throw new Error('Research not found');
        }

        // Verificar que el módulo existe y pertenece al research
        const moduleCheck = await client.query(
            'SELECT id FROM modules WHERE id = ? AND research_id = ?',
            [moduleId, researchId]
        );

        if (moduleCheck.rows.length === 0) {
            throw new Error('Module not found');
        }

        // Eliminar el módulo (CASCADE eliminará automáticamente las questions asociadas)
        await client.query('DELETE FROM modules WHERE id = ?', [moduleId]);

        await client.query('COMMIT');
        return { message: 'Module deleted successfully' };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Adds Welcome Screen and Thank You Screen to an existing research if they don't exist
 * @param researchId - ID of the research
 * @param userId - ID of the user
 * @returns Object with information about what was added
 */
export const addWelcomeAndThankYouStages = async (researchId: string, userId: string, role?: string): Promise<{ added: string[]; alreadyExists: string[] }> => {
    const client = await pool.connect();
    const ownership = buildOwnershipClause(userId, role, '', 'write');

    try {
        await client.query('BEGIN');

        // Verify that the research exists and belongs to the user (admin bypasses)
        const researchCheck = await client.query(
            `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
            [researchId, ...ownership.params]
        );

        if (researchCheck.rows.length === 0) {
            throw new Error('Research not found');
        }

        const added: string[] = [];
        const alreadyExists: string[] = [];

        // Check and add Welcome Screen
        // Check by STAGE name first (more reliable), then by module name as fallback
        const welcomeCheck = await client.query(
            `SELECT s.id FROM stages s
             WHERE s.research_id = ? AND s.name = 'Welcome Screen'
             UNION
             SELECT s.id FROM stages s
             JOIN modules m ON m.stage_id = s.id
             WHERE s.research_id = ? AND m.name = 'Welcome Screen'`,
            [researchId, researchId]
        );

        if (welcomeCheck.rows.length === 0) {
            await createStageFromTemplateInternal(client, researchId, 'Welcome Screen');
            added.push('Welcome Screen');
        } else {
            alreadyExists.push('Welcome Screen');
        }

        // Check and add Thank You Screen
        // Check by STAGE name first (more reliable), then by module name as fallback
        const thankYouCheck = await client.query(
            `SELECT s.id FROM stages s
             WHERE s.research_id = ? AND s.name = 'Thank You Screen'
             UNION
             SELECT s.id FROM stages s
             JOIN modules m ON m.stage_id = s.id
             WHERE s.research_id = ? AND m.name = 'Thank You Screen'`,
            [researchId, researchId]
        );

        if (thankYouCheck.rows.length === 0) {
            await createStageFromTemplateInternal(client, researchId, 'Thank You Screen');
            added.push('Thank You Screen');
        } else {
            alreadyExists.push('Thank You Screen');
        }

        await client.query('COMMIT');
        return { added, alreadyExists };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Research Service] Error adding Welcome/Thank You stages:', error);
        throw error;
    } finally {
        client.release();
    }
};
