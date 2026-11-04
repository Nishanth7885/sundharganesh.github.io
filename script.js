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
    const lerp = (a, b, t) => a + (b - a) * t;
    const onChange = (mql, fn) => {
        if (mql.addEventListener) mql.addEventListener('change', fn);
        else if (mql.addListener) mql.addListener(fn);
    };
    let vw = window.innerWidth;
    let vh = window.innerHeight;

    // Shared header state: whether it is on screen, and how far it has scrolled away (0 to 1).
    let heroOn = true;
    let heroShift = 0;
    const heroWatchers = [];
    const HERO_BG_SHIFT = 140; // keep in sync with the .hero-canvas translate in style.css

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

    /* ---------- Boot intro: once per session, any input skips it ---------- */
    let introOver = !root.classList.contains('has-intro');
    const introQueue = [];
    const afterIntro = (fn, delay) => {
        const run = () => setTimeout(fn, delay || 0);
        if (introOver) run();
        else introQueue.push(run);
    };

    function initIntro() {
        if (introOver) return;
        let ended = false;
        function release() {
            if (introOver) return;
            introOver = true;
            introQueue.splice(0).forEach((run) => run());
        }
        function finish() {
            if (ended) return;
            ended = true;
            root.classList.add('intro-done');
            release();
            window.removeEventListener('wheel', skip);
            doc.removeEventListener('keydown', skip);
        }
        function skip() {
            if (ended) return;
            // Without has-intro, --intro-delay drops to its short default and the header plays at once.
            root.classList.remove('has-intro');
            finish();
        }
        setTimeout(release, 1650);
        setTimeout(finish, 2600);
        const intro = $('.intro');
        if (intro) intro.addEventListener('pointerdown', skip);
        window.addEventListener('wheel', skip, { passive: true });
        doc.addEventListener('keydown', skip);
    }

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

    /* ---------- Header name: letters assemble one by one ---------- */
    function initChars() {
        $$('[data-chars]').forEach((el) => {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (!text) return;
            const sr = doc.createElement('span');
            sr.className = 'sr-only';
            sr.textContent = text;
            const visual = doc.createElement('span');
            visual.setAttribute('aria-hidden', 'true');
            let index = 0;
            text.split(' ').forEach((word, w) => {
                if (w) visual.appendChild(doc.createTextNode(' '));
                const wd = doc.createElement('span');
                wd.className = 'wd';
                Array.from(word).forEach((c) => {
                    const ch = doc.createElement('span');
                    ch.className = 'ch';
                    ch.style.setProperty('--ci', String(index++));
                    ch.textContent = c;
                    wd.appendChild(ch);
                });
                visual.appendChild(wd);
            });
            el.textContent = '';
            el.appendChild(sr);
            el.appendChild(visual);
            el.classList.add('is-split');
        });
    }

    /* ---------- Typed line cycling through specialties ---------- */
    function initTyped() {
        const el = $('.typed-text[data-typed]');
        if (!el || reduceMotion) return;
        let phrases;
        try { phrases = JSON.parse(el.getAttribute('data-typed')); } catch (e) { return; }
        if (!Array.isArray(phrases) || phrases.length < 2) return;
        const line = el.closest('.hero-typed') || el;
        let index = Math.max(0, phrases.indexOf(el.textContent.trim()));
        let shown = phrases[index].length;
        let mode = 'hold';
        const step = () => {
            // Pause while the header is off screen or the tab is hidden.
            if (!heroOn || doc.hidden) {
                setTimeout(step, 600);
                return;
            }
            if (mode === 'hold') {
                mode = 'delete';
                line.classList.add('is-typing');
            }
            if (mode === 'delete') {
                shown -= 1;
                el.textContent = phrases[index].slice(0, Math.max(0, shown));
                if (shown > 0) {
                    setTimeout(step, 24);
                    return;
                }
                index = (index + 1) % phrases.length;
                mode = 'type';
                setTimeout(step, 320);
                return;
            }
            const target = phrases[index];
            shown += 1;
            el.textContent = target.slice(0, shown);
            if (shown >= target.length) {
                mode = 'hold';
                line.classList.remove('is-typing');
                setTimeout(step, 2600);
                return;
            }
            setTimeout(step, 34 + Math.random() * 46);
        };
        afterIntro(step, 2900);
    }

    /* ---------- Header backdrop: a drifting node network that reacts to the pointer ---------- */
    function initNetwork() {
        const canvas = $('.hero-canvas');
        const hero = canvas ? canvas.closest('.hero') : null;
        if (!hero || reduceMotion || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const BUCKETS = 6;
        const links = [];
        const grabs = [];
        for (let b = 0; b < BUCKETS; b++) { links.push([]); grabs.push([]); }
        let w = 0;
        let h = 0;
        let left = 0;
        let top = 0;
        const dots = [[], [], []];
        let nodes = [];
        let started = false;
        let raf = 0;
        let last = 0;
        let lastRaf = 0;
        let pace = 16.7;
        let halfRate = false;
        let tick = 0;
        let scrolledAt = -1e4;
        let px = 0;
        let py = 0;
        let pointer = false;

        const spawn = () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.026,
            vy: (Math.random() - 0.5) * 0.026,
            r: 0.7 + Math.random() * 1.3
        });
        const size = () => {
            const r = hero.getBoundingClientRect();
            left = r.left;
            top = r.top + (window.scrollY || 0);
            const nw = Math.max(1, Math.round(r.width));
            const nh = Math.max(1, Math.round(r.height));
            if (nw === w && nh === h) return;
            w = nw;
            h = nh;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const count = Math.round(clamp((w * h) / 17000, 22, 80));
            nodes = nodes.filter((n) => n.x <= w && n.y <= h).slice(0, count);
            while (nodes.length < count) nodes.push(spawn());
        };
        const isActive = () => started && heroOn && !doc.hidden;

        // The mesh fades out over the lower part of the header (no CSS mask, which is costly to composite).
        const fadeAt = (y) => (y < h * 0.55 ? 1 : clamp((h * 0.95 - y) / (h * 0.4), 0, 1));

        const frame = (t) => {
            raf = 0;
            if (!isActive()) return;
            const gap = lastRaf ? t - lastRaf : 16.7;
            lastRaf = t;
            pace = lerp(pace, Math.min(gap, 100), 0.05);
            // On a busy device, settle at half rate for the rest of the visit so scrolling stays smooth.
            if (!halfRate && pace > 24) halfRate = true;
            raf = requestAnimationFrame(frame);
            tick += 1;
            if (halfRate && (tick & 1)) return;
            // Hold the mesh still while the page scrolls; scrolling gets the whole frame budget.
            if (t - scrolledAt < 160) {
                last = t;
                return;
            }
            const dt = last ? Math.min(50, t - last) : 16;
            last = t;
            draw(dt);
        };

        const draw = (dt) => {
            const light = root.getAttribute('data-theme') === 'light';
            const rgb = light ? '14,116,144' : '34,211,238';
            const rgb2 = light ? '79,70,229' : '167,139,250';
            const link = w < 700 ? 100 : 140;
            const link2 = link * link;
            const reach = 190;
            const reach2 = reach * reach;
            const mx = px - left;
            const my = py - (top - (window.scrollY || 0)) - heroShift * HERO_BG_SHIFT;

            for (let b = 0; b < BUCKETS; b++) { links[b].length = 0; grabs[b].length = 0; }
            for (let b = 0; b < 3; b++) dots[b].length = 0;
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                n.x += n.vx * dt;
                n.y += n.vy * dt;
                if (n.x < -12) n.x = w + 12; else if (n.x > w + 12) n.x = -12;
                if (n.y < -12) n.y = h + 12; else if (n.y > h + 12) n.y = -12;
                n.f = fadeAt(n.y);
                if (n.f > 0.04) dots[n.f > 0.66 ? 2 : (n.f > 0.33 ? 1 : 0)].push(n);
                if (!pointer) continue;
                const dx = n.x - mx;
                const dy = n.y - my;
                const d2 = dx * dx + dy * dy;
                if (d2 >= reach2) continue;
                const d = Math.sqrt(d2) || 1;
                if (d < 110) {
                    // Gentle push so the cursor opens a little clearing in the mesh.
                    const f = (1 - d / 110) * 0.7;
                    n.x += (dx / d) * f;
                    n.y += (dy / d) * f;
                }
                const s = (1 - d / reach) * n.f;
                if (s > 0.06) grabs[Math.min(BUCKETS - 1, Math.floor(s * BUCKETS))].push(n.x, n.y);
            }
            for (let i = 0; i < nodes.length; i++) {
                const a = nodes[i];
                if (a.f <= 0) continue;
                for (let j = i + 1; j < nodes.length; j++) {
                    const b = nodes[j];
                    const dx = a.x - b.x;
                    if (dx > link || dx < -link) continue;
                    const dy = a.y - b.y;
                    if (dy > link || dy < -link) continue;
                    const d2 = dx * dx + dy * dy;
                    if (d2 >= link2) continue;
                    const s = (1 - d2 / link2) * Math.min(a.f, b.f);
                    if (s > 0.06) links[Math.min(BUCKETS - 1, Math.floor(s * BUCKETS))].push(a.x, a.y, b.x, b.y);
                }
            }

            ctx.clearRect(0, 0, w, h);
            ctx.lineWidth = 1;
            const maxLink = light ? 0.3 : 0.24;
            for (let k = 0; k < BUCKETS; k++) {
                const p = links[k];
                if (!p.length) continue;
                ctx.strokeStyle = 'rgba(' + rgb + ',' + (maxLink * (k + 1) / BUCKETS).toFixed(3) + ')';
                ctx.beginPath();
                for (let q = 0; q < p.length; q += 4) {
                    ctx.moveTo(p[q], p[q + 1]);
                    ctx.lineTo(p[q + 2], p[q + 3]);
                }
                ctx.stroke();
            }
            if (pointer) {
                const maxGrab = light ? 0.34 : 0.4;
                for (let k = 0; k < BUCKETS; k++) {
                    const p = grabs[k];
                    if (!p.length) continue;
                    ctx.strokeStyle = 'rgba(' + rgb2 + ',' + (maxGrab * (k + 1) / BUCKETS).toFixed(3) + ')';
                    ctx.beginPath();
                    for (let q = 0; q < p.length; q += 2) {
                        ctx.moveTo(mx, my);
                        ctx.lineTo(p[q], p[q + 1]);
                    }
                    ctx.stroke();
                }
            }
            const dotAlpha = light ? 0.5 : 0.62;
            for (let k = 0; k < 3; k++) {
                const list = dots[k];
                if (!list.length) continue;
                ctx.fillStyle = 'rgba(' + rgb + ',' + (dotAlpha * (k + 1) / 3).toFixed(3) + ')';
                ctx.beginPath();
                for (let i = 0; i < list.length; i++) {
                    const n = list[i];
                    ctx.moveTo(n.x + n.r, n.y);
                    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
                }
                ctx.fill();
            }
        };
        const wake = () => {
            if (raf || !isActive()) return;
            last = 0;
            lastRaf = 0;
            raf = requestAnimationFrame(frame);
        };

        size();
        resizers.push(size);
        if ('ResizeObserver' in window) new ResizeObserver(size).observe(hero);
        heroWatchers.push(wake);
        window.addEventListener('scroll', () => { scrolledAt = performance.now(); }, { passive: true });
        if (finePointer) {
            hero.addEventListener('pointermove', (e) => {
                px = e.clientX;
                py = e.clientY;
                pointer = true;
            });
            hero.addEventListener('pointerleave', () => { pointer = false; });
        }
        afterIntro(() => {
            started = true;
            canvas.classList.add('is-on');
            wake();
        }, 120);
    }

    /* ---------- Header depth: copy, photo and backdrop drift apart as it scrolls away ---------- */
    // Inline transforms on the moving layers only; a custom property on .hero would restyle its whole subtree.
    function initHeroScroll() {
        const hero = $('.hero');
        if (!hero || reduceMotion) return;
        const backdrop = $$('.hero-bg, .hero-canvas', hero);
        const copy = $('.hero-copy', hero);
        const photo = $('.hero-photo', hero);
        let height = 1;
        let wide = false;
        let last = -1;
        const measure = () => {
            height = Math.max(1, hero.offsetHeight);
            wide = vw >= 961;
            last = -1;
        };
        measure();
        resizers.push(measure);
        readers.push((y) => {
            const p = clamp(y / height, 0, 1);
            if (Math.abs(p - last) < 0.0005) return null;
            return () => {
                last = p;
                heroShift = p;
                const shift = '0 ' + (p * HERO_BG_SHIFT).toFixed(1) + 'px';
                backdrop.forEach((el) => { el.style.translate = shift; });
                // Copy and photo drift only on wide screens, where the whole header fits on screen.
                if (copy) {
                    copy.style.translate = wide ? '0 ' + (p * 90).toFixed(1) + 'px' : '';
                    copy.style.opacity = wide && p > 0 ? (1 - p * 0.8).toFixed(3) : '';
                }
                if (photo) photo.style.translate = wide ? '0 ' + (p * 40).toFixed(1) + 'px' : '';
            };
        });
    }

    /* ---------- Tech ticker: speed, direction and skew follow scroll velocity ---------- */
    function initMarquee() {
        const band = $('.marquee');
        if (!band) return;
        const tracks = $$('.marquee-track', band);
        tracks.forEach((t) => {
            // Repeat the set until one half is wider than the screen, then double it for a seamless loop.
            const base = t.innerHTML;
            const single = t.scrollWidth || 1;
            const copies = Math.max(1, Math.ceil((vw + 240) / single));
            let half = '';
            for (let i = 0; i < copies; i++) half += base;
            t.innerHTML = half + half;
        });
        if (reduceMotion) return;
        band.classList.add('is-ready');
        const rows = $$('.marquee-row', band);
        let anims = null;
        let visible = false;
        let raf = 0;
        let lastY = window.scrollY || 0;
        let vel = 0;
        let skew = 0;
        let lastRate = 1;
        let lastSkew = '';
        const loop = () => {
            raf = 0;
            if (!anims) {
                anims = tracks.map((t) => (t.getAnimations ? t.getAnimations()[0] : null));
                // Start deep into the timeline so reverse playback never reaches the start.
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
            const s = (Math.abs(skew) < 0.01 ? 0 : skew).toFixed(2);
            if (s !== lastSkew) {
                lastSkew = s;
                rows.forEach((row) => { row.style.transform = s === '0.00' ? '' : 'skewX(' + s + 'deg)'; });
            }
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

    /* ---------- Section titles decode from scrambled glyphs ---------- */
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';
    const SYMBOLS = '#%*+=/?!01';
    const pick = (s) => s.charAt((Math.random() * s.length) | 0);

    function scramble(el) {
        const text = el.textContent;
        const chars = Array.from(text);
        if (!text.trim()) return;
        const sr = doc.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = text;
        const visual = doc.createElement('span');
        visual.setAttribute('aria-hidden', 'true');
        el.textContent = '';
        el.appendChild(sr);
        el.appendChild(visual);
        const n = chars.length;
        const due = chars.map((c, i) => 140 + (i / Math.max(1, n - 1)) * 560 + Math.random() * 160);
        const render = (t) => {
            const frag = doc.createDocumentFragment();
            let plain = '';
            let pending = 0;
            chars.forEach((c, i) => {
                if (c === ' ' || t >= due[i]) {
                    plain += c;
                    return;
                }
                if (plain) {
                    frag.appendChild(doc.createTextNode(plain));
                    plain = '';
                }
                const g = doc.createElement('span');
                g.className = 'scr';
                g.textContent = Math.random() < 0.22 ? pick(SYMBOLS) : pick(c === c.toLowerCase() ? LOWER : UPPER);
                frag.appendChild(g);
                pending += 1;
            });
            if (plain) frag.appendChild(doc.createTextNode(plain));
            visual.textContent = '';
            visual.appendChild(frag);
            return pending;
        };
        render(0);
        const t0 = performance.now();
        let lastSwap = 0;
        const tick = (now) => {
            const t = now - t0;
            if (t - lastSwap >= 50) {
                lastSwap = t;
                if (!render(t)) {
                    el.textContent = text;
                    return;
                }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /* ---------- Reveal on scroll ---------- */
    function initReveal() {
        $$('[data-stagger]').forEach((group) => {
            const step = parseInt(group.getAttribute('data-stagger'), 10) || 80;
            $$('[data-reveal]', group).forEach((el, i) => el.style.setProperty('--rd', (i * step) + 'ms'));
        });
        $$('[data-list]').forEach((list) => {
            Array.prototype.forEach.call(list.children, (li, i) => li.style.setProperty('--li', String(i)));
        });
        $$('.skill-row dd').forEach((dd) => {
            Array.prototype.forEach.call(dd.children, (tag, i) => tag.style.setProperty('--ti', String(i)));
        });
        const els = $$('[data-reveal], [data-list], [data-scramble], [data-scan], .section');
        const show = (el) => {
            if (el.classList.contains('section')) el.classList.add('sec-in');
            if (el.hasAttribute('data-scramble') && !reduceMotion) scramble(el);
            el.classList.add('is-in');
        };
        if (reduceMotion || !('IntersectionObserver' in window)) {
            els.forEach(show);
            return;
        }
        // Reveal once an element's top passes 90% of the viewport (tall cards never leave blank bands).
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                io.unobserve(entry.target);
                show(entry.target);
            });
        }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
        els.forEach((el) => io.observe(el));
    }

    /* ---------- Experience timeline: the spine draws itself ---------- */
    function initTimeline() {
        const tl = $('#timeline');
        if (!tl) return;
        const line = $('.tl-line', tl);
        const fill = line ? $('span', line) : null;
        const items = $$('.tl-item', tl);
        const nodes = items.map((it) => $('.tl-node', it));
        if (reduceMotion || !fill) {
            tl.style.setProperty('--tp', '1');
            items.forEach((it) => it.classList.add('is-lit'));
            return;
        }
        let lastP = -1;
        const litState = items.map(() => null);
        readers.push(() => {
            const r = line.getBoundingClientRect();
            if (r.bottom < -50 || r.top > vh + 50) return null;
            const mark = vh * 0.6;
            const p = clamp((mark - r.top) / Math.max(1, r.height), 0, 1);
            const lit = nodes.map((n) => !!n && n.getBoundingClientRect().top < mark);
            if (Math.abs(p - lastP) < 0.0005 && lit.every((v, i) => v === litState[i])) return null;
            return () => {
                lastP = p;
                // Direct transform on the fill: a custom property on the timeline would restyle every card.
                fill.style.transform = 'scaleY(' + p.toFixed(4) + ')';
                items.forEach((it, i) => {
                    if (lit[i] === litState[i]) return;
                    litState[i] = lit[i];
                    it.classList.toggle('is-lit', lit[i]);
                });
            };
        });
    }

    /* ---------- Project cards: sticky stack that recedes as the next card lands ---------- */
    function initStack() {
        const stack = $('#proj-stack');
        if (!stack || reduceMotion) return;
        const items = $$('.proj', stack);
        const cards = items.map((it) => $('.proj-card', it));
        const shades = cards.map((c) => (c ? $('.proj-shade', c) : null));
        if (items.length < 2 || cards.some((c) => !c)) return;
        let on = false;
        let tops = [];
        let lastValues = [];
        const apply = (c, i, v) => {
            // Scale the card and fade its shade directly, so the card's contents are not restyled.
            c.style.transform = v > 0 ? 'scale(' + (1 - v * 0.05).toFixed(4) + ')' : '';
            if (shades[i]) shades[i].style.setProperty('--sp', v.toFixed(3));
        };
        const measure = () => {
            stack.classList.remove('stack-on');
            cards.forEach((c, i) => apply(c, i, 0));
            lastValues = cards.map(() => 0);
            const navH = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 76;
            // Only stack when every card fits on screen below the navigation.
            on = cards.every((c, i) => c.offsetHeight + navH + 10 + i * 18 + 24 <= vh);
            stack.classList.toggle('stack-on', on);
            tops = items.map((it) => parseFloat(getComputedStyle(it).top) || 0);
        };
        measure();
        resizers.push(measure);
        readers.push(() => {
            if (!on) return null;
            const box = stack.getBoundingClientRect();
            if (box.bottom < 0 || box.top > vh) return null;
            const rects = items.map((it) => it.getBoundingClientRect());
            const values = items.map((it, i) => {
                if (i === items.length - 1) return 0;
                const start = tops[i] + rects[i].height;
                const end = tops[i + 1];
                return Math.round(clamp((start - rects[i + 1].top) / Math.max(1, start - end), 0, 1) * 1000) / 1000;
            });
            if (values.every((v, i) => v === lastValues[i])) return null;
            return () => cards.forEach((c, i) => {
                if (values[i] === lastValues[i]) return;
                lastValues[i] = values[i];
                apply(c, i, values[i]);
            });
        });
    }

    /* ---------- 3D tilt: the header photo turns toward the pointer, cards lean under it ---------- */
    function initTilt() {
        if (!finePointer || reduceMotion) return;
        const photo = $('.photo-tilt[data-tilt]');
        const hero = photo ? photo.closest('.hero') : null;
        if (photo && hero) {
            const max = parseFloat(photo.getAttribute('data-tilt')) || 8;
            hero.addEventListener('pointermove', (e) => {
                const r = photo.getBoundingClientRect();
                const dx = clamp((e.clientX - (r.left + r.width / 2)) / (vw / 2), -1, 1);
                const dy = clamp((e.clientY - (r.top + r.height / 2)) / (vh / 2), -1, 1);
                photo.style.setProperty('--ry', (dx * max).toFixed(2) + 'deg');
                photo.style.setProperty('--rx', (-dy * max).toFixed(2) + 'deg');
            });
            hero.addEventListener('pointerleave', () => {
                photo.style.setProperty('--rx', '0deg');
                photo.style.setProperty('--ry', '0deg');
            });
        }
        // Cards use the independent `rotate` property so their reveal transform is untouched.
        $$('[data-tilt]').forEach((el) => {
            if (el === photo) return;
            const max = parseFloat(el.getAttribute('data-tilt')) || 5;
            let tx = 0;
            let ty = 0;
            let cx = 0;
            let cy = 0;
            let raf = 0;
            const tick = () => {
                cx = lerp(cx, tx, 0.14);
                cy = lerp(cy, ty, 0.14);
                if (Math.abs(cx - tx) < 0.02 && Math.abs(cy - ty) < 0.02) {
                    cx = tx;
                    cy = ty;
                }
                const angle = Math.hypot(cx, cy);
                el.style.rotate = angle < 0.02 ? '' : cx.toFixed(3) + ' ' + cy.toFixed(3) + ' 0 ' + angle.toFixed(2) + 'deg';
                raf = (cx !== tx || cy !== ty) ? requestAnimationFrame(tick) : 0;
            };
            const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
            el.addEventListener('pointermove', (e) => {
                if (!el.classList.contains('is-in')) return;
                const r = el.getBoundingClientRect();
                const dx = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
                const dy = clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
                tx = -dy * max;
                ty = dx * max;
                kick();
            });
            el.addEventListener('pointerleave', () => {
                tx = 0;
                ty = 0;
                kick();
            });
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

    /* ---------- Cursor halo that trails the pointer and swells over links ---------- */
    function initCursor() {
        const ring = $('.cursor-ring');
        if (!ring || !finePointer || reduceMotion) return;
        const interactive = 'a, button, [role="button"], label, summary';
        let x = -100;
        let y = -100;
        let tx = -100;
        let ty = -100;
        let raf = 0;
        let on = false;
        const tick = () => {
            x = lerp(x, tx, 0.24);
            y = lerp(y, ty, 0.24);
            if (Math.abs(x - tx) < 0.1 && Math.abs(y - ty) < 0.1) {
                x = tx;
                y = ty;
            }
            ring.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
            raf = (x !== tx || y !== ty) ? requestAnimationFrame(tick) : 0;
        };
        const hide = () => {
            on = false;
            ring.classList.remove('is-on', 'is-down');
        };
        doc.addEventListener('pointermove', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            tx = e.clientX;
            ty = e.clientY;
            if (!on) {
                on = true;
                x = tx;
                y = ty;
                ring.classList.add('is-on');
            }
            if (!raf) raf = requestAnimationFrame(tick);
        }, { passive: true });
        doc.addEventListener('pointerover', (e) => {
            const t = e.target;
            ring.classList.toggle('is-hover', !!(t && t.closest && t.closest(interactive)));
        });
        doc.addEventListener('pointerdown', () => ring.classList.add('is-down'));
        doc.addEventListener('pointerup', () => ring.classList.remove('is-down'));
        doc.addEventListener('mouseout', (e) => { if (!e.relatedTarget) hide(); });
        window.addEventListener('blur', hide);
    }

    /* ---------- Pause decorative loops while they are off screen ---------- */
    function initOffscreenPause() {
        const targets = $$('.hero, .marquee');
        if (!targets.length || !('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                e.target.classList.toggle('is-offscreen', !e.isIntersecting);
                if (e.target.classList.contains('hero')) {
                    heroOn = e.isIntersecting;
                    heroWatchers.forEach((fn) => fn());
                }
            });
        });
        targets.forEach((el) => io.observe(el));
        doc.addEventListener('visibilitychange', () => heroWatchers.forEach((fn) => fn()));
    }

    /* ---------- Copy email: toast, button feedback and a confetti burst ---------- */
    function burst(x, y) {
        if (reduceMotion || !doc.body.animate) return;
        const colors = ['#22d3ee', '#818cf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6'];
        for (let i = 0; i < 30; i++) {
            const bit = doc.createElement('span');
            bit.className = 'confetti';
            bit.setAttribute('aria-hidden', 'true');
            bit.style.background = colors[i % colors.length];
            if (i % 3 === 0) bit.style.borderRadius = '50%';
            if (i % 4 === 1) bit.style.width = '5px';
            doc.body.appendChild(bit);
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
            const dist = 70 + Math.random() * 120;
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            const spin = (Math.random() - 0.5) * 900;
            const at = (px, py, deg, s) => 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0) rotate(' + deg.toFixed(0) + 'deg) scale(' + s + ')';
            const anim = bit.animate([
                { transform: at(x - 4, y - 4, 0, 0.4), opacity: 1 },
                { transform: at(x - 4 + dx, y - 4 + dy, spin * 0.5, 1), opacity: 1, offset: 0.42 },
                { transform: at(x - 4 + dx * 1.2, y - 4 + dy + 170, spin, 0.7), opacity: 0 }
            ], { duration: 1000 + Math.random() * 600, easing: 'cubic-bezier(0.2, 0.65, 0.35, 1)', fill: 'forwards' });
            anim.onfinish = () => bit.remove();
        }
    }

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
        $$('[data-copy]').forEach((btn) => {
            const label = $('span', btn);
            const icon = $('i', btn);
            const labelText = label ? label.textContent : '';
            const iconClass = icon ? icon.className : '';
            let reset = 0;
            btn.addEventListener('click', () => {
                const text = btn.getAttribute('data-copy');
                const fallback = () => { window.location.href = 'mailto:' + text; };
                if (!navigator.clipboard || !navigator.clipboard.writeText) {
                    fallback();
                    return;
                }
                navigator.clipboard.writeText(text).then(() => {
                    show('Email address copied');
                    const r = btn.getBoundingClientRect();
                    burst(r.left + r.width / 2, r.top + r.height / 2);
                    btn.classList.add('is-copied');
                    if (label) label.textContent = 'Copied';
                    if (icon) icon.className = 'fas fa-check';
                    clearTimeout(reset);
                    reset = setTimeout(() => {
                        btn.classList.remove('is-copied');
                        if (label) label.textContent = labelText;
                        if (icon) icon.className = iconClass;
                    }, 2200);
                }, fallback);
            });
        });
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
        initIntro();
        initTheme();
        initNav();
        initProgress();
        initChars();
        initTyped();
        initOffscreenPause();
        initNetwork();
        initHeroScroll();
        initMarquee();
        initReveal();
        initTimeline();
        initStack();
        initTilt();
        initPointer();
        initCursor();
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
