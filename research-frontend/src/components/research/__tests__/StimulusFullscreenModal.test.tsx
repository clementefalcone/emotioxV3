import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StimulusFullscreenModal } from '../StimulusFullscreenModal';
import {
    DEFAULT_SPOTLIGHT_SETTINGS,
    DEFAULT_COLD_MAP_SETTINGS,
    type HeatmapMapMode,
} from '../../../utils/attentionPrediction.utils';

afterEach(cleanup);

const baseProps = {
    imageUrl: 'https://example.com/test.jpg',
    title: 'test-stimulus.jpg',
    heatmapData: [
        { x: 50, y: 50, value: 0.8 },
        { x: 30, y: 70, value: 0.6 },
    ],
    settings: { blur: 5, opacity: 45, threshold: 68, preset: 'Lab' },
    mapMode: 'classic' as HeatmapMapMode,
    spotlightSettings: { ...DEFAULT_SPOTLIGHT_SETTINGS },
    coldSettings: { ...DEFAULT_COLD_MAP_SETTINGS },
    showHeatmap: true,
    onClose: vi.fn(),
};

/* ═══════════════════════════════════════════════════════════════
   1. STRUCTURE & ACCESSIBILITY
   ═══════════════════════════════════════════════════════════════ */

describe('StimulusFullscreenModal — structure & a11y', () => {
    it('renders as a dialog with aria-modal="true"', () => {
        render(<StimulusFullscreenModal {...baseProps} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('includes title in aria-label', () => {
        render(<StimulusFullscreenModal {...baseProps} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-label')).toContain(baseProps.title);
    });

    it('close button has descriptive aria-label', () => {
        render(<StimulusFullscreenModal {...baseProps} />);
        expect(screen.getByLabelText('Close fullscreen view')).toBeInTheDocument();
    });

    it('uses fixed positioning with z-50 (covers entire viewport)', () => {
        render(<StimulusFullscreenModal {...baseProps} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('fixed');
        expect(dialog.className).toContain('inset-0');
        expect(dialog.className).toContain('z-50');
    });

    it('has dark background (bg-black/95)', () => {
        render(<StimulusFullscreenModal {...baseProps} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('bg-black');
    });
});

/* ═══════════════════════════════════════════════════════════════
   2. TOOLBAR
   ═══════════════════════════════════════════════════════════════ */

describe('StimulusFullscreenModal — toolbar', () => {
    it('displays the stimulus title', () => {
        render(<StimulusFullscreenModal {...baseProps} />);
        expect(screen.getByText(baseProps.title)).toBeInTheDocument();
    });

    it('displays "Download image" button', () => {
        render(<StimulusFullscreenModal {...baseProps} />);
        expect(screen.getByText('Download image')).toBeInTheDocument();
    });

    it('title truncates with max-w-md', () => {
        const longTitle = 'A'.repeat(200) + '.jpg';
        render(<StimulusFullscreenModal {...baseProps} title={longTitle} />);
        const titleEl = screen.getByText(longTitle);
        expect(titleEl.className).toContain('truncate');
        expect(titleEl.className).toContain('max-w-md');
    });
});

/* ═══════════════════════════════════════════════════════════════
   3. CLOSE BEHAVIOR
   ═══════════════════════════════════════════════════════════════ */

describe('StimulusFullscreenModal — close behavior', () => {
    it('calls onClose when close button clicked', () => {
        const onClose = vi.fn();
        render(<StimulusFullscreenModal {...baseProps} onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Close fullscreen view'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose on Escape key', () => {
        const onClose = vi.fn();
        render(<StimulusFullscreenModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does NOT call onClose on Enter', () => {
        const onClose = vi.fn();
        render(<StimulusFullscreenModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does NOT call onClose on ArrowDown', () => {
        const onClose = vi.fn();
        render(<StimulusFullscreenModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does NOT call onClose on Space', () => {
        const onClose = vi.fn();
        render(<StimulusFullscreenModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: ' ' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does NOT call onClose on Backspace', () => {
        const onClose = vi.fn();
        render(<StimulusFullscreenModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Backspace' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('cleans up keydown listener on unmount', () => {
        const onClose = vi.fn();
        const { unmount } = render(<StimulusFullscreenModal {...baseProps} onClose={onClose} />);
        unmount();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });
});

/* ═══════════════════════════════════════════════════════════════
   4. PREVIEW CONTENT — original vs heatmap
   ═══════════════════════════════════════════════════════════════ */

describe('StimulusFullscreenModal — preview content', () => {
    it('shows original <img> when showHeatmap=false', () => {
        render(<StimulusFullscreenModal {...baseProps} showHeatmap={false} />);
        const img = screen.getByAltText('Stimulus original');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', baseProps.imageUrl);
    });

    it('shows original <img> when heatmapData is empty', () => {
        render(<StimulusFullscreenModal {...baseProps} heatmapData={[]} />);
        expect(screen.getByAltText('Stimulus original')).toBeInTheDocument();
    });

    it('shows original <img> when both showHeatmap=false AND heatmapData=[]', () => {
        render(<StimulusFullscreenModal {...baseProps} showHeatmap={false} heatmapData={[]} />);
        expect(screen.getByAltText('Stimulus original')).toBeInTheDocument();
    });

    it('does NOT show original <img> when showHeatmap=true and data present (renderer takes over)', () => {
        render(<StimulusFullscreenModal {...baseProps} showHeatmap={true} />);
        expect(screen.queryByAltText('Stimulus original')).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════
   5. MAP MODE RENDERING — each mode renders without crashing
   ═══════════════════════════════════════════════════════════════ */

describe('StimulusFullscreenModal — map mode rendering', () => {
    const modes: HeatmapMapMode[] = ['classic', 'spotlight', 'cold'];

    it.each(modes)('%s — renders without throwing', (mode) => {
        expect(() => {
            render(<StimulusFullscreenModal {...baseProps} mapMode={mode} />);
        }).not.toThrow();
    });

    it.each(modes)('%s — does not show <img> fallback when heatmap active', (mode) => {
        render(<StimulusFullscreenModal {...baseProps} mapMode={mode} showHeatmap={true} />);
        expect(screen.queryByAltText('Stimulus original')).toBeNull();
    });

    it.each(modes)('%s — shows <img> fallback when showHeatmap=false regardless of mode', (mode) => {
        render(<StimulusFullscreenModal {...baseProps} mapMode={mode} showHeatmap={false} />);
        expect(screen.getByAltText('Stimulus original')).toBeInTheDocument();
    });
});

/* ═══════════════════════════════════════════════════════════════
   6. SCROLLABLE CONTENT AREA
   ═══════════════════════════════════════════════════════════════ */

describe('StimulusFullscreenModal — scrollable viewport', () => {
    it('content area has overflow-auto for scrolling large images', () => {
        const { container } = render(<StimulusFullscreenModal {...baseProps} showHeatmap={false} />);
        const scrollArea = container.querySelector('.overflow-auto');
        expect(scrollArea).toBeInTheDocument();
    });

    it('content wrapper uses flex-1 to fill available vertical space', () => {
        const { container } = render(<StimulusFullscreenModal {...baseProps} showHeatmap={false} />);
        const scrollArea = container.querySelector('.flex-1.overflow-auto');
        expect(scrollArea).toBeInTheDocument();
    });

    it('inner content is inline-block (natural size, not stretched)', () => {
        const { container } = render(<StimulusFullscreenModal {...baseProps} showHeatmap={false} />);
        const inner = container.querySelector('.inline-block');
        expect(inner).toBeInTheDocument();
    });
});
