import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as moduleTemplatesService from './module-templates.service';
import * as authService from '../auth/auth.service';
import { getRequestOrigin } from '../../utils/request';
import { denyUnlessAdmin } from '../auth/admin-guard';

export const handleModuleTemplatesRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // All module-templates routes require authentication
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

        // GET /module-templates
        if (path === '/module-templates' && httpMethod === 'GET') {
            const templates = await moduleTemplatesService.list();
            return success(templates, 200, undefined, origin);
        }

        // POST /module-templates
        if (path === '/module-templates' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');

            if (!body.name) {
                return error('Name is required', 400, undefined, origin);
            }

            const template = await moduleTemplatesService.create({
                ...body,
                created_by: user.id
            });
            return success(template, 201, undefined, origin);
        }

        // GET /module-templates/:id/usage
        if (path.match(/^\/module-templates\/[a-zA-Z0-9-]+\/usage$/) && httpMethod === 'GET') {
            const id = path.split('/')[2] || '';
            const usage = await moduleTemplatesService.getUsage(id);
            return success(usage, 200, undefined, origin);
        }

        // GET /module-templates/:id
        if (path.match(/^\/module-templates\/[a-zA-Z0-9-]+$/) && httpMethod === 'GET') {
            const id = path.split('/').pop() || '';
            const template = await moduleTemplatesService.getById(id);
            return success(template, 200, undefined, origin);
        }

        // PUT /module-templates/:id
        if (path.match(/^\/module-templates\/[a-zA-Z0-9-]+$/) && httpMethod === 'PUT') {
            const id = path.split('/').pop() || '';
            const body = JSON.parse(event.body || '{}');
            const template = await moduleTemplatesService.update(id, body);
            return success(template, 200, undefined, origin);
        }

        // DELETE /module-templates/:id
        if (path.match(/^\/module-templates\/[a-zA-Z0-9-]+$/) && httpMethod === 'DELETE') {
            const id = path.split('/').pop() || '';
            await moduleTemplatesService.deleteTemplate(id);
            return success({ message: 'Module template deleted successfully' }, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: any) {
        if (err.message === 'Module template not found') {
            return error('Module template not found', 404, undefined, origin);
        }
        console.error('Module Templates error:', err);
        return error(err.message || 'Internal server error', 500, undefined, origin);
    }
};
