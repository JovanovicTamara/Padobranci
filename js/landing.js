/* Javna strana: podaci iz config.js, meni, animacije pri skrolovanju */
(function () {
    'use strict';
    const S = window.SITE || {};
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    $$('[data-phone]').forEach(el => { if (S.phone) el.textContent = S.phone; });
    $$('[data-tel]').forEach(el => { if (S.phoneRaw) el.href = 'tel:' + S.phoneRaw; });
    $$('[data-viber]').forEach(el => { if (S.phoneRaw) el.href = 'viber://chat?number=' + encodeURIComponent(S.phoneRaw); });
    $$('[data-wa]').forEach(el => { if (S.phoneRaw) el.href = 'https://wa.me/' + S.phoneRaw.replace(/\D/g, ''); });
    $$('[data-hours]').forEach(el => { if (S.hours) el.textContent = S.hours; });
    $$('[data-map]').forEach(el => { if (S.mapQuery) el.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(S.mapQuery); });
    $$('[data-price]').forEach(el => { const v = S.prices && S.prices[el.dataset.price]; if (v) el.textContent = '€' + v; });
    $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

    // Mobilni meni
    const btn = document.getElementById('menu-btn'), menu = document.getElementById('mobile-menu');
    if (btn && menu) {
        const set = open => { menu.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', String(open)); btn.querySelector('i').className = open ? 'fa-solid fa-xmark text-lg' : 'fa-solid fa-bars text-lg'; };
        btn.addEventListener('click', () => set(menu.classList.contains('hidden')));
        $$('a', menu).forEach(a => a.addEventListener('click', () => set(false)));
    }

    // Senka zaglavlja pri skrolu
    const header = document.getElementById('site-header');
    const onScroll = () => header && header.classList.toggle('shadow-2xl', window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

    // Pojavljivanje sekcija + aktivan link
    if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.documentElement.classList.add('reveal-ready');
        const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
        $$('.reveal').forEach(el => io.observe(el));
    }
    if ('IntersectionObserver' in window) {
        const links = $$('.nav-link'), map = {};
        links.forEach(l => { map[l.getAttribute('href').slice(1)] = l; });
        const so = new IntersectionObserver(es => es.forEach(e => {
            if (e.isIntersecting && map[e.target.id]) { links.forEach(l => l.classList.remove('text-ember-400')); map[e.target.id].classList.add('text-ember-400'); }
        }), { rootMargin: '-45% 0px -50% 0px' });
        Object.keys(map).forEach(id => { const s = document.getElementById(id); if (s) so.observe(s); });
    }
})();
