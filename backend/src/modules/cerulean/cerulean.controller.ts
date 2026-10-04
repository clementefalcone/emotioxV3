/**
 * Cerulean Ledger Controller
 * Endpoints for blockchain integration features.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as authService from '../auth/auth.service';
import { getRequestOrigin } from '../../utils/request';
import * as ceruleanClient from './client';
import * as integrationService from './integration.service';
import { canAccessResearch, researchNotFound } from '../research/research-access';

export const handleCeruleanRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        const decoded = await requireAuth(event);
        const user = await authService.getMe(decoded.sub);

        if (decoded.role === 'viewer' && httpMethod !== 'GET') {
            return error('Viewer role is read-only', 403, undefined, origin);
        }

        const scopedResearch = path.match(/^\/cerulean\/research\/([^/]+)/);
        if (scopedResearch && !(await canAccessResearch(scopedResearch[1], decoded.sub))) {
            return researchNotFound(scopedResearch[1], decoded.sub, path, origin);
        }

        // GET /cerulean/status — check if integration is enabled + API reachable
        if (path === '/cerulean/status' && httpMethod === 'GET') {
            return success({
                enabled: ceruleanClient.isEnabled(),
                apiUrl: ceruleanClient.getApiUrl(),
            }, 200, undefined, origin);
        }

        // POST /cerulean/research/:id/certify — certify research integrity on blockchain
        const certifyMatch = path.match(/^\/cerulean\/research\/([^\/]+)\/certify$/);
        if (certifyMatch && httpMethod === 'POST') {
            const researchId = certifyMatch[1];
            const certification = await integrationService.certifyResearchIntegrity(researchId);
            if (!certification) {
                return error('Blockchain certification failed or disabled', 503, undefined, origin);
            }
            await integrationService.recordAuditEvent(researchId, 'research.certified', user.id);
            return success({ certification }, 201, undefined, origin);
        }

        // GET /cerulean/research/:id/verify — verify integrity against blockchain
        const verifyMatch = path.match(/^\/cerulean\/research\/([^\/]+)\/verify$/);
        if (verifyMatch && httpMethod === 'GET') {
            const researchId = verifyMatch[1];
            const verification = await integrationService.verifyResearchIntegrity(researchId);
            return success({ verification }, 200, undefined, origin);
        }

        // POST /cerulean/research/:id/certificate — issue study completion certificate
        const certificateMatch = path.match(/^\/cerulean\/research\/([^\/]+)\/certificate$/);
        if (certificateMatch && httpMethod === 'POST') {
            const researchId = certificateMatch[1];
            const result = await integrationService.issueStudyCertificate(researchId);
            if (!result) {
                return error('Certificate issuance failed or disabled', 503, undefined, origin);
            }
            return success({ credentialId: result.credentialId }, 201, undefined, origin);
        }

        // GET /cerulean/research/:id/certificate — get certificate info
        if (certificateMatch && httpMethod === 'GET') {
            const researchId = certificateMatch[1];
            const configResult = await (await import('../../config/database')).default.query(
                'SELECT config FROM researches WHERE id = ?', [researchId]
            );
            const config = typeof configResult.rows[0]?.config === 'string'
                ? JSON.parse(configResult.rows[0].config)
                : configResult.rows[0]?.config || {};

            const credentialId = config.blockchainCredentialId;
            if (!credentialId) {
                return error('No certificate found', 404, undefined, origin);
            }

            const credential = await ceruleanClient.getCredential(credentialId);
            return success({ credentialId, credential }, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        if (isAuthError(err)) return error(err.message, err.statusCode, undefined, origin);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Cerulean Controller]', msg);
        return error(msg, 500, undefined, origin);
    }
};
