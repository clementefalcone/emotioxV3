/**
 * Server entry point for cPanel/Passenger (TypeScript version)
 * This will be compiled to dist/server-cpanel.js for Passenger
 */

// IMPORTANT: Load environment variables FIRST, before any other imports
// that might depend on process.env values
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

// Now import modules that depend on process.env
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';
import { route } from './router';
import cache from './config/cache';
import { monitorSSEService } from './modules/monitor/monitor-sse.service';
import { verifyToken } from './utils/auth.local';
import { attachSSE, detachSSE, getJob } from './modules/attention-prediction/video-prediction-jobs';
import type { APIGatewayProxyEvent } from 'aws-lambda';

const app = express();

// Get port from Passenger or environment, default to 3000
const PORT = process.env.PORT || process.env.PASSENGER_PORT || 3000;

// CORS configuration
const allowedOrigins = [
    'http://localhost:12800',
    'http://localhost:12500',
    'http://localhost:12600',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    // Production cPanel
    'https://emotio.cx',
    'https://emotio.cx/research',
    'https://emotio.cx/participant',
    process.env.CORS_ORIGIN,
    process.env.RESEARCH_FRONTEND_URL,
    process.env.PARTICIPANT_FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, Postman)
        if (!origin) {
            return callback(null, true);
        }
        
        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        
        // Allow any subdomain or path of emotio.cx
        if (origin.includes('emotio.cx')) {
            return callback(null, true);
        }
        
        console.warn(`CORS: Origin not allowed: ${origin}`);
        callback(new Error('CORS: Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
}));

app.options('/api/monitor/events/:researchId', (req: Request, res: Response) => {
    const origin = req.headers.origin;

    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,Cache-Control,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.status(204).end();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain', limit: '1mb' }));

// Configure multer for file uploads (memory storage for direct processing)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max file size
    },
});

app.put('/api/media/upload-direct', express.raw({ type: '*/*', limit: '50mb' }), async (req: Request, res: Response) => {
    try {
        const research_id = (req.query.research_id as string) || (req.headers['x-research-id'] as string);
        const question_id = (req.query.question_id as string) || (req.headers['x-question-id'] as string) || null;
        const media_path = (req.query.media_path as string) || (req.headers['x-media-path'] as string);
        
        if (!research_id || !media_path) {
            return res.status(400).json({ 
                error: 'research_id and media_path are required. Send as query params: ?research_id=...&media_path=...' 
            });
        }

        const { isValidUploadSignature } = await import('./modules/media/media.service.local');
        if (!isValidUploadSignature(String(research_id), String(media_path), req.query.expires, req.query.signature)) {
            console.warn(JSON.stringify({ event: 'media_upload_rejected', researchId: research_id, mediaPath: media_path }));
            return res.status(403).json({ error: 'Upload URL signature is missing, invalid or expired' });
        }

        if (!req.body || (req.body as Buffer).length === 0) {
            return res.status(400).json({ error: 'No file data provided' });
        }

        const contentType = req.headers['content-type'] || 'application/octet-stream';
        
        const { handleDirectUpload } = await import('./modules/media/media.controller.local');
        
        const fileName = media_path.split('/').pop() || 'uploaded-file';
        
        const result = await handleDirectUpload(
            research_id,
            question_id || null,
            {
                name: fileName,
                data: Buffer.from(req.body as Buffer),
                mimetype: contentType,
            },
            media_path
        );

        res.status(200).json(result);
    } catch (error) {
        console.error('Upload error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        res.status(500).json({ error: errorMessage });
    }
});

// ─── Upload heatmap video from external renderer (Colab) ─────────
app.post('/api/attention-prediction/upload-heatmap-video', upload.single('file'), async (req: Request, res: Response) => {
    try {
        const { researchId, stimulusMediaId, secret } = req.body || {};
        const expectedSecret = process.env.HEATMAP_UPLOAD_SECRET;

        if (!expectedSecret || secret !== expectedSecret) { res.status(403).json({ error: 'Invalid secret' }); return; }
        if (!researchId || !stimulusMediaId || !req.file) { res.status(400).json({ error: 'researchId, stimulusMediaId, and file are required' }); return; }

        const timestamp = Date.now();
        const relativePath = `research/${researchId}/heatmap_${timestamp}.mp4`;
        const absolutePath = path.join(MEDIA_BASE_DIR, relativePath);
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absolutePath, req.file.buffer);

        const mediaUrl = `${MEDIA_PUBLIC_URL}/${relativePath}`;

        const dbPool = (await import('./config/database')).default;
        const dbResult = await dbPool.query('SELECT config FROM researches WHERE id = ? AND deleted_at IS NULL', [researchId]);
        if (dbResult.rows.length === 0) { res.status(404).json({ error: 'Research not found' }); return; }

        let config: Record<string, unknown> = {};
        try { const raw = dbResult.rows[0].config; config = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch { config = {}; }

        const stimuli = (config.stimuli as Array<Record<string, unknown>>) || [];
        config.stimuli = stimuli.map(s =>
            s.mediaId === stimulusMediaId
                ? { ...s, heatmapVideoUrl: mediaUrl, heatmapVideoPath: relativePath, processedAt: new Date().toISOString(), predictionError: undefined, predictionErrorAt: undefined }
                : s
        );

        await dbPool.query('UPDATE researches SET config = ? WHERE id = ?', [JSON.stringify(config), researchId]);
        console.log(`[HeatmapUpload] Saved ${relativePath} for stimulus ${stimulusMediaId}`);
        res.status(200).json({ success: true, heatmapVideoUrl: mediaUrl, path: relativePath });
    } catch (error) {
        console.error('[HeatmapUpload] Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        res.status(500).json({ error: errorMessage });
    }
});

// Serve media files statically
const MEDIA_BASE_DIR = process.env.MEDIA_BASE_DIR || path.join(__dirname, '../media');
const MEDIA_PUBLIC_URL = process.env.MEDIA_PUBLIC_URL || '/media';

// Ensure media directory exists
if (!fs.existsSync(MEDIA_BASE_DIR)) {
    fs.mkdirSync(MEDIA_BASE_DIR, { recursive: true });
    console.log(`✓ Media directory created: ${MEDIA_BASE_DIR}`);
}

// Serve media files at /media/*
app.use('/media', express.static(MEDIA_BASE_DIR, {
    setHeaders: (res: Response, filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
        };
        if (contentTypes[ext]) {
            res.setHeader('Content-Type', contentTypes[ext]);
        }
        if (ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        if (ext === '.mp4' || ext === '.webm') {
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Accept-Ranges', 'bytes');
        }
    },
    dotfiles: 'deny',
    index: false,
}));

// Also serve at /api/media for compatibility
app.use('/api/media', express.static(MEDIA_BASE_DIR, {
    setHeaders: (res: Response, filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
        };
        if (contentTypes[ext]) {
            res.setHeader('Content-Type', contentTypes[ext]);
        }
        if (ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        if (ext === '.mp4' || ext === '.webm') {
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Accept-Ranges', 'bytes');
        }
    },
    dotfiles: 'deny',
    index: false,
}));

// Debug endpoint to verify JWT token
// GET /api/debug/verify-token?token=xxx
app.get('/api/debug/verify-token', async (req: Request, res: Response) => {
    const { token } = req.query;

    console.log('[DEBUG] JWT_SECRET configured:', process.env.JWT_SECRET ? 'YES (custom)' : 'NO (using default)');
    console.log('[DEBUG] JWT_SECRET value preview:', process.env.JWT_SECRET ? process.env.JWT_SECRET.substring(0, 10) + '...' : 'default');

    if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Token required', jwtSecretConfigured: !!process.env.JWT_SECRET });
    }

    try {
        const decoded = await verifyToken(token);
        res.json({
            valid: true,
            decoded,
            jwtSecretConfigured: !!process.env.JWT_SECRET
        });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        res.status(401).json({
            valid: false,
            error: errorMessage,
            jwtSecretConfigured: !!process.env.JWT_SECRET,
            jwtSecretPreview: process.env.JWT_SECRET ? process.env.JWT_SECRET.substring(0, 10) + '...' : 'using default'
        });
    }
});

// SSE endpoint for live tracking sessions
// Registered with both /api and / prefix for Passenger compatibility
app.get(['/api/tracking/:researchId/live/stream', '/tracking/:researchId/live/stream'], async (req: Request, res: Response) => {
    try {
        const { researchId } = req.params;
        const { token } = req.query;

        if (!token || typeof token !== 'string') {
            return res.status(401).json({ error: 'Authentication token is required' });
        }

        let userSub: string;
        try {
            userSub = (await verifyToken(token)).sub;
        } catch {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        const { canAccessResearch } = await import('./modules/research/research-access');
        if (!(await canAccessResearch(researchId, userSub))) {
            console.warn(JSON.stringify({ event: 'research_access_denied', researchId, userSub, path: req.path }));
            return res.status(404).json({ error: `Research ${researchId} not found` });
        }

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.flushHeaders();

        // Import lazily to avoid circular deps
        const { getLiveSessions } = await import('./modules/tracking/tracking.service');

        // Send initial data
        const initial = await getLiveSessions(researchId);
        res.write(`data: ${JSON.stringify(initial)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();

        // Push updates every 5s
        const interval = setInterval(async () => {
            try {
                const data = await getLiveSessions(researchId);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
                if (typeof (res as any).flush === 'function') (res as any).flush();
            } catch {
                // DB query failed — skip this tick
            }
        }, 5000);

        // Keep-alive ping every 30s
        const pingInterval = setInterval(() => {
            try { res.write(': ping\n\n'); if (typeof (res as any).flush === 'function') (res as any).flush(); } catch { /* connection dead */ }
        }, 30000);

        // Cleanup on disconnect
        res.on('close', () => {
            clearInterval(interval);
            clearInterval(pingInterval);
        });

    } catch (err) {
        console.error('[Tracking SSE] Error:', err);
        res.status(500).json({ error: 'SSE connection failed' });
    }
});

// SSE endpoint for real-time monitoring
// GET /api/monitor/events/:researchId?token=xxx
app.get('/api/monitor/events/:researchId', async (req: Request, res: Response) => {
    try {
        const { researchId } = req.params;
        const { token } = req.query;

        console.log('[SSE] Connection attempt for research:', researchId);

        if (!token || typeof token !== 'string') {
            console.log('[SSE] No token provided');
            return res.status(401).json({ error: 'Authentication token is required' });
        }

        try {
            const decoded = await verifyToken(token);
            const userId = decoded.sub;
            const { canAccessResearch } = await import('./modules/research/research-access');
            if (!(await canAccessResearch(researchId, userId))) {
                console.warn(JSON.stringify({ event: 'research_access_denied', researchId, userSub: userId, path: req.path }));
                return res.status(404).json({ error: `Research ${researchId} not found` });
            }
            console.log('[SSE] Token verified successfully, userId:', userId);

            // Generate unique connection ID
            const connectionId = crypto.randomUUID();

            // Register SSE connection
            await monitorSSEService.registerConnection(connectionId, researchId, userId, res);

            console.log(`SSE connection established: ${connectionId} for research ${researchId}`);

        } catch (authError) {
            const errorMessage = authError instanceof Error ? authError.message : 'Unknown error';
            console.error('[SSE] Auth failed:', errorMessage);
            console.error('[SSE] Token length:', token.length);
            console.error('[SSE] JWT_SECRET configured:', process.env.JWT_SECRET ? 'YES' : 'NO (using default)');
            return res.status(401).json({ error: 'Invalid or expired token', details: errorMessage });
        }
    } catch (error) {
        console.error('SSE connection error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Connection failed';
        res.status(500).json({ error: errorMessage });
    }
});

// SSE endpoint for video prediction progress
// GET /api/attention-prediction/research/:researchId/video-predict/stream?jobId=xxx
// Auth: jobId is crypto.randomUUID() — unguessable, acts as capability token
app.get([
    '/api/attention-prediction/research/:researchId/video-predict/stream',
    '/attention-prediction/research/:researchId/video-predict/stream'
], async (req: Request, res: Response) => {
    try {
        const { jobId } = req.query;

        if (!jobId || typeof jobId !== 'string') {
            return res.status(400).json({ error: 'jobId query parameter is required' });
        }

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.flushHeaders();

        if (!attachSSE(jobId, res)) {
            const job = getJob(jobId);
            const msg = job ? `Job already ${job.status}` : 'Job not found';
            res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
            res.end();
            return;
        }

        // Keep-alive ping every 10s (LiteSpeed proxy may timeout idle connections at ~60s)
        const pingInterval = setInterval(() => {
            try { res.write(': ping\n\n'); if (typeof (res as any).flush === 'function') (res as any).flush(); } catch { /* dead */ }
        }, 10_000);

        res.on('close', () => {
            clearInterval(pingInterval);
            detachSSE(jobId, res);
        });

    } catch (err) {
        console.error('[VideoPrediction SSE] Error:', err);
        res.status(500).json({ error: 'SSE connection failed' });
    }
});

// Convert Express request to Lambda event format (for compatibility)
app.use(async (req: Request, res: Response) => {
    // Remove /api prefix if present (cPanel serves app at /api)
    let requestPath = req.path;
    if (requestPath.startsWith('/api')) {
        requestPath = requestPath.substring(4) || '/';
    }
    
    // Debug logging for add-welcome-thankyou endpoint
    if (requestPath.includes('add-welcome-thankyou')) {
        console.log('[server-cpanel] add-welcome-thankyou request:', {
            method: req.method,
            originalPath: req.path,
            processedPath: requestPath,
            url: req.url
        });
    }
    
    const event: APIGatewayProxyEvent = {
        httpMethod: req.method,
        path: requestPath,
        headers: req.headers as Record<string, string>,
        multiValueHeaders: {},
        body: req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : null,
        isBase64Encoded: false,
        pathParameters: null,
        queryStringParameters: req.query as Record<string, string> || null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: requestPath,
    };

    try {
        const result = await route(event);

        if (result.headers) {
            Object.keys(result.headers).forEach((key) => {
                const value = result.headers![key];
                if (value && typeof value === 'string') {
                    res.setHeader(key, value);
                }
            });
        }

        // Handle multiValueHeaders (for Set-Cookie)
        if (result.multiValueHeaders) {
            Object.keys(result.multiValueHeaders).forEach((key) => {
                const values = result.multiValueHeaders![key];
                if (Array.isArray(values)) {
                    values.forEach((value) => {
                        res.append(key, String(value));
                    });
                }
            });
        }

        // Binary responses (base64-encoded) — decode and send as buffer
        if (result.isBase64Encoded && typeof result.body === 'string') {
            res.status(result.statusCode).send(Buffer.from(result.body, 'base64'));
            return;
        }

        // Parse body if it's a JSON string and send as JSON
        let bodyToSend: string | object = result.body;
        if (typeof result.body === 'string') {
            try {
                const parsed = JSON.parse(result.body);
                res.status(result.statusCode).json(parsed);
                return;
            } catch (e) {
                // Not JSON, send as-is
                bodyToSend = result.body;
            }
        }

        res.status(result.statusCode).send(bodyToSend);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server only if not running under Passenger
if (process.env.PASSENGER_APP_ENV !== 'production' && !process.env.PASSENGER_BASE_URI) {
    app.listen(PORT, () => {
        console.log(`\n✓ Server running on port ${PORT}`);
        console.log(`✓ Database: ${process.env.DB_NAME || 'not configured'}`);
        console.log(`✓ Region: ${process.env.APP_AWS_REGION || 'not configured'}`);
        console.log(`✓ Cache: Enabled (in-memory)\n`);
    });
} else {
    console.log(`\n✓ Running under Passenger`);
    console.log(`✓ Database: ${process.env.DB_NAME || 'not configured'}`);
    console.log(`✓ Region: ${process.env.APP_AWS_REGION || 'not configured'}`);
    console.log(`✓ Cache: Enabled (in-memory)\n`);
}

// Export for Passenger (required)
export = app;
