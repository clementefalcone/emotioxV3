import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success, error } from '../../utils/response';
import { requireAuth } from '../../utils/auth';
import * as authService from '../auth/auth.service';
import * as usersService from './users.service';
import { sendViewerInvitation } from '../email/email.service';
import { getRequestOrigin } from '../../utils/request';
import pool from '../../config/database';

const USER_ROLES = ['admin', 'researcher', 'viewer'];

export const handleUsersRoutes = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { httpMethod, path } = event;
    const origin = getRequestOrigin(event);

    try {
        // POST /users/invite — invite a viewer (admin/researcher only)
        if (path === '/users/invite' && httpMethod === 'POST') {
            const decoded = await requireAuth(event);
            const inviter = await authService.getMe(decoded.sub);

            if (inviter.role === 'viewer') {
                return error('Viewers cannot invite users', 403, undefined, origin);
            }

            const body = JSON.parse(event.body || '{}');
            const { email } = body;
            if (!email || typeof email !== 'string') {
                return error('Email is required', 400, undefined, origin);
            }

            // Check if user already exists
            const existing = await pool.query(
                'SELECT id, email, role FROM users WHERE email = ? AND deleted_at IS NULL',
                [email.trim().toLowerCase()]
            );

            if (existing.rows.length > 0) {
                return error(`User ${email} already exists with role: ${existing.rows[0].role}`, 409, undefined, origin);
            }

            // Create user with viewer role (placeholder cognito_sub, no password)
            const userId = crypto.randomUUID();
            const placeholderSub = `pending-google-${userId}`;
            await pool.query(
                'INSERT INTO users (id, email, cognito_sub, role, first_name, last_name, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    userId,
                    email.trim().toLowerCase(),
                    placeholderSub,
                    'viewer',
                    body.first_name || null,
                    body.last_name || null,
                    JSON.stringify({ auth_provider: 'google', invited_by: inviter.id }),
                ]
            );

            // Send invitation email
            const appUrl = process.env.RESEARCH_FRONTEND_URL || 'https://emotio.cx/research';
            const inviterName = [inviter.first_name, inviter.last_name].filter(Boolean).join(' ') || inviter.email;
            const emailResult = await sendViewerInvitation({
                to: email.trim().toLowerCase(),
                inviterName,
                appUrl,
            });

            return success({
                userId,
                email: email.trim().toLowerCase(),
                role: 'viewer',
                emailSent: emailResult.success,
                emailError: emailResult.error,
            }, 201, undefined, origin);
        }

        // All remaining routes require auth
        const userDecoded = await requireAuth(event);
        const currentUser = await authService.getMe(userDecoded.sub);

        // Viewer: read-only
        if (currentUser.role === 'viewer' && httpMethod !== 'GET') {
            return error('Viewer role is read-only', 403, undefined, origin);
        }

        // GET /users/viewers — list invited viewers
        if (path === '/users/viewers' && httpMethod === 'GET') {
            const result = await pool.query(
                `SELECT id, email, first_name, last_name, metadata, created_at
                 FROM users
                 WHERE role = 'viewer' AND deleted_at IS NULL
                 ORDER BY created_at DESC`
            );
            const viewers = result.rows.map((row) => ({
                id: row.id,
                email: row.email,
                firstName: row.first_name || null,
                lastName: row.last_name || null,
                invitedBy: (() => {
                    try {
                        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                        return meta?.invited_by || null;
                    } catch { return null; }
                })(),
                createdAt: row.created_at,
            }));
            return success({ viewers }, 200, undefined, origin);
        }

        if (currentUser.role !== 'admin') {
            console.warn(JSON.stringify({ event: 'users_admin_required', userId: currentUser.id, method: httpMethod, path }));
            return error('Admin role required', 403, undefined, origin);
        }

        const body = JSON.parse(event.body || '{}');
        if (body.role !== undefined && !USER_ROLES.includes(body.role)) {
            return error(`Invalid role: expected one of ${USER_ROLES.join(', ')}`, 400, undefined, origin);
        }

        // GET /users
        if (path === '/users' && httpMethod === 'GET') {
            const users = await usersService.getAllUsers();
            return success({ users }, 200, undefined, origin);
        }

        // GET /users/:id
        const matchId = path.match(/^\/users\/([a-zA-Z0-9-]+)$/);
        if (matchId && httpMethod === 'GET') {
            const id = matchId[1];
            const user = await usersService.getUserById(id);
            if (!user) {
                return error('User not found', 404, undefined, origin);
            }
            return success({ user }, 200, undefined, origin);
        }

        // POST /users
        if (path === '/users' && httpMethod === 'POST') {
            try {
                const user = await usersService.createUser({
                    email: body.email,
                    password: body.password,
                    first_name: body.first_name,
                    last_name: body.last_name,
                    role: body.role
                });
                return success({ user }, 201, undefined, origin);
            } catch (err) {
                return error(err instanceof Error ? err.message : 'Failed to create user', 400, undefined, origin);
            }
        }

        // PUT /users/:id
        if (matchId && httpMethod === 'PUT') {
            const id = matchId[1];
            try {
                const user = await usersService.updateUser(id, {
                    email: body.email,
                    first_name: body.first_name,
                    last_name: body.last_name,
                    role: body.role
                });
                return success({ user }, 200, undefined, origin);
            } catch (err) {
                return error(err instanceof Error ? err.message : 'Failed to update user', 400, undefined, origin);
            }
        }

        // DELETE /users/:id
        if (matchId && httpMethod === 'DELETE') {
            const id = matchId[1];
            try {
                const result = await usersService.deleteUser(id);
                return success(result, 200, undefined, origin);
            } catch (err) {
                return error(err instanceof Error ? err.message : 'Failed to delete user', 400, undefined, origin);
            }
        }

        return error('Route not found', 404, undefined, origin);
    } catch (err: unknown) {
        console.error('Users controller error:', err);
        const msg = err instanceof Error ? err.message : 'Internal server error';
        const status = msg.includes('token') || msg.includes('auth') || msg.includes('Authentication') ? 401 : 500;
        return error(msg, status, undefined, origin);
    }
};
