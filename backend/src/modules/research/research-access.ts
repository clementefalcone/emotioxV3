import type { APIGatewayProxyResult } from 'aws-lambda';
import pool from '../../config/database';
import { error } from '../../utils/response';
import * as authService from '../auth/auth.service';
import { buildOwnershipClause } from './research.helpers';

const RESEARCH_OWNED_TABLES = {
    module: 'modules',
    media: 'media',
} as const;

export type ResearchOwnedResource = keyof typeof RESEARCH_OWNED_TABLES;

export const buildUserOwnership = async (userSub: string) => {
    const user = await authService.getMe(userSub);
    return buildOwnershipClause(user.id, user.role);
};

export const canAccessResearch = async (researchId: string, userSub: string): Promise<boolean> => {
    const ownership = await buildUserOwnership(userSub);
    const result = await pool.query(
        `SELECT 1 FROM researches r WHERE r.id = ? AND ${ownership.clause}`,
        [researchId, ...ownership.params],
    );
    return result.rows.length > 0;
};

export const findResearchIdOf = async (resource: ResearchOwnedResource, id: string): Promise<string | null> => {
    const result = await pool.query(`SELECT research_id FROM ${RESEARCH_OWNED_TABLES[resource]} WHERE id = ?`, [id]);
    return (result.rows[0]?.research_id as string | undefined) ?? null;
};

export const researchIdFromMediaPath = (mediaPath: string): string | null =>
    mediaPath.match(/^research\/([^/]+)\//)?.[1] ?? null;

export const canAccessMediaPath = async (mediaPath: string, userSub: string): Promise<boolean> => {
    const folderResearchId = researchIdFromMediaPath(mediaPath);
    const owners = await pool.query('SELECT DISTINCT research_id FROM media WHERE s3_key = ?', [mediaPath]);
    const researchIds = new Set<string>(owners.rows.map((row) => row.research_id as string));
    if (folderResearchId) researchIds.add(folderResearchId);
    for (const researchId of researchIds) {
        if (await canAccessResearch(researchId, userSub)) return true;
    }
    return false;
};

export const isStageOfResearch = async (stageId: string, researchId: string): Promise<boolean> => {
    const result = await pool.query('SELECT 1 FROM stages WHERE id = ? AND research_id = ?', [stageId, researchId]);
    return result.rows.length > 0;
};

export const researchNotFound = (researchId: string, userSub: string, path: string, origin: string | null): APIGatewayProxyResult => {
    console.warn(JSON.stringify({ event: 'research_access_denied', researchId, userSub, path }));
    return error(`Research ${researchId} not found`, 404, undefined, origin);
};
