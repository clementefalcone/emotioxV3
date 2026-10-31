import pool from '../../config/database';
import cache, { CacheKeys, CacheTTL } from '../../config/cache';
import { readPrivacyNotice } from '../research/research-privacy';
import { readBiometricRetentionMonths } from '../retention/retention.service';
import {
  DbResearchRow,
  DbResearchConfigModuleRow,
  PublicQuestionDto,
  PublicModuleStructureDto,
  PublicModuleDto,
  PublicStageDto,
  PublicResearchDto,
  parseJsonRecord,
  extractStructure,
} from './public.types';

// Function to get the participant count for a research
// Only counts participants who submitted actual module responses (excludes demographics-only)
// Cached for 10 seconds — prevents N concurrent COUNT(DISTINCT) scans during submission bursts.
export const getParticipantCount = async (researchId: string): Promise<number> => {
  const cacheKey = `participant_count:${researchId}`;
  return cache.getOrSet(cacheKey, async () => {
    const query = `
      SELECT COUNT(DISTINCT participant_id) as participant_count
      FROM responses
      WHERE research_id = ? AND module_id != 'demographics'
    `;
    const result = await pool.query(query, [researchId]);
    return parseInt(result.rows[0].participant_count) || 0;
  }, 10); // 10 seconds — short enough to stay accurate for quota limits
};

/**
 * Gets the research-level configuration from the "Research Configuration" module (if present).
 * Cached for 60 seconds — config doesn't change while participants are responding.
 * @param researchId - Research ID
 * @returns Parsed config record
 */
export const getResearchConfiguration = async (researchId: string): Promise<Record<string, unknown>> => {
  const cacheKey = `research_config:${researchId}`;
  return cache.getOrSet(cacheKey, async () => {
    const modulesQuery = `
      SELECT m.id, m.name, m.config
      FROM modules m
      WHERE m.research_id = ?
      ORDER BY m.order_index
    `;
    const modulesResult = await pool.query(modulesQuery, [researchId]);

    const researchConfigModule: DbResearchConfigModuleRow | undefined = (modulesResult.rows as DbResearchConfigModuleRow[])
      .find((moduleRow: DbResearchConfigModuleRow) => moduleRow.name === 'Research Configuration');

    if (researchConfigModule && researchConfigModule.config) {
      return parseJsonRecord(researchConfigModule.config);
    }

    return {};
  }, CacheTTL.SHORT); // 60 seconds
};

/**
 * Gets the public research payload including stages -> modules -> questions, for participant-frontend.
 * @param researchId - Research ID
 * @returns Research DTO
 */
export const getResearch = async (researchId: string, preview: boolean = false): Promise<PublicResearchDto> => {
  const cacheKey = `${CacheKeys.PUBLIC_RESEARCH}:${researchId}`;

  const fetchResearch = async (): Promise<PublicResearchDto> => {
        try {
        // Check if research is active (or draft in preview mode)
        const allowedStatuses = preview ? ['active', 'draft'] : ['active'];
        const statusPlaceholders = allowedStatuses.map(() => '?').join(',');
        const researchQuery = `
          SELECT id, name, description, status, config
          FROM researches
          WHERE id = ? AND status IN (${statusPlaceholders}) AND deleted_at IS NULL
        `;
        const researchResult = await pool.query(researchQuery, [researchId, ...allowedStatuses]);

        if (researchResult.rows.length === 0) {
          // Check if research exists but is not in an allowed status
          const checkQuery = `
            SELECT id, name, status, deleted_at
            FROM researches
            WHERE id = ?
          `;
          const checkResult = await pool.query(checkQuery, [researchId]);

          if (checkResult.rows.length === 0) {
            throw new Error(`Research not found: ${researchId}`);
          }

          const research = checkResult.rows[0];
          if (research.deleted_at) {
            throw new Error(`Research has been deleted: ${researchId}`);
          }
          if (research.status !== 'active') {
            throw new Error(`Research is not active (status: ${research.status}): ${researchId}`);
          }

          throw new Error(`Research not found or not active: ${researchId}`);
        }

        const researchRow: DbResearchRow = researchResult.rows[0] as DbResearchRow;
        const privacy = { ...readPrivacyNotice(researchRow.config), biometricRetentionMonths: readBiometricRetentionMonths(researchRow.config) };

        // Get stages with modules + questions (MySQL-compatible approach)
        // Split into multiple simpler queries instead of complex nested JSON aggregation
        let stagesData: Array<{
          id: string;
          name: string;
          description: string | null;
          order_index: number;
          stage_type: string | null;
          modules: Array<{
            id: string;
            name: string;
            description: string | null;
            order_index: number;
            is_from_template: boolean | null;
            config: unknown;
            questions: Array<{
              id: string;
              type: string;
              text: string;
              order: number;
              config: unknown;
              validation: unknown;
              required: boolean;
            }>;
          }>;
        }> = [];

        try {
          // Step 1: Get all stages for this research
          const stagesQuery = `
            SELECT id, name, description, display_order as order_index, stage_type
            FROM stages
            WHERE research_id = ?
            ORDER BY display_order
          `;
          const stagesResult = await pool.query(stagesQuery, [researchId]);

          if (stagesResult.rows.length === 0) {
            stagesData = [];
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

            // Assemble the final structure
            stagesData = stagesResult.rows.map((stage: Record<string, unknown>) => {
              const stageId = stage.id as string;
              const stageModules = modulesByStage.get(stageId) || [];

              return {
                id: stageId,
                name: stage.name as string,
                description: stage.description as string | null,
                order_index: stage.order_index as number,
                stage_type: stage.stage_type as string | null,
                modules: stageModules.map((mod: Record<string, unknown>) => {
                  const moduleId = mod.id as string;
                  const moduleQuestions = questionsByModule.get(moduleId) || [];

                  return {
                    id: moduleId,
                    name: mod.name as string,
                    description: mod.description as string | null,
                    order_index: mod.order_index as number,
                    is_from_template: mod.is_from_template as boolean | null,
                    config: mod.config || {},
                    questions: moduleQuestions.map((q: Record<string, unknown>) => ({
                      id: q.id as string,
                      type: q.question_type as string,
                      text: q.question_text as string,
                      order: q.order_index as number,
                      config: q.config || {},
                      validation: q.validation || {},
                      required: (q.required as boolean) || false,
                    })),
                  };
                }),
              };
            });
          }
        } catch (queryError: unknown) {
          console.error('Error executing stages query:', queryError);
          console.error('Research ID:', researchId);
          if (queryError instanceof Error) {
            console.error('Query error stack:', queryError.stack);
          }
          throw new Error(`Failed to fetch stages: ${queryError instanceof Error ? queryError.message : 'Unknown error'}`);
        }

        // Handle case when no stages exist
        if (stagesData.length === 0) {
          console.log(`[getResearch] No stages found for research: ${researchId}`);
          return {
            id: researchRow.id,
            name: researchRow.name,
            title: researchRow.name,
            description: researchRow.description ?? '',
            status: researchRow.status,
            stages: [],
            modules: [],
            privacy,
          };
        }

        // Transform stagesData to PublicStageDto format
        const stages: PublicStageDto[] = stagesData.map((stageRow) => {
          const modules: PublicModuleDto[] = stageRow.modules.map((mod) => {
            // Parse config safely - MySQL may return JSON as string
            let moduleConfigRaw: unknown = mod.config;
            if (typeof moduleConfigRaw === 'string') {
              try {
                moduleConfigRaw = JSON.parse(moduleConfigRaw);
              } catch (e) {
                console.error('Error parsing module config string:', e);
                moduleConfigRaw = {};
              }
            }
            const moduleConfig: Record<string, unknown> = parseJsonRecord(moduleConfigRaw);
            const structure: PublicModuleStructureDto = extractStructure(moduleConfig);

            // Parse questions - config/validation may be strings from MySQL
            const questions: PublicQuestionDto[] = mod.questions.map((q) => {
              let qConfig: unknown = q.config;
              let qValidation: unknown = q.validation;
              if (typeof qConfig === 'string') {
                try { qConfig = JSON.parse(qConfig); } catch (_e) { qConfig = {}; }
              }
              if (typeof qValidation === 'string') {
                try { qValidation = JSON.parse(qValidation); } catch (_e) { qValidation = {}; }
              }
              return {
                id: q.id,
                type: q.type,
                text: q.text,
                order: q.order,
                config: qConfig,
                validation: qValidation,
                required: q.required,
              };
            });

            return {
              id: mod.id,
              name: mod.name,
              description: mod.description ?? '',
              order_index: mod.order_index,
              is_from_template: mod.is_from_template ?? undefined,
              config: moduleConfig,
              structure,
              questions,
            };
          });

          return {
            id: stageRow.id,
            name: stageRow.name,
            description: stageRow.description ?? '',
            order_index: stageRow.order_index,
            stage_type: stageRow.stage_type,
            modules,
          };
        });

        const flattenedModules: PublicModuleDto[] = stages.flatMap((stage: PublicStageDto) => stage.modules);

        return {
          id: researchRow.id,
          name: researchRow.name,
          title: researchRow.name,
          description: researchRow.description ?? '',
          status: researchRow.status,
          stages,
          modules: flattenedModules,
          privacy,
        };
      } catch (error: unknown) {
        console.error('Error in getResearch:', error);
        console.error('Research ID:', researchId);
        if (error instanceof Error) {
          console.error('Error stack:', error.stack);
        }
        throw error;
      }
  };

  // Preview mode: skip cache (draft content changes frequently)
  if (preview) {
    return fetchResearch();
  }

  // Normal mode: use cache
  try {
    return await cache.getOrSet(
      cacheKey,
      fetchResearch,
      CacheTTL.SHORT // Cache for 1 minute (frequently changing)
    );
  } catch (error: unknown) {
    // Clear cache on error to prevent caching bad data
    cache.delete(cacheKey);
    console.error('[getResearch] Error outside cache:', error);
    throw error;
  }
};
