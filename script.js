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
    const hasIntro = root.classList.contains('has-intro');
    const $ = (s, c) => (c || doc).querySelector(s);
    const $$ = (s, c) => Array.prototype.slice.call((c || doc).querySelectorAll(s));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
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
            const transition = doc.startViewTransition(() => apply(next));
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

    /* ---------- Word splitting for headline reveals ---------- */
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
        const els = $$('[data-reveal], [data-split], [data-inview]');
        if (reduceMotion || !('IntersectionObserver' in window)) {
            els.forEach((el) => el.classList.add('is-in'));
            return;
        }
        // Hero items revealed during the intro or headline entrance wait for it to
        // finish; anything revealed later by scrolling animates straight away.
        const heroReadyAt = performance.now() + (hasIntro ? 1900 : 650);
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                const wait = heroReadyAt - performance.now();
                if (wait > 0 && el.closest('.hero')) {
                    const base = parseInt(el.style.getPropertyValue('--rd'), 10) || 0;
                    el.style.setProperty('--rd', Math.round(base + wait) + 'ms');
                }
                el.classList.add('is-in');
                io.unobserve(el);
            });
        }, { threshold: 0.14, rootMargin: '0px 0px -7% 0px' });
        els.forEach((el) => io.observe(el));
    }

    /* ---------- Number counters ---------- */
    function initCounters() {
        const els = $$('[data-count]');
        if (!els.length || reduceMotion || !('IntersectionObserver' in window)) return;
        const introEnd = performance.now() + (hasIntro ? 1900 : 500);
        const run = (el) => {
            const target = parseInt(el.getAttribute('data-count'), 10) || 0;
            const start = performance.now();
            if (target === 0) {
                let last = 0;
                const roll = (now) => {
                    if (now - start < 950) {
                        if (now - last > 65) {
                            last = now;
                            el.textContent = String(1 + Math.floor(Math.random() * 9));
                        }
                        requestAnimationFrame(roll);
                    } else {
                        el.textContent = '0';
                    }
                };
                requestAnimationFrame(roll);
                return;
            }
            const duration = 1300 + target * 60;
            const tick = (now) => {
                const k = clamp((now - start) / duration, 0, 1);
                el.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 4))));
                if (k < 1) requestAnimationFrame(tick);
            };
            el.textContent = '0';
            requestAnimationFrame(tick);
        };
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                io.unobserve(entry.target);
                setTimeout(() => run(entry.target), Math.max(0, introEnd - performance.now()));
            });
        }, { threshold: 0.6 });
        els.forEach((el) => io.observe(el));
    }

    /* ---------- Hero terminal: types the agent session ---------- */
    function initTerminal() {
        const term = $('[data-terminal]');
        if (!term || reduceMotion) return;
        const plan = $$('.tl', term).map((line) => {
            const nodes = [];
            const walker = doc.createTreeWalker(line, NodeFilter.SHOW_TEXT, null);
            let n;
            while ((n = walker.nextNode())) {
                const typed = !!(n.parentNode && n.parentNode.classList && n.parentNode.classList.contains('t-text'));
                nodes.push({ node: n, text: n.textContent, typed: typed });
            }
            return { line: line, nodes: nodes, kind: line.getAttribute('data-t') };
        });
        plan.forEach((p) => {
            p.line.classList.add('is-pending');
            if (p.kind === 'cmd') p.nodes.forEach((o) => { if (o.typed) o.node.textContent = ''; });
        });
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const typeLine = async (p) => {
            p.line.classList.remove('is-pending');
            p.line.classList.add('is-typing');
            for (const o of p.nodes) {
                if (!o.typed) continue;
                for (let i = 1; i <= o.text.length; i++) {
                    o.node.textContent = o.text.slice(0, i);
                    await wait(o.text.charAt(i - 1) === ' ' ? 20 : 26 + Math.random() * 40);
                }
            }
            await wait(220);
            p.line.classList.remove('is-typing');
        };
        const run = async () => {
            for (let i = 0; i < plan.length; i++) {
                const p = plan[i];
                if (p.kind === 'cmd') {
                    await typeLine(p);
                } else {
                    await wait(plan[i - 1] && plan[i - 1].kind === 'cmd' ? 420 : 230);
                    p.line.classList.remove('is-pending');
                    p.line.classList.add('is-out');
                }
            }
            plan[plan.length - 1].line.classList.add('is-last');
        };
        setTimeout(run, hasIntro ? 2100 : 900);
    }

    /* ---------- Marquee: speed and direction follow scroll velocity ---------- */
    function initMarquee() {
        const band = $('.marquee');
        if (!band) return;
        const tracks = $$('.marquee-track', band);
        tracks.forEach((t) => { t.innerHTML = t.innerHTML + t.innerHTML; });
        if (reduceMotion) return;
        band.classList.add('is-ready');
        let anims = null;
        let visible = false;
        let raf = 0;
        let lastY = window.scrollY || 0;
        let vel = 0;
        let skew = 0;
        let lastRate = 1;
        const loop = () => {
            raf = 0;
            if (!anims) {
                anims = tracks.map((t) => (t.getAnimations ? t.getAnimations()[0] : null));
                // Start deep into the timeline so reverse playback never hits the start.
                anims.forEach((a) => { if (a) a.currentTime = 4e7; });
            }
            const y = window.scrollY || 0;
            vel = lerp(vel, y - lastY, 0.1);
            lastY = y;
            const speed = 1 + Math.min(Math.abs(vel) * 0.09, 4);
            const rate = (vel < -0.6 ? -1 : 1) * speed;
            if (Math.abs(rate - lastRate) > 0.02) {
                anims.forEach((a) => { if (a) a.playbackRate = rate; });
                lastRate = rate;
            }
            skew = lerp(skew, clamp(vel * 0.12, -7, 7), 0.12);
            band.style.setProperty('--skew', skew.toFixed(2));
            if (visible) raf = requestAnimationFrame(loop);
        };
        if (!('IntersectionObserver' in window)) return;
        new IntersectionObserver((entries) => {
            visible = entries[0].isIntersecting;
            if (visible && !raf) {
                lastY = window.scrollY || 0;
                raf = requestAnimationFrame(loop);
            }
        }).observe(band);
    }

    /* ---------- Build cards: sticky stack that recedes as the next card lands ---------- */
    function initStack() {
        const stack = $('#build-stack');
        if (!stack || reduceMotion) return;
        const items = $$('.build', stack);
        const cards = items.map((it) => $('.build-card', it));
        if (items.length < 2) return;
        let on = false;
        let tops = [];
        const measure = () => {
            stack.classList.remove('stack-on');
            cards.forEach((c) => c.style.removeProperty('--sp'));
            const navH = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 76;
            on = cards.every((c, i) => c.offsetHeight + navH + 6 + i * 20 + 24 <= vh);
            stack.classList.toggle('stack-on', on);
            tops = items.map((it) => parseFloat(getComputedStyle(it).top) || 0);
        };
        measure();
        resizers.push(measure);
        readers.push(() => {
            if (!on) return null;
            const rects = items.map((it) => it.getBoundingClientRect());
            const values = items.map((it, i) => {
                if (i === items.length - 1) return 0;
                const start = tops[i] + rects[i].height;
                const end = tops[i + 1];
                return clamp((start - rects[i + 1].top) / Math.max(1, start - end), 0, 1);
            });
            return () => cards.forEach((c, i) => c.style.setProperty('--sp', values[i].toFixed(3)));
        });
    }

    /* ---------- Pipeline: pinned scroll-driven track on desktop ---------- */
    function initPipeline() {
        const sec = $('#pipeline');
        if (!sec) return;
        const pin = $('.pipe-pin', sec);
        const inner = $('.pipe-inner', sec);
        const line = $('.pipe-line', sec);
        const steps = $$('.pipe-step', sec);
        const nodes = steps.map((s) => $('.pipe-node', s));
        const count = $('.pipe-count b', sec);
        const total = steps.length;
        const wide = media('(min-width: 961px)');
        if (!pin || !inner || !line || !total) return;
        if (reduceMotion) {
            steps.forEach((s) => s.classList.add('is-done'));
            sec.style.setProperty('--pp', '1');
            if (count) count.textContent = String(total).padStart(2, '0');
            return;
        }
        let mode = 'flow';
        let active = -2;
        const measure = () => {
            sec.classList.remove('pin-on');
            mode = wide.matches ? 'row' : 'column';
            if (wide.matches) {
                sec.classList.add('pin-on');
                if (inner.offsetHeight + 24 > vh) sec.classList.remove('pin-on');
                else mode = 'pin';
            }
            sec.style.setProperty('--lw', String(line.offsetWidth));
            sec.style.setProperty('--lh', String(line.offsetHeight));
            active = -2;
        };
        measure();
        resizers.push(measure);
        const smooth = (t) => t * t * (3 - 2 * t);
        const seg = total - 1;
        readers.push(() => {
            let pp;
            let idx;
            if (mode === 'pin') {
                const r = pin.getBoundingClientRect();
                const p = clamp(-r.top / Math.max(1, r.height - vh), 0, 1);
                const raw = p * seg;
                const k = Math.min(Math.floor(raw), seg - 1);
                const f = raw - k;
                const eased = f < 0.3 ? 0 : f > 0.8 ? 1 : smooth((f - 0.3) / 0.5);
                pp = (k + eased) / seg;
                idx = Math.round(pp * seg);
            } else if (mode === 'row') {
                const r = pin.getBoundingClientRect();
                pp = clamp((vh * 0.8 - r.top) / Math.max(1, r.height * 0.75), 0, 1);
                idx = Math.round(pp * seg);
            } else {
                const r = line.getBoundingClientRect();
                const mark = vh * 0.62;
                pp = clamp((mark - r.top) / Math.max(1, r.height), 0, 1);
                idx = -1;
                for (let i = 0; i < total; i++) {
                    if (nodes[i].getBoundingClientRect().top + 24 < mark) idx = i;
                }
            }
            const changed = idx !== active;
            return () => {
                sec.style.setProperty('--pp', pp.toFixed(4));
                if (!changed) return;
                active = idx;
                steps.forEach((s, i) => {
                    s.classList.toggle('is-done', i < idx);
                    s.classList.toggle('is-active', i === idx);
                });
                if (count) count.textContent = String(Math.max(1, idx + 1)).padStart(2, '0');
            };
        });
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

    /* ---------- Hero depth: scroll parallax plus pointer tilt ---------- */
    function initHero() {
        const hero = $('#home');
        if (!hero || reduceMotion) return;
        const stage = $('.hv-stage', hero);
        const bg = $('.hero-bg', hero);
        readers.push((y) => {
            if (y > vh * 1.3) return null;
            return () => {
                if (bg) bg.style.transform = 'translate3d(0,' + (y * 0.28).toFixed(1) + 'px,0)';
                if (stage) stage.style.setProperty('--sy', y.toFixed(1));
            };
        });
        if (!finePointer || !stage) return;
        let tx = 0;
        let ty = 0;
        let cx = 0;
        let cy = 0;
        let raf = 0;
        const tick = () => {
            cx = lerp(cx, tx, 0.075);
            cy = lerp(cy, ty, 0.075);
            stage.style.setProperty('--px', cx.toFixed(3));
            stage.style.setProperty('--py', cy.toFixed(3));
            raf = (Math.abs(cx - tx) > 0.002 || Math.abs(cy - ty) > 0.002) ? requestAnimationFrame(tick) : 0;
        };
        hero.addEventListener('pointermove', (e) => {
            tx = (e.clientX / vw) * 2 - 1;
            ty = (e.clientY / vh) * 2 - 1;
            const r = hero.getBoundingClientRect();
            hero.style.setProperty('--hx', (e.clientX - r.left) + 'px');
            hero.style.setProperty('--hy', (e.clientY - r.top) + 'px');
            if (!raf) raf = requestAnimationFrame(tick);
        });
        hero.addEventListener('pointerleave', () => {
            tx = 0;
            ty = 0;
            if (!raf) raf = requestAnimationFrame(tick);
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
                el.style.transform = 'translate3d(' + (x * 0.2).toFixed(1) + 'px,' + (y * 0.28).toFixed(1) + 'px,0)';
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

    /* ---------- SMIL animations only run while visible ---------- */
    function initSvgPlayback() {
        const svgs = $$('svg').filter((s) => s.pauseAnimations && s.querySelector('animateMotion, animate'));
        if (!svgs.length) return;
        if (reduceMotion || !('IntersectionObserver' in window)) {
            if (reduceMotion) svgs.forEach((s) => s.pauseAnimations());
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (e.isIntersecting) e.target.unpauseAnimations();
                else e.target.pauseAnimations();
            });
        });
        svgs.forEach((s) => io.observe(s));
    }

    /* ---------- Pause decorative loops in sections that are off screen ---------- */
    function initOffscreenPause() {
        if (!('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => e.target.classList.toggle('is-offscreen', !e.isIntersecting));
        }, { rootMargin: '10% 0px' });
        $$('.hero, .security, .contact').forEach((el) => io.observe(el));
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

    /* ---------- Intro can be skipped; it is removed once finished ---------- */
    function initIntro() {
        const intro = $('.intro');
        if (!intro || !hasIntro) return;
        const done = () => root.classList.add('intro-done');
        intro.addEventListener('click', done);
        setTimeout(done, 2400);
    }

    /* ---------- Case study pages reuse the reveal system ---------- */
    function initSubpages() {
        $$('.project-hero-content, .content-block, .next-projects').forEach((el) => {
            if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
        });
    }

    function init() {
        initSubpages();
        initTheme();
        initNav();
        initProgress();
        initReveal();
        initCounters();
        initTerminal();
        initMarquee();
        initStack();
        initPipeline();
        initTimeline();
        initHero();
        initPointer();
        initSvgPlayback();
        initOffscreenPause();
        initCopy();
        initIntro();
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
