import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const PUBLIC_REQUESTS_PER_MINUTE = 1000;

export const readClientAddress = (req: Request): string => {
    const forwarded = req.headers['x-forwarded-for'];
    const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '')
        .split(',')
        .map(address => address.trim())
        .filter(Boolean);
    return chain[chain.length - 1] ?? req.socket.remoteAddress ?? 'unknown';
};

export const publicRateLimit = rateLimit({
    windowMs: 60_000,
    limit: PUBLIC_REQUESTS_PER_MINUTE,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: readClientAddress,
    validate: { xForwardedForHeader: false },
    handler: (req, res) => {
        console.warn(JSON.stringify({ event: 'public_rate_limited', path: req.path }));
        res.status(429).json({ message: `Too many requests to ${req.path}: the limit is ${PUBLIC_REQUESTS_PER_MINUTE} per minute per address, retry in a minute` });
    },
});
