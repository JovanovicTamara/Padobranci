/* Tandem NS – portal magacina (prilagođen telefonu) */
(function () {
    'use strict';
    const C = window.TandemCore;

    // ---------- Pomoćne ----------
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };
    const sstore = {
        get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
        del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
    };
    const lstore = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
        del(k) { try { localStorage.removeItem(k); } catch (e) {} }
    };
    const TOKEN_KEY = 'tandem.token', MODE_KEY = 'tandem.mode', LOCAL_KEY = 'tandem.localdb.v3', LOCAL_SESSION = 'tandem.localsession', CAM_KEY = 'tandem.cam';

    function mkErr(msg, status, network) { const e = new Error(msg); e.status = status; e.network = !!network; return e; }

    // ---------- Pozadina: server ili lokalni demo ----------
    const ApiBackend = {
        mode: 'server',
        token: lstore.get(TOKEN_KEY),
        async call(method, params) {
            let r, j;
            try {
                r = await fetch('api/rpc', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, this.token ? { Authorization: 'Bearer ' + this.token } : {}),
                    body: JSON.stringify({ method, params: params || {} })
                });
                j = await r.json();
            } catch (e) { throw mkErr('Nema veze sa serverom.', 0, true); }
            if (!j.ok) throw mkErr(j.error || 'Greška.', r.status);
            if (j.token) { this.token = j.token; lstore.set(TOKEN_KEY, j.token); }
            return j.data;
        },
        logout() { this.token = null; lstore.del(TOKEN_KEY); }
    };

    const localHooks = {
        hashPin: pin => ({ salt: '', pinHash: 'plain:' + pin }),
        verifyPin: (m, pin) => m.pinHash === 'plain:' + pin,
        allowReset: true
    };
    let memDB = null;
    function localLoad() {
        try {
            const r = lstore.get(LOCAL_KEY);
            if (r) { const d = JSON.parse(r); if (d && d.version >= 3) return d; }
        } catch (e) {}
        if (memDB) return memDB;
        const d = C.defaultDB();
        d.members.forEach(m => { Object.assign(m, localHooks.hashPin(m.pin)); delete m.pin; });
        localSave(d);
        return d;
    }
    function localSave(d) { memDB = d; lstore.set(LOCAL_KEY, JSON.stringify(d)); }
    const LocalBackend = {
        mode: 'local',
        async call(method, params) {
            const db = localLoad();
            const r = C.dispatch(db, { userId: sstore.get(LOCAL_SESSION) }, method, params || {}, localHooks);
            if (!r.ok) throw mkErr(r.error, r.status);
            if (!C.READ_ONLY[method]) localSave(db);
            if (method === 'login') sstore.set(LOCAL_SESSION, r.userId);
            return r.data;
        },
        logout() { sstore.del(LOCAL_SESSION); }
    };

    async function detectBackend() {
        if (location.protocol === 'file:') return LocalBackend;
        try {
            const r = await fetch('api/ping', { cache: 'no-store' });
            const j = await r.json();
            if (j && j.mode === 'server') { lstore.set(MODE_KEY, 'server'); return ApiBackend; }
        } catch (e) { /* nema servera */ }
        // Ako smo ranije koristili server, ne prelazi tiho na demo podatke
        if (lstore.get(MODE_KEY) === 'server') return null;
        return LocalBackend;
    }

    // ---------- Stanje ----------
    let backend = null, S = null, me = null, online = true, pollTimer = null;
    const ui = { tab: 'scan', filter: 'all', q: '', adminTab: 'gear', scan: { gear: null, loc: null }, sheet: false, pick: null };

    const gearById = id => (S ? S.gear.find(g => g.id === id) : null);
    const locById = id => (S ? S.locations.find(l => l.id === id) : null);
    const locName = id => { const l = locById(id); return l ? l.name : '—'; };
    const isAdmin = () => me && me.role === 'admin';

    // ---------- Toast ----------
    function toast(msg, type) {
        const st = {
            success: ['border-emerald-500/50 bg-emerald-950/95 text-emerald-100', 'fa-circle-check text-emerald-400'],
            error: ['border-red-500/50 bg-red-950/95 text-red-100', 'fa-circle-xmark text-red-400'],
            warn: ['border-amber-500/50 bg-amber-950/95 text-amber-100', 'fa-triangle-exclamation text-amber-400'],
            info: ['border-sky-500/50 bg-slate-900/95 text-sky-100', 'fa-circle-info text-sky-400']
        }[type || 'info'];
        const el = document.createElement('div');
        el.className = `pop pointer-events-none max-w-sm w-full border ${st[0]} rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3 text-sm font-medium`;
        el.innerHTML = `<i class="fa-solid ${st[1]} text-lg"></i><span class="flex-1">${esc(msg)}</span>`;
        $('#toast-root').appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
    }

    // ---------- Sheet (donji panel) ----------
    function openSheet(html) {
        $('#sheet-root').innerHTML = `
            <div class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
                <div class="absolute inset-0 bg-black/70" data-act="close-sheet"></div>
                <div class="sheet-enter relative w-full sm:max-w-md bg-panel border-t sm:border border-line rounded-t-[28px] sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-h-[90dvh] overflow-y-auto">
                    <div class="w-10 h-1.5 bg-line rounded-full mx-auto mb-4 sm:hidden"></div>
                    ${html}
                </div>
            </div>`;
        ui.sheet = true;
    }
    function closeSheet() { $('#sheet-root').innerHTML = ''; ui.sheet = false; ui.pick = null; }

    async function run(btn, fn) {
        if (btn) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
        try { return await fn(); }
        catch (e) {
            if (e.status === 401 && me) { toast('Sesija je istekla – prijavi se ponovo.', 'warn'); forceLogout(); }
            else toast(e.message || 'Greška.', e.network ? 'warn' : 'error');
            buzz([60, 40, 60]);
            return undefined;
        } finally {
            if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.html; }
        }
    }

    // ---------- Prikaz opreme ----------
    const CAT_ICON = { 'Naočare': 'fa-glasses', 'Kaciga': 'fa-helmet-safety', 'Dytter': 'fa-volume-high', 'Visinomer': 'fa-gauge-high', 'Motorola (radio)': 'fa-walkie-talkie' };
    const catIcon = c => CAT_ICON[c] || 'fa-box';
    function statusOf(g) {
        if (g.status === 'available') return { key: 'free', label: 'Slobodno', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-300' };
        if (g.mine) return { key: 'mine', label: 'Kod mene', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30', icon: 'bg-sky-500/15 text-sky-300' };
        if (g.holderName) return { key: 'held', label: 'Zaduženo', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'bg-amber-500/15 text-amber-300' };
        return { key: 'other', label: 'Zaduženo', badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30', icon: 'bg-slate-500/15 text-slate-400' };
    }
    function whereLine(g) {
        if (g.status === 'available') return `<i class="fa-solid fa-location-dot text-indigo-300 mr-1"></i>${esc(locName(g.locationId))}`;
        if (g.mine) return `<i class="fa-regular fa-clock mr-1"></i>od ${esc(g.checkedOutAt || '')}`;
        if (g.holderName) return `<i class="fa-solid fa-user mr-1"></i>${esc(g.holderName)} · ${esc(g.checkedOutAt || '')}`;
        return '<i class="fa-solid fa-user-lock mr-1"></i>Zadužio drugi član';
    }
    function gearCard(g, act) {
        const s = statusOf(g);
        return `
        <button data-act="${act || 'gear'}" data-id="${esc(g.id)}" class="w-full text-left bg-panel border border-line rounded-2xl p-3.5 flex items-center gap-3 active:bg-line transition">
            <div class="w-12 h-12 rounded-xl ${s.icon} flex items-center justify-center text-xl flex-shrink-0"><i class="fa-solid ${catIcon(g.category)}"></i></div>
            <div class="min-w-0 flex-1">
                <div class="font-bold truncate">${esc(g.name)}</div>
                <div class="text-xs text-slate-400 mt-0.5 truncate"><span class="font-mono text-slate-300">${esc(g.id)}</span> · ${esc(g.category)}</div>
                <div class="text-xs text-slate-400 mt-1 truncate">${whereLine(g)}</div>
            </div>
            <span class="text-[10px] font-bold border rounded-full px-2.5 py-1 ${s.badge} flex-shrink-0">${s.label}</span>
        </button>`;
    }
    const empty = (icon, title, sub) => `
        <div class="text-center py-14 px-6 text-slate-400">
            <div class="w-16 h-16 mx-auto rounded-2xl bg-white/5 flex items-center justify-center text-2xl mb-3"><i class="fa-solid ${icon}"></i></div>
            <div class="font-semibold text-slate-200">${title}</div><div class="text-sm mt-1">${sub || ''}</div>
        </div>`;

    // ---------- QR pomoćne ----------
    function qrMatrix(text) {
        const q = qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
        return { n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
    }
    function qrSvg(text) {
        const { n, dark } = qrMatrix(text), m = 2;
        let p = '';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) p += `M${c + m} ${r + m}h1v1h-1z`;
        const sz = n + 2 * m;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sz} ${sz}" shape-rendering="crispEdges"><rect width="${sz}" height="${sz}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
    }
    function qrPng(text, id, name, cb) {
        const { n, dark } = qrMatrix(text), m = 2, px = 16, qs = (n + 2 * m) * px, textH = 170;
        const cv = document.createElement('canvas'); cv.width = qs; cv.height = qs + textH;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) ctx.fillRect((c + m) * px, (r + m) * px, px, px);
        ctx.textAlign = 'center';
        ctx.font = 'bold 64px "Courier New", monospace'; ctx.fillText(id, qs / 2, qs + 62);
        let fs = 44; ctx.font = fs + 'px Inter, Arial, sans-serif';
        while (ctx.measureText(name).width > qs - 40 && fs > 18) { fs -= 2; ctx.font = fs + 'px Inter, Arial, sans-serif'; }
        ctx.fillText(name, qs / 2, qs + 128);
        cv.toBlob(cb, 'image/png');
    }
    function download(blob, name) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    }
    function printLabels(items) {
        $('#print-area').innerHTML = items.map(it => `
            <div class="label"><div class="l-brand">Tandem NS · magacin</div>${qrSvg(C.QR_PREFIX + it.id)}<div class="l-id">${esc(it.id)}</div><div class="l-name">${esc(it.name)}</div></div>`).join('');
        document.body.classList.add('printing');
        const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        setTimeout(() => window.print(), 80);
    }
    function csvDownload(rows, name) {
        const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        download(new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), name);
    }

    // ---------- Prijava ----------
    let pinMember = null, pin = '';
    async function showLogin() {
        stopCamera();
        $('#app').classList.add('hidden');
        $('#login-screen').classList.remove('hidden');
        $('#demo-banner').classList.toggle('hidden', backend.mode !== 'local');
        $('#login-pin').classList.add('hidden'); $('#login-pin').classList.remove('flex');
        $('#login-members').classList.remove('hidden');
        $('#member-list').innerHTML = '<div class="text-slate-400 text-sm py-6 text-center"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Učitavanje članova…</div>';
        try {
            const members = await backend.call('members');
            $('#member-list').innerHTML = members.map(m => `
                <button data-act="member" data-id="${esc(m.id)}" class="w-full text-left bg-panel border border-line rounded-2xl p-4 flex items-center gap-4 active:bg-line transition">
                    <span class="w-12 h-12 rounded-full ${m.role === 'admin' ? 'bg-ember-500/15 text-ember-300 border-ember-500/30' : 'bg-sky-500/15 text-sky-300 border-sky-500/30'} border flex items-center justify-center font-bold flex-shrink-0">${m.role === 'admin' ? '<i class="fa-solid fa-shield-halved"></i>' : esc(initials(m.name))}</span>
                    <span class="flex-1 min-w-0"><span class="block font-bold truncate">${esc(m.name)}</span><span class="block text-xs text-slate-400">${esc(m.badge || (m.role === 'admin' ? 'Administrator' : 'Član'))}</span></span>
                    <i class="fa-solid fa-chevron-right text-slate-500"></i>
                </button>`).join('');
            window._members = members;
        } catch (e) {
            $('#member-list').innerHTML = empty('fa-wifi', 'Nema veze sa serverom', 'Proveri mrežu i pokušaj ponovo.') + '<button data-act="retry-login" class="btn-ghost w-full py-3.5">Pokušaj ponovo</button>';
        }
    }
    function startPin(id) {
        pinMember = (window._members || []).find(m => m.id === id); if (!pinMember) return;
        pin = ''; renderPin();
        $('#pin-avatar').textContent = initials(pinMember.name);
        $('#pin-name').textContent = pinMember.name;
        $('#login-members').classList.add('hidden');
        $('#login-pin').classList.remove('hidden'); $('#login-pin').classList.add('flex');
    }
    function renderPin() {
        const n = Math.max(4, pin.length);
        $('#pin-dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="w-3.5 h-3.5 rounded-full ${i < pin.length ? 'bg-sky-400' : 'bg-line'}"></span>`).join('');
    }
    async function submitPin() {
        if (!pinMember || pin.length < 4) return toast('PIN ima 4–8 cifara.', 'warn');
        const okBtn = $('[data-key="ok"]');
        const r = await run(okBtn, async () => {
            const d = await backend.call('login', { memberId: pinMember.id, pin });
            return d;
        });
        if (!r) { $('#pin-dots').classList.add('shake'); setTimeout(() => $('#pin-dots').classList.remove('shake'), 350); pin = ''; renderPin(); return; }
        me = r.user;
        await enterApp();
    }
    function pinKey(k) {
        if (k === 'back') pin = pin.slice(0, -1);
        else if (k === 'ok') return submitPin();
        else if (pin.length < 8) pin += k;
        renderPin(); buzz(8);
    }
    function forceLogout() {
        backend.logout(); me = null; S = null; ui.scan = { gear: null, loc: null }; closeSheet(); stopPolling(); showLogin();
    }

    // ---------- Aplikacija ----------
    async function enterApp() {
        const st = await run(null, () => backend.call('state'));
        if (!st) return showLogin();
        S = st; me = st.user;
        $('#login-screen').classList.add('hidden');
        $('#app').classList.remove('hidden');
        $('#user-btn').textContent = initials(me.name);
        $('#tab-admin').classList.toggle('hidden', !isAdmin());
        $('#tab-admin').classList.toggle('flex', isAdmin());
        setTab(ui.tab === 'admin' && !isAdmin() ? 'scan' : ui.tab);
        startPolling();
    }

    async function refresh(silent) {
        try {
            S = await backend.call('state');
            me = S.user; online = true;
            $('#offline-bar').classList.add('hidden'); $('#sync-dot').className = 'absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400';
            renderAll();
            return true;
        } catch (e) {
            if (e.status === 401) { forceLogout(); return false; }
            online = false;
            $('#offline-bar').classList.remove('hidden'); $('#sync-dot').className = 'absolute top-2 right-2 w-2 h-2 rounded-full bg-red-400';
            if (!silent) toast(e.message, 'warn');
            return false;
        }
    }
    function startPolling() {
        stopPolling();
        if (backend.mode !== 'server') return;
        pollTimer = setInterval(() => { if (!document.hidden && !ui.sheet && me) refresh(true); }, 15000);
    }
    function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

    const TITLES = { scan: 'Skener', mine: 'Moja oprema', stock: 'Magacin', admin: 'Administracija' };
    function setTab(tab) {
        ui.tab = tab;
        ['scan', 'mine', 'stock', 'admin'].forEach(t => $('#v-' + t).classList.toggle('hidden', t !== tab));
        $$('.tab').forEach(b => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('text-sky-300', on); b.classList.toggle('text-slate-500', !on);
        });
        $('#app-title').textContent = TITLES[tab];
        if (tab === 'scan') { if (lstore.get(CAM_KEY) === '1') startCamera(true); }
        else stopCamera();
        renderAll();
        $('main').scrollTop = 0;
    }

    function renderAll() {
        if (!S) return;
        const mine = S.gear.filter(g => g.mine).length;
        const b = $('#mine-badge'); b.textContent = mine; b.classList.toggle('hidden', !mine); b.classList.toggle('flex', !!mine);
        renderScanState();
        if (ui.tab === 'mine') renderMine();
        if (ui.tab === 'stock') renderStock();
        if (ui.tab === 'admin' && isAdmin()) renderAdmin();
    }

    // ---------- Skener: stanje ----------
    function renderScanState() {
        const g = gearById(ui.scan.gear), l = locById(ui.scan.loc);
        const slot = (filled, icon, label, val, sub, color) => filled
            ? `<div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide ${color}"><i class="fa-solid ${icon}"></i>${label}<i class="fa-solid fa-xmark ml-auto text-slate-400"></i></div><div class="font-bold text-sm truncate mt-1">${esc(val)}</div><div class="text-[11px] text-slate-400 truncate font-mono">${esc(sub)}</div>`
            : `<div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"><i class="fa-solid ${icon}"></i>${label}</div><div class="text-sm text-slate-500 mt-1">Skeniraj ili izaberi</div>`;
        const sg = $('#slot-gear'), sl = $('#slot-loc');
        sg.className = 'text-left rounded-2xl border p-3 min-h-[68px] ' + (g ? 'bg-sky-500/10 border-sky-500/40' : 'bg-panel border-line border-dashed');
        sl.className = 'text-left rounded-2xl border p-3 min-h-[68px] ' + (l ? 'bg-indigo-500/10 border-indigo-400/40' : 'bg-panel border-line border-dashed');
        sg.innerHTML = slot(!!g, 'fa-parachute-box', 'Oprema', g && g.name, g && g.id, 'text-sky-300');
        sl.innerHTML = slot(!!l, 'fa-location-dot', 'Polica', l && l.name, l && l.id, 'text-indigo-300');
        let hint = 'Skeniraj QR nalepnicu na opremi.';
        if (g && g.status === 'available') hint = 'Oprema je slobodna – potvrdi zaduženje.';
        else if (g && !l) hint = 'Za razduživanje skeniraj QR police ili stola.';
        else if (!g && l) hint = 'Sada skeniraj opremu koju vraćaš.';
        $('#scan-hint').textContent = hint;
    }

    function onCode(raw) {
        if (ui.sheet || !S) return false;
        let code = String(raw || '').trim();
        if (code.startsWith(C.QR_PREFIX)) code = code.slice(C.QR_PREFIX.length);
        code = code.toUpperCase();
        if (!code) return false;
        const g = gearById(code), l = locById(code);
        if (g) {
            if (g.heldByOther) { toast('Ovu opremu je zadužio drugi član.', 'warn'); buzz([80, 40, 80]); return false; }
            ui.scan.gear = g.id;
        } else if (l) ui.scan.loc = l.id;
        else { toast('Nepoznat QR kod: ' + code.slice(0, 24), 'error'); buzz([80, 40, 80]); return false; }
        buzz(40);
        renderScanState();
        evaluateScan();
        return true;
    }
    function evaluateScan() {
        const g = gearById(ui.scan.gear), l = locById(ui.scan.loc);
        if (!g) return;
        if (g.status === 'available') return sheetCheckout(g);
        if (l && (g.mine || isAdmin())) return sheetReturn(g, l);
    }

    // ---------- Skener: potvrde ----------
    function gearHead(g, extra) {
        const s = statusOf(g);
        return `<div class="flex items-center gap-3 mb-4">
            <div class="w-14 h-14 rounded-2xl ${s.icon} flex items-center justify-center text-2xl flex-shrink-0"><i class="fa-solid ${catIcon(g.category)}"></i></div>
            <div class="min-w-0"><div class="font-bold text-lg leading-tight">${esc(g.name)}</div><div class="text-xs text-slate-400 mt-1"><span class="font-mono text-slate-300">${esc(g.id)}</span> · ${esc(g.category)}</div></div></div>${extra || ''}`;
    }
    function sheetCheckout(g) {
        openSheet(`${gearHead(g, `<div class="rounded-2xl bg-ink/60 border border-line p-3 text-sm mb-4"><span class="text-slate-400">Trenutno na:</span> <b>${esc(locName(g.locationId))}</b></div>`)}
            <button data-act="do-checkout" data-id="${esc(g.id)}" class="btn w-full py-4 text-lg bg-emerald-500 hover:bg-emerald-400 text-ink"><i class="fa-solid fa-hand-holding-hand"></i> Zaduži</button>
            <button data-act="cancel-scan" class="btn-ghost w-full py-3.5 mt-2.5">Otkaži</button>`);
    }
    function sheetReturn(g, l) {
        openSheet(`${gearHead(g, `<div class="rounded-2xl bg-ink/60 border border-line p-3 text-sm mb-4 space-y-1">
                <div><span class="text-slate-400">Vraćaš na:</span> <b>${esc(l.name)}</b> <span class="font-mono text-xs text-slate-400">${esc(l.id)}</span></div>
                ${g.holderName && !g.mine ? `<div class="text-xs text-amber-300">Zadužio: ${esc(g.holderName)}</div>` : ''}</div>`)}
            <button data-act="do-return" data-id="${esc(g.id)}" data-loc="${esc(l.id)}" class="btn w-full py-4 text-lg bg-amber-500 hover:bg-amber-400 text-ink"><i class="fa-solid fa-box-archive"></i> Razduži</button>
            <button data-act="pick-loc-scan" class="btn-ghost w-full py-3.5 mt-2.5"><i class="fa-solid fa-location-dot"></i> Druga lokacija</button>
            <button data-act="cancel-scan" class="w-full py-3 mt-1 text-sm text-slate-400">Otkaži</button>`);
    }
    function pickLocationSheet(title, onPick, selectedId) {
        ui.pick = onPick;
        openSheet(`<h2 class="text-lg font-bold mb-3">${esc(title)}</h2>
            <div class="space-y-2">${S.locations.map(l => `
                <button data-act="pick" data-id="${esc(l.id)}" class="w-full text-left rounded-2xl border ${l.id === selectedId ? 'border-indigo-400 bg-indigo-500/10' : 'border-line bg-ink/50'} p-4 flex items-center gap-3 active:bg-line">
                    <span class="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center"><i class="fa-solid ${l.type === 'table' ? 'fa-table-cells-large' : l.type === 'locker' ? 'fa-door-closed' : 'fa-layer-group'}"></i></span>
                    <span class="flex-1 min-w-0"><span class="block font-semibold truncate">${esc(l.name)}</span><span class="block text-xs font-mono text-slate-400">${esc(l.id)}</span></span>
                </button>`).join('')}</div>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-3">Otkaži</button>`);
    }
    function gearPickerSheet() {
        const list = S.gear.filter(g => !g.heldByOther);
        openSheet(`<h2 class="text-lg font-bold mb-3">Izaberi opremu</h2>
            <div class="space-y-2">${list.map(g => gearCard(g, 'pick-gear')).join('') || empty('fa-box-open', 'Nema opreme')}</div>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-3">Zatvori</button>`);
    }

    async function doCheckout(btn, id) {
        const ok = await run(btn, () => backend.call('checkout', { gearId: id }));
        if (ok === undefined) { await refresh(true); return; }
        const g = gearById(id); closeSheet(); ui.scan = { gear: null, loc: null };
        buzz([30, 40, 30]); toast(`Zaduženo: ${g ? g.name : id}`, 'success');
        await refresh(true);
    }
    async function doReturn(btn, id, locId) {
        const ok = await run(btn, () => backend.call('return', { gearId: id, locationId: locId }));
        if (ok === undefined) { await refresh(true); return; }
        const g = gearById(id); closeSheet(); ui.scan = { gear: null, loc: null };
        buzz([30, 40, 30]); toast(`Vraćeno: ${g ? g.name : id} → ${locName(locId)}`, 'success');
        await refresh(true);
    }

    // ---------- Moja oprema ----------
    function renderMine() {
        const mine = S.gear.filter(g => g.mine);
        $('#v-mine').innerHTML = mine.length
            ? `<p class="text-xs text-slate-400 px-1">Oprema koju trenutno imaš kod sebe. Dodirni za razduživanje.</p>` +
              mine.map(g => `
                <div class="bg-panel border border-line rounded-2xl p-3.5">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center text-xl flex-shrink-0"><i class="fa-solid ${catIcon(g.category)}"></i></div>
                        <div class="min-w-0 flex-1"><div class="font-bold truncate">${esc(g.name)}</div>
                        <div class="text-xs text-slate-400 mt-0.5"><span class="font-mono text-slate-300">${esc(g.id)}</span> · od ${esc(g.checkedOutAt || '')}</div></div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-3">
                        <button data-act="return-pick" data-id="${esc(g.id)}" class="btn bg-amber-500 hover:bg-amber-400 text-ink py-3"><i class="fa-solid fa-box-archive"></i> Vrati</button>
                        <button data-act="scan-gear" data-id="${esc(g.id)}" class="btn-ghost py-3"><i class="fa-solid fa-qrcode"></i> Skeniraj</button>
                    </div>
                </div>`).join('')
            : empty('fa-hand-holding-hand', 'Nemaš zaduženu opremu', 'Skeniraj QR nalepnicu da zadužiš opremu.');
    }

    // ---------- Magacin ----------
    function renderStock() {
        const q = ui.q.trim().toLowerCase();
        const counts = { all: S.gear.length, free: S.gear.filter(g => g.status === 'available').length, out: S.gear.filter(g => g.status !== 'available').length, mine: S.gear.filter(g => g.mine).length };
        let list = S.gear.filter(g => {
            if (ui.filter === 'free' && g.status !== 'available') return false;
            if (ui.filter === 'out' && g.status === 'available') return false;
            if (ui.filter === 'mine' && !g.mine) return false;
            return !q || `${g.id} ${g.name} ${g.category} ${locName(g.locationId)}`.toLowerCase().includes(q);
        });
        const chip = (k, label) => `<button data-act="filter" data-id="${k}" class="flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border ${ui.filter === k ? 'bg-sky-500 text-ink border-sky-500' : 'bg-panel text-slate-300 border-line'}">${label} <span class="opacity-70">${counts[k]}</span></button>`;
        const keep = document.activeElement && document.activeElement.id === 'stock-search';
        $('#v-stock').innerHTML = `
            <div class="sticky top-0 z-10 bg-ink/95 backdrop-blur px-3 pt-3 pb-2 space-y-2 border-b border-line/60">
                <div class="relative"><i class="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                <input id="stock-search" type="search" value="${esc(ui.q)}" placeholder="Traži opremu, ID ili lokaciju…" class="w-full h-12 rounded-2xl bg-panel border border-line pl-11 pr-4 text-base focus:outline-none focus:border-sky-400"></div>
                <div class="flex gap-2 overflow-x-auto no-scrollbar">${chip('all', 'Sve')}${chip('free', 'Slobodno')}${chip('out', 'Zaduženo')}${chip('mine', 'Moje')}</div>
            </div>
            <div class="p-3 space-y-2.5">${list.map(gearCard).join('') || empty('fa-magnifying-glass', 'Nema rezultata', 'Probaj drugu pretragu ili filter.')}</div>`;
        if (keep) { const i = $('#stock-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    }

    function sheetGearDetails(id) {
        const g = gearById(id); if (!g) return;
        const s = statusOf(g);
        let actions = '';
        if (g.status === 'available') actions = `<button data-act="do-checkout" data-id="${esc(g.id)}" class="btn w-full py-4 text-lg bg-emerald-500 hover:bg-emerald-400 text-ink"><i class="fa-solid fa-hand-holding-hand"></i> Zaduži</button>`;
        else if (g.mine || isAdmin()) actions = `<button data-act="return-pick" data-id="${esc(g.id)}" class="btn w-full py-4 text-lg bg-amber-500 hover:bg-amber-400 text-ink"><i class="fa-solid fa-box-archive"></i> ${g.mine ? 'Vrati na policu' : 'Razduži (admin)'}</button>`;
        else actions = '<div class="text-center text-sm text-slate-400 py-2">Ovu opremu je zadužio drugi član.</div>';
        openSheet(`${gearHead(g, `<div class="rounded-2xl bg-ink/60 border border-line p-3 text-sm mb-4 space-y-1.5">
                <div class="flex justify-between gap-2"><span class="text-slate-400">Status</span><span class="text-[10px] font-bold border rounded-full px-2.5 py-0.5 ${s.badge}">${s.label}</span></div>
                <div class="flex justify-between gap-2"><span class="text-slate-400">${g.status === 'available' ? 'Lokacija' : 'Kod'}</span><b class="text-right">${g.status === 'available' ? esc(locName(g.locationId)) : esc(g.holderName || 'drugi član')}</b></div>
                ${g.checkedOutAt ? `<div class="flex justify-between gap-2"><span class="text-slate-400">Zaduženo</span><span>${esc(g.checkedOutAt)}</span></div>` : ''}</div>`)}
            ${actions}<button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-2.5">Zatvori</button>`);
    }

    // ---------- Admin ----------
    function renderAdmin() {
        const segs = [['gear', 'Oprema'], ['qr', 'QR'], ['members', 'Članovi'], ['log', 'Istorija']];
        const seg = `<div class="grid grid-cols-4 gap-1 p-1 bg-panel border border-line rounded-2xl text-sm font-semibold">${segs.map(([k, l]) => `<button data-act="admin-tab" data-id="${k}" class="py-2.5 rounded-xl ${ui.adminTab === k ? 'bg-ember-500 text-ink' : 'text-slate-300'}">${l}</button>`).join('')}</div>`;
        let body = '';
        if (ui.adminTab === 'gear') {
            const free = S.gear.filter(g => g.status === 'available').length;
            body = `<div class="grid grid-cols-3 gap-2 text-center">
                    <div class="bg-panel border border-line rounded-2xl p-3"><div class="font-display text-2xl font-bold">${S.gear.length}</div><div class="text-[11px] text-slate-400">Ukupno</div></div>
                    <div class="bg-panel border border-line rounded-2xl p-3"><div class="font-display text-2xl font-bold text-emerald-300">${free}</div><div class="text-[11px] text-slate-400">U magacinu</div></div>
                    <div class="bg-panel border border-line rounded-2xl p-3"><div class="font-display text-2xl font-bold text-amber-300">${S.gear.length - free}</div><div class="text-[11px] text-slate-400">Zaduženo</div></div></div>
                <div class="grid grid-cols-2 gap-2"><button data-act="gear-form" class="btn-ember py-3.5"><i class="fa-solid fa-plus"></i> Nova oprema</button><button data-act="cat-sheet" class="btn-ghost py-3.5"><i class="fa-solid fa-tags"></i> Vrste opreme</button></div>
                ${S.gear.map(g => { const s = statusOf(g); return `
                <div class="bg-panel border border-line rounded-2xl p-3.5">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-xl ${s.icon} flex items-center justify-center text-lg flex-shrink-0"><i class="fa-solid ${catIcon(g.category)}"></i></div>
                        <div class="min-w-0 flex-1"><div class="font-bold truncate">${esc(g.name)}</div><div class="text-xs text-slate-400 truncate"><span class="font-mono text-slate-300">${esc(g.id)}</span> · ${esc(g.category)}</div><div class="text-xs text-slate-400 mt-0.5 truncate">${whereLine(g)}</div></div>
                    </div>
                    <div class="grid grid-cols-3 gap-2 mt-3 text-sm">
                        <button data-act="qr-gear" data-id="${esc(g.id)}" class="btn-ghost py-2.5"><i class="fa-solid fa-qrcode"></i> QR</button>
                        <button data-act="gear-form" data-id="${esc(g.id)}" class="btn-ghost py-2.5"><i class="fa-solid fa-pen"></i> Uredi</button>
                        <button data-act="gear-del" data-id="${esc(g.id)}" class="btn bg-red-500/10 text-red-300 border border-red-500/25 py-2.5"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`; }).join('')}`;
        } else if (ui.adminTab === 'qr') {
            body = `<button data-act="print-all" class="btn-ember w-full py-3.5"><i class="fa-solid fa-print"></i> Štampaj sve nalepnice</button>
                <button data-act="loc-form" class="btn-ghost w-full py-3.5"><i class="fa-solid fa-plus"></i> Nova polica / sto / ormarić</button>
                <h2 class="text-xs font-bold uppercase tracking-wider text-slate-400 pt-2 px-1">Lokacije</h2>
                ${S.locations.map(l => `<div class="bg-panel border border-line rounded-2xl p-3 flex items-center gap-3">
                    <div class="flex-1 min-w-0"><div class="font-semibold truncate">${esc(l.name)}</div><div class="text-xs font-mono text-indigo-300">${esc(l.id)} · ${esc(S.locTypes[l.type] || '')}</div></div>
                    <button data-act="qr-loc" data-id="${esc(l.id)}" class="btn-ghost px-4 py-2.5 text-sm"><i class="fa-solid fa-qrcode"></i></button>
                    <button data-act="loc-del" data-id="${esc(l.id)}" class="btn bg-red-500/10 text-red-300 border border-red-500/25 px-3.5 py-2.5 text-sm" aria-label="Obriši"><i class="fa-solid fa-trash"></i></button></div>`).join('')}
                <h2 class="text-xs font-bold uppercase tracking-wider text-slate-400 pt-2 px-1">Oprema</h2>
                ${S.gear.map(g => `<div class="bg-panel border border-line rounded-2xl p-3 flex items-center gap-3">
                    <div class="flex-1 min-w-0"><div class="font-semibold truncate">${esc(g.name)}</div><div class="text-xs font-mono text-sky-300">${esc(g.id)}</div></div>
                    <button data-act="qr-gear" data-id="${esc(g.id)}" class="btn-ghost px-4 py-2.5 text-sm"><i class="fa-solid fa-qrcode"></i></button></div>`).join('')}`;
        } else if (ui.adminTab === 'members') {
            body = `<button data-act="member-form" class="btn-ember w-full py-3.5"><i class="fa-solid fa-user-plus"></i> Novi član</button>
                ${(S.members || []).map(m => `<div class="bg-panel border border-line rounded-2xl p-3.5 flex items-center gap-3">
                    <span class="w-11 h-11 rounded-full ${m.role === 'admin' ? 'bg-ember-500/15 text-ember-300' : 'bg-sky-500/15 text-sky-300'} flex items-center justify-center font-bold flex-shrink-0">${esc(initials(m.name))}</span>
                    <div class="flex-1 min-w-0"><div class="font-bold truncate">${esc(m.name)}</div><div class="text-xs text-slate-400">${esc(m.badge || '')} · ${m.role === 'admin' ? 'Administrator' : 'Član'}</div></div>
                    <button data-act="member-form" data-id="${esc(m.id)}" class="btn-ghost px-3.5 py-2.5 text-sm" aria-label="Uredi"><i class="fa-solid fa-pen"></i></button>
                    <button data-act="member-del" data-id="${esc(m.id)}" class="btn bg-red-500/10 text-red-300 border border-red-500/25 px-3.5 py-2.5 text-sm" aria-label="Obriši"><i class="fa-solid fa-trash"></i></button></div>`).join('')}`;
        } else {
            const colors = { 'Zaduženo': 'text-amber-300', 'Razduženo': 'text-emerald-300' };
            body = `<div class="grid grid-cols-2 gap-2"><button data-act="export-gear" class="btn-ghost py-3 text-sm"><i class="fa-solid fa-file-csv"></i> Inventar</button><button data-act="export-log" class="btn-ghost py-3 text-sm"><i class="fa-solid fa-file-csv"></i> Istorija</button></div>
                ${(S.log || []).length ? S.log.map(e => `<div class="bg-panel border border-line rounded-xl px-3.5 py-2.5 text-sm">
                    <div class="flex justify-between gap-2"><span class="font-bold ${colors[e.action] || 'text-sky-300'}">${esc(e.action)}</span><span class="text-[11px] font-mono text-slate-500">${esc(e.t)}</span></div>
                    <div class="truncate">${esc(e.gearName || e.detail)} ${e.gearId ? `<span class="font-mono text-xs text-slate-500">${esc(e.gearId)}</span>` : ''}</div>
                    <div class="text-xs text-slate-400 truncate">${esc(e.userName)}${e.detail && e.gearName ? ' · ' + esc(e.detail) : ''}</div></div>`).join('') : empty('fa-clock-rotate-left', 'Još nema aktivnosti')}`;
        }
        $('#v-admin').innerHTML = seg + body;
    }

    function sheetGearForm(id) {
        const g = id ? gearById(id) : null;
        openSheet(`<h2 class="text-lg font-bold mb-4">${g ? 'Uredi opremu' : 'Nova oprema'}</h2>
            <div class="space-y-3">
                <label class="block"><span class="text-xs text-slate-400">Naziv / model</span><input id="f-name" maxlength="80" value="${esc(g ? g.name : '')}" placeholder="npr. Glavni padobran Sabre 3 – 170" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-4 text-base focus:outline-none focus:border-ember-400"></label>
                <label class="block"><span class="text-xs text-slate-400">Kategorija</span><select id="f-cat" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-3 text-base">${S.categories.map(c => `<option ${g && g.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
                ${g ? '' : `<label class="block"><span class="text-xs text-slate-400">Početna lokacija</span><select id="f-loc" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-3 text-base">${S.locations.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></label>`}
            </div>
            <button data-act="save-gear" data-id="${g ? esc(g.id) : ''}" class="btn-ember w-full py-4 mt-5 text-base">${g ? 'Sačuvaj' : 'Dodaj i napravi QR'}</button>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-2.5">Otkaži</button>`);
        setTimeout(() => { const f = $('#f-name'); if (f && !g) f.focus(); }, 60);
    }
    function sheetCategories() {
        const cnt = n => S.gear.filter(g => g.category === n).length;
        openSheet(`<h2 class="text-lg font-bold">Vrste opreme</h2>
            <p class="text-xs text-slate-400 mt-1 mb-4">Ovde dodaješ nove vrste opreme koje se zadužuju. Oznaka (npr. NAO) ulazi u ID i QR kod.</p>
            <div class="space-y-2">${S.categories.map(c => `
                <div class="flex items-center gap-3 bg-ink/60 border border-line rounded-2xl p-3">
                    <span class="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center flex-shrink-0"><i class="fa-solid ${catIcon(c.name)}"></i></span>
                    <span class="flex-1 min-w-0"><span class="block font-semibold truncate">${esc(c.name)}</span><span class="block text-xs text-slate-400"><span class="font-mono">${esc(c.prefix)}</span> · ${cnt(c.name)} kom</span></span>
                    <button data-act="cat-del" data-id="${esc(c.name)}" class="btn bg-red-500/10 text-red-300 border border-red-500/25 px-3.5 py-2.5 text-sm" aria-label="Obriši vrstu"><i class="fa-solid fa-trash"></i></button>
                </div>`).join('') || '<div class="text-sm text-slate-400 text-center py-4">Još nema vrsta opreme.</div>'}</div>
            <form data-act-form="add-cat" class="mt-4 flex gap-2">
                <input id="f-cat-name" maxlength="40" placeholder="Nova vrsta (npr. Padobran, Jakna)" class="flex-1 min-w-0 h-12 rounded-xl bg-ink border border-line px-4 text-base focus:outline-none focus:border-ember-400">
                <button class="h-12 px-5 rounded-xl bg-ember-500 text-ink font-bold" aria-label="Dodaj vrstu"><i class="fa-solid fa-plus"></i></button>
            </form>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-4">Zatvori</button>`);
    }
    function sheetLocForm() {
        openSheet(`<h2 class="text-lg font-bold mb-4">Nova lokacija</h2>
            <div class="space-y-3">
                <label class="block"><span class="text-xs text-slate-400">Naziv</span><input id="f-name" maxlength="60" placeholder="npr. Polica C (nova sala)" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-4 text-base focus:outline-none focus:border-ember-400"></label>
                <label class="block"><span class="text-xs text-slate-400">Tip</span><select id="f-type" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-3 text-base">${Object.entries(S.locTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
            </div>
            <button data-act="save-loc" class="btn-ember w-full py-4 mt-5 text-base">Dodaj i napravi QR</button>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-2.5">Otkaži</button>`);
        setTimeout(() => { const f = $('#f-name'); if (f) f.focus(); }, 60);
    }
    function sheetMemberForm(id) {
        const m = id ? (S.members || []).find(x => x.id === id) : null;
        openSheet(`<h2 class="text-lg font-bold mb-4">${m ? 'Uredi člana' : 'Novi član'}</h2>
            <div class="space-y-3">
                <label class="block"><span class="text-xs text-slate-400">Ime i prezime</span><input id="f-name" maxlength="60" value="${esc(m ? m.name : '')}" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-4 text-base focus:outline-none focus:border-ember-400"></label>
                <label class="block"><span class="text-xs text-slate-400">Oznaka (npr. Skydiver #120)</span><input id="f-badge" maxlength="30" value="${esc(m ? m.badge : '')}" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-4 text-base focus:outline-none focus:border-ember-400"></label>
                <label class="block"><span class="text-xs text-slate-400">Uloga</span><select id="f-role" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-3 text-base"><option value="parachutist" ${m && m.role !== 'admin' ? 'selected' : ''}>Član / padobranac</option><option value="admin" ${m && m.role === 'admin' ? 'selected' : ''}>Administrator</option></select></label>
                <label class="block"><span class="text-xs text-slate-400">${m ? 'Novi PIN (ostavi prazno da ostane isti)' : 'PIN (4–8 cifara)'}</span><input id="f-pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-4 text-base font-mono tracking-widest focus:outline-none focus:border-ember-400"></label>
            </div>
            <button data-act="save-member" data-id="${m ? esc(m.id) : ''}" class="btn-ember w-full py-4 mt-5 text-base">Sačuvaj</button>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-2.5">Otkaži</button>`);
    }
    function sheetQR(id, name, kind) {
        openSheet(`<div class="text-center">
            <div class="text-xs font-bold uppercase tracking-widest text-ember-400">${kind === 'loc' ? 'Lokacija' : 'Oprema'}</div>
            <h2 class="text-lg font-bold mt-1">${esc(name)}</h2>
            <div class="bg-white text-black rounded-2xl p-3 w-60 mx-auto mt-4">
                ${qrSvg(C.QR_PREFIX + id)}
                <div class="font-mono font-bold text-lg mt-1.5 leading-tight">${esc(id)}</div>
                <div class="text-sm leading-tight mt-0.5 pb-1 break-words">${esc(name)}</div>
            </div>
            <div class="grid grid-cols-2 gap-2 mt-5">
                <button data-act="print-one" data-id="${esc(id)}" data-name="${esc(name)}" class="btn-ember py-3.5"><i class="fa-solid fa-print"></i> Štampaj</button>
                <button data-act="png-one" data-id="${esc(id)}" data-name="${esc(name)}" class="btn-ghost py-3.5"><i class="fa-solid fa-download"></i> PNG</button>
            </div>
            <button data-act="close-sheet" class="w-full py-3 mt-2 text-sm text-slate-400">Zatvori</button></div>`);
    }
    function sheetProfile() {
        openSheet(`<div class="text-center mb-4">
                <div class="w-16 h-16 mx-auto rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 flex items-center justify-center font-bold text-xl">${esc(initials(me.name))}</div>
                <div class="font-bold text-lg mt-2">${esc(me.name)}</div>
                <div class="text-xs text-slate-400">${esc(me.badge || '')} · ${isAdmin() ? 'Administrator' : 'Član'}</div>
                <div class="inline-block mt-2 text-[10px] font-bold px-2.5 py-1 rounded-full border ${backend.mode === 'server' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}">${backend.mode === 'server' ? 'Povezan sa serverom' : 'Demo režim (samo ovaj uređaj)'}</div>
            </div>
            <button data-act="pin-form" class="btn-ghost w-full py-3.5"><i class="fa-solid fa-key"></i> Promeni PIN</button>
            ${backend.mode === 'local' && isAdmin() ? '<button data-act="reset-demo" class="btn-ghost w-full py-3.5 mt-2.5 text-amber-300"><i class="fa-solid fa-rotate-left"></i> Vrati početne podatke</button>' : ''}
            <a href="index.html" class="btn-ghost w-full py-3.5 mt-2.5"><i class="fa-solid fa-globe"></i> Javni sajt</a>
            <button data-act="logout" class="btn w-full py-3.5 mt-2.5 bg-red-500/10 text-red-300 border border-red-500/25"><i class="fa-solid fa-right-from-bracket"></i> Odjava</button>
            <button data-act="close-sheet" class="w-full py-3 mt-1 text-sm text-slate-400">Zatvori</button>`);
    }
    function sheetPinForm() {
        openSheet(`<h2 class="text-lg font-bold mb-4">Promena PIN-a</h2>
            <div class="space-y-3">
                <label class="block"><span class="text-xs text-slate-400">Stari PIN</span><input id="f-old" type="password" inputmode="numeric" maxlength="8" autocomplete="off" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-4 text-base font-mono tracking-widest focus:outline-none focus:border-ember-400"></label>
                <label class="block"><span class="text-xs text-slate-400">Novi PIN (4–8 cifara)</span><input id="f-new" type="password" inputmode="numeric" maxlength="8" autocomplete="off" class="mt-1 w-full h-12 rounded-xl bg-ink border border-line px-4 text-base font-mono tracking-widest focus:outline-none focus:border-ember-400"></label>
            </div>
            <button data-act="save-pin" class="btn-ember w-full py-4 mt-5 text-base">Sačuvaj</button>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-2.5">Otkaži</button>`);
    }
    function confirmSheet(title, text, act, id, label) {
        openSheet(`<h2 class="text-lg font-bold">${esc(title)}</h2><p class="text-sm text-slate-400 mt-2">${esc(text)}</p>
            <button data-act="${act}" data-id="${esc(id)}" class="btn w-full py-4 mt-5 bg-red-500 hover:bg-red-400 text-white">${esc(label)}</button>
            <button data-act="close-sheet" class="btn-ghost w-full py-3.5 mt-2.5">Otkaži</button>`);
    }

    // ---------- Kamera ----------
    let camStream = null, camRAF = null, lastCode = '', lastAt = 0, lastScanTs = 0, torchOn = false;
    async function startCamera(quiet) {
        if (camStream) return;
        if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
            $('#cam-msg').textContent = 'Kamera radi samo preko HTTPS veze (vidi README). Dok to ne podesiš, upiši kod ručno.';
            if (!quiet) toast('Kamera traži HTTPS. Koristi ručni unos.', 'warn');
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            $('#cam-msg').textContent = 'Ovaj pregledač ne podržava kameru. Upiši kod ručno.';
            return;
        }
        try {
            camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        } catch (e) {
            $('#cam-msg').textContent = 'Kamera nije dostupna (dozvola odbijena?). Dozvoli pristup kameri ili upiši kod ručno.';
            lstore.del(CAM_KEY);
            if (!quiet) toast('Pristup kameri nije odobren.', 'error');
            return;
        }
        lstore.set(CAM_KEY, '1');
        const v = $('#cam-video'); v.srcObject = camStream;
        try { await v.play(); } catch (e) {}
        v.classList.remove('hidden'); $('#cam-idle').classList.add('hidden'); $('#cam-frame').classList.remove('hidden'); $('#cam-tools').classList.remove('hidden');
        const track = camStream.getVideoTracks()[0];
        const caps = track && track.getCapabilities ? track.getCapabilities() : {};
        $('#cam-torch').classList.toggle('hidden', !caps.torch); torchOn = false;
        scanLoop();
    }
    function stopCamera() {
        if (camRAF) cancelAnimationFrame(camRAF); camRAF = null;
        if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null;
        const v = $('#cam-video'); if (!v) return;
        v.srcObject = null; v.classList.add('hidden');
        $('#cam-idle').classList.remove('hidden'); $('#cam-frame').classList.add('hidden'); $('#cam-tools').classList.add('hidden');
    }
    function scanLoop(ts) {
        if (!camStream) return;
        camRAF = requestAnimationFrame(scanLoop);
        if (ts - lastScanTs < 90 || ui.sheet) return; // ~11 fps, pauza dok je panel otvoren
        lastScanTs = ts;
        const v = $('#cam-video'); if (!v.videoWidth) return;
        const cv = $('#cam-canvas'), w = 560, h = Math.round(w * v.videoHeight / v.videoWidth);
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, w, h);
        const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
        if (res && res.data) {
            const now = Date.now();
            if (res.data !== lastCode || now - lastAt > 2200) { lastCode = res.data; lastAt = now; onCode(res.data); }
        }
    }
    async function toggleTorch() {
        const track = camStream && camStream.getVideoTracks()[0]; if (!track) return;
        try { torchOn = !torchOn; await track.applyConstraints({ advanced: [{ torch: torchOn }] }); $('#cam-torch').classList.toggle('bg-amber-400', torchOn); $('#cam-torch').classList.toggle('text-ink', torchOn); }
        catch (e) { torchOn = false; }
    }

    // ---------- Događaji ----------
    document.addEventListener('click', async e => {
        const el = e.target.closest('[data-act],[data-tab],[data-key]');
        if (!el) return;
        if (el.dataset.key) return pinKey(el.dataset.key);
        if (el.dataset.tab) return setTab(el.dataset.tab);
        const id = el.dataset.id;
        switch (el.dataset.act) {
            case 'member': return startPin(id);
            case 'retry-login': return showLogin();
            case 'close-sheet': return closeSheet();
            case 'cancel-scan': closeSheet(); ui.scan = { gear: null, loc: null }; return renderScanState();
            case 'gear': return sheetGearDetails(id);
            case 'pick-gear': ui.scan.gear = id; closeSheet(); renderScanState(); evaluateScan(); return;
            case 'slot-gear': if (ui.scan.gear) { ui.scan.gear = null; renderScanState(); } else gearPickerSheet(); return;
            case 'slot-loc': if (ui.scan.loc) { ui.scan.loc = null; renderScanState(); } else pickLocationSheet('Izaberi lokaciju', lid => { ui.scan.loc = lid; closeSheet(); renderScanState(); evaluateScan(); }); return;
            case 'pick-loc-scan': { const g = gearById(ui.scan.gear); return pickLocationSheet('Vrati na…', lid => { ui.scan.loc = lid; closeSheet(); renderScanState(); evaluateScan(); }, ui.scan.loc); }
            case 'pick': { const fn = ui.pick; if (fn) fn(id); return; }
            case 'do-checkout': return doCheckout(el, id);
            case 'do-return': return doReturn(el, id, el.dataset.loc);
            case 'return-pick': return pickLocationSheet('Vrati na…', lid => doReturn(null, id, lid));
            case 'scan-gear': ui.scan = { gear: id, loc: null }; setTab('scan'); return;
            case 'filter': ui.filter = id; return renderStock();
            case 'admin-tab': ui.adminTab = id; return renderAdmin();
            case 'gear-form': return sheetGearForm(id);
            case 'loc-form': return sheetLocForm();
            case 'cat-sheet': return sheetCategories();
            case 'cat-del': { const r = await run(el, () => backend.call('deleteCategory', { name: id })); if (r !== undefined) { toast('Vrsta obrisana.', 'success'); await refresh(true); } sheetCategories(); return; }
            case 'member-form': return sheetMemberForm(id);
            case 'save-gear': {
                const name = $('#f-name').value, category = $('#f-cat').value;
                const r = await run(el, () => id ? backend.call('updateGear', { id, name, category }) : backend.call('addGear', { name, category, locationId: $('#f-loc').value }));
                if (r === undefined) return;
                closeSheet(); toast(id ? 'Sačuvano.' : 'Oprema dodata.', 'success'); await refresh(true);
                if (!id && r.id) { const g = gearById(r.id); if (g) sheetQR(g.id, g.name, 'gear'); }
                return;
            }
            case 'save-loc': {
                const r = await run(el, () => backend.call('addLocation', { name: $('#f-name').value, type: $('#f-type').value }));
                if (r === undefined) return;
                closeSheet(); toast('Lokacija dodata.', 'success'); await refresh(true);
                const l = locById(r.id); if (l) sheetQR(l.id, l.name, 'loc');
                return;
            }
            case 'save-member': {
                const params = { name: $('#f-name').value, badge: $('#f-badge').value, role: $('#f-role').value, pin: $('#f-pin').value };
                if (id) { params.id = id; if (!params.pin) delete params.pin; }
                const r = await run(el, () => backend.call(id ? 'updateMember' : 'addMember', params));
                if (r === undefined) return;
                closeSheet(); toast('Sačuvano.', 'success'); return refresh(true);
            }
            case 'gear-del': { const g = gearById(id); return confirmSheet('Obrisati opremu?', g ? `${g.name} (${g.id}) će biti trajno uklonjena iz evidencije.` : '', 'do-gear-del', id, 'Obriši'); }
            case 'do-gear-del': { const r = await run(el, () => backend.call('deleteGear', { id })); if (r !== undefined) { closeSheet(); toast('Obrisano.', 'success'); refresh(true); } return; }
            case 'loc-del': { const l = locById(id); return confirmSheet('Obrisati lokaciju?', l ? `${l.name} (${l.id}) – to mora biti prazna lokacija.` : '', 'do-loc-del', id, 'Obriši'); }
            case 'do-loc-del': { const r = await run(el, () => backend.call('deleteLocation', { id })); if (r !== undefined) { closeSheet(); toast('Obrisano.', 'success'); refresh(true); } else closeSheet(); return; }
            case 'member-del': { const m = (S.members || []).find(x => x.id === id); return confirmSheet('Obrisati člana?', m ? `${m.name} više neće moći da se prijavi.` : '', 'do-member-del', id, 'Obriši'); }
            case 'do-member-del': { const r = await run(el, () => backend.call('deleteMember', { id })); if (r !== undefined) { closeSheet(); toast('Obrisano.', 'success'); refresh(true); } else closeSheet(); return; }
            case 'qr-gear': { const g = gearById(id); return g && sheetQR(g.id, g.name, 'gear'); }
            case 'qr-loc': { const l = locById(id); return l && sheetQR(l.id, l.name, 'loc'); }
            case 'print-one': return printLabels([{ id, name: el.dataset.name }]);
            case 'png-one': return qrPng(C.QR_PREFIX + id, id, el.dataset.name || '', b => download(b, `QR_${id}.png`));
            case 'print-all': return printLabels(S.locations.map(l => ({ id: l.id, name: l.name })).concat(S.gear.map(g => ({ id: g.id, name: g.name }))));
            case 'export-gear': return csvDownload([['ID', 'Naziv', 'Kategorija', 'Status', 'Lokacija', 'Zadužio', 'Datum zaduženja']].concat(S.gear.map(g => [g.id, g.name, g.category, g.status === 'available' ? 'U magacinu' : 'Zaduženo', g.status === 'available' ? locName(g.locationId) : '', g.holderName || '', g.checkedOutAt || ''])), `inventar_${C.nowStr().slice(0, 10)}.csv`);
            case 'export-log': return csvDownload([['Vreme', 'Radnja', 'Oprema ID', 'Oprema', 'Korisnik', 'Detalji']].concat((S.log || []).map(l => [l.t, l.action, l.gearId, l.gearName, l.userName, l.detail])), `istorija_${C.nowStr().slice(0, 10)}.csv`);
            case 'pin-form': return sheetPinForm();
            case 'save-pin': { const r = await run(el, () => backend.call('changePin', { oldPin: $('#f-old').value, newPin: $('#f-new').value })); if (r !== undefined) { closeSheet(); toast('PIN je promenjen.', 'success'); } return; }
            case 'reset-demo': { if (!confirm('Vratiti sve podatke na početno stanje?')) return; const r = await run(el, () => backend.call('resetDemo')); if (r !== undefined) { closeSheet(); toast('Podaci vraćeni.', 'info'); refresh(true); } return; }
            case 'logout': closeSheet(); return forceLogout();
        }
    });

    document.addEventListener('submit', async e => {
        const f = e.target.closest('[data-act-form="add-cat"]'); if (!f) return;
        e.preventDefault();
        const name = $('#f-cat-name').value;
        const r = await run(f.querySelector('button'), () => backend.call('addCategory', { name }));
        if (r !== undefined) { toast('Vrsta dodata.', 'success'); await refresh(true); }
        sheetCategories();
    });
    document.addEventListener('input', e => {
        if (e.target.id === 'stock-search') { ui.q = e.target.value; renderStock(); }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && ui.sheet) return closeSheet();
        if (!$('#login-pin').classList.contains('hidden') && !e.target.matches('input')) {
            if (/^\d$/.test(e.key)) pinKey(e.key);
            else if (e.key === 'Backspace') pinKey('back');
            else if (e.key === 'Enter') pinKey('ok');
        }
    });
    $('#pin-back').addEventListener('click', () => { pinMember = null; pin = ''; $('#login-pin').classList.add('hidden'); $('#login-pin').classList.remove('flex'); $('#login-members').classList.remove('hidden'); });
    $('#cam-start').addEventListener('click', () => startCamera(false));
    $('#cam-stop').addEventListener('click', () => { lstore.del(CAM_KEY); stopCamera(); });
    $('#cam-torch').addEventListener('click', toggleTorch);
    $('#sync-btn').addEventListener('click', async () => { const ok = await refresh(false); if (ok) toast('Osveženo.', 'info'); });
    $('#user-btn').addEventListener('click', sheetProfile);
    $('#manual-form').addEventListener('submit', e => { e.preventDefault(); const i = $('#manual-code'); if (onCode(i.value)) i.value = ''; i.blur(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopCamera();
        else if (me && ui.tab === 'scan' && lstore.get(CAM_KEY) === '1') { startCamera(true); refresh(true); }
        else if (me) refresh(true);
    });
    window.addEventListener('pagehide', stopCamera);

    // ---------- Pokretanje ----------
    async function boot() {
        $('#boot-retry').classList.add('hidden'); $('#boot-msg').textContent = 'Učitavanje…';
        backend = await detectBackend();
        if (!backend) {
            $('#boot-msg').textContent = 'Nema veze sa serverom.';
            $('#boot-retry').classList.remove('hidden');
            return;
        }
        // automatska prijava ako postoji važeća sesija
        const hasSession = backend.mode === 'server' ? !!ApiBackend.token : !!sstore.get(LOCAL_SESSION);
        if (hasSession) {
            try { S = await backend.call('state'); me = S.user; } catch (e) { S = null; me = null; if (e.network) { $('#boot-msg').textContent = 'Nema veze sa serverom.'; $('#boot-retry').classList.remove('hidden'); return; } }
        }
        $('#boot').classList.add('hidden');
        if (me) await enterApp(); else await showLogin();
    }
    $('#boot-retry').addEventListener('click', boot);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    boot();
})();
