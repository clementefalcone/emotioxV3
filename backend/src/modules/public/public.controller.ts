import { createHash } from 'crypto';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import * as publicService from './index';
import * as mediaService from '../media/media.service';
import { isAuthError, requireParticipantReviewToken } from '../../utils/auth';

const anonymizeProgressParticipant = <T extends { id: string; name: string; email: string }>(researchId: string, participant: T): T => {
    const alias = createHash('sha256').update(`${researchId}:${participant.id}`).digest('hex').slice(0, 8);
    return { ...participant, id: alias, name: `Participante ${alias}`, email: '' };
};

export const handlePublicRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin: string | null = (event.headers.Origin || event.headers.origin || null) as string | null;
    try {
        // No auth required for public routes

        // GET /public/research/:id
        const researchMatch = path.match(/^\/public\/research\/([^\/]+)$/);
        if (researchMatch && httpMethod === 'GET') {
            const researchId = researchMatch[1];
            try {
                const preview = event.queryStringParameters?.preview === 'true';
                console.log(`[Public API] Fetching research: ${researchId}${preview ? ' (preview mode)' : ''}`);
                const research = await publicService.getResearch(researchId, preview);
                console.log(`[Public API] Successfully fetched research: ${researchId}`);
                return success({ research }, 200, undefined, origin);
            } catch (serviceError: unknown) {
                console.error('[Public API] Error in getResearch service:', serviceError);
                const errorMessage = serviceError instanceof Error ? serviceError.message : 'Failed to load research';
                console.error('[Public API] Error details:', {
                    researchId,
                    error: errorMessage,
                    stack: serviceError instanceof Error ? serviceError.stack : undefined
                });
                
                // Return 404 for not found errors, 500 for others
                if (errorMessage.includes('not found') || errorMessage.includes('not active') || errorMessage.includes('deleted')) {
                    return error(errorMessage, 404, undefined, origin);
                }
                
                throw serviceError; // Re-throw to be caught by outer catch
            }
        }

        // GET /public/research/:id/mode
        const modeMatch = path.match(/^\/public\/research\/([^\/]+)\/mode$/);
        if (modeMatch && httpMethod === 'GET') {
            const researchId = modeMatch[1];
            const mode = await publicService.getParticipationMode(researchId);
            return success({ mode, settings: {} }, 200, undefined, origin);
        }

        // POST /public/research/:id/kiosk/session
        const kioskMatch = path.match(/^\/public\/research\/([^\/]+)\/kiosk\/session$/);
        if (kioskMatch && httpMethod === 'POST') {
            const researchId = kioskMatch[1];
            try {
                const result = await publicService.generateKioskSession(researchId);
                return success(result, 201, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to create kiosk session';
                if (errorMessage.includes('not configured in kiosk mode') || errorMessage.includes('not found')) {
                    return error(errorMessage, 400, undefined, origin);
                }
                throw err;
            }
        }

        // GET /public/research/:id/participant/:participantId/status
        const participantStatusMatch = path.match(/^\/public\/research\/([^\/]+)\/participant\/([^\/]+)\/status$/);
        if (participantStatusMatch && httpMethod === 'GET') {
            const researchId = participantStatusMatch[1];
            const participantId = participantStatusMatch[2];
            const status = await publicService.getParticipantStatus(researchId, participantId);
            return success(status, 200, undefined, origin);
        }

        // GET /public/research/:id/participant/:participantId/responses
        const participantResponsesMatch = path.match(/^\/public\/research\/([^\/]+)\/participant\/([^\/]+)\/responses$/);
        if (participantResponsesMatch && httpMethod === 'GET') {
            const researchId = participantResponsesMatch[1];
            const participantId = decodeURIComponent(participantResponsesMatch[2]);
            requireParticipantReviewToken(event, researchId, participantId);
            const responses = await publicService.getParticipantResponses(researchId, participantId);
            return success({ responses }, 200, undefined, origin);
        }

        // POST /public/research/:id/responses
        const responsesMatch = path.match(/^\/public\/research\/([^\/]+)\/responses$/);
        if (responsesMatch && httpMethod === 'POST') {
            const researchId = responsesMatch[1];
            const body = JSON.parse(event.body || '{}');
            try {
                const result = await publicService.saveParticipantResponses(researchId, body);

                // Auto-trigger text analysis every 10 participants
                checkAutoAnalysisThreshold(researchId).catch(err =>
                    console.error('[Auto-analysis threshold]', err.message)
                );

                // Check for alerts
                import('../analytics/alerts.service').then(({ checkAlerts }) =>
                    checkAlerts(researchId).catch(() => {})
                );

                // Register participant DID on Cerulean Ledger
                if (body.participantId) {
                    import('../cerulean/integration.service').then(cl =>
                        cl.registerParticipantDID(researchId, body.participantId).catch(() => {})
                    ).catch(() => {});
                }

                return success(result, 201, undefined, origin);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to save responses';
                if (msg.includes('not active') || msg.includes('not found')) {
                    return error(msg, 410, undefined, origin);
                }
                if (msg.includes('Participant limit reached')) {
                    return error(msg, 410, undefined, origin);
                }
                throw err;
            }
        }

        // GET /public/research/:id/progress — public read-only progress (no auth)
        const progressMatch = path.match(/^\/public\/research\/([^\/]+)\/progress$/);
        if (progressMatch && httpMethod === 'GET') {
            const researchId = progressMatch[1];
            try {
                const { getOverviewMetricsInternal, getParticipantsWithStatusInternal } = await import('../research/research-in-progress.service');
                const [metrics, participants] = await Promise.all([
                    getOverviewMetricsInternal(researchId),
                    getParticipantsWithStatusInternal(researchId),
                ]);
                return success({ metrics, participants: participants.map(p => anonymizeProgressParticipant(researchId, p)) }, 200, undefined, origin);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to load progress';
                if (msg.includes('not found')) return error(msg, 404, undefined, origin);
                throw err;
            }
        }

        const resultsMetaMatch = path.match(/^\/public\/research\/([^\/]+)\/results-meta$/);
        if (resultsMetaMatch && httpMethod === 'GET') {
            const researchId = resultsMetaMatch[1];
            try {
                const { hasPublicResults, researchResultsNotPublic } = await import('../research/research-access');
                if (!(await hasPublicResults(researchId))) return researchResultsNotPublic(researchId, path, origin);
                const pool = (await import('../../config/database')).default;
                const result = await pool.query(
                    `SELECT r.id, r.name, r.status, rt.name AS research_type_name, r.created_at
                     FROM researches r
                     LEFT JOIN research_types rt ON r.research_type_id = rt.id
                     WHERE r.id = ?`,
                    [researchId]
                );
                const research = result.rows[0];
                if (!research) return error('Research not found', 404, undefined, origin);

                const stageResult = await pool.query(
                    'SELECT id, name, stage_type, display_order FROM stages WHERE research_id = ? ORDER BY display_order',
                    [researchId]
                );

                return success({ research: { ...research, stages: stageResult.rows } }, 200, undefined, origin);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to load research metadata';
                return error(msg, 500, undefined, origin);
            }
        }

        // GET /public/research/:id/quota-availability
        const quotaAvailMatch = path.match(/^\/public\/research\/([^\/]+)\/quota-availability$/);
        if (quotaAvailMatch && httpMethod === 'GET') {
            const researchId = quotaAvailMatch[1];
            const result = await publicService.checkQuotaPreAvailability(researchId);
            return success(result, 200, undefined, origin);
        }

        // POST /public/research/:id/validate-demographics
        const validateMatch = path.match(/^\/public\/research\/([^\/]+)\/validate-demographics$/);
        if (validateMatch && httpMethod === 'POST') {
            const researchId = validateMatch[1];
            const body = JSON.parse(event.body || '{}');
            const validation = await publicService.validateDemographics(researchId, body.demographics || {}, body.participantId);
            return success({ validation }, 200, undefined, origin);
        }

        // GET /public/media/by-key?s3_key=...
        if (path === '/public/media/by-key' && httpMethod === 'GET') {
            try {
                const rawS3Key = event.queryStringParameters?.s3_key;
                if (!rawS3Key) {
                    return error('s3_key query parameter is required', 400, undefined, origin);
                }
                
                // Decode URL-encoded s3_key (API Gateway should do this, but handle manually for safety)
                const s3Key = decodeURIComponent(rawS3Key);
                
                console.log(`[Public API] Getting media URL for s3_key: ${s3Key}`);
                const result = await mediaService.getMediaUrlByPath(s3Key);
                console.log(`[Public API] Successfully generated media URL for s3_key: ${s3Key}`);
                return success(result, 200, undefined, origin);
            } catch (serviceError: unknown) {
                console.error('[Public API] Error in getMediaUrlByS3Key:', serviceError);
                const errorMessage = serviceError instanceof Error ? serviceError.message : 'Failed to get media URL';
                console.error('[Public API] Error details:', {
                    s3Key: event.queryStringParameters?.s3_key,
                    error: errorMessage,
                    stack: serviceError instanceof Error ? serviceError.stack : undefined
                });
                
                // Return 404 for not found errors, 400 for validation errors, 500 for others
                if (errorMessage.includes('not found')) {
                    return error(errorMessage, 404, undefined, origin);
                }
                if (errorMessage.includes('Invalid') || errorMessage.includes('required')) {
                    return error(errorMessage, 400, undefined, origin);
                }
                
                throw serviceError; // Re-throw to be caught by outer catch
            }
        }

        // Legacy endpoint (deprecated)
        if (path === '/public/responses' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const response = await publicService.saveResponse(body);
            return success({ response }, 201, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        if (isAuthError(err)) {
            console.warn(JSON.stringify({ event: 'public_auth_denied', path, reason: err.message }));
            return error(err.message, 401, undefined, origin);
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Public API error:', err);
        return error(errorMessage, 500, undefined, origin);
    }
};

const AUTO_ANALYSIS_THRESHOLD = 10;

/**
 * Check if participant count reached a threshold multiple and trigger text analysis.
 * Only runs at multiples of AUTO_ANALYSIS_THRESHOLD (10, 20, 30...).
 */
async function checkAutoAnalysisThreshold(researchId: string): Promise<void> {
    const pool = (await import('../../config/database')).default;

    const result = await pool.query(
        'SELECT COUNT(DISTINCT participant_id) AS cnt FROM responses WHERE research_id = ?',
        [researchId]
    );
    const count = Number(result.rows[0]?.cnt) || 0;

    // Only trigger at exact threshold multiples
    if (count === 0 || count % AUTO_ANALYSIS_THRESHOLD !== 0) return;

    // Check if already analyzed at this count (avoid duplicate runs)
    const configResult = await pool.query(
        'SELECT config FROM researches WHERE id = ?',
        [researchId]
    );
    const config = typeof configResult.rows[0]?.config === 'string'
        ? JSON.parse(configResult.rows[0].config)
        : configResult.rows[0]?.config || {};

    const lastAutoCount = config.lastAutoAnalysisCount || 0;
    if (lastAutoCount >= count) return;

    // Mark this count
    config.lastAutoAnalysisCount = count;
    await pool.query(
        'UPDATE researches SET config = ? WHERE id = ?',
        [JSON.stringify(config), researchId]
    );

    // Trigger analysis for VOC
    const { triggerTextAnalysis } = await import('../analytics/text-analysis.service');
    await triggerTextAnalysis(researchId, 'voc').catch(() => {});

    console.log(`[Auto-analysis] Triggered at ${count} participants for research ${researchId}`);
}
