// Privacy-respecting pageview beacon. Fires once per page load.
// Skips the analytics dashboard itself so it does not inflate its own counts.
(function () {
    try {
        const path = location.pathname || '/';
        if (path.indexOf('/analytics') === 0) return;
        if (!navigator.sendBeacon && !window.fetch) return;
        const payload = JSON.stringify({
            path: path,
            referrer: document.referrer || '',
            screen: (screen && screen.width && screen.height) ? screen.width + 'x' + screen.height : ''
        });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
        } else {
            fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
        }
    } catch (e) { /* ignore */ }
})();

// Interaction and motion layer. Progressive enhancement only: with JS off or
// reduced motion requested, every section still renders fully and statically.
(function () {
    'use strict';

    const doc = document;
    const root = doc.documentElement;
    const media = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false });
    const reduceMotion = media('(prefers-reduced-motion: reduce)').matches;
    const finePointer = media('(hover: hover) and (pointer: fine)').matches;
    const $ = (s, c) => (c || doc).querySelector(s);
    const $$ = (s, c) => Array.prototype.slice.call((c || doc).querySelectorAll(s));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const onChange = (mql, fn) => {
        if (mql.addEventListener) mql.addEventListener('change', fn);
        else if (mql.addListener) mql.addListener(fn);
    };
    let vw = window.innerWidth;
    let vh = window.innerHeight;

    /* ---------- Frame scheduler: all reads first, then all writes ---------- */
    const readers = [];
    const resizers = [];
    let queued = false;

    const runFrame = () => {
        queued = false;
        const y = window.scrollY || window.pageYOffset || 0;
        const writes = [];
        for (let i = 0; i < readers.length; i++) {
            const write = readers[i](y);
            if (write) writes.push(write);
        }
        for (let i = 0; i < writes.length; i++) writes[i]();
    };
    const requestFrame = () => {
        if (!queued) {
            queued = true;
            requestAnimationFrame(runFrame);
        }
    };
    const remeasure = () => {
        vw = window.innerWidth;
        vh = window.innerHeight;
        resizers.forEach((fn) => fn());
        requestFrame();
    };

    window.addEventListener('scroll', requestFrame, { passive: true });
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(remeasure, 140);
    });

    /* ---------- Theme (persisted, circular reveal where supported) ---------- */
    function initTheme() {
        const buttons = $$('[data-theme-toggle]');
        const meta = $('meta[name="theme-color"]');
        const sync = () => {
            const light = root.getAttribute('data-theme') === 'light';
            if (meta) meta.setAttribute('content', light ? '#f5f7fc' : '#05060b');
            buttons.forEach((b) => {
                b.setAttribute('aria-pressed', String(light));
                b.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
            });
        };
        const apply = (theme) => {
            root.setAttribute('data-theme', theme);
            try { localStorage.setItem('sg-theme', theme); } catch (e) { /* storage blocked */ }
            sync();
        };
        sync();
        buttons.forEach((btn) => btn.addEventListener('click', () => {
            const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            if (!doc.startViewTransition || reduceMotion) {
                apply(next);
                return;
            }
            const r = btn.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            const radius = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y));
            // Scope the "no crossfade" rule to theme switches; page navigations keep a normal fade.
            root.classList.add('vt-theme');
            const transition = doc.startViewTransition(() => apply(next));
            const done = () => root.classList.remove('vt-theme');
            transition.finished.then(done, done);
            transition.ready.then(() => {
                root.animate(
                    { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
                    { duration: 720, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' }
                );
            }).catch(() => {});
        }));
    }

    /* ---------- Navigation ---------- */
    function initNav() {
        const nav = $('#navbar');
        if (!nav) return;
        const burger = $('#hamburger');
        const menu = $('#mobile-menu');
        let lastY = window.scrollY || 0;
        let hidden = false;
        let scrolled = null;

        readers.push((y) => {
            const isScrolled = y > 24;
            const delta = y - lastY;
            lastY = y;
            let hide = hidden;
            if (root.classList.contains('nav-open') || y < 160) hide = false;
            else if (delta > 8) hide = true;
            else if (delta < -6) hide = false;
            if (isScrolled === scrolled && hide === hidden) return null;
            return () => {
                if (isScrolled !== scrolled) {
                    scrolled = isScrolled;
                    nav.classList.toggle('is-scrolled', isScrolled);
                }
                if (hide !== hidden) {
                    hidden = hide;
                    nav.classList.toggle('is-hidden', hide);
                }
            };
        });
        nav.addEventListener('focusin', () => {
            hidden = false;
            nav.classList.remove('is-hidden');
        });

        if (burger && menu) {
            const setOpen = (open) => {
                root.classList.toggle('nav-open', open);
                burger.setAttribute('aria-expanded', String(open));
                burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
                menu.setAttribute('aria-hidden', String(!open));
                doc.body.style.overflow = open ? 'hidden' : '';
                if (open) {
                    hidden = false;
                    nav.classList.remove('is-hidden');
                }
            };
            burger.addEventListener('click', () => setOpen(!root.classList.contains('nav-open')));
            $$('a', menu).forEach((a) => a.addEventListener('click', () => setOpen(false)));
            doc.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && root.classList.contains('nav-open')) {
                    setOpen(false);
                    burger.focus();
                }
            });
            onChange(media('(min-width: 1001px)'), (e) => { if (e.matches) setOpen(false); });
        }

        // Active section: sliding pill on desktop, accent colour in the mobile menu.
        const list = $('#nav-menu');
        const pairs = (list ? $$('a[href^="#"]', list) : [])
            .map((a) => ({ a: a, sec: $(a.getAttribute('href')) }))
            .filter((p) => p.sec);
        if (!pairs.length) return;
        const mobileLinks = menu ? $$('a[href^="#"]', menu) : [];
        const indicator = doc.createElement('li');
        indicator.className = 'nav-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        list.appendChild(indicator);
        let active;
        resizers.push(() => { active = undefined; });

        readers.push(() => {
            const line = vh * 0.38;
            let current = null;
            for (let i = 0; i < pairs.length; i++) {
                if (pairs[i].sec.getBoundingClientRect().top <= line) current = pairs[i].a;
            }
            if (current === active) return null;
            return () => {
                active = current;
                pairs.forEach((p) => p.a.classList.toggle('is-active', p.a === current));
                const href = current ? current.getAttribute('href') : '';
                mobileLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === href));
                if (current && !current.classList.contains('nav-cta')) {
                    indicator.style.setProperty('--ix', current.offsetLeft + 'px');
                    indicator.style.setProperty('--iw', current.offsetWidth + 'px');
                    indicator.classList.add('is-on');
                } else {
                    indicator.classList.remove('is-on');
                }
            };
        });
    }

    /* ---------- Scroll progress and back-to-top ---------- */
    function initProgress() {
        let bar = $('.scroll-progress span');
        if (!bar) {
            const wrap = doc.createElement('div');
            wrap.className = 'scroll-progress';
            wrap.setAttribute('aria-hidden', 'true');
            wrap.appendChild(doc.createElement('span'));
            doc.body.appendChild(wrap);
            bar = wrap.firstChild;
        }
        const toTop = $('.to-top');
        let max = 1;
        const measure = () => { max = Math.max(1, root.scrollHeight - vh); };
        measure();
        resizers.push(measure);
        if ('ResizeObserver' in window) {
            new ResizeObserver(() => { measure(); requestFrame(); }).observe(doc.body);
        }
        let lastP = -1;
        let shown = null;
        readers.push((y) => {
            const p = clamp(y / max, 0, 1);
            const show = y > vh * 0.9;
            if (Math.abs(p - lastP) < 0.0004 && show === shown) return null;
            return () => {
                lastP = p;
                bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
                if (toTop) {
                    toTop.style.setProperty('--p', p.toFixed(4));
                    if (show !== shown) {
                        shown = show;
                        toTop.classList.toggle('is-on', show);
                    }
                }
            };
        });
        if (toTop) {
            toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
        }
    }

    /* ---------- Word splitting for section title reveals ---------- */
    function splitWords(el) {
        let index = 0;
        const walk = (node) => {
            Array.prototype.slice.call(node.childNodes).forEach((child) => {
                if (child.nodeType === 3) {
                    const parts = child.textContent.split(/(\s+)/);
                    const frag = doc.createDocumentFragment();
                    parts.forEach((part) => {
                        if (!part) return;
                        if (/^\s+$/.test(part)) {
                            frag.appendChild(doc.createTextNode(' '));
                            return;
                        }
                        const outer = doc.createElement('span');
                        outer.className = 'word';
                        const inner = doc.createElement('span');
                        inner.className = 'word-in';
                        inner.style.setProperty('--wi', String(index++));
                        inner.textContent = part;
                        outer.appendChild(inner);
                        frag.appendChild(outer);
                    });
                    node.replaceChild(frag, child);
                } else if (child.nodeType === 1 && !child.classList.contains('sr-only')) {
                    walk(child);
                }
            });
        };
        walk(el);
        el.classList.add('is-split');
    }

    /* ---------- Reveal on scroll ---------- */
    function initReveal() {
        $$('[data-split]').forEach(splitWords);
        $$('[data-stagger]').forEach((group) => {
            const step = parseInt(group.getAttribute('data-stagger'), 10) || 80;
            $$('[data-reveal]', group).forEach((el, i) => el.style.setProperty('--rd', (i * step) + 'ms'));
        });
        const els = $$('[data-reveal], [data-split]');
        if (reduceMotion || !('IntersectionObserver' in window)) {
            els.forEach((el) => el.classList.add('is-in'));
            return;
        }
        // Reveal once an element's top passes 90% of the viewport (tall cards never leave blank bands).
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            });
        }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
        els.forEach((el) => io.observe(el));
    }

    /* ---------- Experience timeline: the spine draws itself ---------- */
    function initTimeline() {
        const tl = $('#timeline');
        if (!tl) return;
        const line = $('.tl-line', tl);
        const items = $$('.tl-item', tl);
        const nodes = items.map((it) => $('.tl-node', it));
        if (reduceMotion || !line) {
            tl.style.setProperty('--tp', '1');
            items.forEach((it) => it.classList.add('is-lit'));
            return;
        }
        readers.push(() => {
            const r = line.getBoundingClientRect();
            const mark = vh * 0.6;
            const p = clamp((mark - r.top) / Math.max(1, r.height), 0, 1);
            const lit = nodes.map((n) => !!n && n.getBoundingClientRect().top < mark);
            return () => {
                tl.style.setProperty('--tp', p.toFixed(4));
                items.forEach((it, i) => it.classList.toggle('is-lit', lit[i]));
            };
        });
    }

    /* ---------- Pointer niceties: magnetic buttons, card spotlight ---------- */
    function initPointer() {
        if (!finePointer || reduceMotion) return;
        $$('[data-magnetic]').forEach((el) => {
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                const x = e.clientX - (r.left + r.width / 2);
                const y = e.clientY - (r.top + r.height / 2);
                el.style.transform = 'translate3d(' + (x * 0.18).toFixed(1) + 'px,' + (y * 0.25).toFixed(1) + 'px,0)';
            });
            el.addEventListener('pointerleave', () => { el.style.transform = ''; });
        });
        $$('[data-spotlight]').forEach((el) => {
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                el.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
                el.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
            });
        });
    }

    /* ---------- Pause the header's decorative loops when it is off screen ---------- */
    function initOffscreenPause() {
        if (!('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => e.target.classList.toggle('is-offscreen', !e.isIntersecting));
        }, { rootMargin: '10% 0px' });
        $$('.hero').forEach((el) => io.observe(el));
    }

    /* ---------- Copy email with a toast ---------- */
    function initCopy() {
        const toast = $('.toast');
        let timer = 0;
        const show = (msg) => {
            if (!toast) return;
            toast.textContent = msg;
            toast.classList.add('is-on');
            clearTimeout(timer);
            timer = setTimeout(() => toast.classList.remove('is-on'), 2400);
        };
        $$('[data-copy]').forEach((btn) => btn.addEventListener('click', () => {
            const text = btn.getAttribute('data-copy');
            const fallback = () => { window.location.href = 'mailto:' + text; };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => show('Email address copied'), fallback);
            } else {
                fallback();
            }
        }));
    }

    /* ---------- Case study pages reuse the reveal system ---------- */
    function initSubpages() {
        // The subpage hero stays visible so its title can morph in from the project list.
        $$('.content-block, .next-projects').forEach((el) => {
            if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
        });
    }

    function init() {
        // iOS only applies :active press states when a touch listener exists.
        doc.addEventListener('touchstart', function () {}, { passive: true });
        initSubpages();
        initTheme();
        initNav();
        initProgress();
        initReveal();
        initTimeline();
        initPointer();
        initOffscreenPause();
        initCopy();
        window.__sgReady = true;
        requestFrame();
        window.addEventListener('load', remeasure);
        if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(remeasure);
    }

    try {
        init();
    } catch (err) {
        window.__sgReady = true;
        root.classList.add('no-anim');
        if (window.console && console.error) console.error(err);
    }
})();
