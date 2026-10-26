/**
 * Website Tracking AI Report Service
 * Gathers tracking metrics based on selected sections and generates
 * a contextual professional analysis via GPT-4o.
 * Cached in researches.config.trackingReport.
 */

import OpenAI from 'openai';
import pool from '../../config/database';
import {
    getOverviewMetrics,
    getTrackedPages,
    getScrollDepthData,
    getFrictionSummary,
    getVisitorJourneys,
    getTrackingConfig,
} from './tracking.service';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const LLM_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

interface ReportSections {
    funnels_custom?: boolean;
    funnels_pageVisits?: boolean;
    funnels_transitions?: boolean;
    heatmaps_click?: boolean;
    heatmaps_scroll?: boolean;
    heatmaps_attention?: boolean;
    heatmaps_density?: boolean;
    sessions?: boolean;
    live?: boolean;
    [key: string]: boolean | undefined;
}

export interface TrackingReport {
    generatedAt: string;
    overview: string;
    keyFindings: string[];
    recommendations: string[];
    usabilityScore: number;
    engagementAnalysis: string;
    frictionAnalysis: string;
    scrollBehavior: string;
    funnelAnalysis: string;
    topIssues: Array<{ issue: string; severity: 'high' | 'medium' | 'low'; suggestion: string }>;
    analyzedSections: string[];
}

export const generateTrackingReport = async (
    researchId: string,
    sections?: ReportSections
): Promise<TrackingReport> => {
    // Determine what data to gather based on sections
    const sec = sections || {};
    const needsFunnels = sec.funnels_custom || sec.funnels_pageVisits || sec.funnels_transitions;
    const needsHeatmaps = sec.heatmaps_click || sec.heatmaps_scroll || sec.heatmaps_attention || sec.heatmaps_density;
    const needsSessions = sec.sessions;

    // Always fetch overview and pages (lightweight)
    const [overview, pages] = await Promise.all([
        getOverviewMetrics(researchId),
        getTrackedPages(researchId),
    ]);

    // Conditionally fetch heavier data
    const [scrollData, frictionData, visitorsData, trackingConfig] = await Promise.all([
        needsHeatmaps ? getScrollDepthData(researchId) : Promise.resolve({ depths: [] as Array<{ depthPct: number; sessions: number; percentage: number }>, totalSessions: 0 }),
        needsHeatmaps ? getFrictionSummary(researchId) : Promise.resolve({ tags: {} as Record<string, number> }),
        needsSessions ? getVisitorJourneys(researchId, 50, 0) : Promise.resolve({ visitors: [] as Array<{ visitorId: string; sessionCount: number; entryPage: string; firstSeen: unknown; lastSeen: unknown; viewportWidth: number; userAgent: string | null; totalDurationMs: number; pages: Array<{ index: number; sessionId: string; pageUrl: string; pageTitle: string | null; startedAt: unknown; durationMs: number; eventCount: number; clickCount: number }> }>, totalVisitors: 0 }),
        needsFunnels ? getTrackingConfig(researchId) : Promise.resolve(null),
    ]);

    const topPages = [...pages]
        .sort((a, b) => b.sessionCount - a.sessionCount)
        .slice(0, 10)
        .map((p) => ({
            url: String(p.pageUrl || ''),
            title: String(p.pageTitle || ''),
            views: p.sessionCount,
            events: p.eventCount,
        }));

    // Build contextual prompt
    const dataBlocks: string[] = [];
    const analyzedSections: string[] = [];

    // Always include overview
    dataBlocks.push(`**Overview:**
- Unique visitors: ${overview.uniqueVisitors}
- Total sessions: ${overview.totalSessions}
- Pages tracked: ${overview.pagesTracked}
- Total events: ${overview.totalEvents}
- Avg session duration: ${overview.avgSessionDuration}s`);
    analyzedSections.push('Overview');

    // Funnels
    if (needsFunnels) {
        analyzedSections.push('Funnels');
        const funnels = trackingConfig?.funnels || [];

        if (sec.funnels_pageVisits && topPages.length > 0) {
            dataBlocks.push(`**Page Visits (top ${topPages.length}):**
${topPages.map(p => `- ${p.title || p.url}: ${p.views} views, ${p.events} events`).join('\n')}`);
        }

        if (sec.funnels_custom && funnels.length > 0) {
            dataBlocks.push(`**Custom Funnels (${funnels.length} defined):**
${funnels.map(f => `- "${f.name}": ${f.steps.length} steps (${f.steps.map(s => s.label || s.url).join(' → ')})`).join('\n')}`);
        }

        if (sec.funnels_transitions && topPages.length > 1) {
            dataBlocks.push(`**Page Traffic Order (most to least visited):**
${topPages.map((p, i) => `${i + 1}. ${p.title || p.url} (${p.views} views)`).join('\n')}`);
        }
    }

    // Heatmaps
    if (needsHeatmaps) {
        analyzedSections.push('Heatmaps');

        if (sec.heatmaps_click) {
            const totalClicks = topPages.reduce((sum, p) => sum + p.events, 0);
            dataBlocks.push(`**Click Data:**
- Total click events: ${totalClicks}
- Top clicked pages: ${topPages.slice(0, 5).map(p => `${p.title || p.url} (${p.events})`).join(', ')}`);
        }

        if (sec.heatmaps_scroll && scrollData.depths.length > 0) {
            dataBlocks.push(`**Scroll Depth:**
${scrollData.depths.map(d => `- ${d.depthPct}% depth: ${d.percentage}% of users reached`).join('\n')}`);
        }

        if (sec.heatmaps_attention) {
            dataBlocks.push(`**Attention (viewport time):**
- Data based on time users spent with each page zone visible in viewport.
- Avg session duration: ${overview.avgSessionDuration}s`);
        }

        const frictionTags = frictionData.tags;
        const totalFriction = Object.values(frictionTags).reduce((sum, v) => sum + v, 0);
        if (totalFriction > 0) {
            dataBlocks.push(`**Friction Events (${totalFriction} total):**
${Object.entries(frictionTags).map(([tag, count]) => `- ${tag}: ${count}`).join('\n')}`);
        }
    }

    // Sessions
    if (needsSessions) {
        analyzedSections.push('Sessions');
        const visitors = visitorsData.visitors || [];
        const avgSessionsPerVisitor = visitors.length > 0
            ? (visitors.reduce((sum, v) => sum + v.sessionCount, 0) / visitors.length).toFixed(1)
            : '0';
        const returnRate = overview.uniqueVisitors > 0
            ? Math.round((overview.totalSessions / overview.uniqueVisitors - 1) * 100)
            : 0;

        dataBlocks.push(`**Session & Visitor Behavior:**
- ${visitors.length} visitors tracked
- Avg sessions per visitor: ${avgSessionsPerVisitor}
- Return rate: ${returnRate}% returning sessions
- Top entry pages: ${visitors.slice(0, 5).map(v => v.entryPage).join(', ')}`);
    }

    // Live
    if (sec.live) {
        analyzedSections.push('Live');
        dataBlocks.push(`**Live Status:** Report generated at ${new Date().toISOString()}. Live data is a point-in-time snapshot.`);
    }

    // Build focus instructions based on what's selected
    const focusAreas: string[] = [];
    if (needsFunnels) focusAreas.push('conversion funnel efficiency and page flow optimization');
    if (sec.heatmaps_click) focusAreas.push('click distribution patterns and interaction quality');
    if (sec.heatmaps_scroll) focusAreas.push('scroll behavior and content engagement depth');
    if (sec.heatmaps_attention) focusAreas.push('attention distribution and viewport time allocation');
    if (needsHeatmaps) focusAreas.push('friction points (rage-clicks, dead-clicks) and their UX implications');
    if (needsSessions) focusAreas.push('visitor journey quality, return rate, and session depth');

    const prompt = `You are an expert UX analyst specializing in website behavior analytics. Generate a professional tracking analysis report based ONLY on the data provided below. Do not invent or assume data not present.

## Selected Analysis Scope
The user selected these sections for analysis: ${analyzedSections.join(', ')}.
Focus your analysis on: ${focusAreas.join('; ')}.

## Data

${dataBlocks.join('\n\n')}

## Instructions

Provide analysis ONLY for the data categories present above. If scroll data is not included, do not analyze scroll behavior. If funnel data is not included, skip funnel analysis. Be specific with numbers from the data.

Respond in JSON:
{
  "overview": "3-4 sentence professional summary focused on the selected sections",
  "keyFindings": ["finding based on provided data only", ...up to 5],
  "recommendations": ["actionable recommendation based on findings", ...up to 4],
  "usabilityScore": <1-100 integer based only on available metrics>,
  "engagementAnalysis": "2-3 sentences about engagement (or empty string if sessions not selected)",
  "frictionAnalysis": "2-3 sentences about friction (or empty string if heatmaps not selected)",
  "scrollBehavior": "2-3 sentences about scroll patterns (or empty string if scroll not selected)",
  "funnelAnalysis": "2-3 sentences about funnel/page flow (or empty string if funnels not selected)",
  "topIssues": [
    {"issue": "specific problem from data", "severity": "high|medium|low", "suggestion": "actionable fix"},
    ...up to 4 issues
  ]
}`;

    const response = await client.chat.completions.create({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    const report: TrackingReport = {
        generatedAt: new Date().toISOString(),
        overview: parsed.overview || 'No analysis available.',
        keyFindings: parsed.keyFindings || [],
        recommendations: parsed.recommendations || [],
        usabilityScore: parsed.usabilityScore || 50,
        engagementAnalysis: parsed.engagementAnalysis || '',
        frictionAnalysis: parsed.frictionAnalysis || '',
        scrollBehavior: parsed.scrollBehavior || '',
        funnelAnalysis: parsed.funnelAnalysis || '',
        topIssues: parsed.topIssues || [],
        analyzedSections,
    };

    // Cache in config
    const configResult = await pool.query('SELECT config FROM researches WHERE id = ?', [researchId]);
    const config = typeof configResult.rows[0]?.config === 'string'
        ? JSON.parse(configResult.rows[0].config)
        : configResult.rows[0]?.config || {};
    config.trackingReport = report;
    await pool.query('UPDATE researches SET config = ? WHERE id = ?', [JSON.stringify(config), researchId]);

    return report;
};
