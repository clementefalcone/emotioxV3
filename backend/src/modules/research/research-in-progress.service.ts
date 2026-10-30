import pool from '../../config/database';
import { buildOwnershipClause } from './research.helpers';

interface ProgressComponent {
    id?: string;
    type?: string;
    value?: unknown;
    settings?: Record<string, unknown>;
    placeholder?: { text?: string };
    hidden?: boolean;
    config?: { hidden?: boolean };
}

interface ProgressModuleConfig {
    structure?: {
        components?: ProgressComponent[];
    };
    components?: ProgressComponent[];
    hidden?: boolean;
}

interface ProgressModuleRow {
    id: string;
    name: string;
    config: unknown;
}

/**
 * Checks whether a module has been configured with content by the researcher.
 * Mirrors participant-frontend's isModuleConfigured logic so the backend
 * denominator matches what participants actually see.
 */
const isModuleConfiguredForProgress = (name: string, components: ProgressComponent[]): boolean => {
    const trimmed = name.trim();

    // SmartVOC modules are always considered configured
    const smartVOCNames = ['CSAT', 'NPS', 'CES', 'CV', 'NEV', 'VOC'];
    if (smartVOCNames.some(n => trimmed.includes(n))) return true;

    // Navigation Flow / Preference Test: require file-upload with images
    if (trimmed === 'Navigation Flow' || trimmed === 'Preference Test') {
        const fileUpload = components.find(c => c.type === 'file-upload');
        if (!fileUpload?.value) return false;
        try {
            const parsed = typeof fileUpload.value === 'string'
                ? JSON.parse(fileUpload.value) : fileUpload.value;
            if (!Array.isArray(parsed) || parsed.length === 0) return false;
            return parsed.some((img: Record<string, unknown>) =>
                Boolean(img && (img.s3Key || img.url)));
        } catch {
            return false;
        }
    }

    // Ranking: requires items with labels (not just default template values)
    if (trimmed === 'Ranking') {
        const itemsComp = components.find(c =>
            c.id === 'items' || (c.id === 'ranking-slider' && c.type === 'select'));
        if (!itemsComp?.value) return false;
        try {
            const parsed = typeof itemsComp.value === 'string'
                ? JSON.parse(itemsComp.value as string) : itemsComp.value;
            const arr = Array.isArray(parsed) ? parsed
                : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items))
                    ? (parsed as { items: unknown[] }).items : null;
            if (!Array.isArray(arr) || arr.length === 0) return false;
            const defaultLabels = ['Item 1', 'Item 2', 'Item 3'];
            return arr.some((item: Record<string, unknown>) =>
                Boolean(item?.label && typeof item.label === 'string'
                    && item.label.trim() && !defaultLabels.includes(item.label)));
        } catch {
            return Boolean(typeof itemsComp.value === 'string' && (itemsComp.value as string).trim());
        }
    }

    if (trimmed === 'Screener') {
        const question = components.find(c => c.id === 'question-title')
            ?? components.find(c => c.id === 'screener-question');
        return typeof question?.value === 'string' && question.value.trim().length > 0;
    }

    // Cognitive Tasks: require at least title or description
    const cognitiveNames = ['Short Text', 'Long Text', 'Single Choice', 'Multiple Choice', 'Linear Scale'];
    if (cognitiveNames.includes(trimmed)) {
        const titleComp = components.find(c =>
            String(c.id || '').includes('title') || String(c.id || '').includes('question-title'));
        const descComp = components.find(c =>
            String(c.id || '').includes('description') || String(c.id || '').includes('question-description'));

        const hasTitle = Boolean(titleComp?.value && typeof titleComp.value === 'string' && titleComp.value.trim());
        const hasDesc = Boolean(descComp?.value && typeof descComp.value === 'string' && descComp.value.trim());

        // Choice questions: also check if choices have content
        if (trimmed === 'Single Choice' || trimmed === 'Multiple Choice') {
            const choices = components.filter(c =>
                c.settings?.isChoice || String(c.id || '').includes('choice-'));
            const hasChoices = choices.some(c => {
                const text = (typeof c.value === 'string' ? c.value : null)
                    || c.placeholder?.text || null;
                return Boolean(text && text.trim());
            });
            return hasTitle || hasDesc || hasChoices;
        }

        return hasTitle || hasDesc;
    }

    // Default: consider configured (unknown module types get included)
    return true;
};

/**
 * Returns the IDs of visible modules that participants are expected to answer.
 * Excludes: orphan modules (no stage), Research Configuration, Welcome Screen,
 * Thank You Screen, hidden modules, and unconfigured modules (mirrors
 * participant-frontend's isModuleConfigured check).
 */
interface VisibleModule {
    id: string;
    conditionality?: boolean;
    conditionalityConfig?: {
        action: string;
        demographicKey: string;
        demographicValue: string;
    };
}

/**
 * Returns visible modules with conditionality info.
 * Used to compute per-participant progress (excluding conditional modules that don't apply).
 */
const getVisibleModulesForProgress = async (researchId: string): Promise<VisibleModule[]> => {
    const EXCLUDED_NAMES = ['research configuration', 'welcome screen', 'thank you screen'];
    const modulesQuery = `
        SELECT m.id, m.name, m.config
        FROM modules m
        INNER JOIN stages s ON m.stage_id = s.id
        WHERE m.research_id = ? AND m.stage_id IS NOT NULL
        ORDER BY m.order_index
    `;
    const modulesResult = await pool.query(modulesQuery, [researchId]);
    const result: VisibleModule[] = [];

    for (const mod of modulesResult.rows as ProgressModuleRow[]) {
        if (EXCLUDED_NAMES.includes(mod.name.toLowerCase())) continue;

        let parsedConfig: ProgressModuleConfig | null = null;
        try {
            if (typeof mod.config === 'string') {
                parsedConfig = JSON.parse(mod.config) as ProgressModuleConfig;
            } else if (mod.config && typeof mod.config === 'object') {
                parsedConfig = mod.config as ProgressModuleConfig;
            }
        } catch {
            parsedConfig = null;
        }

        if (parsedConfig?.hidden === true) continue;

        const components = parsedConfig?.structure?.components || parsedConfig?.components || [];
        if (!isModuleConfiguredForProgress(mod.name, components)) continue;

        result.push({
            id: mod.id,
            conditionality: (parsedConfig as Record<string, unknown>)?.conditionality === true,
            conditionalityConfig: (parsedConfig as Record<string, unknown>)?.conditionalityConfig as VisibleModule['conditionalityConfig'],
        });
    }

    return result;
};

const getVisibleModuleIdsForProgress = async (researchId: string): Promise<Set<string>> => {
    const EXCLUDED_NAMES = ['research configuration', 'welcome screen', 'thank you screen'];
    const modulesQuery = `
        SELECT m.id, m.name, m.config
        FROM modules m
        INNER JOIN stages s ON m.stage_id = s.id
        WHERE m.research_id = ? AND m.stage_id IS NOT NULL
        ORDER BY m.order_index
    `;
    const modulesResult = await pool.query(modulesQuery, [researchId]);
    const visibleIds = new Set<string>();

    for (const mod of modulesResult.rows as ProgressModuleRow[]) {
        if (EXCLUDED_NAMES.includes(mod.name.toLowerCase())) continue;

        let parsedConfig: ProgressModuleConfig | null = null;
        try {
            if (typeof mod.config === 'string') {
                parsedConfig = JSON.parse(mod.config) as ProgressModuleConfig;
            } else if (mod.config && typeof mod.config === 'object') {
                parsedConfig = mod.config as ProgressModuleConfig;
            }
        } catch {
            parsedConfig = null;
        }

        if (parsedConfig?.hidden === true) continue;

        // Check if module is configured (has actual content, not just template defaults)
        const components = parsedConfig?.structure?.components || parsedConfig?.components || [];
        if (!isModuleConfiguredForProgress(mod.name, components)) continue;

        visibleIds.add(mod.id);
    }

    return visibleIds;
};

/**
 * Obtiene las métricas generales de una investigación
 * @param researchId - ID de la investigación
 * @param userId - ID del usuario (para verificar permisos)
 * @returns Métricas de la investigación
 */
export const getOverviewMetrics = async (researchId: string, userId: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role, '');
    // Verificar que el research existe y pertenece al usuario (admin bypasses)
    const researchCheck = await pool.query(
        `SELECT id, status FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
        [researchId, ...ownership.params]
    );

    if (researchCheck.rows.length === 0) {
        throw new Error('Research not found');
    }

    return getOverviewMetricsInternal(researchId);
};

export const getOverviewMetricsInternal = async (researchId: string) => {
    // Verifying research existence
    const researchCheck = await pool.query(
        'SELECT id, name, status FROM researches WHERE id = ? AND deleted_at IS NULL',
        [researchId]
    );

    if (researchCheck.rows.length === 0) {
        throw new Error('Research not found');
    }

    const research = researchCheck.rows[0] as { status: string; name?: string };
    const researchStatus = research.status;

    // Obtener estadísticas de participantes
    const participantsQuery = `
        WITH participant_stats AS (
            SELECT DISTINCT participant_id
            FROM responses
            WHERE research_id = ?
        ),
        participants_with_responses AS (
            SELECT DISTINCT participant_id
            FROM responses
            WHERE research_id = ?
            GROUP BY participant_id
            HAVING COUNT(*) > 0
        )
        SELECT 
            (SELECT COUNT(*) FROM participant_stats) as total_participants,
            (SELECT COUNT(*) FROM participants_with_responses) as participants_with_responses
    `;
    const participantsResult = await pool.query(participantsQuery, [researchId, researchId]);
    const totalParticipants = parseInt(participantsResult.rows[0]?.total_participants || '0', 10);
    const participantsWithResponses = parseInt(participantsResult.rows[0]?.participants_with_responses || '0', 10);

    // Obtener IDs de módulos visibles
    const visibleModuleIds = await getVisibleModuleIdsForProgress(researchId);
    const totalComponents = visibleModuleIds.size;

    // Calcular tasa de completitud real: participantes que respondieron todos los módulos visibles
    let completedParticipantsCount = 0;
    if (totalComponents > 0) {
        const placeholders = Array.from(visibleModuleIds).map(() => '?').join(',');
        const completedQuery = `
            SELECT COUNT(*) as completed
            FROM (
                SELECT participant_id, COUNT(DISTINCT CASE WHEN module_id IN (${placeholders}) THEN module_id END) as answered
                FROM responses
                WHERE research_id = ?
                GROUP BY participant_id
                HAVING answered >= ?
            ) completed_participants
        `;
        const completedResult = await pool.query(completedQuery, [...visibleModuleIds, researchId, totalComponents]);
        completedParticipantsCount = parseInt(completedResult.rows[0]?.completed || '0', 10);
    }
    const completionRate = totalParticipants > 0
        ? Math.round((completedParticipantsCount / totalParticipants) * 100)
        : 0;

    // Calcular tiempo promedio
    const timeQuery = `
        WITH participant_durations AS (
            SELECT 
                TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) as duration_seconds
            FROM responses
            WHERE research_id = ?
            GROUP BY participant_id
        )
        SELECT AVG(duration_seconds) as avg_duration_seconds
        FROM participant_durations
    `;
    const timeResult = await pool.query(timeQuery, [researchId]);
    const avgDurationSeconds = parseFloat(timeResult.rows[0]?.avg_duration_seconds || '0');

    const minutes = Math.floor(avgDurationSeconds / 60);
    const seconds = Math.floor(avgDurationSeconds % 60);
    const averageTime = `${minutes} min ${seconds} seg`;

    let statusValue = 'Inactiva';
    let statusDescription = 'Los participantes no pueden acceder';

    if (researchStatus === 'active') {
        statusValue = 'Activa';
        statusDescription = 'Los participantes pueden acceder';
    } else if (researchStatus === 'draft') {
        statusValue = 'Borrador';
        statusDescription = 'En configuración';
    }

    return {
        status: {
            value: statusValue,
            description: statusDescription,
            icon: 'chart-line'
        },
        participants: {
            value: totalParticipants.toString(),
            description: `${participantsWithResponses} respuestas completadas`,
            icon: 'users'
        },
        completionRate: {
            value: `${completionRate}%`,
            description: `${totalParticipants - participantsWithResponses} pendientes`,
            icon: 'check-circle'
        },
        averageTime: {
            value: averageTime,
            description: `Última actividad: ${await getLastActivityText(researchId)}`,
            icon: 'clock'
        },
        totalModules: totalComponents,
        researchName: research.name || 'Research'
    };
};

/**
 * Obtiene la lista de participantes con su estado (Internal version)
 */
export const getParticipantsWithStatusInternal = async (researchId: string) => {
    // Verificar que el research existe
    const researchCheck = await pool.query(
        'SELECT id FROM researches WHERE id = ? AND deleted_at IS NULL',
        [researchId]
    );

    if (researchCheck.rows.length === 0) {
        throw new Error('Research not found');
    }

    // 1. Obtener módulos visibles con info de condicionalidad
    const visibleModules = await getVisibleModulesForProgress(researchId);
    const visibleModuleIds = new Set(visibleModules.map(m => m.id));
    const totalComponents = visibleModuleIds.size;

    // Conditional modules: keyed by demographicKey+demographicValue for fast lookup
    const conditionalModuleIds = new Set(
        visibleModules.filter(m => m.conditionality && m.conditionalityConfig?.demographicKey).map(m => m.id)
    );

    // 2. Obtener módulos respondidos por participante (solo módulos visibles válidos)
    let participantsQuery: string;
    let queryParams: unknown[];

    if (totalComponents > 0) {
        const placeholders = Array.from(visibleModuleIds).map(() => '?').join(',');
        participantsQuery = `
            SELECT
                r.participant_id as id,
                COALESCE(p.name, CAST(r.participant_id AS CHAR), 'Unknown') as name,
                p.email as email,
                COUNT(DISTINCT CASE WHEN r.module_id IN (${placeholders}) THEN r.module_id END) as answered_modules,
                MIN(r.created_at) as first_response,
                MAX(r.created_at) as last_response,
                p.status as panel_status
            FROM responses r
            LEFT JOIN participants p ON p.research_id = r.research_id AND p.participant_id = r.participant_id
            WHERE r.research_id = ?
            GROUP BY r.participant_id, p.status
            ORDER BY MAX(r.created_at) IS NULL, MAX(r.created_at) DESC
        `;
        queryParams = [...visibleModuleIds, researchId];
    } else {
        participantsQuery = `
            SELECT
                r.participant_id as id,
                COALESCE(p.name, CAST(r.participant_id AS CHAR), 'Unknown') as name,
                p.email as email,
                0 as answered_modules,
                MIN(r.created_at) as first_response,
                MAX(r.created_at) as last_response,
                p.status as panel_status
            FROM responses r
            LEFT JOIN participants p ON p.research_id = r.research_id AND p.participant_id = r.participant_id
            WHERE r.research_id = ?
            GROUP BY r.participant_id, p.status
            ORDER BY MAX(r.created_at) IS NULL, MAX(r.created_at) DESC
        `;
        queryParams = [researchId];
    }
    const result = await pool.query(participantsQuery, queryParams);

    // 3. Load demographics per participant to evaluate conditionality
    let demographicsMap = new Map<string, Record<string, string>>();
    if (conditionalModuleIds.size > 0) {
        const demoResult = await pool.query(
            'SELECT participant_id, demographic_type, demographic_value FROM participant_demographics WHERE research_id = ?',
            [researchId]
        );
        for (const row of demoResult.rows) {
            if (!demographicsMap.has(row.participant_id)) demographicsMap.set(row.participant_id, {});
            demographicsMap.get(row.participant_id)![row.demographic_type] = row.demographic_value;
        }
    }

    const participants = result.rows.map(row => {
        const answered = parseInt(row.answered_modules || '0', 10);
        const panelStatus = row.panel_status as string | null;

        // Per-participant: exclude conditional modules that don't apply
        let participantTotal = totalComponents;
        if (conditionalModuleIds.size > 0) {
            const pDemographics = demographicsMap.get(row.id) || {};
            for (const mod of visibleModules) {
                if (!mod.conditionality || !mod.conditionalityConfig) continue;
                const { action, demographicKey, demographicValue } = mod.conditionalityConfig;
                const participantValue = pDemographics[demographicKey];
                const matches = participantValue === demographicValue;
                // action=show: module visible only if matches. action=hide: visible only if NOT matches.
                const isVisible = action === 'show' ? matches : !matches;
                if (!isVisible) participantTotal--;
            }
        }

        const isCompleted = panelStatus === 'responded' || (participantTotal > 0 && answered >= participantTotal);
        const progress = isCompleted ? 100
            : participantTotal > 0 ? Math.min(99, Math.round((answered / participantTotal) * 100))
            : 0;
        // Panel status (overquota/disqualified) overrides progress-based status
        const status = panelStatus === 'overquota' ? 'Over quota'
            : panelStatus === 'disqualified' ? 'Disqualified'
            : isCompleted ? 'Completed'
            : progress > 0 ? 'In progress'
            : 'Not started';
        const durationSeconds = row.first_response && row.last_response
            ? Math.floor((new Date(row.last_response).getTime() - new Date(row.first_response).getTime()) / 1000)
            : 0;
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = Math.floor(durationSeconds % 60);
        const duration = minutes > 0 ? `${minutes} min ${seconds} seg` : `${seconds} seg`;
        const lastActivity = row.last_response
            ? formatLastActivity(row.last_response)
            : 'Nunca';
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            status,
            progress,
            duration,
            lastActivity
        };
    });

    return participants;
};

/**
 * Obtiene la lista de participantes con su estado
 * @param researchId - ID de la investigación
 * @param userId - ID del usuario (para verificar permisos)
 * @returns Lista de participantes con estado
 */
export const getParticipantsWithStatus = async (researchId: string, userId: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role, '');
    const researchCheck = await pool.query(
        `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
        [researchId, ...ownership.params]
    );

    if (researchCheck.rows.length === 0) {
        throw new Error('Research not found');
    }

    // Return internal implementation result
    return getParticipantsWithStatusInternal(researchId);
};

/**
 * Obtiene los detalles de un participante específico
 * @param researchId - ID de la investigación
 * @param participantId - ID del participante
 * @param userId - ID del usuario (para verificar permisos)
 * @returns Detalles del participante
 */
export const getParticipantDetails = async (researchId: string, participantId: string, userId: string, role?: string) => {
    const ownership = buildOwnershipClause(userId, role, '');
    const researchCheck = await pool.query(
        `SELECT id FROM researches WHERE id = ? AND ${ownership.clause} AND deleted_at IS NULL`,
        [researchId, ...ownership.params]
    );

    if (researchCheck.rows.length === 0) {
        throw new Error('Research not found');
    }

    // Obtener IDs de módulos visibles
    const visibleModuleIds = await getVisibleModuleIdsForProgress(researchId);
    const totalComponents = visibleModuleIds.size;

    // Obtener estadísticas del participante (solo módulos visibles)
    let participantQuery: string;
    let queryParams: unknown[];

    if (totalComponents > 0) {
        const placeholders = Array.from(visibleModuleIds).map(() => '?').join(',');
        participantQuery = `
            SELECT
                r.participant_id as id,
                COALESCE(p.name, CAST(r.participant_id AS CHAR), 'Unknown') as name,
                p.email as email,
                COUNT(DISTINCT CASE WHEN r.module_id IN (${placeholders}) THEN r.module_id END) as answered_modules,
                MIN(r.created_at) as first_response,
                MAX(r.created_at) as last_response,
                p.status as panel_status
            FROM responses r
            LEFT JOIN participants p ON p.research_id = r.research_id AND p.participant_id = r.participant_id
            WHERE r.research_id = ? AND r.participant_id = ?
            GROUP BY r.participant_id, p.status
        `;
        queryParams = [...visibleModuleIds, researchId, participantId];
    } else {
        participantQuery = `
            SELECT
                r.participant_id as id,
                COALESCE(p.name, CAST(r.participant_id AS CHAR), 'Unknown') as name,
                p.email as email,
                0 as answered_modules,
                MIN(r.created_at) as first_response,
                MAX(r.created_at) as last_response,
                p.status as panel_status
            FROM responses r
            LEFT JOIN participants p ON p.research_id = r.research_id AND p.participant_id = r.participant_id
            WHERE r.research_id = ? AND r.participant_id = ?
            GROUP BY r.participant_id, p.status
        `;
        queryParams = [researchId, participantId];
    }

    const result = await pool.query(participantQuery, queryParams);

    if (result.rows.length === 0) {
        throw new Error('Participant not found');
    }

    const row = result.rows[0];
    const answered = parseInt(row.answered_modules || '0', 10);
    const panelStatus = row.panel_status as string | null;
    const isCompleted = panelStatus === 'responded' || (totalComponents > 0 && answered >= totalComponents);
    const progress = isCompleted ? 100
        : totalComponents > 0 ? Math.min(99, Math.round((answered / totalComponents) * 100))
        : 0;
    const status = panelStatus === 'overquota' ? 'Sobre cuota'
        : panelStatus === 'disqualified' ? 'Descalificado'
        : isCompleted ? 'Completado'
        : progress > 0 ? 'En proceso' : 'Por iniciar';

    const durationMs = row.first_response && row.last_response
        ? new Date(row.last_response).getTime() - new Date(row.first_response).getTime()
        : 0;
    const durationSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.floor(durationSeconds % 60);
    const duration = minutes > 0 ? `${minutes} min ${seconds} seg` : `${seconds} seg`;

    // Obtener respuestas del participante
    const responsesQuery = `
        SELECT 
            r.id,
            r.module_id,
            r.question_id,
            r.component_id,
            r.value,
            r.metadata,
            r.created_at,
            m.name as module_name,
            q.question_text
        FROM responses r
        LEFT JOIN modules m ON r.module_id = m.id
        LEFT JOIN questions q ON r.question_id = q.id
        WHERE r.research_id = ? AND r.participant_id = ?
        ORDER BY r.created_at ASC
    `;

    const responsesResult = await pool.query(responsesQuery, [researchId, participantId]);

    return {
        id: row.id,
        name: row.name,
        email: row.email,
        status,
        progress,
        duration,
        lastActivity: row.last_response ? formatLastActivity(row.last_response) : 'Nunca',
        startTime: row.first_response,
        endTime: row.last_response,
        responses: responsesResult.rows.map(r => ({
            id: r.id,
            moduleId: r.module_id,
            moduleName: r.module_name,
            questionId: r.question_id,
            questionText: r.question_text,
            componentId: r.component_id,
            value: r.value,
            metadata: r.metadata,
            createdAt: r.created_at
        }))
    };
};

/**
 * Elimina un participante y todas sus respuestas
 * @param researchId - ID de la investigación
 * @param participantId - ID del participante
 * @param userId - ID del usuario (para verificar permisos)
 * @returns Mensaje de confirmación
 */
export const deleteParticipant = async (researchId: string, participantId: string, userId: string, role?: string) => {
    const client = await pool.connect();
    const ownership = buildOwnershipClause(userId, role, '');

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

        // Verificar que el participante tiene respuestas
        const participantCheck = await client.query(
            'SELECT COUNT(*) as count FROM responses WHERE research_id = ? AND participant_id = ?',
            [researchId, participantId]
        );

        if (parseInt(participantCheck.rows[0]?.count || '0', 10) === 0) {
            throw new Error('Participant not found');
        }

        // Eliminar todas las respuestas del participante
        await client.query(
            'DELETE FROM responses WHERE research_id = ? AND participant_id = ?',
            [researchId, participantId]
        );

        await client.query('COMMIT');
        return { message: 'Participant deleted successfully' };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Helper: Obtiene el texto de última actividad
 */
const getLastActivityText = async (researchId: string): Promise<string> => {
    const query = `
        SELECT MAX(created_at) as last_activity
        FROM responses
        WHERE research_id = ?
    `;
    const result = await pool.query(query, [researchId]);

    if (result.rows.length === 0 || !result.rows[0].last_activity) {
        return 'Nunca';
    }

    return formatLastActivity(result.rows[0].last_activity);
};

/**
 * Helper: Formatea la última actividad
 */
const formatLastActivity = (date: Date | string): string => {
    const now = new Date();
    const activityDate = typeof date === 'string' ? new Date(date) : date;
    const diffMs = now.getTime() - activityDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            return diffMinutes <= 1 ? 'Hace un momento' : `Hace ${diffMinutes} minutos`;
        }
        return diffHours === 1 ? 'Hace 1 hora' : `Hace ${diffHours} horas`;
    }

    if (diffDays === 1) {
        return 'Hace 1 día';
    }

    if (diffDays < 7) {
        return `Hace ${diffDays} días`;
    }

    if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? 'Hace 1 semana' : `Hace ${weeks} semanas`;
    }

    if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return months === 1 ? 'Hace 1 mes' : `Hace ${months} meses`;
    }

    const years = Math.floor(diffDays / 365);
    return years === 1 ? 'Hace 1 año' : `Hace ${years} años`;
};
