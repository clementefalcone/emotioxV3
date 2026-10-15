import { describe, it, expect } from 'vitest';
import { buildZoneSelector } from '../zoneSelector';

const page = () => {
    document.body.innerHTML = `
        <main>
            <section><a class="buy">Plan A</a><a class="buy">Plan B</a></section>
            <section><div id="hero"><button>Start</button></div></section>
            <div id="2col"><span>odd id</span></div>
        </main>`;
    return document;
};

describe('buildZoneSelector', () => {
    it('points back to the exact element among identical siblings', () => {
        const doc = page();
        const planB = doc.querySelectorAll('a.buy')[1];
        const selector = buildZoneSelector(planB);
        expect(selector).toBe('body > main > section:nth-of-type(1) > a:nth-of-type(2)');
        expect(doc.querySelector(selector)).toBe(planB);
    });

    it('anchors on the nearest id', () => {
        const doc = page();
        const button = doc.querySelector('#hero button')!;
        expect(buildZoneSelector(button)).toBe('#hero > button');
        expect(doc.querySelector(buildZoneSelector(button))).toBe(button);
    });

    it('quotes ids that are not valid CSS identifiers', () => {
        const doc = page();
        const span = doc.querySelector('[id="2col"] span')!;
        expect(buildZoneSelector(span)).toBe('[id="2col"] > span');
        expect(doc.querySelector(buildZoneSelector(span))).toBe(span);
    });
});
