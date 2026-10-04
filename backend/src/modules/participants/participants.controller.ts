import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth';
import * as authService from '../auth/auth.service';
import * as participantsService from './participants.service';
import { getRequestOrigin } from '../../utils/request';
import { canAccessResearch, researchNotFound } from '../research/research-access';

/**
 * Parses CSV text into rows. Supports comma and semicolon delimiters.
 * Expected columns: email, name, externalId (all optional, header row required).
 */
const parseCSV = (csvText: string): participantsService.ImportRow[] => {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return []; // header + at least one data row

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

  // Map header names to our fields (flexible naming)
  const emailIdx = headers.findIndex(h => ['email', 'correo', 'e-mail', 'mail'].includes(h));
  const nameIdx = headers.findIndex(h => ['name', 'nombre', 'full_name', 'fullname'].includes(h));
  const externalIdIdx = headers.findIndex(h => ['externalid', 'external_id', 'id', 'id_externo', 'participant_id'].includes(h));

  const rows: participantsService.ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const row: participantsService.ImportRow = {};

    if (emailIdx >= 0 && cols[emailIdx]) row.email = cols[emailIdx];
    if (nameIdx >= 0 && cols[nameIdx]) row.name = cols[nameIdx];
    if (externalIdIdx >= 0 && cols[externalIdIdx]) row.externalId = cols[externalIdIdx];

    // Skip completely empty rows
    if (row.email || row.name || row.externalId) {
      rows.push(row);
    }
  }

  return rows;
};

export const handleParticipantsRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { httpMethod, path } = event;
  const origin = getRequestOrigin(event);

  try {
    // Auth required for all participant management routes
    let decoded;
    try {
      decoded = await requireAuth(event);
    } catch (authError: unknown) {
      if (isAuthError(authError)) {
        return error(authError.message, authError.statusCode, undefined, origin);
      }
      throw authError;
    }
    const user = await authService.getMe(decoded.sub);

    // Viewer role: read-only
    if (user.role === 'viewer' && httpMethod !== 'GET') {
        return error('Viewer role is read-only', 403, undefined, origin);
    }

    const scopedResearch = path.match(/^\/participants\/([^/]+)/);
    if (scopedResearch && !(await canAccessResearch(scopedResearch[1], decoded.sub))) {
      return researchNotFound(scopedResearch[1], decoded.sub, path, origin);
    }

    // GET /participants/:researchId
    const listMatch = path.match(/^\/participants\/([^/]+)$/);
    if (listMatch && httpMethod === 'GET') {
      const researchId = listMatch[1];
      const participants = await participantsService.listByResearch(researchId);
      return success({ participants }, 200, undefined, origin);
    }

    // POST /participants/:researchId/import
    const importMatch = path.match(/^\/participants\/([^/]+)\/import$/);
    if (importMatch && httpMethod === 'POST') {
      const researchId = importMatch[1];
      const body = JSON.parse(event.body || '{}');

      if (!body.csv || typeof body.csv !== 'string') {
        return error('csv field is required (CSV text content)', 400, undefined, origin);
      }

      const rows = parseCSV(body.csv);
      if (rows.length === 0) {
        return error('No valid rows found in CSV. Expected header row with email/name/externalId columns.', 400, undefined, origin);
      }

      const result = await participantsService.importParticipants(researchId, rows);
      return success(result, 201, undefined, origin);
    }

    // DELETE /participants/:researchId/:participantDbId
    const deleteMatch = path.match(/^\/participants\/([^/]+)\/([^/]+)$/);
    if (deleteMatch && httpMethod === 'DELETE') {
      const researchId = deleteMatch[1];
      const participantDbId = deleteMatch[2];

      // Prevent matching "import" as a participantDbId
      if (participantDbId === 'import') {
        return error('Route not found', 404, undefined, origin);
      }

      const deleted = await participantsService.deleteParticipant(researchId, participantDbId);
      if (!deleted) {
        return error('Participant not found', 404, undefined, origin);
      }
      return success({ message: 'Participant deleted' }, 200, undefined, origin);
    }

    // DELETE /participants/:researchId (delete all)
    const deleteAllMatch = path.match(/^\/participants\/([^/]+)$/);
    if (deleteAllMatch && httpMethod === 'DELETE') {
      const researchId = deleteAllMatch[1];
      const count = await participantsService.deleteAllByResearch(researchId);
      return success({ message: `Deleted ${count} participants`, count }, 200, undefined, origin);
    }

    // POST /participants/:researchId/send-emails (send to all pending)
    const sendAllMatch = path.match(/^\/participants\/([^/]+)\/send-emails$/);
    if (sendAllMatch && httpMethod === 'POST') {
      const researchId = sendAllMatch[1];
      const body = JSON.parse(event.body || '{}');

      if (!body.baseUrl || !body.researchName) {
        return error('baseUrl and researchName are required', 400, undefined, origin);
      }

      // Validate panel mode
      const { getParticipationMode } = await import('../public/index');
      const mode = await getParticipationMode(researchId);
      if (mode !== 'panel') {
        return error('Email sending is only available for panel-mode researches', 400, undefined, origin);
      }

      const result = await participantsService.sendEmailsToAll({
        researchId,
        baseUrl: body.baseUrl,
        researchName: body.researchName,
      });
      return success(result, 200, undefined, origin);
    }

    // POST /participants/:researchId/:id/send-email (send to one)
    const sendOneMatch = path.match(/^\/participants\/([^/]+)\/([^/]+)\/send-email$/);
    if (sendOneMatch && httpMethod === 'POST') {
      const researchId = sendOneMatch[1];
      const participantDbId = sendOneMatch[2];
      const body = JSON.parse(event.body || '{}');

      if (!body.baseUrl || !body.researchName) {
        return error('baseUrl and researchName are required', 400, undefined, origin);
      }

      const { getParticipationMode } = await import('../public/index');
      const mode = await getParticipationMode(researchId);
      if (mode !== 'panel') {
        return error('Email sending is only available for panel-mode researches', 400, undefined, origin);
      }

      const result = await participantsService.sendEmailToOne(researchId, participantDbId, {
        baseUrl: body.baseUrl,
        researchName: body.researchName,
      });

      if (!result.success) {
        return error(result.error || 'Failed to send email', result.participantId ? 400 : 404, undefined, origin);
      }
      return success(result, 200, undefined, origin);
    }

    return error('Route not found', 404, undefined, origin);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Participants API error:', err);
    return error(errorMessage, 500, undefined, origin);
  }
};
