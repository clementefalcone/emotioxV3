import apiClient from './api/client';
import type { ApiErrorResponse } from './api/types';

export interface ResearchStatus {
    researchName?: string;
    status: {
        value: string;
        description: string;
        icon: string;
    };
    participants: {
        value: string;
        description: string;
        icon: string;
    };
    completionRate: {
        value: string;
        description: string;
        icon: string;
    };
    averageTime: {
        value: string;
        description: string;
        icon: string;
    };
    totalModules?: number;
}

export interface Participant {
    id: string;
    name: string;
    email: string;
    status: string;
    progress: number;
    duration: string;
    lastActivity: string;
}

export interface ResearchConfiguration {
    allowMobileDevices: boolean;
    trackLocation: boolean;
}

export interface ParticipantDetails {
    id: string;
    name: string;
    email: string;
    status: string;
    progress: number;
    duration: string;
    lastActivity: string;
    responses?: unknown[];
}

export interface OverviewMetricsResponse {
    success?: boolean;
    status?: number;
    data: ResearchStatus;
}

export interface ParticipantsResponse {
    success?: boolean;
    status?: number;
    data: Participant[] | { data: Participant[] };
}

export interface ResearchConfigResponse {
    success?: boolean;
    status?: number;
    data: {
        linkConfig?: {
            allowMobileDevices?: boolean;
            trackLocation?: boolean;
        };
    };
}

export interface ParticipantDetailsResponse {
    success?: boolean;
    status?: number;
    data: ParticipantDetails;
}

export interface DeleteParticipantResponse {
    success: boolean;
    message?: string;
}

/**
 * Servicio de investigación en progreso
 * Maneja todas las operaciones relacionadas con el monitoreo de investigaciones activas
 */
class ResearchInProgressService {
    /**
     * Obtiene las métricas generales de una investigación
     * @param researchId - ID de la investigación
     * @returns Métricas de la investigación
     * @throws ApiErrorResponse si falla la petición
     */
    async getOverviewMetrics(researchId: string): Promise<OverviewMetricsResponse> {
        try {
            const response = await apiClient.get<ResearchStatus>(`/research/${researchId}/metrics`);
            return {
                success: true,
                status: 200,
                data: response as unknown as ResearchStatus
            };
        } catch (error: unknown) {
            throw this.handleError(error, 'Failed to fetch overview metrics');
        }
    }

    /**
     * Obtiene los participantes con su estado
     * @param researchId - ID de la investigación
     * @returns Lista de participantes con estado
     * @throws ApiErrorResponse si falla la petición
     */
    async getParticipantsWithStatus(researchId: string): Promise<ParticipantsResponse> {
        try {
            const response = await apiClient.get<Participant[] | { data: Participant[] }>(
                `/research/${researchId}/participants/status`
            );
            return {
                success: true,
                status: 200,
                data: response as unknown as Participant[] | { data: Participant[] }
            };
        } catch (error: unknown) {
            throw this.handleError(error, 'Failed to fetch participants with status');
        }
    }

    /**
     * Obtiene la configuración de una investigación
     * @param researchId - ID de la investigación
     * @returns Configuración de la investigación
     * @throws ApiErrorResponse si falla la petición
     */
    async getResearchConfiguration(researchId: string): Promise<ResearchConfigResponse> {
        try {
            const response = await apiClient.get<{ linkConfig?: { allowMobileDevices?: boolean; trackLocation?: boolean } }>(
                `/eye-tracking-recruit/research/${researchId}`
            );
            return {
                success: true,
                status: 200,
                data: response as unknown as { linkConfig?: { allowMobileDevices?: boolean; trackLocation?: boolean } }
            };
        } catch (error: unknown) {
            throw this.handleError(error, 'Failed to fetch research configuration');
        }
    }

    /**
     * Obtiene los detalles de un participante
     * @param researchId - ID de la investigación
     * @param participantId - ID del participante
     * @returns Detalles del participante
     * @throws ApiErrorResponse si falla la petición
     */
    async getParticipantDetails(researchId: string, participantId: string): Promise<ParticipantDetailsResponse> {
        try {
            const response = await apiClient.get<ParticipantDetails>(
                `/research/${researchId}/participants/${participantId}`
            );
            return {
                success: true,
                status: 200,
                data: response as unknown as ParticipantDetails
            };
        } catch (error: unknown) {
            throw this.handleError(error, 'Failed to fetch participant details');
        }
    }

    async createParticipantReviewToken(researchId: string, participantId: string): Promise<string> {
        const response = await apiClient.post<{ reviewToken: string }>(
            `/research/${researchId}/participants/${encodeURIComponent(participantId)}/review-token`
        );
        return response.reviewToken;
    }

    /**
     * Elimina un participante
     * @param researchId - ID de la investigación
     * @param participantId - ID del participante
     * @returns Respuesta de eliminación
     * @throws ApiErrorResponse si falla la eliminación
     */
    async deleteParticipant(researchId: string, participantId: string): Promise<DeleteParticipantResponse> {
        try {
            await apiClient.delete(`/research/${researchId}/participants/${participantId}`);
            return {
                success: true,
                message: 'Participant deleted successfully'
            };
        } catch (error: unknown) {
            throw this.handleError(error, 'Failed to delete participant');
        }
    }

    private handleError(error: unknown, defaultMessage: string): Error {
        if (error instanceof Error) {
            return error;
        }

        if (error && typeof error === 'object' && 'response' in error) {
            const axiosError = error as ApiErrorResponse;
            const message = axiosError.response?.data?.error || defaultMessage;
            return new Error(message);
        }

        return new Error(defaultMessage);
    }
}

export const researchInProgressService = new ResearchInProgressService();
