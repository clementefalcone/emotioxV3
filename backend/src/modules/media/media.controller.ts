import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth.local';
import * as mediaService from './media.service.local';
import { getRequestOrigin } from '../../utils/request';
import { analyzeStimulusComplexity } from './stimulus-complexity.service';
import { canAccessMediaPath, canAccessResearch, findResearchIdOf, researchIdFromMediaPath, researchNotFound } from '../research/research-access';

export const handleMediaRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);
    try {
        const decoded = await requireAuth(event);
        const body = event.body ? JSON.parse(event.body) : {};

        if (decoded.role === 'viewer' && httpMethod !== 'GET') {
            return error('Viewer role is read-only', 403, undefined, origin);
        }

        const denyUnlessAccessible = async (researchId: string) =>
            (await canAccessResearch(researchId, decoded.sub)) ? null : researchNotFound(researchId, decoded.sub, path, origin);
        const mediaNotFound = (mediaPath: string) => {
            console.warn(JSON.stringify({ event: 'media_access_denied', mediaPath, userSub: decoded.sub, path }));
            return error(`Media ${mediaPath} not found`, 404, undefined, origin);
        };

        if (path === '/media/analyze-complexity' && httpMethod === 'POST') {
            const { s3Key } = body;
            if (!s3Key) return error('s3Key is required', 400, undefined, origin);
            if (!(await canAccessMediaPath(s3Key, decoded.sub))) return mediaNotFound(s3Key);
            const result = await analyzeStimulusComplexity(s3Key);
            return success(result, 200, undefined, origin);
        }

        if (path === '/media/upload' && httpMethod === 'POST') {
            const { research_id, file_name, content_type } = body;
            if (typeof research_id !== 'string' || !research_id) return error('research_id is required', 400, undefined, origin);
            const denied = await denyUnlessAccessible(research_id);
            if (denied) return denied;
            const result = await mediaService.generateUploadUrl(research_id, file_name, content_type);
            return success(result, 200, undefined, origin);
        }

        if (path === '/media' && httpMethod === 'POST') {
            const { research_id, question_id, media_path, s3_key, metadata } = body;
            // Compatibilidad: aceptar s3_key o media_path
            const pathToUse = media_path || s3_key;
            if (!pathToUse) {
                return error('media_path or s3_key is required', 400, undefined, origin);
            }
            if (typeof research_id !== 'string' || researchIdFromMediaPath(pathToUse) !== research_id) {
                return error(`media_path must be inside research/${research_id}/`, 400, undefined, origin);
            }
            const denied = await denyUnlessAccessible(research_id);
            if (denied) return denied;
            const media = await mediaService.saveMetadata(research_id, question_id, pathToUse, metadata);
            return success({ media }, 201, undefined, origin);
        }

        if (path === '/media/by-key' && httpMethod === 'GET') {
            const mediaPath = event.queryStringParameters?.media_path || event.queryStringParameters?.s3_key;
            if (!mediaPath) {
                return error('media_path or s3_key query parameter is required', 400, undefined, origin);
            }
            if (!(await canAccessMediaPath(mediaPath, decoded.sub))) return mediaNotFound(mediaPath);
            const result = await mediaService.getMediaUrlByPath(mediaPath);
            return success(result, 200, undefined, origin);
        }

        const idMatch = path.match(/^\/media\/([^\/]+)$/);
        if (idMatch && (httpMethod === 'GET' || httpMethod === 'DELETE')) {
            const id = idMatch[1];
            const researchId = await findResearchIdOf('media', id);
            if (!researchId) return error(`Media ${id} not found`, 404, undefined, origin);
            const denied = await denyUnlessAccessible(researchId);
            if (denied) return denied;
            const result = httpMethod === 'GET' ? await mediaService.getMediaUrlById(id) : await mediaService.deleteMedia(id);
            return success(result, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Media error:', err);
        if (isAuthError(err)) {
            return error(errorMessage, err.statusCode, undefined, origin);
        }
        if (errorMessage.includes('not found') || errorMessage.includes('Not found')) {
            return error(errorMessage, 404, undefined, origin);
        }
        return error(errorMessage, 500, undefined, origin);
    }
};
