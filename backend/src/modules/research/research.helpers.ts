export interface ResearchData {
    name: string;
    description?: string;
    research_type_id?: string;
    research_technique_id?: string;
    enterprise_id?: string;
    settings?: Record<string, unknown>;
    use_default_modules?: string[]; // Module names to clone from template
    skip_default_modules?: boolean; // Skip all default module creation (file-based research)
}

/**
 * Admin users bypass the created_by ownership filter.
 * Returns { clause, params } to inject into WHERE conditions.
 * Usage: `WHERE r.id = ? AND ${clause}` with [...otherParams, ...params]
 */
export const buildOwnershipClause = (userId: string, role?: string, alias = 'r') => {
    if (role === 'admin') {
        return { clause: '1=1', params: [] as string[] };
    }
    const prefix = alias ? `${alias}.` : '';
    const idCol = alias ? `${alias}.id` : 'id';
    return {
        clause: `(${prefix}created_by = ? OR ${idCol} IN (SELECT research_id FROM research_collaborators WHERE user_id = ?))`,
        params: [userId, userId],
    };
};
