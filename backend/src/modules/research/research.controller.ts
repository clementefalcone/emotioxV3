import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as researchService from '.';
import * as researchInProgressService from './research-in-progress.service';
import * as researchActivityService from './research-activity.service';
import * as authService from '../auth/auth.service';
import * as publicService from '../public/index';
import * as researchTagsService from './research-tags.service';
import { getRequestOrigin } from '../../utils/request';
import { canAccessResearch, researchNotFound } from './research-access';

export const handleResearchRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);
    
    // Debug logging for add-welcome-thankyou endpoint
    if (path.includes('add-welcome-thankyou')) {
        console.log('[Research Controller] Received request:', { 
            httpMethod, 
            path, 
            rawPath: event.path,
            headers: Object.keys(event.headers || {}),
            body: event.body ? 'present' : 'missing'
        });
        console.log('[Research Controller] Testing match:', {
            path,
            httpMethod,
            matchPattern: '/^\\/research\\/([^\\/]+)\\/add-welcome-thankyou$/',
            willMatch: /^\/research\/([^\/]+)\/add-welcome-thankyou$/.test(path)
        });
    }

    try {
        let decoded;
        try {
            decoded = await requireAuth(event);
        } catch (authError: unknown) {
            const authErrorMessage = authError instanceof Error ? authError.message : 'Authentication failed';
            console.error('Auth error for', path, ':', authErrorMessage);
            if (isAuthError(authError)) {
                return error(authErrorMessage, authError.statusCode, undefined, origin);
            }
            throw authError;
        }
        const user = await authService.getMe(decoded.sub);

        // Viewer role: read-only — block all mutations
        if (user.role === 'viewer' && httpMethod !== 'GET') {
            return error('Viewer role is read-only', 403, undefined, origin);
        }

        // GET /research
        if (path === '/research' && httpMethod === 'GET') {
            const researches = await researchService.list(user.id, user.role);
            return success({ researches }, 200, undefined, origin);
        }

        // GET /research/activity
        if (path === '/research/activity' && httpMethod === 'GET') {
            const activities = await researchActivityService.listAccessibleResearchActivity(user.id, user.role);
            return success({ activities }, 200, undefined, origin);
        }

        // GET /research/dashboard-summary
        if (path === '/research/dashboard-summary' && httpMethod === 'GET') {
            const summary = await researchActivityService.getDashboardSummary(user.id, user.role);
            return success({ summary }, 200, undefined, origin);
        }

        // POST /research
        if (path === '/research' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            console.log('[Research Controller] POST /research - Body received:', JSON.stringify(body, null, 2));
            console.log('[Research Controller] research_type_id:', body.research_type_id);
            console.log('[Research Controller] use_default_modules:', body.use_default_modules);
            const research = await researchService.create(user.id, body);

            // Cerulean audit trail
            import('../cerulean/integration.service').then(cl =>
                cl.recordAuditEvent(research.id, 'research.created', user.id, { name: body.name }).catch(() => {})
            ).catch(() => {});

            return success({ research }, 201, undefined, origin);
        }

        // GET /research/:id
        const getMatch = path.match(/^\/research\/([^\/]+)$/);
        if (getMatch && httpMethod === 'GET') {
            const id = getMatch[1];
            try {
                const research = await researchService.getById(id, user.id, user.role);
                return success({ research }, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (errorMessage.includes('Research not found')) {
                    return error('Research not found', 404, undefined, origin);
                }
                throw err;
            }
        }

        // PUT /research/:id
        const putMatch = path.match(/^\/research\/([^\/]+)$/);
        if (putMatch && httpMethod === 'PUT') {
            const id = putMatch[1];
            const body = JSON.parse(event.body || '{}');
            const research = await researchService.update(id, user.id, body, user.role);
            return success({ research }, 200, undefined, origin);
        }

        // DELETE /research/:id
        const deleteMatch = path.match(/^\/research\/([^\/]+)$/);
        if (deleteMatch && httpMethod === 'DELETE') {
            const id = deleteMatch[1];
            const result = await researchService.deleteResearch(id, user.id, user.role);
            return success(result, 200, undefined, origin);
        }

        // POST /research/:id/add-welcome-thankyou (must be before other /research/:id/* routes)
        const addWelcomeThankYouMatch = path.match(/^\/research\/([^\/]+)\/add-welcome-thankyou$/);
        console.log('[Research Controller] Checking add-welcome-thankyou:', {
            path,
            httpMethod,
            match: addWelcomeThankYouMatch,
            willExecute: addWelcomeThankYouMatch && httpMethod === 'POST'
        });
        if (addWelcomeThankYouMatch && httpMethod === 'POST') {
            const id = addWelcomeThankYouMatch[1];
            console.log('[Research Controller] POST /research/:id/add-welcome-thankyou - Research ID:', id, 'User ID:', user.id);
            try {
                const result = await researchService.addWelcomeAndThankYouStages(id, user.id, user.role);
                console.log('[Research Controller] Successfully added Welcome/Thank You stages:', result);
                return success({ result }, 200, undefined, origin);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error('[Research Controller] Error adding Welcome/Thank You stages:', errorMessage, error);
                throw error;
            }
        }

        // POST /research/:id/duplicate
        const duplicateMatch = path.match(/^\/research\/([^\/]+)\/duplicate$/);
        if (duplicateMatch && httpMethod === 'POST') {
            const id = duplicateMatch[1];
            const body = JSON.parse(event.body || '{}');
            try {
                const research = await researchService.duplicate(id, user.id, user.role, body.name);
                return success({ research }, 201, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (errorMessage.includes('Research not found')) {
                    return error('Research not found', 404, undefined, origin);
                }
                throw err;
            }
        }

        // PATCH /research/:id/status
        const statusMatch = path.match(/^\/research\/([^\/]+)\/status$/);
        if (statusMatch && httpMethod === 'PATCH') {
            const id = statusMatch[1];
            const body = JSON.parse(event.body || '{}');
            const research = await researchService.updateStatus(id, user.id, body.status, user.role);

            // Auto-trigger text analysis when research is completed/closed
            if (body.status === 'completed' || body.status === 'closed') {
                autoTriggerTextAnalysis(id).catch(err =>
                    console.error('[Auto-analysis] Error:', err.message)
                );

                // Cerulean Ledger: certify integrity + issue certificate + audit trail
                import('../cerulean/integration.service').then(async (cl) => {
                    await cl.certifyResearchIntegrity(id).catch(() => {});
                    await cl.issueStudyCertificate(id).catch(() => {});
                    await cl.recordAuditEvent(id, 'research.closed', user.id).catch(() => {});
                }).catch(() => {});
            }

            // Cerulean audit trail for status changes
            if (body.status === 'active') {
                import('../cerulean/integration.service').then(cl =>
                    cl.recordAuditEvent(id, 'research.activated', user.id).catch(() => {})
                ).catch(() => {});
            }

            return success({ research }, 200, undefined, origin);
        }

        // POST /research/:id/activate
        const activateMatch = path.match(/^\/research\/([^\/]+)\/activate$/);
        if (activateMatch && httpMethod === 'POST') {
            const id = activateMatch[1];
            const research = await researchService.activate(id, user.id, user.role);
            return success({ research }, 200, undefined, origin);
        }

        // POST /research/:id/stages
        const createStageMatch = path.match(/^\/research\/([^\/]+)\/stages$/);
        if (createStageMatch && httpMethod === 'POST') {
            const id = createStageMatch[1];
            const body = JSON.parse(event.body || '{}');
            if (!body.name) {
                return error('Stage name is required', 400, undefined, origin);
            }
            const stage = await researchService.createStage(id, user.id, body.name, body.description, user.role, body.defaultModuleName);
            return success({ stage }, 201, undefined, origin);
        }

        // DELETE /research/:id/stages/:stageId
        const deleteStageMatch = path.match(/^\/research\/([^\/]+)\/stages\/([^\/]+)$/);
        if (deleteStageMatch && httpMethod === 'DELETE') {
            const researchId = deleteStageMatch[1];
            const stageId = deleteStageMatch[2];
            try {
                const result = await researchService.deleteStage(researchId, user.id, stageId, user.role);
                return success(result, 200, undefined, origin);
            } catch (deleteError: unknown) {
                const errorMessage = deleteError instanceof Error ? deleteError.message : 'Failed to delete stage';
                console.error('[ResearchController] Error deleting stage:', {
                    researchId,
                    stageId,
                    userId: user.id,
                    error: errorMessage,
                    stack: deleteError instanceof Error ? deleteError.stack : undefined
                });
                
                // Handle specific error cases
                if (errorMessage.includes('Research not found')) {
                    return error('Research not found', 404, undefined, origin);
                }
                if (errorMessage.includes('Stage not found')) {
                    return error('Stage not found', 404, undefined, origin);
                }
                if (errorMessage.includes('foreign key') || errorMessage.includes('constraint')) {
                    return error('Cannot delete stage: it has dependencies that prevent deletion', 409, undefined, origin);
                }
                
                // Generic error
                return error(errorMessage || 'Failed to delete stage', 500, undefined, origin);
            }
        }

        // DELETE /research/:id/modules/:moduleId
        const deleteModuleMatch = path.match(/^\/research\/([^\/]+)\/modules\/([^\/]+)$/);
        if (deleteModuleMatch && httpMethod === 'DELETE') {
            const researchId = deleteModuleMatch[1];
            const moduleId = deleteModuleMatch[2];
            const result = await researchService.deleteModule(researchId, user.id, moduleId, user.role);
            return success(result, 200, undefined, origin);
        }

        // PUT /stages/:stageId/modules/reorder
        const reorderModulesMatch = path.match(/^\/stages\/([^\/]+)\/modules\/reorder$/);
        if (reorderModulesMatch && httpMethod === 'PUT') {
            const stageId = reorderModulesMatch[1];
            const body = JSON.parse(event.body || '{}');
            if (!body.updates || !Array.isArray(body.updates)) {
                return error('updates array is required', 400, undefined, origin);
            }
            try {
                const result = await researchService.updateModulesOrderInStage(stageId, user.id, body.updates, user.role);
                return success(result, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to update modules order';
                console.error('Error updating modules order:', err);
                if (errorMessage === 'Stage not found' || errorMessage === 'Research not found') {
                    return error(errorMessage, 404, undefined, origin);
                }
                if (errorMessage.includes('not found in this stage')) {
                    return error(errorMessage, 400, undefined, origin);
                }
                return error(errorMessage, 500, undefined, origin);
            }
        }

        // PUT /research/:id/stages/reorder
        const reorderStagesMatch = path.match(/^\/research\/([^\/]+)\/stages\/reorder$/);
        if (reorderStagesMatch && httpMethod === 'PUT') {
            const researchId = reorderStagesMatch[1];
            const body = JSON.parse(event.body || '{}');
            if (!body.updates || !Array.isArray(body.updates)) {
                return error('updates array is required', 400, undefined, origin);
            }
            try {
                const result = await researchService.reorderStages(researchId, user.id, body.updates, user.role);
                return success(result, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to update stages order';
                if (errorMessage === 'Research not found') {
                    return error(errorMessage, 404, undefined, origin);
                }
                if (errorMessage.includes('not found in this research')) {
                    return error(errorMessage, 400, undefined, origin);
                }
                return error(errorMessage, 500, undefined, origin);
            }
        }

        // POST /research/:id/share-progress — send progress link by email
        const shareProgressMatch = path.match(/^\/research\/([^\/]+)\/share-progress$/);
        if (shareProgressMatch && httpMethod === 'POST') {
            const researchId = shareProgressMatch[1];
            const body = JSON.parse(event.body || '{}');
            const emails: string[] = body.emails;
            if (!Array.isArray(emails) || emails.length === 0) {
                return error('emails array is required', 400, undefined, origin);
            }
            try {
                const research = await researchService.getById(researchId, user.id, user.role);
                const researchName = (research as { name?: string }).name || 'Research';
                const senderName = user.email || 'A researcher';
                const progressUrl = body.progressUrl || `https://emotio.cx/research/progress/${researchId}`;

                const { sendShareProgress } = await import('../email/email.service');
                const result = await sendShareProgress({ to: emails, senderName, researchName, progressUrl });
                return success(result, 200, undefined, origin);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to send emails';
                if (msg.includes('not found')) return error(msg, 404, undefined, origin);
                return error(msg, 500, undefined, origin);
            }
        }

        // GET /research/:id/activity
        const activityMatch = path.match(/^\/research\/([^\/]+)\/activity$/);
        if (activityMatch && httpMethod === 'GET') {
            const researchId = activityMatch[1];
            await researchService.getById(researchId, user.id, user.role);
            const activities = await researchActivityService.listResearchActivity(researchId);
            return success({ activities }, 200, undefined, origin);
        }

        // GET /research/:id/detail
        const detailMatch = path.match(/^\/research\/([^\/]+)\/detail$/);
        if (detailMatch && httpMethod === 'GET') {
            const researchId = detailMatch[1];
            await researchService.getById(researchId, user.id, user.role);
            const detail = await researchActivityService.getResearchDetail(researchId);
            return success(detail, 200, undefined, origin);
        }

        // GET /research/:id/metrics
        const metricsMatch = path.match(/^\/research\/([^\/]+)\/metrics$/);
        if (metricsMatch && httpMethod === 'GET') {
            const researchId = metricsMatch[1];
            try {
                const metrics = await researchInProgressService.getOverviewMetrics(researchId, user.id, user.role);
                return success(metrics, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (errorMessage.includes('Research not found')) {
                    return error('Research not found', 404, undefined, origin);
                }
                throw err;
            }
        }

        // GET /research/:id/participants/status
        const participantsStatusMatch = path.match(/^\/research\/([^\/]+)\/participants\/status$/);
        if (participantsStatusMatch && httpMethod === 'GET') {
            const researchId = participantsStatusMatch[1];
            try {
                const participants = await researchInProgressService.getParticipantsWithStatus(researchId, user.id, user.role);
                return success(participants, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (errorMessage.includes('Research not found')) {
                    return error('Research not found', 404, undefined, origin);
                }
                throw err;
            }
        }

        // GET /research/:id/participants/:participantId
        const participantDetailsMatch = path.match(/^\/research\/([^\/]+)\/participants\/([^\/]+)$/);
        if (participantDetailsMatch && httpMethod === 'GET') {
            const researchId = participantDetailsMatch[1];
            const participantId = participantDetailsMatch[2];
            const participant = await researchInProgressService.getParticipantDetails(researchId, participantId, user.id, user.role);
            return success(participant, 200, undefined, origin);
        }

        // DELETE /research/:id/participants/:participantId
        const deleteParticipantMatch = path.match(/^\/research\/([^\/]+)\/participants\/([^\/]+)$/);
        if (deleteParticipantMatch && httpMethod === 'DELETE') {
            const researchId = deleteParticipantMatch[1];
            const participantId = deleteParticipantMatch[2];
            const result = await researchInProgressService.deleteParticipant(researchId, participantId, user.id, user.role);
            return success(result, 200, undefined, origin);
        }

        // GET /eye-tracking-recruit/research/:id
        const eyeTrackingRecruitMatch = path.match(/^\/eye-tracking-recruit\/research\/([^\/]+)$/);
        if (eyeTrackingRecruitMatch && httpMethod === 'GET') {
            const researchId = eyeTrackingRecruitMatch[1];
            // Verificar que el research existe y pertenece al usuario
            await researchService.getById(researchId, user.id, user.role);
            const config = await publicService.getResearchConfiguration(researchId);
            return success({ linkConfig: config.linkConfig || {}, ...config }, 200, undefined, origin);
        }

        // GET /research/:id/collaborators
        const collabGetMatch = path.match(/^\/research\/([^\/]+)\/collaborators$/);
        if (collabGetMatch && httpMethod === 'GET') {
            const researchId = collabGetMatch[1];
            await researchService.getById(researchId, user.id, user.role);
            const collaborators = await researchService.listCollaborators(researchId);
            return success({ collaborators }, 200, undefined, origin);
        }

        // POST /research/:id/collaborators
        if (collabGetMatch && httpMethod === 'POST') {
            const researchId = collabGetMatch[1];
            // Only owner or admin can add collaborators
            const research = await researchService.getById(researchId, user.id, user.role) as { created_by?: string };
            if (user.role !== 'admin' && research.created_by !== user.id) {
                return error('Only the research owner can add collaborators', 403, undefined, origin);
            }
            const body = JSON.parse(event.body || '{}');
            const { email, permission } = body;
            if (!email || typeof email !== 'string') {
                return error('Email is required', 400, undefined, origin);
            }
            try {
                const collaborator = await researchService.addCollaborator(researchId, email.trim().toLowerCase(), user.id, permission);
                return success({ collaborator }, 201, undefined, origin);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to add collaborator';
                const status = msg.includes('not found') ? 404 : msg.includes('already') ? 409 : msg.includes('owner') ? 400 : 500;
                return error(msg, status, undefined, origin);
            }
        }

        // DELETE /research/:id/collaborators/:collaboratorId
        const collabDeleteMatch = path.match(/^\/research\/([^\/]+)\/collaborators\/([^\/]+)$/);
        if (collabDeleteMatch && httpMethod === 'DELETE') {
            const researchId = collabDeleteMatch[1];
            const collaboratorId = collabDeleteMatch[2];
            const research = await researchService.getById(researchId, user.id, user.role) as { created_by?: string };
            if (user.role !== 'admin' && research.created_by !== user.id) {
                return error('Only the research owner can remove collaborators', 403, undefined, origin);
            }
            await researchService.removeCollaborator(collaboratorId, researchId);
            return success({ message: 'Collaborator removed' }, 200, undefined, origin);
        }

        // GET /research/tags — all unique tags for user
        if (path === '/research/tags' && httpMethod === 'GET') {
            const tags = await researchTagsService.getAllTags(user.id, user.role);
            return success({ tags }, 200, undefined, origin);
        }

        const taggedResearch = path.match(/^\/research\/([^\/]+)\/(?:tags|archive|unarchive)(?:\/|$)/);
        if (taggedResearch && !(await canAccessResearch(taggedResearch[1], decoded.sub))) {
            return researchNotFound(taggedResearch[1], decoded.sub, path, origin);
        }

        // GET /research/:id/tags
        const tagsGetMatch = path.match(/^\/research\/([^\/]+)\/tags$/);
        if (tagsGetMatch && httpMethod === 'GET') {
            const researchId = tagsGetMatch[1];
            const tags = await researchTagsService.getTagsForResearch(researchId);
            return success({ tags }, 200, undefined, origin);
        }

        // POST /research/:id/tags
        if (tagsGetMatch && httpMethod === 'POST') {
            const researchId = tagsGetMatch[1];
            const body = JSON.parse(event.body || '{}');
            if (!body.tag || typeof body.tag !== 'string') {
                return error('Tag is required', 400, undefined, origin);
            }
            await researchTagsService.addTag(researchId, body.tag);
            return success({ message: 'Tag added' }, 201, undefined, origin);
        }

        // DELETE /research/:id/tags/:tag
        const tagDeleteMatch = path.match(/^\/research\/([^\/]+)\/tags\/(.+)$/);
        if (tagDeleteMatch && httpMethod === 'DELETE') {
            const researchId = tagDeleteMatch[1];
            const tag = decodeURIComponent(tagDeleteMatch[2]);
            await researchTagsService.removeTag(researchId, tag);
            return success({ message: 'Tag removed' }, 200, undefined, origin);
        }

        // POST /research/:id/archive
        const archiveMatch = path.match(/^\/research\/([^\/]+)\/archive$/);
        if (archiveMatch && httpMethod === 'POST') {
            const researchId = archiveMatch[1];
            await researchTagsService.archiveResearch(researchId);
            return success({ message: 'Research archived' }, 200, undefined, origin);
        }

        // POST /research/:id/unarchive
        const unarchiveMatch = path.match(/^\/research\/([^\/]+)\/unarchive$/);
        if (unarchiveMatch && httpMethod === 'POST') {
            const researchId = unarchiveMatch[1];
            await researchTagsService.unarchiveResearch(researchId);
            return success({ message: 'Research unarchived' }, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: any) {
        console.error('Research controller error:', err);

        if (err.message === 'Invalid or expired token' || err.message === 'No token provided' || err.message === 'No authorization header') {
            return error(err.message, 401, undefined, origin);
        }

        return error(err.message || 'Internal server error', 500, undefined, origin);
    }
};

/**
 * Auto-trigger text analysis for all text modules in a research.
 * Finds VOC, Short Text, and Long Text modules and triggers LLM analysis
 * for each. Fire-and-forget — errors are logged, not thrown.
 */
async function autoTriggerTextAnalysis(researchId: string): Promise<void> {
    const pool = (await import('../../config/database')).default;
    const { triggerTextAnalysis } = await import('../analytics/text-analysis.service');

    // Find text-bearing modules: VOC + Short/Long Text
    const result = await pool.query(
        `SELECT m.id, m.name
         FROM modules m
         JOIN stages s ON s.id = m.stage_id
         WHERE s.research_id = ?
           AND (m.name IN ('VOC', 'Short Text', 'Long Text')
                OR m.name LIKE '%Short Text%'
                OR m.name LIKE '%Long Text%')`,
        [researchId]
    );

    const moduleIds: string[] = result.rows.map((r) => (r as { id: string }).id);

    // Also trigger for SmartVOC VOC (special moduleId = 'voc')
    const vocCheck = await pool.query(
        `SELECT 1 FROM responses
         WHERE research_id = ? AND component_id = 'answer'
         LIMIT 1`,
        [researchId]
    );
    if (vocCheck.rows.length > 0) {
        moduleIds.push('voc');
    }

    console.log(`[Auto-analysis] Triggering for research ${researchId}, ${moduleIds.length} modules`);

    for (const moduleId of moduleIds) {
        try {
            await triggerTextAnalysis(researchId, moduleId);
        } catch (err) {
            console.error(`[Auto-analysis] Failed for module ${moduleId}:`, err);
        }
    }
}
