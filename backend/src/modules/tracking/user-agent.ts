const DEVICE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/iPad|Tablet/i, 'tablet'],
    [/Mobi|iPhone|iPod|Android/i, 'mobile'],
];

const SYSTEM_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
];

const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/Edg\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser\//, 'Samsung Internet'],
    [/Firefox\/|FxiOS\//, 'Firefox'],
    [/Chrome\/|CriOS\//, 'Chrome'],
    [/Safari\//, 'Safari'],
];

const matchLabel = (userAgent: string, patterns: ReadonlyArray<readonly [RegExp, string]>, fallback: string): string =>
    patterns.find(([pattern]) => pattern.test(userAgent))?.[1] ?? fallback;

export const summarizeUserAgent = (userAgent: string | undefined): string | null => {
    if (!userAgent) return null;
    return [
        matchLabel(userAgent, DEVICE_PATTERNS, 'desktop'),
        matchLabel(userAgent, SYSTEM_PATTERNS, 'Other'),
        matchLabel(userAgent, BROWSER_PATTERNS, 'Other'),
    ].join(' · ');
};
