import { describe, it, expect } from 'vitest';
import { summarizeUserAgent } from '../user-agent';

describe('summarizeUserAgent', () => {
    it('keeps only device type, system and browser', () => {
        expect(summarizeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'))
            .toBe('desktop · macOS · Chrome');
        expect(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'))
            .toBe('mobile · iOS · Safari');
        expect(summarizeUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0 Edg/130.0.0.0'))
            .toBe('mobile · Android · Edge');
        expect(summarizeUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1'))
            .toBe('tablet · iOS · Safari');
    });

    it('marks unknown parts and returns null without a user agent', () => {
        expect(summarizeUserAgent('curl/8.7.1')).toBe('desktop · Other · Other');
        expect(summarizeUserAgent(undefined)).toBeNull();
        expect(summarizeUserAgent('')).toBeNull();
    });
});
