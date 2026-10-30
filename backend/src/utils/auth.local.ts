/**
 * Utilidades de autenticación local (cPanel)
 * Reemplaza verificación de tokens Cognito con JWT local
 */

import jwt from 'jsonwebtoken';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Read JWT_SECRET lazily to ensure dotenv has loaded
const getJwtSecret = (): string => {
    return process.env.JWT_SECRET || 'change-this-secret-in-production';
};

export type AuthErrorCode = 'NO_TOKEN' | 'INVALID_TOKEN';

/**
 * Represents an authentication error that should be returned as HTTP 401.
 */
export class AuthError extends Error {
    public readonly statusCode: number = 401;
    public readonly code: AuthErrorCode;

    constructor(message: string, code: AuthErrorCode) {
        super(message);
        this.name = 'AuthError';
        this.code = code;
    }
}

export const isAuthError = (value: unknown): value is AuthError => {
    return value instanceof AuthError;
};

export interface DecodedToken {
    sub: string;
    email: string;
    role: string;
    [key: string]: string | number | boolean | undefined;
}

/**
 * Verifica un token JWT local
 */
export const verifyToken = (token: string): Promise<DecodedToken> => {
    return new Promise((resolve, reject) => {
        try {
            const decoded = jwt.verify(token, getJwtSecret()) as DecodedToken;
            resolve(decoded);
        } catch (error) {
            reject(error instanceof Error ? error : new Error('Error verificando token'));
        }
    });
};

export const getUserFromToken = async (token: string): Promise<DecodedToken> => {
    try {
        const decoded = await verifyToken(token);
        return decoded;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('getUserFromToken error:', {
            error: errorMessage,
            tokenLength: token.length,
            tokenPreview: token.substring(0, 20) + '...',
        });
        throw new AuthError('Invalid or expired token', 'INVALID_TOKEN');
    }
};

/**
 * Extrae el token de las cookies o del header Authorization
 */
const extractToken = (event: APIGatewayProxyEvent): string | null => {
    const cookieHeaders = [
        event.headers.Cookie,
        event.headers.cookie,
        event.headers['Cookie'],
        event.headers['cookie'],
        event.multiValueHeaders?.Cookie?.[0],
        event.multiValueHeaders?.cookie?.[0],
    ].filter(Boolean) as string[];

    for (const cookies of cookieHeaders) {
        if (!cookies) continue;
        const cookieParts = cookies.split(';');
        for (const cookie of cookieParts) {
            const trimmed = cookie.trim();
            if (trimmed.startsWith('accessToken=')) {
                const token = trimmed.substring('accessToken='.length).trim();
                if (token) {
                    return token;
                }
            }
        }
    }
    
    const authHeaders = [
        event.headers.Authorization,
        event.headers.authorization,
        event.headers['Authorization'],
        event.headers['authorization'],
    ].filter(Boolean) as string[];

    for (const authHeader of authHeaders) {
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring('Bearer '.length).trim();
            if (token) {
                return token;
            }
        }
    }
    
    return null;
};

export const requireAuth = async (event: APIGatewayProxyEvent): Promise<DecodedToken> => {
    const token = extractToken(event);

    if (!token) {
        throw new AuthError('No token provided', 'NO_TOKEN');
    }

    try {
        return await getUserFromToken(token);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido al verificar token';
        console.error('requireAuth error:', {
            error: errorMessage,
            hasToken: !!token,
            tokenLength: token.length,
        });
        if (isAuthError(error)) {
            throw error;
        }
        throw new AuthError('Invalid or expired token', 'INVALID_TOKEN');
    }
};

const PARTICIPANT_REVIEW_TTL = '30m';

const getParticipantReviewSecret = (): string => `${getJwtSecret()}:participant-review`;

interface ParticipantReviewToken {
    researchId: string;
    participantId: string;
}

export const signParticipantReviewToken = (researchId: string, participantId: string): string =>
    jwt.sign({ researchId, participantId }, getParticipantReviewSecret(), { expiresIn: PARTICIPANT_REVIEW_TTL });

export const requireParticipantReviewToken = (event: APIGatewayProxyEvent, researchId: string, participantId: string): void => {
    const token = extractToken(event);
    if (!token) {
        throw new AuthError(`No review token provided for participant ${participantId} in research ${researchId}`, 'NO_TOKEN');
    }
    let decoded: ParticipantReviewToken;
    try {
        decoded = jwt.verify(token, getParticipantReviewSecret()) as ParticipantReviewToken;
    } catch {
        throw new AuthError(`Invalid or expired review token for participant ${participantId} in research ${researchId}`, 'INVALID_TOKEN');
    }
    if (decoded.researchId !== researchId || decoded.participantId !== participantId) {
        throw new AuthError(`Review token does not grant participant ${participantId} in research ${researchId}`, 'INVALID_TOKEN');
    }
};
