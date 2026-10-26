import { fetchPublicUrl } from './public-fetch';

const DISABLE_INTERACTION_STYLE = '<style>* { pointer-events: none !important; user-select: none !important; } body { overflow: visible !important; }</style>';

const resolveFromPage = (ref: string, pageOrigin: string): string => {
    if (ref.startsWith('http')) return ref;
    if (ref.startsWith('//')) return 'https:' + ref;
    return pageOrigin + (ref.startsWith('/') ? '' : '/') + ref;
};

const resolveFromStylesheet = (ref: string, cssUrl: string): string => {
    if (ref.startsWith('data:') || ref.startsWith('#')) return ref;
    if (ref.startsWith('http')) return ref;
    if (ref.startsWith('//')) return 'https:' + ref;
    if (ref.startsWith('/')) return new URL(cssUrl).origin + ref;
    return cssUrl.substring(0, cssUrl.lastIndexOf('/') + 1) + ref;
};

export const rewriteStylesheet = (css: string, cssUrl: string, proxyBase: string): string => css
    .replace(/url\(\s*['"]?(?!['"]?data:)([^'")]+)\s*['"]?\)/gi, (match: string, ref: string) => {
        const resolved = resolveFromStylesheet(ref.trim(), cssUrl);
        if (resolved === ref.trim()) return match;
        return `url('${proxyBase}${encodeURIComponent(resolved)}')`;
    })
    .replace(/@import\s+['"](?!data:)([^'"]+)['"]/gi, (_match: string, ref: string) =>
        `@import url('${proxyBase}${encodeURIComponent(resolveFromStylesheet(ref.trim(), cssUrl))}')`);

export const renderInertPage = (html: string, pageUrl: string, proxyBase: string): string => {
    const pageOrigin = new URL(pageUrl).origin;
    const rewritten = html
        .replace(/<link\s([^>]*?)href\s*=\s*['"]([^'"]+)['"]([^>]*?)>/gi, (match: string, before: string, href: string, after: string) => {
            const combined = before + after;
            if (!combined.includes('stylesheet') && !combined.includes('text/css')) return match;
            return `<link ${before}href="${proxyBase}${encodeURIComponent(resolveFromPage(href, pageOrigin))}"${after}>`;
        })
        .replace(/url\(\s*['"]?([^'")]+\.(?:woff2?|ttf|eot|otf)(?:\?[^'")]*)?)\s*['"]?\)/gi, (_match: string, fontUrl: string) =>
            `url('${proxyBase}${encodeURIComponent(resolveFromPage(fontUrl, pageOrigin))}')`)
        .replace(/media\s*=\s*["']none["']/gi, 'media="all"')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<script\b[^>]*\/>/gi, '')
        .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');
    const headStart = `<base href="${pageOrigin}/">${DISABLE_INTERACTION_STYLE}`;
    if (rewritten.includes('<head>')) return rewritten.replace('<head>', `<head>${headStart}`);
    if (rewritten.includes('<HEAD>')) return rewritten.replace('<HEAD>', `<HEAD>${headStart}`);
    return headStart + rewritten;
};

export interface ProxiedAsset {
    contentType: string;
    body: string;
    isBinary: boolean;
}

export const fetchProxiedAsset = async (assetUrl: string, proxyBase: string): Promise<ProxiedAsset> => {
    const response = await fetchPublicUrl(assetUrl);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isText = contentType.includes('text/') || contentType.includes('css') || contentType.includes('javascript') || contentType.includes('json');
    if (!isText) {
        return { contentType, body: Buffer.from(await response.arrayBuffer()).toString('base64'), isBinary: true };
    }
    const text = await response.text();
    return { contentType, body: contentType.includes('css') ? rewriteStylesheet(text, assetUrl, proxyBase) : text, isBinary: false };
};
