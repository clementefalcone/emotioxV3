import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error, getCorsHeaders } from './utils/response';

/**
 * Normalizes the API Gateway path by removing the stage prefix if present
 * API Gateway with {proxy+} may include the stage in the path (e.g., /dev/auth/me)
 * @param path - Original path from API Gateway
 * @param stage - Stage name from request context
 * @returns Normalized path without stage prefix
 */
const normalizePath = (path: string, stage?: string): string => {
    if (!stage) {
        return path;
    }
    
    // Remove stage prefix if present (e.g., /dev/auth/me -> /auth/me)
    const stagePrefix = `/${stage}`;
    if (path.startsWith(stagePrefix)) {
        return path.substring(stagePrefix.length) || '/';
    }
    
    return path;
};

export const route = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path: rawPath, requestContext } = event;
    
    // Normalize path to remove stage prefix if present
    const stage = requestContext?.stage;
    const path = normalizePath(rawPath, stage);

    console.log(`${httpMethod} ${rawPath} -> ${path}${stage ? ` (stage: ${stage})` : ''}`);
    
    // Debug logging for add-welcome-thankyou endpoint
    if (path.includes('add-welcome-thankyou')) {
        console.log('[Router] add-welcome-thankyou request detected:', { httpMethod, rawPath, path, stage });
    }

    const origin = event.headers.Origin || event.headers.origin || null;

    // Handle OPTIONS for CORS preflight
    // Tracking endpoints use permissive CORS (Access-Control-Allow-Origin: *) — delegate to their controller
    if (httpMethod === 'OPTIONS' && path.startsWith('/public/tracking')) {
        const { handlePublicTrackingRoutes } = await import('./modules/tracking/tracking.controller');
        const normalizedEvent: APIGatewayProxyEvent = { ...event, path };
        return await handlePublicTrackingRoutes(normalizedEvent);
    }

    // IMPORTANTE: API Gateway puede interceptar OPTIONS, pero debemos responder con headers correctos
    if (httpMethod === 'OPTIONS') {
        const corsHeaders = getCorsHeaders(origin);
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'OK' }),
        };
    }

    // Health check
    if (path === '/health' && httpMethod === 'GET') {
        return success({ status: 'healthy', timestamp: new Date().toISOString() }, 200, undefined, origin);
    }

    // Config endpoint (public - no auth required)
    if (path === '/config' && httpMethod === 'GET') {
        const { handleConfigRoutes } = await import('./modules/config/config.controller');
        const normalizedEvent: APIGatewayProxyEvent = {
            ...event,
            path,
        };
        return await handleConfigRoutes(normalizedEvent);
    }

    // Route to modules (will be implemented)
    try {
        // Create a normalized event with the corrected path
        const normalizedEvent: APIGatewayProxyEvent = {
            ...event,
            path,
        };
        
        // Auth routes
        if (path.startsWith('/auth')) {
            const { handleAuthRoutes } = await import('./modules/auth/auth.controller');
            return await handleAuthRoutes(normalizedEvent);
        }

        // Enterprises routes
        if (path.startsWith('/enterprises')) {
            const { handleEnterprisesRoutes } = await import('./modules/enterprises/enterprises.controller');
            return await handleEnterprisesRoutes(normalizedEvent);
        }

        // Research Techniques routes (admin only)
        if (path.startsWith('/research-techniques')) {
            const { handleResearchTechniquesRoutes } = await import('./modules/research-techniques/research-techniques.controller');
            return await handleResearchTechniquesRoutes(normalizedEvent);
        }

        // Research Types routes (admin only)
        if (path.startsWith('/research-types')) {
            const { handleResearchTypesRoutes } = await import('./modules/research-types/research-types.controller');
            return await handleResearchTypesRoutes(normalizedEvent);
        }

        // Eye tracking recruit routes (must be before /research to avoid conflicts)
        if (path.startsWith('/eye-tracking-recruit')) {
            const { handleResearchRoutes } = await import('./modules/research/research.controller');
            return await handleResearchRoutes(normalizedEvent);
        }

        // Research routes (must be after research-types and research-techniques to avoid conflicts)
        if (path.startsWith('/research') && !path.startsWith('/research-types') && !path.startsWith('/research-techniques')) {
            const { handleResearchRoutes } = await import('./modules/research/research.controller');
            return await handleResearchRoutes(normalizedEvent);
        }

        // Stages routes (for stage-specific operations like reordering modules)
        if (path.startsWith('/stages')) {
            const { handleResearchRoutes } = await import('./modules/research/research.controller');
            return await handleResearchRoutes(normalizedEvent);
        }

        // Modules routes
        if (path.startsWith('/modules')) {
            const { handleModulesRoutes } = await import('./modules/modules/modules.controller');
            return await handleModulesRoutes(normalizedEvent);
        }

        // Module Templates routes
        if (path.startsWith('/module-templates')) {
            const { handleModuleTemplatesRoutes } = await import('./modules/module-templates/module-templates.controller');
            return await handleModuleTemplatesRoutes(normalizedEvent);
        }

        // Stage Templates routes
        if (path.startsWith('/stage-templates')) {
            const { handleStageTemplatesRoutes } = await import('./modules/stage-templates/stage-templates.controller');
            return await handleStageTemplatesRoutes(normalizedEvent);
        }

        // Media routes
        if (path.startsWith('/media')) {
            const { handleMediaRoutes } = await import('./modules/media/media.controller');
            return await handleMediaRoutes(normalizedEvent);
        }

        // Participants routes (panel mode: import, list, delete)
        if (path.startsWith('/participants')) {
            const { handleParticipantsRoutes } = await import('./modules/participants/participants.controller');
            return await handleParticipantsRoutes(normalizedEvent);
        }

        // Responses routes
        if (path.startsWith('/responses')) {
            const { handleResponsesRoutes } = await import('./modules/responses/responses.controller');
            return await handleResponsesRoutes(normalizedEvent);
        }

        // Public routes (no auth)
        if (path.startsWith('/public/tracking')) {
            const { handlePublicTrackingRoutes } = await import('./modules/tracking/tracking.controller');
            return await handlePublicTrackingRoutes(normalizedEvent);
        }

        if (path.startsWith('/public/analytics')) {
            const rewritten = { ...normalizedEvent, path: path.replace('/public/analytics', '/analytics') };
            const { handleAnalyticsRoutes } = await import('./modules/analytics/analytics.controller');
            return await handleAnalyticsRoutes(rewritten);
        }

        if (path.startsWith('/public/responses')) {
            const rewritten = { ...normalizedEvent, path: path.replace('/public/responses', '/responses') };
            const { handleResponsesRoutes } = await import('./modules/responses/responses.controller');
            return await handleResponsesRoutes(rewritten);
        }

        if (path.startsWith('/public/participants')) {
            const rewritten = { ...normalizedEvent, path: path.replace('/public/participants', '/participants') };
            const { handleParticipantsRoutes } = await import('./modules/participants/participants.controller');
            return await handleParticipantsRoutes(rewritten);
        }

        if (path.startsWith('/public/modules')) {
            const rewritten = { ...normalizedEvent, path: path.replace('/public/modules', '/modules') };
            const { handleModulesRoutes } = await import('./modules/modules/modules.controller');
            return await handleModulesRoutes(rewritten);
        }

        if (path.startsWith('/public')) {
            const { handlePublicRoutes } = await import('./modules/public/public.controller');
            return await handlePublicRoutes(normalizedEvent);
        }

        // Users routes (publicly exposed as requested)
        if (path.startsWith('/users')) {
            const { handleUsersRoutes } = await import('./modules/users/users.controller');
            return await handleUsersRoutes(normalizedEvent);
        }

        // Analytics routes
        if (path.startsWith('/analytics')) {
            const { handleAnalyticsRoutes } = await import('./modules/analytics/analytics.controller');
            return await handleAnalyticsRoutes(normalizedEvent);
        }

        // Tracking routes (authenticated — research-frontend)
        if (path.startsWith('/tracking')) {
            const { handleTrackingRoutes } = await import('./modules/tracking/tracking.controller');
            return await handleTrackingRoutes(normalizedEvent);
        }

        // Cerulean Ledger integration routes
        if (path.startsWith('/cerulean')) {
            const { handleCeruleanRoutes } = await import('./modules/cerulean/cerulean.controller');
            return await handleCeruleanRoutes(normalizedEvent);
        }

        // Attention Prediction routes
        if (path.startsWith('/attention-prediction')) {
            const { handleAttentionPredictionRoutes } = await import('./modules/attention-prediction/attention-prediction.controller');
            return await handleAttentionPredictionRoutes(normalizedEvent);
        }

        // Insights Finding routes (LLM text analysis)
        if (path.startsWith('/insights')) {
            const { handleInsightsRoutes } = await import('./modules/insights/insights.controller');
            return await handleInsightsRoutes(normalizedEvent);
        }

        // Cache routes (admin only - add auth check as needed)
        if (path.startsWith('/cache')) {
            const { handleCacheRoutes } = await import('./modules/cache/cache.controller');
            return await handleCacheRoutes(normalizedEvent);
        }

        // 404 Not Found
        return error('Route not found', 404, undefined, origin);

    } catch (err: unknown) {
        console.error('Router error:', err);
        const message = err instanceof Error ? err.message : 'Internal server error';
        return error(message, 500, undefined, origin);
    }
};
