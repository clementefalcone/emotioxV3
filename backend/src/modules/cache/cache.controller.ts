import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { getStats, clearAll, clearByPattern } from './cache.service';
import { getRequestOrigin } from '../../utils/request';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as authService from '../auth/auth.service';
import { denyUnlessAdmin } from '../auth/admin-guard';

export const handleCacheRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        const decoded = await requireAuth(event);
        const user = await authService.getMe(decoded.sub);
        const adminDenied = denyUnlessAdmin(user, event, origin);
        if (adminDenied) return adminDenied;

        // GET /cache/stats - Get cache statistics
        if (path === '/cache/stats' && httpMethod === 'GET') {
            const stats = getStats();
            return success(stats, 200, undefined, origin);
        }

        // DELETE /cache/clear - Clear all caches (admin only)
        if (path === '/cache/clear' && httpMethod === 'DELETE') {
            clearAll();
            return success({ message: 'All caches cleared successfully' }, 200, undefined, origin);
        }

        // DELETE /cache/pattern - Clear caches by pattern (admin only)
        if (path === '/cache/pattern' && httpMethod === 'DELETE') {
            const body = JSON.parse(event.body || '{}');
            const { pattern } = body;
            
            if (!pattern) {
                return error('Pattern is required', 400, undefined, origin);
            }
            
            const count = clearByPattern(pattern);
            return success({ 
                message: `Cleared ${count} cache entries`,
                count 
            }, 200, undefined, origin);
        }

        return error('Cache route not found', 404, undefined, origin);
    } catch (err: any) {
        if (isAuthError(err)) return error(err.message, err.statusCode, undefined, origin);
        console.error('Cache controller error:', err);
        return error(err.message || 'Internal server error', 500, undefined, origin);
    }
};
