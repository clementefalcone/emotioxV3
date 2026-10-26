import { describe, it, expect } from 'vitest';
import { rewriteStylesheet, renderInertPage } from '../proxy-rewrite';

const PROXY = 'https://api.example.com/proxy?url=';
const proxied = (url: string) => `${PROXY}${encodeURIComponent(url)}`;

describe('rewriteStylesheet', () => {
    it('routes relative, root and protocol-relative references through the proxy', () => {
        const css = `@import "theme.css";.a{background:url(../img/p.png)}.b{src:url('/f/a.woff2')}.c{x:url(//cdn.example.com/c.png)}`;

        const result = rewriteStylesheet(css, 'https://site.example.com/css/main.css', PROXY);

        expect(result).toContain(`@import url('${proxied('https://site.example.com/css/theme.css')}')`);
        expect(result).toContain(`url('${proxied('https://site.example.com/css/../img/p.png')}')`);
        expect(result).toContain(`url('${proxied('https://site.example.com/f/a.woff2')}')`);
        expect(result).toContain(`url('${proxied('https://cdn.example.com/c.png')}')`);
    });

    it('leaves data URIs, fragments and absolute urls untouched', () => {
        const css = '.a{background:url(data:image/png;base64,AAA)}.b{x:url(#id)}.c{y:url(https://abs.example.com/z.png)}';

        expect(rewriteStylesheet(css, 'https://site.example.com/main.css', PROXY)).toBe(css);
    });
});

describe('renderInertPage', () => {
    it('removes scripts and inline handlers and pins relative urls to the page origin', () => {
        const html = '<html><head><script>alert(1)</script><script src="/x.js"/></head><body onclick="x()"><img src="a.png"></body></html>';

        const result = renderInertPage(html, 'https://site.example.com/deep/page', PROXY);

        expect(result).not.toContain('script');
        expect(result).not.toContain('onclick');
        expect(result).toContain('<head><base href="https://site.example.com/"><style>* { pointer-events: none !important;');
    });

    it('disables interaction in pages written with an uppercase HEAD', () => {
        const result = renderInertPage('<HTML><HEAD><title>x</title></HEAD></HTML>', 'https://site.example.com/', PROXY);

        expect(result).toContain('<HEAD><base href="https://site.example.com/"><style>* { pointer-events: none');
    });

    it('proxies stylesheets and fonts and turns lazily loaded stylesheets on', () => {
        const html = `<head><link rel="stylesheet" href="/a.css" media="none"><link rel="icon" href="/fav.ico"><style>@font-face{src:url(fonts/b.woff2)}</style></head>`;

        const result = renderInertPage(html, 'https://site.example.com/', PROXY);

        expect(result).toContain(`href="${proxied('https://site.example.com/a.css')}"`);
        expect(result).toContain('media="all"');
        expect(result).toContain('href="/fav.ico"');
        expect(result).toContain(`url('${proxied('https://site.example.com/fonts/b.woff2')}')`);
    });
});
