import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as analyticsService from './index';
import { getRequestOrigin } from '../../utils/request';
import pool from '../../config/database';
import { buildUserOwnership, canAccessResearch, researchNotFound } from '../research/research-access';

const collectSmartVOCResults = async (researchFilter: string, params: string[]) => {
    const researches = await pool.query(
        `SELECT r.id, r.name, e.name AS enterprise_name
         FROM researches r
         LEFT JOIN enterprises e ON e.id = r.enterprise_id
         WHERE ${researchFilter} AND r.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM modules m JOIN stages st ON st.id = m.stage_id WHERE m.research_id = r.id AND st.name = 'Smart VOC')
         ORDER BY r.created_at DESC`,
        params,
    );
    const results = [];
    for (const row of researches.rows) {
        try {
            const smartVoc = await analyticsService.getSmartVOCResults(row.id);
            if (smartVoc.totalResponses > 0) {
                results.push({ researchId: row.id, researchName: row.name, enterpriseName: row.enterprise_name, ...smartVoc });
            }
        } catch (err) {
            console.warn(JSON.stringify({ event: 'smartvoc_consolidation_skipped', researchId: row.id, error: err instanceof Error ? err.message : String(err) }));
        }
    }
    return results;
};

const RESEARCH_SCOPED_PATH = /^\/analytics\/(?:research|benchmark)\/([^\/]+)/;

export const handleAnalyticsRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path, queryStringParameters: queryParams } = event;
    const origin = getRequestOrigin(event);
    try {
        const decoded = await requireAuth(event);

        const scopedResearch = path.match(RESEARCH_SCOPED_PATH);
        if (scopedResearch && !(await canAccessResearch(scopedResearch[1], decoded.sub))) {
            return researchNotFound(scopedResearch[1], decoded.sub, path, origin);
        }

        // GET /analytics/research/:id/smartvoc
        const smartvocMatch = path.match(/^\/analytics\/research\/([^\/]+)\/smartvoc$/);
        if (smartvocMatch && httpMethod === 'GET') {
            const researchId = smartvocMatch[1];
            const results = await analyticsService.getSmartVOCResults(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/cognitive-tasks
        const cognitiveMatch = path.match(/^\/analytics\/research\/([^\/]+)\/cognitive-tasks$/);
        if (cognitiveMatch && httpMethod === 'GET') {
            const researchId = cognitiveMatch[1];
            const results = await analyticsService.getCognitiveTaskResults(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/screener
        const screenerMatch = path.match(/^\/analytics\/research\/([^\/]+)\/screener$/);
        if (screenerMatch && httpMethod === 'GET') {
            const researchId = screenerMatch[1];
            const results = await analyticsService.getScreenerResults(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/implicit-association/raw-trials
        const rawTrialsMatch = path.match(/^\/analytics\/research\/([^\/]+)\/implicit-association\/raw-trials$/);
        if (rawTrialsMatch && httpMethod === 'GET') {
            const researchId = rawTrialsMatch[1];
            const results = await analyticsService.getIATRawTrials(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/implicit-association
        const implicitMatch = path.match(/^\/analytics\/research\/([^\/]+)\/implicit-association$/);
        if (implicitMatch && httpMethod === 'GET') {
            const researchId = implicitMatch[1];
            const stageId = queryParams?.stageId as string | undefined;
            const results = await analyticsService.getImplicitAssociationResults(researchId, stageId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/eye-tracking
        const eyeTrackingMatch = path.match(/^\/analytics\/research\/([^\/]+)\/eye-tracking$/);
        if (eyeTrackingMatch && httpMethod === 'GET') {
            const researchId = eyeTrackingMatch[1];
            const stageId = queryParams?.stageId as string | undefined;
            const results = await analyticsService.getEyeTrackingResults(researchId, stageId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/benchmark/:id
        const benchmarkMatch = path.match(/^\/analytics\/benchmark\/([^\/]+)$/);
        if (benchmarkMatch && httpMethod === 'GET') {
            const researchId = benchmarkMatch[1];
            const results = await analyticsService.getBenchmarkResults(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/demographics
        const demographicsMatch = path.match(/^\/analytics\/research\/([^\/]+)\/demographics$/);
        if (demographicsMatch && httpMethod === 'GET') {
            const researchId = demographicsMatch[1];
            const results = await analyticsService.getDemographicResponses(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/navigation-flow/:moduleId
        const navigationMatch = path.match(/^\/analytics\/research\/([^\/]+)\/navigation-flow\/([^\/]+)$/);
        if (navigationMatch && httpMethod === 'GET') {
            const [, researchId, moduleId] = navigationMatch;
            const results = await analyticsService.getNavigationFlowResults(researchId, moduleId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/preference-test/:moduleId
        const preferenceMatch = path.match(/^\/analytics\/research\/([^\/]+)\/preference-test\/([^\/]+)$/);
        if (preferenceMatch && httpMethod === 'GET') {
            const [, researchId, moduleId] = preferenceMatch;
            const results = await analyticsService.getPreferenceTestResults(researchId, moduleId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/text-responses/:moduleId
        const textMatch = path.match(/^\/analytics\/research\/([^\/]+)\/text-responses\/([^\/]+)$/);
        if (textMatch && httpMethod === 'GET') {
            const [, researchId, moduleId] = textMatch;
            const results = await analyticsService.getTextResponses(researchId, moduleId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/choice-responses/:moduleId
        const choiceMatch = path.match(/^\/analytics\/research\/([^\/]+)\/choice-responses\/([^\/]+)$/);
        if (choiceMatch && httpMethod === 'GET') {
            const [, researchId, moduleId] = choiceMatch;
            const results = await analyticsService.getChoiceResponses(researchId, moduleId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/scale-responses/:moduleId
        const scaleMatch = path.match(/^\/analytics\/research\/([^\/]+)\/scale-responses\/([^\/]+)$/);
        if (scaleMatch && httpMethod === 'GET') {
            const [, researchId, moduleId] = scaleMatch;
            const results = await analyticsService.getScaleResponses(researchId, moduleId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/ranking-responses/:moduleId
        const rankingMatch = path.match(/^\/analytics\/research\/([^\/]+)\/ranking-responses\/([^\/]+)$/);
        if (rankingMatch && httpMethod === 'GET') {
            const [, researchId, moduleId] = rankingMatch;
            const results = await analyticsService.getRankingResponses(researchId, moduleId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/text-analysis/:moduleId — read cached LLM analysis
        const textAnalysisGetMatch = path.match(/^\/analytics\/research\/([^\/]+)\/text-analysis\/([^\/]+)$/);
        if (textAnalysisGetMatch && httpMethod === 'GET') {
            const [, researchId, moduleId] = textAnalysisGetMatch;
            const { getTextAnalysis } = await import('./text-analysis.service');
            const analysis = await getTextAnalysis(researchId, moduleId);
            return success({ analysis }, 200, undefined, origin);
        }

        // POST /analytics/research/:id/text-analysis/:moduleId — trigger LLM analysis (fire-and-forget)
        const textAnalysisPostMatch = path.match(/^\/analytics\/research\/([^\/]+)\/text-analysis\/([^\/]+)$/);
        if (textAnalysisPostMatch && httpMethod === 'POST') {
            const [, researchId, moduleId] = textAnalysisPostMatch;
            const { triggerTextAnalysis } = await import('./text-analysis.service');
            const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body ?? {});
            const participantIds: string[] | undefined = Array.isArray(body.participantIds) ? body.participantIds : undefined;
            const selectedTexts: Array<{ text: string; mood: string }> | undefined = Array.isArray(body.selectedTexts) ? body.selectedTexts : undefined;
            // Fire-and-forget: respond immediately, analysis runs in background
            triggerTextAnalysis(researchId, moduleId, participantIds, selectedTexts).catch(err =>
                console.error(`[TextAnalysis] Background analysis failed for ${researchId}/${moduleId}:`, err)
            );
            return success({ status: 'analyzing' }, 202, undefined, origin);
        }

        // GET /analytics/research/:id/emotion-analysis
        const emotionAnalysisMatch = path.match(/^\/analytics\/research\/([^\/]+)\/emotion-analysis$/);
        if (emotionAnalysisMatch && httpMethod === 'GET') {
            const researchId = emotionAnalysisMatch[1];
            const { getEmotionAnalysisResults } = await import('./emotion-analysis.analytics');
            const results = await getEmotionAnalysisResults(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/eeg
        const eegMatch = path.match(/^\/analytics\/research\/([^\/]+)\/eeg$/);
        if (eegMatch && httpMethod === 'GET') {
            const researchId = eegMatch[1];
            const { getEEGResults } = await import('./biometrics.analytics');
            const results = await getEEGResults(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/wearable
        const wearableMatch = path.match(/^\/analytics\/research\/([^\/]+)\/wearable$/);
        if (wearableMatch && httpMethod === 'GET') {
            const researchId = wearableMatch[1];
            const { getWearableResults } = await import('./biometrics.analytics');
            const results = await getWearableResults(researchId);
            return success({ results }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/alerts
        const alertsGetMatch = path.match(/^\/analytics\/research\/([^\/]+)\/alerts$/);
        if (alertsGetMatch && httpMethod === 'GET') {
            const researchId = alertsGetMatch[1];
            const { checkAlerts } = await import('./alerts.service');
            const alerts = await checkAlerts(researchId);
            return success({ alerts }, 200, undefined, origin);
        }

        // POST /analytics/research/:id/alerts/:alertId/dismiss
        const alertDismissMatch = path.match(/^\/analytics\/research\/([^\/]+)\/alerts\/([^\/]+)\/dismiss$/);
        if (alertDismissMatch && httpMethod === 'POST') {
            const [, researchId, alertId] = alertDismissMatch;
            const { dismissAlert } = await import('./alerts.service');
            await dismissAlert(researchId, alertId);
            return success({ message: 'Alert dismissed' }, 200, undefined, origin);
        }

        // GET /analytics/research/:id/executive-summary
        const execSummaryGetMatch = path.match(/^\/analytics\/research\/([^\/]+)\/executive-summary$/);
        if (execSummaryGetMatch && httpMethod === 'GET') {
            const researchId = execSummaryGetMatch[1];
            const { getExecutiveSummary } = await import('./executive-summary.service');
            const summary = await getExecutiveSummary(researchId);
            return success({ summary }, 200, undefined, origin);
        }

        // POST /analytics/research/:id/executive-summary
        if (execSummaryGetMatch && httpMethod === 'POST') {
            const researchId = execSummaryGetMatch[1];
            const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body ?? {});
            const participantIds: string[] | undefined = Array.isArray(body.participantIds) ? body.participantIds : undefined;
            const { generateExecutiveSummary } = await import('./executive-summary.service');
            const summary = await generateExecutiveSummary(researchId, participantIds);
            return success({ summary }, 201, undefined, origin);
        }

        const enterpriseSmartVocMatch = path.match(/^\/analytics\/enterprise\/([^\/]+)\/smartvoc$/);
        if (enterpriseSmartVocMatch && httpMethod === 'GET') {
            const ownership = await buildUserOwnership(decoded.sub);
            const results = await collectSmartVOCResults(
                `r.enterprise_id = ? AND ${ownership.clause}`,
                [enterpriseSmartVocMatch[1], ...ownership.params],
            );
            return success({ results }, 200, undefined, origin);
        }

        if (path === '/analytics/smartvoc/consolidated' && httpMethod === 'GET') {
            const ownership = await buildUserOwnership(decoded.sub);
            const results = await collectSmartVOCResults(ownership.clause, ownership.params);
            return success({ results }, 200, undefined, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Analytics error:', err);
        if (isAuthError(err)) {
            return error(errorMessage, err.statusCode, undefined, origin);
        }
        return error(errorMessage, 500, undefined, origin);
    }
};
