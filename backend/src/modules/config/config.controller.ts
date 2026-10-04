import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { getRequestOrigin } from '../../utils/request';
import { loadSsmParameters } from '../../config/ssm';

/**
 * Config Controller
 * Provides dynamic configuration to frontends
 * No hardcoded endpoints - service discovery pattern
 */

export const handleConfigRoutes = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // GET /config - Public endpoint for frontend configuration
        if (path === '/config' && httpMethod === 'GET') {
            return await getConfig(origin);
        }

        return error('Config route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Internal server error';
        console.error('Config routes error:', errorMessage);
        return error(errorMessage, 500, undefined, origin);
    }
};

/**
 * Get dynamic configuration for frontends
 * Provides API routes, feature flags, and environment settings
 */
const getConfig = async (origin: string | null): Promise<APIGatewayProxyResult> => {
    // WebSocket API is deprecated - SSE is now used for real-time monitoring
    // Frontend should use /api/monitor/events/:researchId endpoint instead
    const websocketApiUrl: string | null = null;

    const config = {
        // API version
        version: '1.0.0',

        // Environment
        environment: process.env.API_STAGE || 'development',

        // WebSocket API URL (deprecated - use SSE endpoint instead)
        // Frontend will use /api/monitor/events/:researchId for real-time monitoring
        websocketApiUrl: websocketApiUrl,

        // API endpoints (relative paths - frontend will use same domain)
        endpoints: {
            // Auth
            auth: {
                login: '/auth/login',
                register: '/auth/register',
                me: '/auth/me',
                refresh: '/auth/refresh',
            },

            // Research
            research: {
                list: '/research',
                create: '/research',
                getById: '/research/:id',
                update: '/research/:id',
                delete: '/research/:id',
                activate: '/research/:id/activate',
                stages: '/research/:id/stages',
                modules: '/research/:id/modules',
                metrics: '/research/:id/metrics',
                participantsStatus: '/research/:id/participants/status',
                participantDetails: '/research/:id/participants/:participantId',
                deleteParticipant: '/research/:id/participants/:participantId',
                activity: '/research/:id/activity',
                getAllActivity: '/research/activity',
                collaborators: '/research/:id/collaborators',
            },

            // Research Progress
            researchProgress: {
                getResearchConfiguration: '/research-progress/research/:id',
                createConfig: '/research-progress/research/:id',
                updateConfig: '/research-progress/research/:id',
                delete: '/research-progress/research/:id',
                createParticipant: '/research-progress/config/:configId/participant',
                updateParticipantStatus: '/research-progress/participant/:participantId/status',
                getParticipants: '/research-progress/config/:configId/participants',
                getStats: '/research-progress/config/:configId/stats',
                generateLink: '/research-progress/config/:configId/link',
                getActiveLinks: '/research-progress/config/:configId/links',
                deactivateLink: '/research-progress/link/:token/deactivate',
                validateLink: '/research-progress/link/:token/validate',
                getResearchSummary: '/research-progress/research/:id/summary',
                registerPublicParticipant: '/research-progress/public/participant/start',
                updatePublicParticipantStatus: '/research-progress/public/participant/:participantId/status',
            },

            // Research Types
            researchTypes: {
                list: '/research-types',
                create: '/research-types',
                getById: '/research-types/:id',
                update: '/research-types/:id',
                delete: '/research-types/:id',
            },

            // Research Techniques
            researchTechniques: {
                list: '/research-techniques',
                create: '/research-techniques',
                getById: '/research-techniques/:id',
                update: '/research-techniques/:id',
                delete: '/research-techniques/:id',
                byType: '/research-techniques/by-type/:typeId',
            },

            // Modules
            modules: {
                list: '/modules',
                create: '/modules',
                getById: '/modules/:id',
                update: '/modules/:id',
                delete: '/modules/:id',
            },

            // Module Templates
            moduleTemplates: {
                list: '/module-templates',
                create: '/module-templates',
                getById: '/module-templates/:id',
                update: '/module-templates/:id',
                delete: '/module-templates/:id',
            },

            // Public endpoints (participant-frontend)
            public: {
                research: '/public/research/:id',
                validateDemographics: '/public/research/:id/validate-demographics',
                quotaAvailability: '/public/research/:id/quota-availability',
                submitResponse: '/public/research/:id/responses',
                mediaByKey: '/public/media/by-key',
                participationMode: '/public/research/:id/mode',
                kioskSession: '/public/research/:id/kiosk/session',
            },

            // Media
            media: {
                upload: '/media/upload',
                getUrl: '/media/:key',
                delete: '/media/:key',
            },

            // Analysis
            analysis: {
                research: '/analysis/research/:id',
            },

            // Enterprises
            enterprises: {
                list: '/enterprises',
                create: '/enterprises',
            },
        },

        // Feature flags
        features: {
            authentication: true,
            fileUpload: true,
            analytics: true,
            cache: true,
        },

        // Limits and constraints
        limits: {
            maxFileSize: 5 * 1024 * 1024, // 5MB
            maxResponseLength: 10000,
            requestTimeout: 30000, // 30s
        },

        // Cache settings
        cache: {
            enabled: true,
            ttl: 300, // 5 minutes
        },
    };

    return success(config, 200, undefined, origin);
};
