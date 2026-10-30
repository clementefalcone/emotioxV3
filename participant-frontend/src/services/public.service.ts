/**
 * Public Service
 * Handles public API endpoints for participant-frontend
 * No authentication required
 */

import { configService } from './config.service';
import type { ModuleConfig } from '../types/module';

// Alias for consistency
type Module = ModuleConfig & {
    config?: {
        backlinks?: {
            complete?: string;
            disqualified?: string;
            overquota?: string;
        };
        linkConfig?: {
            allowMobile?: boolean;
            trackLocation?: boolean;
            allowMultiple?: boolean;
        };
        participantLimit?: number;
    };
};

interface Stage {
    id: string;
    name: string;
    description: string;
    order_index: number;
    modules: Module[];
}

interface ResearchData {
    id: string;
    name: string;
    title: string;
    description: string;
    status: string;
    stages: Stage[];
    modules?: Module[]; // Legacy: backend may return modules directly
}

interface PublicResearchResponse {
    research: ResearchData;
}

interface SubmitResponseData {
    participantId: string;
    moduleId: string;
    responses: Record<string, unknown>;
}

interface SubmitResponseResult {
    success: boolean;
    message: string;
}

class PublicService {
    /**
     * Fetch public research data (no auth required)
     * @param researchId - Research ID
     * @returns Research data with stages and modules
     */
    async getResearch(researchId: string, preview?: boolean): Promise<ResearchData> {
        try {
            const baseUrl = configService.getBaseUrl();
            const endpoint = configService.getEndpoint('public', 'research', { id: researchId });
            const url = preview ? `${baseUrl}${endpoint}?preview=true` : `${baseUrl}${endpoint}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch research: ${response.statusText}`);
            }

            const data = await response.json() as PublicResearchResponse;
            return data.research;
        } catch (error: unknown) {
            console.error('Error fetching research:', error);
            throw error;
        }
    }

    /**
     * Submit participant response
     * @param researchId - Research ID
     * @param data - Response data
     * @returns Submission result
     */
    async submitResponse(researchId: string, data: SubmitResponseData): Promise<SubmitResponseResult> {
        try {
            const baseUrl = configService.getBaseUrl();
            const endpoint = configService.getEndpoint('public', 'submitResponse', { id: researchId });
            const url = `${baseUrl}${endpoint}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error(`Failed to submit response: ${response.statusText}`);
            }

            const result = await response.json() as SubmitResponseResult;
            return result;
        } catch (error: unknown) {
            console.error('Error submitting response:', error);
            throw error;
        }
    }

    /**
     * Pre-check quota availability before showing demographics.
     * Returns { available: true } if there are quota slots, false if all exhausted.
     */
    async checkQuotaAvailability(researchId: string): Promise<{ available: boolean; exhaustedType?: string }> {
        try {
            const baseUrl = configService.getBaseUrl();
            const endpoint = configService.getEndpoint('public', 'quotaAvailability', { id: researchId });
            const url = `${baseUrl}${endpoint}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });

            if (!response.ok) {
                // If endpoint doesn't exist yet, assume available (backwards compat)
                console.warn('Quota availability check failed, assuming available');
                return { available: true };
            }

            return await response.json() as { available: boolean; exhaustedType?: string };
        } catch {
            // Network error → don't block participant
            console.warn('Quota availability check error, assuming available');
            return { available: true };
        }
    }

    /**
     * Validate participant demographics
     * @param researchId - Research ID
     * @param demographics - Demographic answers
     * @returns Validation result
     */
    async validateDemographics(researchId: string, demographics: Record<string, string>, participantId?: string): Promise<ValidationResult> {
        try {
            const baseUrl = configService.getBaseUrl();
            const endpoint = configService.getEndpoint('public', 'validateDemographics', { id: researchId });
            const url = `${baseUrl}${endpoint}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ demographics, participantId }),
            });

            if (!response.ok) {
                throw new Error(`Failed to validate demographics: ${response.statusText}`);
            }

            const data = await response.json() as { validation: ValidationResult };
            return data.validation;
        } catch (error: unknown) {
            console.error('Error validating demographics:', error);
            throw error;
        }
    }
    /**
     * Fetch participation mode for a research
     * @param researchId - Research ID
     * @returns Participation mode ('kiosk' or 'panel')
     */
    async getParticipationMode(researchId: string): Promise<ParticipationMode> {
        try {
            const baseUrl = configService.getBaseUrl();
            const endpoint = configService.getEndpoint('public', 'participationMode', { id: researchId });
            const url = `${baseUrl}${endpoint}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch participation mode: ${response.statusText}`);
            }

            const data = await response.json() as { mode: ParticipationMode };
            return data.mode;
        } catch (error: unknown) {
            console.error('Error fetching participation mode:', error);
            // Default to panel for retrocompatibility
            return 'panel';
        }
    }

    /**
     * Request a new kiosk session (generates incremental participantId)
     * @param researchId - Research ID
     * @returns Generated participantId (e.g., 'kiosk-1')
     */
    async requestKioskSession(researchId: string): Promise<string> {
        const baseUrl = configService.getBaseUrl();
        const endpoint = configService.getEndpoint('public', 'kioskSession', { id: researchId });
        const url = `${baseUrl}${endpoint}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`Failed to create kiosk session: ${response.statusText}`);
        }

        const data = await response.json() as { participantId: string };
        return data.participantId;
    }
    /**
     * Check if a participant has already responded
     */
    async getParticipantStatus(researchId: string, participantId: string): Promise<{ hasResponded: boolean }> {
        try {
            const baseUrl = configService.getBaseUrl();
            const url = `${baseUrl}/public/research/${researchId}/participant/${encodeURIComponent(participantId)}/status`;

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });

            if (!response.ok) return { hasResponded: false };

            const data = await response.json() as { hasResponded: boolean };
            return data;
        } catch {
            return { hasResponded: false };
        }
    }
    async recordConsent(researchId: string, record: ConsentRecord): Promise<void> {
        const baseUrl = configService.getBaseUrl();
        const response = await fetch(`${baseUrl}/public/research/${researchId}/consent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
        });
        if (!response.ok) {
            throw new Error(`Failed to record ${record.decision} consent of ${record.subjectId} for ${record.context} in research ${researchId}: HTTP ${response.status}`);
        }
    }

    async getParticipantResponses(researchId: string, participantId: string, reviewToken: string): Promise<ParticipantResponse[]> {
        const baseUrl = configService.getBaseUrl();
        const url = `${baseUrl}/public/research/${researchId}/participant/${encodeURIComponent(participantId)}/responses`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${reviewToken}` } });
        if (!response.ok) {
            throw new Error(`Failed to fetch responses of participant ${participantId} in research ${researchId}: HTTP ${response.status}`);
        }
        const data = await response.json() as { responses: ParticipantResponse[] };
        return data.responses;
    }
}

export interface ConsentRecord {
    subjectId: string;
    context: 'eye_tracking' | 'emotion_analysis';
    decision: 'accepted' | 'declined';
    text: string;
    locale: string;
}

export interface ParticipantResponse {
    module_id: string;
    component_id: string;
    value: unknown;
    created_at: string;
}

export type ParticipationMode = 'kiosk' | 'panel';

export const publicService = new PublicService();

export interface ValidationResult {
    valid: boolean;
    reason?: 'QUOTA_FULL' | 'DISQUALIFIED' | 'RESEARCH_CLOSED';
    details?: string;
}

// Export types
export type {
    ResearchData,
    Stage,
    Module,
    SubmitResponseData,
    SubmitResponseResult
};
