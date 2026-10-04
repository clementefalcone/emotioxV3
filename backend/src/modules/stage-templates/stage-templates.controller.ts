import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as stageTemplatesService from './stage-templates.service';
import * as authService from '../auth/auth.service';
import { getRequestOrigin } from '../../utils/request';
import { denyUnlessAdmin } from '../auth/admin-guard';

export const handleStageTemplatesRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // All stage-templates routes require authentication
        let user;
        try {
            const decoded = await requireAuth(event);
            user = await authService.getMe(decoded.sub);
        } catch (authError: unknown) {
            const authErrorMessage = authError instanceof Error ? authError.message : 'Authentication failed';
            if (isAuthError(authError)) {
                return error(authErrorMessage, authError.statusCode, undefined, origin);
            }
            throw authError;
        }

        if (httpMethod !== 'GET') {
            const denied = denyUnlessAdmin(user, event, origin);
            if (denied) return denied;
        }

        // GET /stage-templates
        if (path === '/stage-templates' && httpMethod === 'GET') {
            const templates = await stageTemplatesService.list();
            return success(templates, 200, undefined, origin);
        }

        // POST /stage-templates
        if (path === '/stage-templates' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');

            if (!body.name) {
                return error('Name is required', 400, undefined, origin);
            }

            const template = await stageTemplatesService.create({
                ...body,
                created_by: user.id
            });
            return success(template, 201, undefined, origin);
        }

        // GET /stage-templates/:id
        if (path.match(/^\/stage-templates\/[a-zA-Z0-9-]+$/) && httpMethod === 'GET') {
            const id = path.split('/').pop() || '';
            const template = await stageTemplatesService.getById(id);
            return success(template, 200, undefined, origin);
        }

        // PUT /stage-templates/:id
        if (path.match(/^\/stage-templates\/[a-zA-Z0-9-]+$/) && httpMethod === 'PUT') {
            const id = path.split('/').pop() || '';
            const body = JSON.parse(event.body || '{}');
            const template = await stageTemplatesService.update(id, body);
            return success(template, 200, undefined, origin);
        }

        // DELETE /stage-templates/:id
        if (path.match(/^\/stage-templates\/[a-zA-Z0-9-]+$/) && httpMethod === 'DELETE') {
            const id = path.split('/').pop() || '';
            await stageTemplatesService.deleteTemplate(id);
            return success({ message: 'Stage template deleted successfully' }, 200, undefined, origin);
        }

        // POST /stage-templates/:id/modules
        if (path.match(/^\/stage-templates\/[a-zA-Z0-9-]+\/modules$/) && httpMethod === 'POST') {
            const id = path.split('/')[2];
            const body = JSON.parse(event.body || '{}');

            if (!body.moduleId) {
                return error('moduleId is required', 400, undefined, origin);
            }

            const result = await stageTemplatesService.addModule(id, body.moduleId, body.displayOrder);
            return success(result, 200, undefined, origin);
        }

        // DELETE /stage-templates/:id/modules/:moduleId
        if (path.match(/^\/stage-templates\/[a-zA-Z0-9-]+\/modules\/[a-zA-Z0-9-]+$/) && httpMethod === 'DELETE') {
            const parts = path.split('/');
            const stageId = parts[2];
            const moduleId = parts[4];
            const result = await stageTemplatesService.removeModule(stageId, moduleId);
            return success(result, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: any) {
        if (err.message === 'Stage template not found') {
            return error('Stage template not found', 404, undefined, origin);
        }
        console.error('Stage Templates error:', err);
        return error(err.message || 'Internal server error', 500, undefined, origin);
    }
};
