import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { error } from '../../utils/response';

export const denyUnlessAdmin = (
    user: { id: string; role: string },
    event: Pick<APIGatewayProxyEvent, 'httpMethod' | 'path'>,
    origin: string | null,
): APIGatewayProxyResult | null => {
    if (user.role === 'admin') return null;
    console.warn(JSON.stringify({ event: 'admin_required', userId: user.id, method: event.httpMethod, path: event.path }));
    return error('Admin role required', 403, undefined, origin);
};
