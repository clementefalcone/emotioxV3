/**
 * Servicio de media para almacenamiento local (cPanel)
 * Reemplaza S3 con almacenamiento en sistema de archivos
 */

import pool from '../../config/database';
import { getMediaPath, getMediaUrl, ensureDirectoryExists, initializeMediaDirectory } from '../../config/local-storage';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Inicializar directorio al cargar el módulo
initializeMediaDirectory();

interface MediaUrlResult {
    id?: string;
    url: string;
    expires_in: number;
    source: 'db' | 'local';
}

/**
 * Valida que la ruta de media sea segura
 */
const validateMediaPath = (mediaPath: string): string => {
    const normalized = mediaPath.trim();
    if (normalized.length === 0) {
        throw new Error('media_path is required');
    }
    
    if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
        throw new Error('Invalid media_path');
    }
    
    if (!normalized.startsWith('research/')) {
        throw new Error('Invalid media_path: must start with research/');
    }
    
    const allowed = /^[A-Za-z0-9/_\-. ]+$/;
    if (!allowed.test(normalized)) {
        throw new Error('Invalid media_path: contains invalid characters');
    }
    
    return normalized;
};

/**
 * Genera información para subir un archivo (el upload se hace directamente)
 * @param researchId - ID de la investigación
 * @param fileName - Nombre del archivo
 * @param contentType - Tipo de contenido
 * @returns Información para el upload
 */
const UPLOAD_URL_TTL_SECONDS = 3600;

const getUploadSigningKey = (): string => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required to sign media upload URLs');
    return secret;
};

const signUpload = (researchId: string, mediaPath: string, expires: number): string =>
    crypto.createHmac('sha256', getUploadSigningKey()).update(`upload\n${researchId}\n${mediaPath}\n${expires}`).digest('hex');

export const isValidUploadSignature = (researchId: string, mediaPath: string, expires: unknown, signature: unknown): boolean => {
    const expiresAt = Number(expires);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now() || typeof signature !== 'string') return false;
    const expected = Buffer.from(signUpload(researchId, mediaPath, expiresAt));
    const received = Buffer.from(signature);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};

export const generateUploadUrl = async (researchId: string, fileName: string, contentType: string) => {
    const timestamp = Date.now();
    const safeFileName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    const relativePath = `research/${researchId}/${timestamp}-${safeFileName}`;
    const expires = Math.floor(timestamp / 1000) + UPLOAD_URL_TTL_SECONDS;
    const signature = signUpload(researchId, relativePath, expires);

    const uploadUrl = `/api/media/upload-direct?research_id=${encodeURIComponent(researchId)}&media_path=${encodeURIComponent(relativePath)}&expires=${expires}&signature=${signature}`;

    return {
        upload_url: uploadUrl,
        s3_key: relativePath,
        expires_in: UPLOAD_URL_TTL_SECONDS,
    };
};

/**
 * Guarda metadata de un archivo subido
 */
export const saveMetadata = async (
    researchId: string,
    questionId: string | null,
    mediaPath: string,
    metadata: Record<string, unknown>
): Promise<unknown> => {
    const validatedPath = validateMediaPath(mediaPath);
    const filePath = getMediaPath(validatedPath);
    
    // Verificar que el archivo existe
    if (!fs.existsSync(filePath)) {
        throw new Error('File not found at specified path');
    }
    
    const stats = fs.statSync(filePath);
    
    // MySQL compatible: pre-generate UUID and no RETURNING
    const mediaId = crypto.randomUUID();
    const query = `
        INSERT INTO media (id, research_id, question_id, s3_key, s3_bucket, file_name, file_type, file_size, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await pool.query(query, [
        mediaId,
        researchId,
        questionId,
        validatedPath, // Usar como s3_key para compatibilidad
        'local', // s3_bucket = 'local' para indicar almacenamiento local
        (metadata?.fileName as string) || path.basename(validatedPath),
        (metadata?.fileType as string) || 'application/octet-stream',
        stats.size,
        JSON.stringify(metadata || {}),
    ]);
    
    // Fetch created record (MySQL doesn't support RETURNING)
    const selectResult = await pool.query('SELECT * FROM media WHERE id = ?', [mediaId]);
    return selectResult.rows[0];
};

/**
 * Obtiene la URL de un archivo por ID
 */
export const getMediaUrlById = async (mediaId: string): Promise<{ url: string; expires_in: number }> => {
    const query = `SELECT s3_key, s3_bucket FROM media WHERE id = ?`;
    const result = await pool.query(query, [mediaId]);
    
    if (result.rows.length === 0) {
        throw new Error('Media not found');
    }
    
    const { s3_key, s3_bucket } = result.rows[0];
    
    // Si es almacenamiento local, generar URL directa
    if (s3_bucket === 'local' || !s3_bucket.includes('s3')) {
        const url = getMediaUrl(s3_key);
        return { url, expires_in: 0 }; // URLs locales no expiran
    }
    
    // Fallback para compatibilidad con S3 (si hay archivos antiguos)
    throw new Error('Legacy S3 media not supported in local mode');
};

/**
 * Obtiene la URL de un archivo por ruta
 */
export const getMediaUrlByPath = async (rawPath: string): Promise<MediaUrlResult> => {
    const mediaPath = validateMediaPath(rawPath);
    
    const query = `SELECT id, s3_key, s3_bucket, file_type FROM media WHERE s3_key = ?`;
    const result = await pool.query(query, [mediaPath]);
    
    if (result.rows.length > 0) {
        const row = result.rows[0] as { id: string; s3_key: string; s3_bucket: string; file_type?: string | null };
        
        // Verificar que el archivo existe
        const filePath = getMediaPath(row.s3_key);
        if (fs.existsSync(filePath)) {
            const url = getMediaUrl(row.s3_key);
            return { id: row.id, url, expires_in: 0, source: 'db' };
        }
    }
    
    // Si no está en DB pero el archivo existe, generar URL directa
    const filePath = getMediaPath(mediaPath);
    if (fs.existsSync(filePath)) {
        const url = getMediaUrl(mediaPath);
        return { url, expires_in: 0, source: 'local' };
    }
    
    throw new Error('Media not found');
};

/**
 * Elimina un archivo de media
 */
export const deleteMedia = async (mediaId: string): Promise<{ message: string }> => {
    const query = `SELECT s3_key, s3_bucket FROM media WHERE id = ?`;
    const result = await pool.query(query, [mediaId]);
    
    if (result.rows.length === 0) {
        throw new Error('Media not found');
    }
    
    const { s3_key, s3_bucket } = result.rows[0];
    
    // Si es almacenamiento local, eliminar archivo
    if (s3_bucket === 'local' || !s3_bucket.includes('s3')) {
        const filePath = getMediaPath(s3_key);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
    
    // Eliminar de DB
    await pool.query('DELETE FROM media WHERE id = ?', [mediaId]);
    
    return { message: 'Media deleted successfully' };
};
