/**
 * Safely extracts a string from an unknown value.
 * @param value - Unknown value
 * @returns String if value is a string, otherwise undefined
 */
export const toOptionalString = (value: unknown): string | undefined => {
    return typeof value === 'string' ? value : undefined;
};

/**
 * Sanitizes the serialized value of a file-upload component by removing ephemeral presigned URL fields.
 * This prevents persisting time-limited S3 URLs into module configuration.
 * @param serialized - Serialized component value (usually JSON)
 * @returns Sanitized serialized value
 */
export const sanitizeFileUploadSerializedValue = (serialized: string | undefined): string | undefined => {
    if (!serialized) {
        return serialized;
    }

    const isRecord = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null;

    const stripUrlFields = (value: unknown): unknown => {
        if (Array.isArray(value)) {
            return value.map(stripUrlFields);
        }
        if (!isRecord(value)) {
            return value;
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { url: _url, urlExpiresAt: _urlExpiresAt, ...rest } = value;
        return rest;
    };

    try {
        const parsed = JSON.parse(serialized) as unknown;
        const sanitized = stripUrlFields(parsed);
        return JSON.stringify(sanitized);
    } catch {
        return serialized;
    }
};

/** Sync rankingConfig.items from comp.value for ranking/ranking-list components */
export const syncRankingConfig = <T extends { type: string; value?: string; rankingConfig?: { items?: unknown[] } }>(comp: T): T => {
    if ((comp.type === 'ranking' || comp.type === 'ranking-list') && comp.value) {
        try {
            const parsed = JSON.parse(comp.value);
            if (Array.isArray(parsed)) {
                return { ...comp, rankingConfig: { ...comp.rankingConfig, items: parsed } };
            }
        } catch { /* keep original */ }
    }
    return comp;
};

export const transformResearchConfigComponentValues = (values: Record<string, string>): Record<string, unknown> => {
    const config: Record<string, unknown> = {
        demographics: {},
        linkConfig: {},
        backlinks: {},
        participantLimit: 50,
        researchUrl: '',
    };

    const tryParse = (val: string): unknown => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        try {
            const parsed = JSON.parse(val);
            if (typeof parsed === 'object' && parsed !== null) return parsed;
        } catch (_) { void _; }
        return val;
    };

    Object.entries(values).forEach(([key, value]) => {
        if (['age', 'country', 'gender', 'educationLevel', 'annualIncome', 'employmentStatus', 'dailyHoursOnline', 'technicalProficiency'].includes(key) || key.startsWith('customQuestion_')) {
            (config.demographics as Record<string, unknown>)[key] = tryParse(value);
        }
        else if (['allowMobile', 'allowMultiple'].includes(key)) {
            (config.linkConfig as Record<string, boolean>)[key] = value === 'true';
        }
        else if (['complete', 'disqualified', 'overquota'].includes(key)) {
            (config.backlinks as Record<string, string>)[key] = value;
        }
        else if (key === 'researchUrl') {
            config.researchUrl = value;
        }
        else if (key === 'participantLimit') {
            const parsed = tryParse(value);
            if (typeof parsed === 'object' && parsed !== null && 'enabled' in parsed) {
                config.participantLimit = parsed;
            } else {
                config.participantLimit = parseInt(value) || 50;
            }
        }
        else if (key === 'participationMode') {
            config.participationMode = value || 'panel';
        }
        else if (key === 'studyLogo') {
            config.studyLogo = tryParse(value);
        }
    });

    return config;
};

export const flattenResearchConfig = (config: Record<string, unknown>): Record<string, string> => {
    const values: Record<string, string> = {};

    if (config.demographics) {
        Object.entries(config.demographics as Record<string, unknown>).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                values[key] = JSON.stringify(value);
            } else {
                values[key] = String(value);
            }
        });
    }

    if (config.linkConfig) {
        Object.entries(config.linkConfig as Record<string, boolean>).forEach(([key, value]) => {
            values[key] = String(value);
        });
    }

    if (config.backlinks) {
        Object.entries(config.backlinks as Record<string, string>).forEach(([key, value]) => {
            values[key] = value;
        });
    }

    if (config.researchUrl) {
        values.researchUrl = String(config.researchUrl);
    }

    if (config.participantLimit !== undefined) {
        values.participantLimit = typeof config.participantLimit === 'object'
            ? JSON.stringify(config.participantLimit)
            : String(config.participantLimit);
    }

    if (config.participationMode) {
        values.participationMode = String(config.participationMode);
    }

    if (config.studyLogo) {
        values.studyLogo = typeof config.studyLogo === 'object'
            ? JSON.stringify(config.studyLogo)
            : String(config.studyLogo);
    }

    return values;
};
