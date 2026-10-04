import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as modulesService from './modules.service';
import { getRequestOrigin } from '../../utils/request';
import { canAccessResearch, findResearchIdOf, isStageOfResearch, researchNotFound } from '../research/research-access';

export const handleModulesRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);
    try {
        const decoded = await requireAuth(event);
        const body = event.body ? JSON.parse(event.body) : {};

        // Viewer role: read-only
        if (decoded.role === 'viewer' && httpMethod !== 'GET') {
            return error('Viewer role is read-only', 403, undefined, origin);
        }

        const reorderMatch = path.match(/^\/modules\/([^\/]+)\/reorder$/);
        if (reorderMatch && httpMethod === 'POST') {
            const researchId = reorderMatch[1];
            if (!(await canAccessResearch(researchId, decoded.sub))) return researchNotFound(researchId, decoded.sub, path, origin);
            const result = await modulesService.reorder(researchId, body.modules);
            return success(result, 200, undefined, origin);
        }

        if (path === '/modules' && httpMethod === 'POST') {
            const researchId = body.research_id;
            if (typeof researchId !== 'string' || !researchId) return error('research_id is required', 400, undefined, origin);
            if (!(await canAccessResearch(researchId, decoded.sub))) return researchNotFound(researchId, decoded.sub, path, origin);
            if (body.stage_id && !(await isStageOfResearch(body.stage_id, researchId))) {
                return error(`Stage ${body.stage_id} does not belong to research ${researchId}`, 400, undefined, origin);
            }
            const module = await modulesService.create(researchId, body);
            return success({ module }, 201, undefined, origin);
        }

        const match = path.match(/^\/modules\/([^\/]+)$/);
        if (match) {
            const id = match[1];
            const researchId = await findResearchIdOf('module', id);
            if (!researchId) return error(`Module ${id} not found`, 404, undefined, origin);
            if (!(await canAccessResearch(researchId, decoded.sub))) return researchNotFound(researchId, decoded.sub, path, origin);
            if (httpMethod === 'PUT') {
                const module = await modulesService.update(id, body);
                return success({ module }, 200, undefined, origin);
            }
            if (httpMethod === 'DELETE') {
                const result = await modulesService.deleteModule(id);
                return success(result, 200, undefined, origin);
            }
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Modules error:', err);
        if (isAuthError(err)) {
            return error(errorMessage, err.statusCode, undefined, origin);
        }
        return error(errorMessage, 500, undefined, origin);
    }
};
