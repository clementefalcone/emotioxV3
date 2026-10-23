import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ShelfGrid } from '../ShelfGrid';

describe('ShelfGrid', () => {
    const columns = [
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg',
        'https://example.com/img1.jpg',
    ];

    it('renders one cell per shelf and column', () => {
        const { container } = render(<ShelfGrid columns={columns} shelfCount={2} />);
        expect(container.querySelectorAll('img').length).toBe(6);
    });

    it('shows the same product down each column on every shelf', () => {
        const { container } = render(<ShelfGrid columns={columns} shelfCount={3} />);
        const sources = Array.from(container.querySelectorAll('img')).map(img => img.getAttribute('src'));
        expect(sources).toEqual([...columns, ...columns, ...columns]);
    });

    it('renders nothing without columns', () => {
        const { container } = render(<ShelfGrid columns={[]} shelfCount={2} />);
        expect(container.innerHTML).toBe('');
    });

    it('lays out the configured shelves and columns', () => {
        const { container } = render(<ShelfGrid columns={columns} shelfCount={2} />);
        const grid = container.firstElementChild as HTMLElement;
        expect(grid.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
        expect(grid.style.gridTemplateRows).toBe('repeat(2, 1fr)');
    });

    it('keeps the configured shelves and columns on a phone screen', () => {
        const desktopWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
        try {
            const sixColumns = [...columns, ...columns];
            const { container } = render(<ShelfGrid columns={sixColumns} shelfCount={2} />);
            const grid = container.firstElementChild as HTMLElement;
            expect(grid.style.gridTemplateColumns).toBe('repeat(6, 1fr)');
            expect(grid.style.gridTemplateRows).toBe('repeat(2, 1fr)');
            expect(container.querySelectorAll('img').length).toBe(12);
        } finally {
            Object.defineProperty(window, 'innerWidth', { value: desktopWidth, configurable: true });
        }
    });

    it('shows each product whole, in cells shaped like the first image', () => {
        const { container } = render(<ShelfGrid columns={columns} shelfCount={2} />);
        const grid = container.firstElementChild as HTMLElement;
        const images = container.querySelectorAll('img');
        images.forEach((img) => expect(img.className).toContain('object-contain'));

        Object.defineProperty(images[0], 'naturalWidth', { value: 300 });
        Object.defineProperty(images[0], 'naturalHeight', { value: 600 });
        act(() => { images[0].dispatchEvent(new Event('load')); });

        expect(grid.style.aspectRatio).toBe('0.75');
    });

    it('applies blur and opacity when specified', () => {
        const { container } = render(<ShelfGrid columns={columns} shelfCount={2} blur opacity={0.6} />);
        const grid = container.firstElementChild as HTMLElement;
        expect(grid.style.filter).toBe('blur(12px)');
        expect(grid.style.opacity).toBe('0.6');
    });

    it('forwards containerRef to the grid div', () => {
        const ref = React.createRef<HTMLDivElement>();
        render(<ShelfGrid columns={columns} shelfCount={2} containerRef={ref} />);
        expect(ref.current?.tagName).toBe('DIV');
    });

    it('sets draggable=false on all images', () => {
        const { container } = render(<ShelfGrid columns={columns} shelfCount={1} />);
        container.querySelectorAll('img').forEach((img) => {
            expect(img.getAttribute('draggable')).toBe('false');
        });
    });
});
