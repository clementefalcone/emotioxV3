/**
 * Servicio de autenticación local (cPanel)
 * Reemplaza Cognito con JWT local + bcrypt
 */

import pool from '../../config/database';
import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { URLSearchParams as NodeURLSearchParams } from 'url';

// Read secrets lazily to ensure dotenv has loaded
const getJwtSecret = (): string => process.env.JWT_SECRET || 'change-this-secret-in-production';
const getJwtRefreshSecret = (): string => process.env.JWT_REFRESH_SECRET || 'change-this-refresh-secret-in-production';
const getJwtExpiresIn = (): string => process.env.JWT_EXPIRES_IN || '24h';
const getJwtRefreshExpiresIn = (): string => process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const getBcryptRounds = (): number => parseInt(process.env.BCRYPT_ROUNDS || '10');

export interface RegisterData {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    role?: 'admin' | 'researcher';
}

export interface LoginData {
    email: string;
    password: string;
}

export interface RefreshTokenData {
    refreshToken: string;
}

/**
 * Genera un ID único para el usuario (equivalente a cognito_sub)
 */
const generateUserSub = (): string => {
    return uuidv4();
};

/**
 * Registra un nuevo usuario
 */
export const register = async (data: RegisterData) => {
    const { email, password, firstName, lastName, role = 'researcher' } = data;
    
    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
    }
    
    // Validar password
    if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }
    
    try {
        const existingUserResult = await pool.query(
            'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
            [email]
        );
        if (existingUserResult.rows.length > 0) {
            throw new Error(`User ${email} already exists`);
        }

        const hashedPassword = await bcrypt.hash(password, getBcryptRounds());

        // Usuario no existe, crear nuevo
        const userSub = generateUserSub();
        
        // Crear usuario en base de datos
        const insertQuery = `
            INSERT INTO users (email, cognito_sub, role, first_name, last_name, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const metadata = {
            password_hash: hashedPassword,
            auth_provider: 'local',
        };
        
        await pool.query(insertQuery, [
            email,
            userSub,
            role,
            firstName,
            lastName,
            JSON.stringify(metadata),
        ]);
        
        // Obtener el usuario creado
        const getUserQuery = `
            SELECT id, email, role, first_name, last_name, created_at
            FROM users
            WHERE email = ? AND deleted_at IS NULL
            LIMIT 1
        `;
        const result = await pool.query(getUserQuery, [email]);
        return result.rows[0];
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to register user';
        console.error('Register error:', error);
        throw new Error(errorMessage);
    }
};

/**
 * Login de usuario
 */
export const login = async (data: LoginData) => {
    const { email, password } = data;
    
    try {
        // Buscar usuario en base de datos
        const userQuery = `
            SELECT id, email, cognito_sub, role, first_name, last_name, metadata
            FROM users
            WHERE email = ? AND deleted_at IS NULL
            LIMIT 1
        `;
        const userResult = await pool.query(userQuery, [email]);
        
        if (userResult.rows.length === 0) {
            throw new Error('Invalid email or password');
        }
        
        const user = userResult.rows[0];
        
        // Parse metadata - MySQL may return JSON as string
        let metadata: Record<string, unknown> = {};
        if (user.metadata) {
            if (typeof user.metadata === 'string') {
                try {
                    metadata = JSON.parse(user.metadata) as Record<string, unknown>;
                } catch (e) {
                    console.error('Failed to parse user metadata:', e);
                    metadata = {};
                }
            } else if (typeof user.metadata === 'object' && user.metadata !== null) {
                metadata = user.metadata as Record<string, unknown>;
            }
        }
        
        const passwordHash = metadata.password_hash as string | undefined;
        
        if (!passwordHash) {
            throw new Error('User account not configured for local authentication');
        }
        
        // Verificar password
        const passwordValid = await bcrypt.compare(password, passwordHash);
        if (!passwordValid) {
            throw new Error('Invalid email or password');
        }
        
        // Generar tokens JWT
        const payload = {
            sub: user.cognito_sub,
            email: user.email,
            role: user.role,
        };
        
        const accessToken = jwt.sign(payload, getJwtSecret(), {
            expiresIn: getJwtExpiresIn(),
        } as jwt.SignOptions);

        const refreshToken = jwt.sign({ sub: user.cognito_sub }, getJwtRefreshSecret(), {
            expiresIn: getJwtRefreshExpiresIn(),
        } as jwt.SignOptions);

        // Calcular expiresIn en segundos
        const jwtExpiresIn = getJwtExpiresIn();
        const expiresInSeconds = jwtExpiresIn.includes('h')
            ? parseInt(jwtExpiresIn) * 3600
            : parseInt(jwtExpiresIn) * 60;
        
        return {
            accessToken,
            idToken: accessToken, // Para compatibilidad
            refreshToken,
            expiresIn: expiresInSeconds,
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to login';
        console.error('Login error:', error);
        throw new Error(errorMessage);
    }
};

/**
 * Obtiene información del usuario
 */
export const getMe = async (userSub: string): Promise<{ id: string; email: string; role: string; first_name?: string | null; last_name?: string | null; created_at: Date; updated_at: Date }> => {
    try {
        if (!userSub) {
            throw new Error('userSub is required');
        }
        
        const query = `
            SELECT id, email, role, first_name, last_name, created_at, updated_at
            FROM users
            WHERE cognito_sub = ? AND deleted_at IS NULL
        `;
        const result = await pool.query(query, [userSub]);
        
        if (result.rows.length === 0) {
            throw new Error(`User not found for sub: ${userSub}`);
        }
        
        const row = result.rows[0];
        return {
            id: row.id,
            email: row.email,
            role: row.role,
            first_name: row.first_name,
            last_name: row.last_name,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to get user';
        console.error('GetMe error:', error);
        throw new Error(errorMessage);
    }
};

/**
 * Refresca el token de acceso
 */
export const refreshToken = async (data: RefreshTokenData) => {
    const { refreshToken: token } = data;
    
    try {
        // Verificar refresh token
        const decoded = jwt.verify(token, getJwtRefreshSecret()) as { sub: string };

        // Obtener usuario
        const user = await getMe(decoded.sub);

        // Usar decoded.sub como cognito_sub (es el mismo valor)
        const cognitoSub = decoded.sub;

        // Generar nuevo access token
        const payload = {
            sub: cognitoSub,
            email: user.email,
            role: user.role,
        };

        const accessToken = jwt.sign(payload, getJwtSecret(), {
            expiresIn: getJwtExpiresIn(),
        } as jwt.SignOptions);

        const jwtExpiresIn = getJwtExpiresIn();
        const expiresInSeconds = jwtExpiresIn.includes('h')
            ? parseInt(jwtExpiresIn) * 3600
            : parseInt(jwtExpiresIn) * 60;
        
        return {
            accessToken,
            idToken: accessToken,
            expiresIn: expiresInSeconds,
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to refresh token';
        console.error('Refresh token error:', error);
        
        if (errorMessage.includes('expired') || errorMessage.includes('invalid')) {
            const refreshError = new Error('Refresh token expired or invalid');
            (refreshError as Error & { statusCode?: number }).statusCode = 401;
            throw refreshError;
        }
        
        throw new Error(errorMessage);
    }
};

/**
 * Actualiza perfil de usuario
 */
export interface UpdateUserData {
    first_name?: string;
    last_name?: string;
    email?: string;
}

export const updateUser = async (userSub: string, data: UpdateUserData): Promise<unknown> => {
    try {
        const fields: string[] = [];
        const values: (string | undefined)[] = [];
        let idx = 1;
        
        if (data.first_name !== undefined) {
            fields.push('first_name = ?');
            values.push(data.first_name);
        }
        if (data.last_name !== undefined) {
            fields.push('last_name = ?');
            values.push(data.last_name);
        }
        if (data.email !== undefined) {
            fields.push('email = ?');
            values.push(data.email);
        }
        
        if (fields.length === 0) {
            throw new Error('No fields to update');
        }
        
        values.push(userSub);
        const query = `
            UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
            WHERE cognito_sub = ?
        `;
        await pool.query(query, values);
        
        // Obtener el usuario actualizado
        const getUserQuery = `
            SELECT id, email, role, first_name, last_name, created_at, updated_at
            FROM users
            WHERE cognito_sub = ?
        `;
        const result = await pool.query(getUserQuery, [userSub]);
        return result.rows[0];
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update user';
        console.error('UpdateUser error:', error);
        throw new Error(message);
    }
};

/**
 * Elimina cuenta de usuario
 */
export const deleteAccount = async (userSub: string): Promise<{ message: string }> => {
    try {
        const query = `
            UPDATE users
            SET deleted_at = NOW()
            WHERE cognito_sub = ? AND deleted_at IS NULL
        `;
        await pool.query(query, [userSub]);
        
        // Verificar que se actualizó
        const verifyQuery = `
            SELECT id FROM users WHERE cognito_sub = ? AND deleted_at IS NOT NULL LIMIT 1
        `;
        const result = await pool.query(verifyQuery, [userSub]);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        return { message: 'Account deleted successfully' };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to delete account';
        console.error('DeleteAccount error:', error);
        throw new Error(message);
    }
};

/**
 * Obtiene o crea cliente OAuth2 de Google
 */
const getGoogleOAuthClient = (): OAuth2Client => {
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || 
        path.join(__dirname, '../../google-credentials.json');
    
    let credentials: { web?: { client_id?: string; client_secret?: string; redirect_uris?: string[] } };
    
    try {
        if (fs.existsSync(credentialsPath)) {
            const fileContent = fs.readFileSync(credentialsPath, 'utf8');
            credentials = JSON.parse(fileContent);
        } else {
            // Fallback a variables de entorno
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            
            if (!clientId || !clientSecret) {
                throw new Error('Google OAuth credentials not found. Set GOOGLE_CREDENTIALS_PATH or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET');
            }
            
            credentials = {
                web: {
                    client_id: clientId,
                    client_secret: clientSecret,
                },
            };
        }
        
        if (!credentials.web?.client_id || !credentials.web?.client_secret) {
            throw new Error('Google OAuth credentials incomplete');
        }
        
        const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
        const client = new OAuth2Client(
            credentials.web.client_id,
            credentials.web.client_secret,
            redirectUri
        );
        
        return client;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load Google OAuth credentials';
        console.error('Google OAuth client error:', error);
        throw new Error(errorMessage);
    }
};

/**
 * Interfaz para datos de usuario de Google
 */
export interface GoogleUserData {
    email: string;
    given_name?: string;
    family_name?: string;
    name?: string;
    picture?: string;
    sub: string;
}

/**
 * Intercambia código de autorización de Google por tokens y obtiene información del usuario
 */
export const exchangeGoogleCode = async (code: string, redirectUri: string): Promise<{
    user: GoogleUserData;
    tokens: { accessToken: string; refreshToken?: string; expiresIn: number };
}> => {
    try {
        // Crear cliente con el redirectUri específico
        const fs = await import('fs');
        const path = await import('path');
        
        const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || 
            path.join(process.cwd(), 'google-credentials.json');
        
        let credentials: { web?: { client_id?: string; client_secret?: string } };
        let clientId: string;
        
        if (fs.existsSync(credentialsPath)) {
            const fileContent = fs.readFileSync(credentialsPath, 'utf8');
            credentials = JSON.parse(fileContent);
            clientId = credentials.web?.client_id || '';
        } else {
            const envClientId = process.env.GOOGLE_CLIENT_ID;
            const envClientSecret = process.env.GOOGLE_CLIENT_SECRET;
            
            if (!envClientId || !envClientSecret) {
                throw new Error('Google OAuth credentials not found');
            }
            
            credentials = {
                web: {
                    client_id: envClientId,
                    client_secret: envClientSecret,
                },
            };
            clientId = envClientId;
        }
        
        if (!credentials.web?.client_id || !credentials.web?.client_secret) {
            throw new Error('Google OAuth credentials incomplete');
        }
        
        // ponytail: bypass undici (native fetch) — "Premature close" on cPanel Node 24.
        // Manual POST via stdlib https. Upgrade path: revert when cPanel fixes undici HTTP/2.
        const tokenBody = new NodeURLSearchParams({
            code,
            client_id: credentials.web!.client_id!,
            client_secret: credentials.web!.client_secret!,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }).toString();

        const tokenResponse = await new Promise<{
            access_token?: string;
            id_token?: string;
            refresh_token?: string;
            expires_in?: number;
        }>((resolve, reject) => {
            const req = https.request('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(tokenBody),
                },
            }, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error(`Google token response not JSON: ${data.slice(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(tokenBody);
            req.end();
        });

        if (!tokenResponse.access_token) {
            throw new Error('Failed to get access token from Google');
        }

        if (!tokenResponse.id_token) {
            throw new Error('ID token not received from Google');
        }

        // Decode id_token JWT payload (no verification needed — we just got it from Google over TLS)
        const idTokenParts = tokenResponse.id_token.split('.');
        const idPayload = JSON.parse(Buffer.from(idTokenParts[1], 'base64url').toString()) as {
            email?: string; given_name?: string; family_name?: string;
            name?: string; picture?: string; sub: string;
        };

        const userData: GoogleUserData = {
            email: idPayload.email || '',
            given_name: idPayload.given_name,
            family_name: idPayload.family_name,
            name: idPayload.name,
            picture: idPayload.picture,
            sub: idPayload.sub,
        };

        if (!userData.email) {
            throw new Error('Email not provided by Google');
        }

        const expiresIn = tokenResponse.expires_in || 3600;
        
        return {
            user: userData,
            tokens: {
                accessToken: tokenResponse.access_token!,
                refreshToken: tokenResponse.refresh_token || undefined,
                expiresIn,
            },
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to exchange Google code';
        console.error('ExchangeGoogleCode error:', error);
        throw new Error(errorMessage);
    }
};

/**
 * Obtiene o crea usuario desde datos de Google OAuth
 */
export const getOrCreateGoogleUser = async (googleUser: GoogleUserData): Promise<{
    id: string;
    email: string;
    role: string;
    first_name?: string | null;
    last_name?: string | null;
    created_at: Date;
    updated_at: Date;
    cognito_sub: string;
}> => {
    try {
        // Buscar usuario por email o cognito_sub (usando sub de Google)
        const existingUserQuery = `
            SELECT id, email, cognito_sub, role, first_name, last_name, created_at, updated_at
            FROM users
            WHERE (email = ? OR cognito_sub = ?) AND deleted_at IS NULL
            LIMIT 1
        `;
        const existingUser = await pool.query(existingUserQuery, [googleUser.email, googleUser.sub]);
        
        if (existingUser.rows.length > 0) {
            const user = existingUser.rows[0];
            // Si el usuario existe pero no tiene el cognito_sub de Google, actualizarlo
            if (user.cognito_sub !== googleUser.sub) {
                const updateQuery = `
                    UPDATE users
                    SET cognito_sub = ?, updated_at = NOW()
                    WHERE id = ?
                `;
                await pool.query(updateQuery, [googleUser.sub, user.id]);
            }
            // Actualizar nombre si está disponible
            if (googleUser.given_name || googleUser.family_name) {
                const updateFields: string[] = [];
                const updateValues: unknown[] = [];
                if (googleUser.given_name && !user.first_name) {
                    updateFields.push('first_name = ?');
                    updateValues.push(googleUser.given_name);
                }
                if (googleUser.family_name && !user.last_name) {
                    updateFields.push('last_name = ?');
                    updateValues.push(googleUser.family_name);
                }
                if (updateFields.length > 0) {
                    updateValues.push(user.id);
                    const updateQuery = `
                        UPDATE users
                        SET ${updateFields.join(', ')}, updated_at = NOW()
                        WHERE id = ?
                    `;
                    await pool.query(updateQuery, updateValues);
                }
            }
            return {
                id: user.id,
                email: user.email,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name,
                created_at: user.created_at,
                updated_at: user.updated_at,
                cognito_sub: googleUser.sub, // Usar el sub de Google
            };
        }
        
        // Crear nuevo usuario
        const userSub = googleUser.sub;
        const metadata = {
            auth_provider: 'google',
            google_id: googleUser.sub,
            picture: googleUser.picture,
        };
        
        const insertQuery = `
            INSERT INTO users (email, cognito_sub, role, first_name, last_name, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        await pool.query(insertQuery, [
            googleUser.email,
            userSub,
            'researcher', // Default role
            googleUser.given_name || null,
            googleUser.family_name || null,
            JSON.stringify(metadata),
        ]);
        
        // Obtener el usuario creado (MySQL doesn't support RETURNING)
        const getUserQuery = `
            SELECT id, email, cognito_sub, role, first_name, last_name, created_at, updated_at
            FROM users
            WHERE email = ? AND deleted_at IS NULL
            LIMIT 1
        `;
        const result = await pool.query(getUserQuery, [googleUser.email]);
        
        if (result.rows.length === 0) {
            throw new Error('Failed to create user');
        }
        
        return {
            id: result.rows[0].id,
            email: result.rows[0].email,
            role: result.rows[0].role,
            first_name: result.rows[0].first_name,
            last_name: result.rows[0].last_name,
            created_at: result.rows[0].created_at,
            updated_at: result.rows[0].updated_at,
            cognito_sub: result.rows[0].cognito_sub,
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to get or create Google user';
        console.error('GetOrCreateGoogleUser error:', error);
        throw new Error(errorMessage);
    }
};
