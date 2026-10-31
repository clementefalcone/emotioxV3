/**
 * Store unificado para el participante
 * Maneja respuestas, navegación y persistencia de forma simple y clara
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Response, ResponseId, ResponseValue, ResponseMetadata, ResponsesMap } from '../types/responses';
import type { ParticipationMode, PrivacyNotice } from '../services/public.service';

interface ParticipantState {
  // Navegación
  currentStep: string;

  // Respuestas
  responses: ResponsesMap;

  // Sesión
  sessionId: string;
  sessionStartTime: number;
  sessionCount: number;
  participantId: string | null;

  // Participation mode (kiosk or panel)
  participationMode: ParticipationMode | null;

  // Turnstile verification (persisted)
  turnstileVerifiedAt: number | null;

  privacyNotice: PrivacyNotice | null;
  setPrivacyNotice: (notice: PrivacyNotice) => void;

  // Actions - Navegación
  setCurrentStep: (step: string) => void;
  setParticipantId: (id: string | null) => void;
  setParticipationMode: (mode: ParticipationMode | null) => void;
  setTurnstileVerified: () => void;
  clearTurnstileVerified: () => void;

  // Actions - Respuestas
  saveResponse: (moduleId: string, componentId: string, value: ResponseValue, metadata?: ResponseMetadata) => void;
  getResponse: (moduleId: string, componentId: string) => Response | null;
  getResponsesByModule: (moduleId: string) => Response[];
  updateResponse: (moduleId: string, componentId: string, value: ResponseValue, metadata?: ResponseMetadata) => void;
  clearResponse: (moduleId: string, componentId: string) => void;
  clearAllResponses: () => void;

  // Actions - Sesión
  startNewSession: () => void;
  getSessionId: () => string;
}

/**
 * Genera un ID único para una respuesta
 * @param moduleId - ID del módulo
 * @param componentId - ID del componente
 * @returns ID único de la respuesta
 */
export const createResponseId = (moduleId: string, componentId: string): ResponseId => {
  return `${moduleId}_${componentId}`;
};

/**
 * Convierte ResponsesMap a objeto para persistencia
 * @param map - Mapa de respuestas
 * @returns Array de respuestas
 */
function mapToArray(map: ResponsesMap): Response[] {
  return Array.from(map.values());
}

/**
 * Convierte array de respuestas a ResponsesMap
 * @param responses - Array de respuestas
 * @returns Mapa de respuestas
 */
function arrayToMap(responses: Response[]): ResponsesMap {
  const map = new Map<ResponseId, Response>();
  responses.forEach((response) => {
    map.set(response.id, response);
  });
  return map;
}

export const useParticipantStore = create<ParticipantState>()(
  persist(
    (set, get) => ({
      // Estado inicial
      currentStep: 'welcome',
      responses: new Map<ResponseId, Response>(),
      sessionId: crypto.randomUUID(),
      sessionStartTime: Date.now(),
      sessionCount: 1,
      participantId: null,
      participationMode: null,
      turnstileVerifiedAt: null,
      privacyNotice: null,

      setPrivacyNotice: (notice: PrivacyNotice) => {
        set({ privacyNotice: notice });
      },

      /**
       * Establece el ID del participante
       * @param id - ID del participante
       */
      setParticipantId: (id: string | null) => {
        set({ participantId: id });
      },

      /**
       * Establece el modo de participación
       */
      setParticipationMode: (mode: ParticipationMode | null) => {
        set({ participationMode: mode });
      },

      /**
       * Marca que el participante completó la verificación de Turnstile
       */
      setTurnstileVerified: () => {
        set({ turnstileVerifiedAt: Date.now() });
      },

      /**
       * Limpia la verificación de Turnstile
       */
      clearTurnstileVerified: () => {
        set({ turnstileVerifiedAt: null });
      },

      /**
       * Establece el step actual
       * @param step - ID del step
       */
      setCurrentStep: (step: string) => {
        set({ currentStep: step });
      },

      /**
       * Guarda una respuesta
       * Si ya existe, la actualiza
       * @param moduleId - ID del módulo
       * @param componentId - ID del componente
       * @param value - Valor de la respuesta
       * @param metadata - Metadata opcional
       */
      saveResponse: (moduleId: string, componentId: string, value: ResponseValue, metadata?: ResponseMetadata) => {
        const responseId = createResponseId(moduleId, componentId);
        const { responses } = get();
        const existingResponse = responses.get(responseId);

        const newResponse: Response = {
          id: responseId,
          moduleId,
          componentId,
          value,
          metadata: {
            ...existingResponse?.metadata,
            ...metadata,
            timestamp: Date.now(),
            sessionId: get().sessionId,
          },
        };

        const newResponses = new Map(responses);
        newResponses.set(responseId, newResponse);

        set({ responses: newResponses });
      },

      /**
       * Obtiene una respuesta específica
       * @param moduleId - ID del módulo
       * @param componentId - ID del componente
       * @returns Respuesta o null si no existe
       */
      getResponse: (moduleId: string, componentId: string): Response | null => {
        const { responses } = get();
        const responseId = createResponseId(moduleId, componentId);
        return responses.get(responseId) || null;
      },

      /**
       * Obtiene todas las respuestas de un módulo
       * @param moduleId - ID del módulo
       * @returns Array de respuestas del módulo
       */
      getResponsesByModule: (moduleId: string): Response[] => {
        const { responses } = get();
        return Array.from(responses.values()).filter((response) => response.moduleId === moduleId);
      },

      /**
       * Actualiza una respuesta existente
       * Si no existe, la crea
       * @param moduleId - ID del módulo
       * @param componentId - ID del componente
       * @param value - Nuevo valor
       * @param metadata - Metadata opcional
       */
      updateResponse: (moduleId: string, componentId: string, value: ResponseValue, metadata?: ResponseMetadata) => {
        get().saveResponse(moduleId, componentId, value, metadata);
      },

      /**
       * Elimina una respuesta específica
       * @param moduleId - ID del módulo
       * @param componentId - ID del componente
       */
      clearResponse: (moduleId: string, componentId: string) => {
        const { responses } = get();
        const responseId = createResponseId(moduleId, componentId);
        const newResponses = new Map(responses);
        newResponses.delete(responseId);
        set({ responses: newResponses });
      },

      /**
       * Elimina todas las respuestas
       */
      clearAllResponses: () => {
        set({ responses: new Map<ResponseId, Response>() });
      },

      /**
       * Inicia una nueva sesión
       */
      startNewSession: () => {
        const newState = {
          sessionId: crypto.randomUUID(),
          sessionStartTime: Date.now(),
          sessionCount: get().sessionCount + 1
        };
        set(newState);
        return newState;
      },

      /**
       * Obtiene el ID de la sesión actual
       */
      getSessionId: () => {
        return get().sessionId;
      },
    }),
    {
      name: 'participant-store',
      partialize: (state) => ({
        currentStep: state.currentStep,
        responses: mapToArray(state.responses),
        sessionId: state.sessionId,
        sessionStartTime: state.sessionStartTime,
        sessionCount: state.sessionCount,
        participantId: state.participantId,
        participationMode: state.participationMode,
        turnstileVerifiedAt: state.turnstileVerifiedAt,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as {
          currentStep?: string;
          responses?: Response[];
          sessionId?: string;
          sessionStartTime?: number;
          sessionCount?: number;
          participantId?: string;
          participationMode?: ParticipationMode | null;
          turnstileVerifiedAt?: number | null;
        };
        return {
          ...currentState,
          currentStep: persisted.currentStep ?? currentState.currentStep,
          responses: persisted.responses ? arrayToMap(persisted.responses) : currentState.responses,
          sessionId: persisted.sessionId ?? currentState.sessionId,
          sessionStartTime: persisted.sessionStartTime ?? currentState.sessionStartTime,
          sessionCount: persisted.sessionCount ?? currentState.sessionCount,
          participantId: persisted.participantId ?? currentState.participantId,
          participationMode: persisted.participationMode ?? currentState.participationMode,
          turnstileVerifiedAt: persisted.turnstileVerifiedAt ?? currentState.turnstileVerifiedAt,
        };
      },
    }
  )
);