import { lookup } from 'dns/promises';
import { isIP } from 'net';

const MAX_REDIRECTS = 5;
const PROXY_USER_AGENT = 'Mozilla/5.0 (compatible; EmotioCX/1.0)';

export class BlockedUrlError extends Error {}

const isPrivateIPv4 = (ip: string): boolean => {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
};

const isPrivateIp = (ip: string): boolean => {
    if (isIP(ip) === 4) return isPrivateIPv4(ip);
    const lower = ip.toLowerCase();
    const mappedIPv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIPv4) return isPrivateIPv4(mappedIPv4[1]);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const high = parseInt(mappedHex[1], 16);
        const low = parseInt(mappedHex[2], 16);
        return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
};

export const assertPublicUrl = async (rawUrl: string): Promise<URL> => {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new BlockedUrlError(`Invalid url: ${rawUrl}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BlockedUrlError(`Blocked protocol ${url.protocol} for ${rawUrl}`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
    if (addresses.some(isPrivateIp)) {
        throw new BlockedUrlError(`Blocked private address for ${url.hostname}`);
    }
    return url;
};

export const fetchPublicUrl = async (rawUrl: string): Promise<Response> => {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const url = await assertPublicUrl(current);
        const response = await fetch(url, { headers: { 'User-Agent': PROXY_USER_AGENT }, redirect: 'manual' });
        const location = response.headers.get('location');
        if (response.status < 300 || response.status >= 400 || !location) return response;
        current = new URL(location, url).toString();
    }
    throw new BlockedUrlError(`Too many redirects for ${rawUrl}`);
};
