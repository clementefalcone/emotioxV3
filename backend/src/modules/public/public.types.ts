import type { PrivacyNotice } from '../research/research-privacy';
// --- Shared types and helpers for public service modules ---

export type ParticipationMode = 'kiosk' | 'panel';

export interface DbResearchRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  config: unknown;
}

export interface DbResearchConfigModuleRow {
  name: string;
  config: unknown;
}

export interface PublicQuestionDto {
  id: string;
  type: string;
  text: string;
  order: number;
  config: unknown;
  required: boolean;
  validation?: unknown;
}

export interface PublicModuleStructureDto {
  components: unknown[];
}

export interface PublicModuleDto {
  id: string;
  name: string;
  description: string;
  order_index: number;
  is_from_template?: boolean;
  config: Record<string, unknown>;
  structure: PublicModuleStructureDto;
  questions: PublicQuestionDto[];
}

export interface PublicStageDto {
  id: string;
  name: string;
  description: string;
  order_index: number;
  stage_type: string | null;
  modules: PublicModuleDto[];
}

export interface PublicResearchDto {
  id: string;
  name: string;
  title: string;
  description: string;
  status: string;
  stages: PublicStageDto[];
  /**
   * Legacy: some clients expect modules at root level.
   * When present, it is a flattened list in display order.
   */
  modules: PublicModuleDto[];
  privacy: PrivacyNotice & { biometricRetentionMonths: number };
}

export interface ParticipantResponsePayload {
  participantId: string;
  moduleId: string;
  responses: Array<{
    moduleId: string;
    componentId: string;
    value: unknown;
    metadata?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
}

// --- Shared helper functions ---

/**
 * Checks whether a value is a plain object record.
 * @param value - Unknown value
 * @returns True if value is a non-null object and not an array
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Parses a json-like value that may come as string from the DB.
 * @param value - Raw value
 * @returns Parsed object record, or empty object if invalid
 */
export const parseJsonRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch (_err: unknown) {
      return {};
    }
  }
  return isRecord(value) ? value : {};
};

/**
 * Extracts a stable module structure from module config.
 * @param config - Parsed module config record
 * @returns Normalized structure payload with a components array
 */
export const extractStructure = (config: Record<string, unknown>): PublicModuleStructureDto => {
  const maybeStructure: unknown = config.structure;
  if (isRecord(maybeStructure) && Array.isArray(maybeStructure.components)) {
    return { components: maybeStructure.components };
  }
  if (Array.isArray(config.components)) {
    return { components: config.components };
  }
  return { components: [] };
};
