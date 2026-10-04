import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as researchTypesService from './research-types.service';
import * as authService from '../auth/auth.service';
import { getRequestOrigin } from '../../utils/request';
import cache, { CacheKeys } from '../../config/cache';
import { denyUnlessAdmin } from '../auth/admin-guard';

export const handleResearchTypesRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // All research-types routes require authentication
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

        // GET /research-types
        if (path === '/research-types' && httpMethod === 'GET') {
            // Force cache invalidation first to ensure fresh data
            cache.delete(CacheKeys.RESEARCH_TYPES_LIST);
            
            const types = await researchTypesService.list();
            // Double-check: filter out any inactive types (shouldn't happen, but safety check)
            // MySQL returns 1/0 for boolean, handle both true/1 and false/0/null
            const activeTypes = Array.isArray(types) ? types.filter((rt: Record<string, unknown>) => {
                const isActive = rt.is_active;
                // Consider active if: true, 1, '1', or undefined (for backwards compatibility)
                // Consider inactive if: false, 0, '0', null
                if (isActive === false || isActive === 0 || isActive === '0' || isActive === null) {
                    return false;
                }
                return true; // true, 1, '1', undefined all count as active
            }) : [];
            console.log(`[Research Types Controller] Returning ${activeTypes.length} active research types (filtered from ${Array.isArray(types) ? types.length : 0} total)`);
            if (activeTypes.length !== 4) {
                console.warn(`[Research Types Controller] WARNING: Expected 4 active types, got ${activeTypes.length}`);
            }
            return success({ researchTypes: activeTypes }, 200, undefined, origin);
        }

        // POST /research-types
        if (path === '/research-types' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const type = await researchTypesService.create(body, user.id);
            return success({ researchType: type }, 201, undefined, origin);
        }

        // GET /research-types/:id
        const getMatch = path.match(/^\/research-types\/([^\/]+)$/);
        if (getMatch && httpMethod === 'GET') {
            const id = getMatch[1];
            try {
                const type = await researchTypesService.getById(id);
                return success({ researchType: type }, 200, undefined, origin);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (errorMessage.includes('not found')) {
                    return error('Research type not found', 404, undefined, origin);
                }
                throw err;
            }
        }

        // PUT /research-types/:id
        const putMatch = path.match(/^\/research-types\/([^\/]+)$/);
        if (putMatch && httpMethod === 'PUT') {
            const id = putMatch[1];
            const body = JSON.parse(event.body || '{}');
            const type = await researchTypesService.update(id, body);
            return success({ researchType: type }, 200, undefined, origin);
        }

        // DELETE /research-types/:id
        const deleteMatch = path.match(/^\/research-types\/([^\/]+)$/);
        if (deleteMatch && httpMethod === 'DELETE') {
            const id = deleteMatch[1];
            const result = await researchTypesService.deleteResearchType(id);
            return success(result, 200, undefined, origin);
        }

        // PATCH /research-types/:id/modules
        const modulesMatch = path.match(/^\/research-types\/([^\/]+)\/modules$/);
        if (modulesMatch && httpMethod === 'PATCH') {
            const id = modulesMatch[1];
            const body = JSON.parse(event.body || '{}');
            const type = await researchTypesService.updateModules(id, body.modules);
            return success({ researchType: type }, 200, undefined, origin);
        }

        // GET /research-types/:id/techniques
        const techniquesMatch = path.match(/^\/research-types\/([^\/]+)\/techniques$/);
        if (techniquesMatch && httpMethod === 'GET') {
            const id = techniquesMatch[1];
            console.log(`[Research Types Controller] GET /research-types/${id}/techniques - Request received`);
            console.log(`[Research Types Controller] Request origin: ${origin}`);
            
            try {
                console.log(`[Research Types Controller] Calling getTechniquesByType for id: ${id}`);
                const techniques = await researchTypesService.getTechniquesByType(id);
                console.log(`[Research Types Controller] getTechniquesByType returned:`, techniques);
                console.log(`[Research Types Controller] Techniques type:`, typeof techniques, 'isArray:', Array.isArray(techniques));
                
                // Ensure we always return an array
                const techniquesArray = Array.isArray(techniques) ? techniques : [];
                console.log(`[Research Types Controller] Returning ${techniquesArray.length} techniques for type ${id}`);
                console.log(`[Research Types Controller] Response data:`, JSON.stringify({ researchTechniques: techniquesArray }, null, 2));
                
                const response = success({ researchTechniques: techniquesArray }, 200, undefined, origin);
                console.log(`[Research Types Controller] Success response created, statusCode: ${response.statusCode}`);
                return response;
            } catch (techError) {
                console.error(`[Research Types Controller] ERROR getting techniques for type ${id}:`, techError);
                console.error(`[Research Types Controller] Error type:`, typeof techError);
                console.error(`[Research Types Controller] Error constructor:`, techError?.constructor?.name);
                
                if (techError instanceof Error) {
                    console.error(`[Research Types Controller] Error message:`, techError.message);
                    console.error(`[Research Types Controller] Error stack:`, techError.stack);
                }
                
                // Return empty array instead of error to prevent frontend crash
                console.log(`[Research Types Controller] Returning empty array due to error`);
                return success({ researchTechniques: [] }, 200, undefined, origin);
            }
        }

        // GET /research-types/:id/module-assignments
        const getModulesMatch = path.match(/^\/research-types\/([^\/]+)\/module-assignments$/);
        if (getModulesMatch && httpMethod === 'GET') {
            const id = getModulesMatch[1];
            const modules = await researchTypesService.getModulesByType(id);
            return success({ moduleTemplates: modules }, 200, undefined, origin);
        }

        // PUT /research-types/:id/module-assignments
        const putModulesMatch = path.match(/^\/research-types\/([^\/]+)\/module-assignments$/);
        if (putModulesMatch && httpMethod === 'PUT') {
            const id = putModulesMatch[1];
            const body = JSON.parse(event.body || '{}');
            const result = await researchTypesService.updateModuleAssignments(id, body.moduleTemplateIds);
            return success(result, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Research types controller error:', err);

        if (isAuthError(err)) {
            return error(errorMessage, err.statusCode, undefined, origin);
        }

        return error(errorMessage || 'Internal server error', 500, undefined, origin);
    }
};
