import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { isAuthError, requireAuth } from '../../utils/auth.local';
import * as authService from './auth.service.local';
import type { SignOptions } from 'jsonwebtoken';

type CookieSameSite = 'Lax' | 'None';

/**
 * Resolve cookie security attributes based on request origin.
 * - Localhost: allow HTTP cookies with SameSite=Lax.
 * - Non-local (HTTPS): use Secure + SameSite=None to allow cross-site XHR (frontend ↔ API).
 * @param origin - Request origin header
 * @returns Cookie attributes to apply
 */
const resolveCookieAttributes = (origin: string | null): { secure: boolean; sameSite: CookieSameSite } => {
    const raw = typeof origin === 'string' ? origin : '';
    const isLocal =
        raw.includes('http://localhost') ||
        raw.includes('http://127.0.0.1') ||
        raw.includes('http://0.0.0.0');

    if (isLocal) {
        return { secure: false, sameSite: 'Lax' };
    }

    // Para emotio.cx, usar Lax porque frontend y API están en el mismo dominio
    // SameSite=None solo es necesario para cross-site requests
    if (raw.includes('emotio.cx')) {
        return { secure: true, sameSite: 'Lax' };
    }

    return { secure: true, sameSite: 'None' };
};

export const handleAuthRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path, headers, requestContext } = event;
    const origin = headers.Origin || headers.origin || null;

    // Build API base URL from request context or environment
    const getApiBaseUrl = async (): Promise<string> => {
        // Try to get from SSM Parameter Store first
        try {
            const { loadSsmParameters } = await import('../../config/ssm');
            const ssmPrefix = process.env.SSM_PREFIX || `/emotioxv3/${process.env.API_STAGE || 'dev'}`;
            const ssmRegion = process.env.SSM_REGION || process.env.AWS_REGION || 'us-east-1';

            const ssmParams = await loadSsmParameters({
                names: ['API_BASE_URL'],
                prefix: ssmPrefix,
                region: ssmRegion
            });

            if (ssmParams.API_BASE_URL) {
                return ssmParams.API_BASE_URL;
            }
        } catch (error) {
            console.warn('Failed to load API_BASE_URL from SSM:', error);
        }

        // Fallback to environment variable
        if (process.env.API_BASE_URL) {
            return process.env.API_BASE_URL;
        }

        // Build from request context (API Gateway)
        if (requestContext?.domainName) {
            // Determine protocol: check X-Forwarded-Proto header first, then requestContext
            let protocol = 'https';
            const forwardedProto = headers['X-Forwarded-Proto'] || headers['x-forwarded-proto'];
            if (forwardedProto && (forwardedProto === 'http' || forwardedProto === 'https')) {
                protocol = forwardedProto;
            } else if (requestContext.protocol && requestContext.protocol !== 'HTTP/1.1') {
                protocol = requestContext.protocol;
            }

            const domainName = requestContext.domainName;

            // Custom domains (like server.emotiox.org) don't include stage in path
            // API Gateway URLs (like *.execute-api.*.amazonaws.com) do include stage
            if (domainName.includes('.execute-api.') || domainName.includes('.amazonaws.com')) {
                // API Gateway URL - include stage
                if (requestContext.stage) {
                    return `${protocol}://${domainName}/${requestContext.stage}`;
                }
            }
            // Custom domain - don't include stage
            return `${protocol}://${domainName}`;
        }

        // Fallback to origin if available
        if (origin) {
            return origin.replace(/\/$/, '');
        }

        // Last resort: construct from environment
        const region = process.env.APP_AWS_REGION || 'us-east-1';
        const stage = process.env.API_STAGE || 'dev';
        // This is a fallback and may not be accurate
        return `https://api.execute-api.${region}.amazonaws.com/${stage}`;
    };

    // Get frontend URL from SSM or use origin
    const getFrontendUrl = async (overrideOrigin?: string | null): Promise<string> => {
        // Use override origin if provided
        const targetOrigin = overrideOrigin || origin;

        // First, try to use origin if available (most reliable)
        if (targetOrigin) {
            // Keep localhost for development
            if (targetOrigin.includes('localhost') || targetOrigin.includes('127.0.0.1')) {
                return targetOrigin.replace(/\/$/, '');
            }

            // If origin is a known frontend domain, use it
            if (targetOrigin.includes('portal.emotiox.org') || targetOrigin.includes('app.emotiox.org') ||
                targetOrigin.includes('research.emotiox.org') || targetOrigin.includes('participant.emotiox.org') ||
                targetOrigin.includes('useremotion.com')) {
                return targetOrigin.replace(/\/$/, '');
            }

            // For emotio.cx (cPanel), use FRONTEND_URL since app is under /research
            if (targetOrigin.includes('emotio.cx')) {
                return process.env.FRONTEND_URL || process.env.RESEARCH_FRONTEND_URL || 'https://emotio.cx/research';
            }
        }

        // Try to load from SSM Parameter Store
        try {
            const { loadSsmParameters } = await import('../../config/ssm');
            const ssmPrefix = process.env.SSM_PREFIX || `/emotioxv3/${process.env.API_STAGE || 'dev'}`;
            const ssmRegion = process.env.SSM_REGION || process.env.AWS_REGION || 'us-east-1';

            const ssmParams = await loadSsmParameters({
                names: ['RESEARCH_FRONTEND_URL', 'PARTICIPANT_FRONTEND_URL'],
                prefix: ssmPrefix,
                region: ssmRegion
            });

            // Prefer RESEARCH_FRONTEND_URL (portal.emotiox.org) as default
            if (ssmParams.RESEARCH_FRONTEND_URL) {
                return ssmParams.RESEARCH_FRONTEND_URL;
            }
            if (ssmParams.PARTICIPANT_FRONTEND_URL) {
                return ssmParams.PARTICIPANT_FRONTEND_URL;
            }
        } catch (error) {
            console.warn('Failed to load FRONTEND_URL from SSM:', error);
        }

        // Fallback to environment variable
        if (process.env.FRONTEND_URL) {
            return process.env.FRONTEND_URL;
        }

        // Last resort: use origin if available, otherwise use production URL
        if (targetOrigin) {
            return targetOrigin.replace(/\/$/, '');
        }

        // Default to production research frontend
        return 'https://portal.emotiox.org';
    };

    try {
        // POST /auth/register
        if (path === '/auth/register' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const user = await authService.register({
                email: body.email,
                password: body.password,
                firstName: body.firstName,
                lastName: body.lastName,
            });
            return success({ user }, 201, undefined, origin);
        }

        // POST /auth/login
        if (path === '/auth/login' && httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const rememberMe = typeof body.rememberMe === 'boolean' ? body.rememberMe : false;
            const tokens = await authService.login({ email: body.email, password: body.password });

            if (!tokens.accessToken) {
                return error('Failed to generate access token', 500, undefined, origin);
            }

            // Crear cookies para los tokens
            const { createCookie } = await import('../../utils/response');
            const cookies: string[] = [];
            const cookieAttrs = resolveCookieAttributes(origin);

            // Access token cookie (expira en 1 hora)
            cookies.push(createCookie('accessToken', tokens.accessToken, {
                maxAge: tokens.expiresIn || 86400, // 24 hours
                httpOnly: true,
                secure: cookieAttrs.secure,
                sameSite: cookieAttrs.sameSite,
                path: '/',
            }));

            // Refresh token cookie: persistent only when rememberMe=true, otherwise session cookie
            if (tokens.refreshToken) {
                cookies.push(createCookie('refreshToken', tokens.refreshToken, {
                    maxAge: rememberMe ? 2 * 24 * 60 * 60 : undefined, // 2 días (48 horas) o sesión - matches Cognito RefreshTokenValidity
                    httpOnly: true,
                    secure: cookieAttrs.secure,
                    sameSite: cookieAttrs.sameSite,
                    path: '/',
                }));
            }

            // Token in body for frontend Authorization header + cookies as httpOnly backup
            return success({
                message: 'Login successful',
                token: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresIn: tokens.expiresIn,
            }, 200, cookies, origin);
        }

        // POST /auth/refresh
        if (path === '/auth/refresh' && httpMethod === 'POST') {
            // Prefer cookie refreshToken; fallback to body for clients that can't send cookies (e.g. cross-site).
            const cookieHeader = event.headers.Cookie || event.headers.cookie || '';
            const refreshTokenMatch = cookieHeader
                .split(';')
                .find(c => c.trim().startsWith('refreshToken='));

            const cookieRefreshToken = refreshTokenMatch?.split('=')[1]?.trim();
            const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
            const bodyRefreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
            const refreshToken = cookieRefreshToken || bodyRefreshToken;

            if (!refreshToken) {
                return error('Refresh token not found', 401, undefined, origin);
            }

            try {
                const tokens = await authService.refreshToken({ refreshToken: refreshToken });

                if (!tokens.accessToken) {
                    return error('Failed to refresh access token', 500, undefined, origin);
                }

                // Actualizar cookies
                const { createCookie } = await import('../../utils/response');
                const cookies: string[] = [];
                const cookieAttrs = resolveCookieAttributes(origin);

                cookies.push(createCookie('accessToken', tokens.accessToken, {
                    maxAge: tokens.expiresIn || 86400, // 24 hours
                    httpOnly: true,
                    secure: cookieAttrs.secure,
                    sameSite: cookieAttrs.sameSite,
                    path: '/',
                }));

                // Return access token for header-based clients
                return success({ message: 'Token refreshed successfully', token: tokens.accessToken, expiresIn: tokens.expiresIn }, 200, cookies, origin);
            } catch (serviceError: unknown) {
                // Si el refresh token expiró o es inválido, devolver 401
                const errorMessage = serviceError instanceof Error ? serviceError.message : 'Failed to refresh token';
                const statusCode = (serviceError as Error & { statusCode?: number }).statusCode || 500;

                if (statusCode === 401 || errorMessage.includes('expired') || errorMessage.includes('invalid')) {
                    return error('Refresh token expired or invalid', 401, undefined, origin);
                }

                return error(errorMessage, statusCode, undefined, origin);
            }
        }

        // GET /auth/me
        if (path === '/auth/me' && httpMethod === 'GET') {
            try {
                const decoded = await requireAuth(event);
                // Token decoded successfully, proceeding with request

                const user = await authService.getMe(decoded.sub);
                return success({ user }, 200, undefined, origin);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error('GET /auth/me error:', {
                    error: errorMessage,
                    hasCookies: !!(event.headers.Cookie || event.headers.cookie),
                    hasAuthHeader: !!(event.headers.Authorization || event.headers.authorization),
                });
                throw error;
            }
        }
        // PUT /auth/me (update profile)
        if (path === '/auth/me' && httpMethod === 'PUT') {
            const decoded = await requireAuth(event);
            const body = JSON.parse(event.body || '{}');
            const updatedUser = await authService.updateUser(decoded.sub, body);
            return success({ user: updatedUser }, 200, undefined, origin);
        }
        // DELETE /auth/me
        if (path === '/auth/me' && httpMethod === 'DELETE') {
            const decoded = await requireAuth(event);
            const result = await authService.deleteAccount(decoded.sub);

            // Limpiar cookies al eliminar cuenta
            const { createCookie } = await import('../../utils/response');
            const cookies: string[] = [
                createCookie('accessToken', '', { maxAge: 0 }),
                createCookie('refreshToken', '', { maxAge: 0 }),
            ];

            return success(result, 200, cookies, origin);
        }

        // GET /auth/google - Initiate Google OAuth flow
        if (path === '/auth/google' && httpMethod === 'GET') {
            try {
                const { OAuth2Client } = await import('google-auth-library');
                const fs = await import('fs');
                const path = await import('path');
                
                // Cargar credenciales de Google
                const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || 
                    path.join(process.cwd(), 'google-credentials.json');
                
                let clientId: string;
                let clientSecret: string;
                
                if (fs.existsSync(credentialsPath)) {
                    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
                    clientId = credentials.web?.client_id || '';
                    clientSecret = credentials.web?.client_secret || '';
                } else {
                    clientId = process.env.GOOGLE_CLIENT_ID || '';
                    clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
                }
                
                if (!clientId || !clientSecret) {
                    return error(
                        'Google OAuth not configured. Please set GOOGLE_CREDENTIALS_PATH or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.',
                        500,
                        undefined,
                        origin
                    );
                }
                
                // Build redirect URI
                const apiBaseUrl = await getApiBaseUrl();
                const redirectUri = `${apiBaseUrl}/auth/google/callback`;
                
                // Get origin for state parameter
                const queryParams = event.queryStringParameters || {};
                let safeOrigin = queryParams.redirect_origin ? decodeURIComponent(queryParams.redirect_origin) : null;
                
                if (!safeOrigin) {
                    safeOrigin = origin;
                }
                
                if (!safeOrigin) {
                    const referer = headers.Referer || headers.referer;
                    if (referer) {
                        try {
                            const refererUrl = new URL(referer);
                            safeOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
                        } catch (e) {
                            // Invalid referer URL, ignore
                        }
                    }
                }
                
                const state = safeOrigin ? encodeURIComponent(safeOrigin) : '';
                
                // Crear cliente OAuth2
                const client = new OAuth2Client(clientId, clientSecret, redirectUri);
                
                // Generar URL de autorización
                const authUrl = client.generateAuthUrl({
                    access_type: 'offline',
                    scope: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
                    state: state,
                    prompt: 'consent', // Para obtener refresh token
                });
                
                // Return redirect response
                return {
                    statusCode: 302,
                    headers: {
                        'Location': authUrl,
                        'Access-Control-Allow-Origin': origin || '*',
                        'Access-Control-Allow-Credentials': 'true',
                    },
                    body: '',
                };
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to initiate Google OAuth';
                console.error('Google OAuth initiation error:', err);
                return error(errorMessage, 500, undefined, origin);
            }
        }

        // GET /auth/google/callback - Handle Google OAuth callback
        if (path === '/auth/google/callback' && httpMethod === 'GET') {
            const queryParams = event.queryStringParameters || {};
            const code = queryParams.code;
            const errorParam = queryParams.error;
            const state = queryParams.state;

            // Try to get origin from state parameter
            let effectiveOrigin = origin;
            if (!effectiveOrigin && state) {
                try {
                    effectiveOrigin = decodeURIComponent(state);
                } catch (e) {
                    console.warn('Failed to decode state parameter:', e);
                }
            }

            // Fallback: Try to get origin from Referer header
            if (!effectiveOrigin) {
                const referer = headers.Referer || headers.referer;
                if (referer) {
                    try {
                        const refererUrl = new URL(referer);
                        effectiveOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
                    } catch (e) {
                        // Invalid referer URL, ignore
                    }
                }
            }

            if (errorParam) {
                const errorDescription = queryParams.error_description || 'OAuth error';
                const frontendUrl = await getFrontendUrl(effectiveOrigin);
                return {
                    statusCode: 302,
                    headers: {
                        'Location': `${frontendUrl}/login?error=${encodeURIComponent(errorDescription)}`,
                        'Access-Control-Allow-Origin': effectiveOrigin || origin || '*',
                    },
                    body: '',
                };
            }

            if (!code) {
                return error('Authorization code not provided', 400, undefined, origin);
            }

            // Exchange authorization code for tokens using Google OAuth directly
            try {
                const apiBaseUrl = await getApiBaseUrl();
                const redirectUri = `${apiBaseUrl}/auth/google/callback`;
                
                // Exchange code for tokens and get user info
                const { user: googleUser, tokens: googleTokens } = await authService.exchangeGoogleCode(code, redirectUri);
                
                // Get or create user in database
                const user = await authService.getOrCreateGoogleUser(googleUser);
                
                // Generate JWT tokens for our system
                const jwtPayload = {
                    sub: user.cognito_sub,
                    email: user.email,
                    role: user.role,
                };
                
                const jwtModule = await import('jsonwebtoken');
                const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
                const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-this-refresh-secret-in-production';
                const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
                const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
                
                const signOptions = {
                    expiresIn: JWT_EXPIRES_IN,
                } as SignOptions;
                
                const accessToken = jwtModule.default.sign(jwtPayload, JWT_SECRET, signOptions);
                
                const refreshTokenOptions = {
                    expiresIn: JWT_REFRESH_EXPIRES_IN,
                } as SignOptions;
                
                const refreshToken = jwtModule.default.sign({ sub: user.cognito_sub }, JWT_REFRESH_SECRET, refreshTokenOptions);
                
                // Create cookies for tokens
                const { createCookie } = await import('../../utils/response');
                const cookies: string[] = [];
                const cookieAttrs = resolveCookieAttributes(effectiveOrigin || origin);
                
                // Calcular expiresIn en segundos
                const expiresInSeconds = JWT_EXPIRES_IN.includes('h')
                    ? parseInt(JWT_EXPIRES_IN) * 3600
                    : parseInt(JWT_EXPIRES_IN) * 60;
                
                // Access token cookie
                cookies.push(createCookie('accessToken', accessToken, {
                    maxAge: expiresInSeconds,
                    httpOnly: true,
                    secure: cookieAttrs.secure,
                    sameSite: cookieAttrs.sameSite,
                    path: '/',
                }));

                // Refresh token cookie
                cookies.push(createCookie('refreshToken', refreshToken, {
                    maxAge: 7 * 24 * 60 * 60, // 7 days
                    httpOnly: true,
                    secure: cookieAttrs.secure,
                    sameSite: cookieAttrs.sameSite,
                    path: '/',
                }));

                // Redirect to frontend dashboard
                const frontendUrl = await getFrontendUrl(effectiveOrigin);
                const isLocalhost = frontendUrl.includes('localhost') || frontendUrl.includes('127.0.0.1');
                let redirectUrl = `${frontendUrl}/dashboard`;

                if (isLocalhost) {
                    // Pass tokens as URL parameters for localhost
                    const params = new URLSearchParams();
                    params.set('token', accessToken);
                    params.set('refreshToken', refreshToken);
                    redirectUrl = `${frontendUrl}/auth/callback?${params.toString()}`;
                }

                const responseHeaders: Record<string, string> = {
                    'Location': redirectUrl,
                    'Access-Control-Allow-Origin': effectiveOrigin || origin || '*',
                    'Access-Control-Allow-Credentials': 'true',
                };

                const response: APIGatewayProxyResult = {
                    statusCode: 302,
                    headers: responseHeaders,
                    body: '',
                };

                // Add cookies via multiValueHeaders
                if (cookies.length > 0) {
                    response.multiValueHeaders = {
                        'Set-Cookie': cookies,
                    };
                }

                return response;
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to complete Google OAuth';
                console.error('Google OAuth callback error:', err);
                const frontendUrl = await getFrontendUrl(effectiveOrigin);
                return {
                    statusCode: 302,
                    headers: {
                        'Location': `${frontendUrl}/login?error=${encodeURIComponent(errorMessage)}`,
                        'Access-Control-Allow-Origin': origin || '*',
                    },
                    body: '',
                };
            }
        }

        // POST /auth/logout
        if (path === '/auth/logout' && httpMethod === 'POST') {
            // Limpiar cookies
            const { createCookie } = await import('../../utils/response');
            const cookies: string[] = [
                createCookie('accessToken', '', { maxAge: 0 }),
                createCookie('refreshToken', '', { maxAge: 0 }),
            ];

            return success({ message: 'Logged out successfully' }, 200, cookies, origin);
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        const errorStack = err instanceof Error ? err.stack : undefined;

        // Determinar código de error apropiado
        let statusCode = 500;
        if (isAuthError(err)) {
            statusCode = err.statusCode;
        } else if (errorMessage.includes('Incorrect username or password') ||
            errorMessage.includes('NotAuthorizedException') ||
            errorMessage.includes('UserNotFoundException')) {
            statusCode = 401;
        } else if (errorMessage.includes('User not found')) {
            statusCode = 404;
        } else if (errorMessage.includes('already exists') ||
            errorMessage.includes('UsernameExistsException')) {
            statusCode = 409;
        } else if (errorMessage.includes('Invalid') ||
            errorMessage.includes('required')) {
            statusCode = 400;
        }

        console.error('Auth controller error:', {
            error: errorMessage,
            stack: errorStack,
            statusCode,
            path,
            httpMethod,
        });

        return error(errorMessage, statusCode, undefined, origin);
    }
};
