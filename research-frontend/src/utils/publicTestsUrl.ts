/**
 * Cached participant base URL resolved from runtime-config.json
 */
let cachedParticipantBaseUrl: string | null = null;

/** Default participant Vite dev URL (see participant-frontend/vite.config.ts server.port) */
const DEFAULT_LOCAL_PARTICIPANT_ORIGIN = 'http://localhost:12600';

/**
 * Resolves participant app origin. In `vite` dev, production runtime-config is not used so the lab and links target the local participant build (eye-tracking, etc.) instead of cPanel until you deploy.
 */
async function resolveParticipantBaseUrl(): Promise<string> {
    if (cachedParticipantBaseUrl) return cachedParticipantBaseUrl;

    if (import.meta.env.DEV) {
        const envUrl = import.meta.env.VITE_PARTICIPANT_FRONTEND_URL;
        if (typeof envUrl === 'string' && envUrl.trim()) {
            cachedParticipantBaseUrl = envUrl.replace(/\/+$/, '');
            return cachedParticipantBaseUrl;
        }
        cachedParticipantBaseUrl = DEFAULT_LOCAL_PARTICIPANT_ORIGIN;
        return cachedParticipantBaseUrl;
    }

    try {
        const basePath = import.meta.env.BASE_URL || '/';
        const response = await fetch(`${basePath}runtime-config.json?t=${Date.now()}`, { cache: 'no-store' });
        if (response.ok) {
            const data = await response.json() as Record<string, unknown>;
            if (typeof data.participantBaseUrl === 'string' && data.participantBaseUrl.trim()) {
                cachedParticipantBaseUrl = data.participantBaseUrl.replace(/\/+$/, '');
                return cachedParticipantBaseUrl;
            }
        }
    } catch { /* fallback below */ }

    const envUrl = import.meta.env.VITE_PARTICIPANT_FRONTEND_URL;
    if (typeof envUrl === 'string' && envUrl.trim()) {
        cachedParticipantBaseUrl = envUrl.replace(/\/+$/, '');
        return cachedParticipantBaseUrl;
    }

    cachedParticipantBaseUrl = `${window.location.protocol}//${window.location.hostname}/participant`;
    return cachedParticipantBaseUrl;
}

// Eagerly resolve on module load
void resolveParticipantBaseUrl();

/**
 * Resolves the participant app origin (from runtime-config.json or fallbacks).
 */
export async function getParticipantBaseUrl(): Promise<string> {
    return resolveParticipantBaseUrl();
}

/**
 * Genera la URL pública para acceder a los tests de un participante
 */
export function getPublicTestsUrl(researchId: string, participantId: string): string {
    const baseUrl = cachedParticipantBaseUrl || `${window.location.protocol}//${window.location.hostname}/participant`;
    return `${baseUrl}/research/${researchId}?participantId=${participantId}`;
}

/**
 * Genera la URL para revisar las respuestas de un participante (read-only)
 */
export function getReviewUrl(researchId: string, participantId: string, reviewToken: string): string {
    const baseUrl = cachedParticipantBaseUrl || `${window.location.protocol}//${window.location.hostname}/participant`;
    return `${baseUrl}/research/${researchId}?review=${encodeURIComponent(participantId)}#reviewToken=${encodeURIComponent(reviewToken)}`;
}
