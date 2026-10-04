import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as responsesService from './responses.service';
import { canAccessResearch, researchNotFound } from '../research/research-access';

export const handleResponsesRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin: string | null = (event.headers.Origin || event.headers.origin || null) as string | null;
    try {
        const decoded = await requireAuth(event);

        const scopedResearch = path.match(/^\/responses\/research\/([^\/]+)/);
        if (scopedResearch && !(await canAccessResearch(scopedResearch[1], decoded.sub))) {
            return researchNotFound(scopedResearch[1], decoded.sub, path, origin);
        }

        const match = path.match(/^\/responses\/research\/([^\/]+)$/);
        if (match && httpMethod === 'GET') {
            const researchId = match[1];
            const qs = event.queryStringParameters || {};
            const limit = Math.min(parseInt(qs.limit || '') || 5000, 10000);
            const offset = parseInt(qs.offset || '') || 0;
            const responses = await responsesService.getByResearch(researchId, limit, offset);
            return success({ responses }, 200, undefined, origin);
        }

        const participantMatch = path.match(/^\/responses\/research\/([^\/]+)\/participant\/([^\/]+)$/);
        if (participantMatch && httpMethod === 'GET') {
            const [, researchId, participantId] = participantMatch;
            const responses = await responsesService.getByParticipant(researchId, participantId);
            return success({ responses }, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Responses error:', err);
        if (isAuthError(err)) {
            return error(errorMessage, err.statusCode, undefined, origin);
        }
        return error(errorMessage, 500, undefined, origin);
    }
};
