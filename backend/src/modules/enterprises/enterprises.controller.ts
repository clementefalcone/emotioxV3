import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as enterprisesService from './enterprises.service';
import * as authService from '../auth/auth.service';
import * as researchService from '../research';
import { getRequestOrigin } from '../../utils/request';
import { denyUnlessAdmin } from '../auth/admin-guard';

export const handleEnterprisesRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // All enterprises routes require authentication
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

        // GET /enterprises
        if (path === '/enterprises' && httpMethod === 'GET') {
            const enterprises = await enterprisesService.list();
            return success({ enterprises }, 200, undefined, origin);
        }

        // POST /enterprises
        if (path === '/enterprises' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const enterprise = await enterprisesService.create(body, user.id);
            return success({ enterprise }, 201, undefined, origin);
        }

        // GET /enterprises/:id/researches
        const researchesMatch = path.match(/^\/enterprises\/([^\/]+)\/researches$/);
        if (researchesMatch && httpMethod === 'GET') {
            const enterpriseId = researchesMatch[1];
            const researches = await researchService.listByEnterprise(enterpriseId, user.id, user.role);
            return success({ researches }, 200, undefined, origin);
        }

        // GET /enterprises/:id
        const getMatch = path.match(/^\/enterprises\/([^\/]+)$/);
        if (getMatch && httpMethod === 'GET') {
            const id = getMatch[1];
            try {
                const enterprise = await enterprisesService.getById(id);
                return success({ enterprise }, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (errorMessage.includes('not found')) {
                    return error('Enterprise not found', 404, undefined, origin);
                }
                throw err;
            }
        }

        // PUT /enterprises/:id
        const putMatch = path.match(/^\/enterprises\/([^\/]+)$/);
        if (putMatch && httpMethod === 'PUT') {
            const id = putMatch[1];
            const body = JSON.parse(event.body || '{}');
            const enterprise = await enterprisesService.update(id, body);
            return success({ enterprise }, 200, undefined, origin);
        }

        // DELETE /enterprises/:id
        const deleteMatch = path.match(/^\/enterprises\/([^\/]+)$/);
        if (deleteMatch && httpMethod === 'DELETE') {
            const id = deleteMatch[1];
            const result = await enterprisesService.deleteEnterprise(id);
            return success(result, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Enterprises controller error:', err);

        if (errorMessage === 'Invalid or expired token' || errorMessage === 'No authorization header' || errorMessage === 'No token provided') {
            return error(errorMessage, 401, undefined, origin);
        }

        return error(errorMessage || 'Internal server error', 500, undefined, origin);
    }
};

