/**
 * Controller de media para almacenamiento local (cPanel)
 * Maneja uploads directos y URLs locales
 */

import * as mediaService from './media.service.local';
import { getMediaPath, ensureDirectoryExists } from '../../config/local-storage';
import fs from 'fs';
import path from 'path';

/**
 * Maneja upload directo de archivos (multipart/form-data)
 * Nota: En Express, esto se manejaría con multer middleware
 * Aquí adaptamos para el formato Lambda/Express híbrido
 * @param researchId - ID de la investigación
 * @param questionId - ID de la pregunta (opcional)
 * @param file - Archivo subido
 * @param mediaPath - Ruta de media pre-generada (opcional, si no se proporciona se genera una nueva)
 * @returns Objeto con el media creado
 */
export const handleDirectUpload = async (
    researchId: string,
    questionId: string | null,
    file: { name: string; data: Buffer; mimetype: string },
    mediaPath?: string
): Promise<{ media: unknown }> => {
    // Usar media_path proporcionado o generar uno nuevo
    let relativePath: string;
    if (mediaPath) {
        relativePath = mediaPath;
    } else {
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
        relativePath = `research/${researchId}/${timestamp}-${safeFileName}`;
    }
    
    const filePath = getMediaPath(relativePath);
    
    // Asegurar que el directorio existe
    ensureDirectoryExists(filePath);
    
    // Guardar archivo
    fs.writeFileSync(filePath, file.data);
    
    // Guardar metadata en DB
    const metadata = {
        fileName: file.name,
        fileType: file.mimetype,
        fileSize: file.data.length,
    };
    
    const media = await mediaService.saveMetadata(researchId, questionId, relativePath, metadata);
    
    return { media };
};
