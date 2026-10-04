import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as researchTechniquesService from './research-techniques.service';
import * as authService from '../auth/auth.service';
import { getRequestOrigin } from '../../utils/request';
import { denyUnlessAdmin } from '../auth/admin-guard';

export const handleResearchTechniquesRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // All research-techniques routes require authentication (admin check removed temporarily)
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

        // GET /research-techniques
        if (path === '/research-techniques' && httpMethod === 'GET') {
            const techniques = await researchTechniquesService.list();
            return success({ researchTechniques: techniques }, 200, undefined, origin);
        }

        // POST /research-techniques
        if (path === '/research-techniques' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const technique = await researchTechniquesService.create(body, user.id);
            return success({ researchTechnique: technique }, 201, undefined, origin);
        }

        // GET /research-techniques/:id
        const getMatch = path.match(/^\/research-techniques\/([^\/]+)$/);
        if (getMatch && httpMethod === 'GET') {
            const id = getMatch[1];
            try {
                const technique = await researchTechniquesService.getById(id);
                return success({ researchTechnique: technique }, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (errorMessage.includes('not found')) {
                    return error('Research technique not found', 404, undefined, origin);
                }
                throw err;
            }
        }

        // PUT /research-techniques/:id
        const putMatch = path.match(/^\/research-techniques\/([^\/]+)$/);
        if (putMatch && httpMethod === 'PUT') {
            const id = putMatch[1];
            const body = JSON.parse(event.body || '{}');
            const technique = await researchTechniquesService.update(id, body);
            return success({ researchTechnique: technique }, 200, undefined, origin);
        }

        // DELETE /research-techniques/:id
        const deleteMatch = path.match(/^\/research-techniques\/([^\/]+)$/);
        if (deleteMatch && httpMethod === 'DELETE') {
            const id = deleteMatch[1];
            const result = await researchTechniquesService.deleteResearchTechnique(id);
            return success(result, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Research techniques controller error:', err);

        if (errorMessage === 'Admin access required') {
            return error(errorMessage, 403, undefined, origin);
        }

        if (errorMessage === 'Invalid or expired token' || errorMessage === 'No authorization header' || errorMessage === 'No token provided') {
            return error(errorMessage, 401, undefined, origin);
        }

        return error(errorMessage || 'Internal server error', 500, undefined, origin);
    }
};

