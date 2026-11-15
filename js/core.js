/* Tandem NS – zajednička logika magacina.
   Koristi se i u pregledaču (lokalni demo režim) i na serveru (server.js),
   tako da pravila rade isto na oba mesta. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TandemCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const QR_PREFIX = 'TANDEM_NS_WMS_';
    const DEFAULT_CATEGORIES = [
        { name: 'Naočare', prefix: 'NAO' },
        { name: 'Kaciga', prefix: 'KAC' },
        { name: 'Dytter', prefix: 'DYT' },
        { name: 'Visinomer', prefix: 'VIS' },
        { name: 'Motorola (radio)', prefix: 'MOT' }
    ];
    const LOC_TYPES = { shelf: 'POL', table: 'STO', locker: 'ORM' };
    const LOC_TYPE_LABELS = { shelf: 'Polica', table: 'Sto', locker: 'Ormarić' };

    const pad = n => String(n).padStart(2, '0');
    function nowStr() {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // ---------- Početni podaci ----------
    function defaultDB() {
        const t = nowStr();
        return {
            version: 4,
            categories: DEFAULT_CATEGORIES.map(c => Object.assign({}, c)),
            members: [
                { id: 'admin_1', name: 'Glavni administrator', badge: 'Admin', role: 'admin', pin: '0000' },
                { id: 'user_1', name: 'Marko Marković', badge: 'Skydiver #104', role: 'parachutist', pin: '1111' },
                { id: 'user_2', name: 'Ana Jović', badge: 'Skydiver #112', role: 'parachutist', pin: '2222' }
            ],
            locations: [
                { id: 'POL-01', name: 'Polica A-1 (glavna sala)', type: 'shelf' },
                { id: 'POL-02', name: 'Polica A-2 (glavna sala)', type: 'shelf' },
                { id: 'POL-03', name: 'Polica B-1 (glavna sala)', type: 'shelf' },
                { id: 'STO-01', name: 'Sto za pakovanje 1', type: 'table' },
                { id: 'ORM-01', name: 'Ormarić za opremu 1', type: 'locker' }
            ],
            gear: [
                { id: 'NAO-001', name: 'Naočare #1', category: 'Naočare', status: 'available', locationId: 'POL-01', holderId: null, checkedOutAt: null },
                { id: 'NAO-002', name: 'Naočare #2', category: 'Naočare', status: 'available', locationId: 'POL-01', holderId: null, checkedOutAt: null },
                { id: 'KAC-001', name: 'Kaciga Cookie G4 (M)', category: 'Kaciga', status: 'checked_out', locationId: null, holderId: 'user_1', checkedOutAt: t },
                { id: 'KAC-002', name: 'Kaciga (L)', category: 'Kaciga', status: 'available', locationId: 'POL-02', holderId: null, checkedOutAt: null },
                { id: 'DYT-001', name: 'Dytter #1', category: 'Dytter', status: 'available', locationId: 'STO-01', holderId: null, checkedOutAt: null },
                { id: 'VIS-001', name: 'Visinomer ručni #1', category: 'Visinomer', status: 'available', locationId: 'POL-03', holderId: null, checkedOutAt: null },
                { id: 'MOT-001', name: 'Motorola #1', category: 'Motorola (radio)', status: 'available', locationId: 'ORM-01', holderId: null, checkedOutAt: null },
                { id: 'MOT-002', name: 'Motorola #2', category: 'Motorola (radio)', status: 'checked_out', locationId: null, holderId: 'user_2', checkedOutAt: t }
            ],
            log: []
        };
    }

    // ---------- Pomoćne ----------
    const fail = (error, status) => ({ ok: false, error, status: status || 400 });
    const good = data => ({ ok: true, data: data === undefined ? {} : data });
    const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
    const catPrefix = (db, name) => { const c = db.categories.find(x => x.name === name); return c ? c.prefix : 'OST'; };
    const validCategory = (db, name) => db.categories.some(c => c.name === name);
    function makePrefix(db, name) {
        let base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
        if (base.length < 2) base = (base + 'XXX').slice(0, 3);
        let p = base, i = 1;
        while (db.categories.some(c => c.prefix === p)) { p = base.slice(0, 2) + i; i++; }
        return p;
    }
    // Starije baze nemaju listu vrsta opreme – dopuni je
    function ensureDB(db) {
        if (!Array.isArray(db.categories)) {
            db.categories = DEFAULT_CATEGORIES.map(c => Object.assign({}, c));
            (db.gear || []).forEach(g => {
                if (g.category && !db.categories.some(c => c.name === g.category)) db.categories.push({ name: g.category, prefix: String(g.id).split('-')[0] || 'OST' });
            });
        }
        return db;
    }
    const validPin = pin => /^\d{4,8}$/.test(String(pin || ''));

    function nextGearId(db, category) {
        const prefix = catPrefix(db, category);
        let n = 1, id;
        do { id = `${prefix}-${String(n).padStart(3, '0')}`; n++; } while (db.gear.some(g => g.id === id));
        return id;
    }
    function nextLocationId(db, type) {
        const prefix = LOC_TYPES[type] || 'POL';
        let n = 1, id;
        do { id = `${prefix}-${pad(n)}`; n++; } while (db.locations.some(l => l.id === id));
        return id;
    }
    function memberName(db, id) { const m = db.members.find(x => x.id === id); return m ? m.name : 'Nepoznat član'; }
    function pubMember(m) { return { id: m.id, name: m.name, badge: m.badge, role: m.role }; }
    function addLog(db, user, action, gear, detail) {
        db.log.unshift({ t: nowStr(), userId: user ? user.id : null, userName: user ? user.name : '—', action, gearId: gear ? gear.id : '', gearName: gear ? gear.name : '', detail: detail || '' });
        if (db.log.length > 500) db.log.length = 500;
    }

    // Prikaz stanja prilagođen korisniku (tuđa zaduženja su anonimna za članove)
    function viewFor(db, user) {
        const isAdmin = user.role === 'admin';
        const gear = db.gear.map(g => {
            const mine = g.holderId === user.id;
            const o = { id: g.id, name: g.name, category: g.category, status: g.status, locationId: g.locationId, holderId: null, holderName: null, checkedOutAt: null, mine, heldByOther: false };
            if (g.status === 'checked_out') {
                if (mine || isAdmin) { o.holderId = g.holderId; o.holderName = memberName(db, g.holderId); o.checkedOutAt = g.checkedOutAt; }
                else o.heldByOther = true;
            }
            return o;
        });
        const out = { user: pubMember(user), gear, locations: db.locations.slice(), categories: db.categories.slice(), locTypes: LOC_TYPE_LABELS, serverTime: nowStr() };
        if (isAdmin) { out.log = db.log.slice(0, 300); out.members = db.members.map(pubMember); }
        return out;
    }

    /* dispatch(db, session, method, p, hooks)
       hooks: { hashPin(pin) -> {salt, hash}, verifyPin(member, pin) -> bool, allowReset }
       vraća { ok, data } ili { ok:false, error, status }; menja db u mestu (pozivalac čuva). */
    function dispatch(db, session, method, p, hooks) {
        p = p || {};
        ensureDB(db);
        const user = session && session.userId ? db.members.find(m => m.id === session.userId) : null;
        const needUser = () => (user ? null : fail('Prijavi se ponovo.', 401));
        const needAdmin = () => (!user ? fail('Prijavi se ponovo.', 401) : user.role !== 'admin' ? fail('Samo administrator može ovo.', 403) : null);
        let e;

        switch (method) {
            case 'members':
                return good(db.members.map(pubMember));

            case 'login': {
                const m = db.members.find(x => x.id === p.memberId);
                if (!m || !hooks.verifyPin(m, String(p.pin || ''))) return fail('Pogrešan PIN.', 401);
                return Object.assign(good({ user: pubMember(m) }), { userId: m.id });
            }

            case 'state':
                if ((e = needUser())) return e;
                return good(viewFor(db, user));

            case 'checkout': {
                if ((e = needUser())) return e;
                const g = db.gear.find(x => x.id === p.gearId);
                if (!g) return fail('Oprema ne postoji.', 404);
                if (g.status !== 'available') return fail(g.holderId === user.id ? 'Ovu opremu već imaš zaduženu.' : 'Oprema je već zadužena.', 409);
                const from = db.locations.find(l => l.id === g.locationId);
                g.status = 'checked_out'; g.holderId = user.id; g.locationId = null; g.checkedOutAt = nowStr();
                addLog(db, user, 'Zaduženo', g, from ? 'sa: ' + from.name : '');
                return good();
            }

            case 'return': {
                if ((e = needUser())) return e;
                const g = db.gear.find(x => x.id === p.gearId);
                if (!g) return fail('Oprema ne postoji.', 404);
                if (g.status !== 'checked_out') return fail('Oprema je već u magacinu.', 409);
                if (g.holderId !== user.id && user.role !== 'admin') return fail('Ovu opremu je zadužio drugi član.', 403);
                const loc = db.locations.find(l => l.id === p.locationId);
                if (!loc) return fail('Izaberi policu ili sto.', 400);
                const holder = memberName(db, g.holderId);
                g.status = 'available'; g.locationId = loc.id; g.holderId = null; g.checkedOutAt = null;
                addLog(db, user, 'Razduženo', g, loc.name + (holder !== user.name ? ' (od: ' + holder + ')' : ''));
                return good();
            }

            case 'changePin': {
                if ((e = needUser())) return e;
                if (!hooks.verifyPin(user, String(p.oldPin || ''))) return fail('Stari PIN nije tačan.', 403);
                if (!validPin(p.newPin)) return fail('Novi PIN mora imati 4–8 cifara.');
                Object.assign(user, hooks.hashPin(String(p.newPin)));
                addLog(db, user, 'Promena PIN-a', null, '');
                return good();
            }

            // ----- admin -----
            case 'addGear': {
                if ((e = needAdmin())) return e;
                const name = clean(p.name, 80);
                if (!name) return fail('Unesi naziv opreme.');
                if (!validCategory(db, p.category)) return fail('Izaberi kategoriju.');
                const loc = db.locations.find(l => l.id === p.locationId);
                if (!loc) return fail('Izaberi početnu lokaciju.');
                const g = { id: nextGearId(db, p.category), name, category: p.category, status: 'available', locationId: loc.id, holderId: null, checkedOutAt: null };
                db.gear.push(g);
                addLog(db, user, 'Dodata oprema', g, loc.name);
                return good({ id: g.id });
            }
            case 'updateGear': {
                if ((e = needAdmin())) return e;
                const g = db.gear.find(x => x.id === p.id);
                if (!g) return fail('Oprema ne postoji.', 404);
                const name = clean(p.name, 80);
                if (!name) return fail('Unesi naziv opreme.');
                if (!validCategory(db, p.category)) return fail('Izaberi kategoriju.');
                g.name = name; g.category = p.category;
                addLog(db, user, 'Izmenjena oprema', g, '');
                return good();
            }
            case 'deleteGear': {
                if ((e = needAdmin())) return e;
                const i = db.gear.findIndex(x => x.id === p.id);
                if (i < 0) return fail('Oprema ne postoji.', 404);
                if (db.gear[i].status !== 'available') return fail('Prvo razduži opremu pa je obriši.', 409);
                addLog(db, user, 'Obrisana oprema', db.gear[i], '');
                db.gear.splice(i, 1);
                return good();
            }
            case 'addCategory': {
                if ((e = needAdmin())) return e;
                const name = clean(p.name, 40);
                if (!name) return fail('Unesi naziv vrste opreme.');
                if (db.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return fail('Ta vrsta opreme već postoji.', 409);
                const c = { name, prefix: makePrefix(db, name) };
                db.categories.push(c);
                addLog(db, user, 'Nova vrsta opreme', null, name + ' [' + c.prefix + ']');
                return good({ name });
            }
            case 'deleteCategory': {
                if ((e = needAdmin())) return e;
                const i = db.categories.findIndex(c => c.name === p.name);
                if (i < 0) return fail('Vrsta ne postoji.', 404);
                if (db.gear.some(g => g.category === p.name)) return fail('Postoji oprema te vrste – prvo je obriši ili prebaci u drugu vrstu.', 409);
                addLog(db, user, 'Obrisana vrsta opreme', null, p.name);
                db.categories.splice(i, 1);
                return good();
            }
            case 'addLocation': {
                if ((e = needAdmin())) return e;
                const name = clean(p.name, 60);
                if (!name) return fail('Unesi naziv lokacije.');
                const type = LOC_TYPES[p.type] ? p.type : 'shelf';
                const l = { id: nextLocationId(db, type), name, type };
                db.locations.push(l);
                addLog(db, user, 'Nova lokacija', null, name + ' [' + l.id + ']');
                return good({ id: l.id });
            }
            case 'deleteLocation': {
                if ((e = needAdmin())) return e;
                const i = db.locations.findIndex(x => x.id === p.id);
                if (i < 0) return fail('Lokacija ne postoji.', 404);
                if (db.gear.some(g => g.locationId === p.id)) return fail('Na toj lokaciji ima opreme – prvo je premesti.', 409);
                if (db.locations.length <= 1) return fail('Mora ostati bar jedna lokacija.', 409);
                addLog(db, user, 'Obrisana lokacija', null, db.locations[i].name);
                db.locations.splice(i, 1);
                return good();
            }
            case 'addMember': {
                if ((e = needAdmin())) return e;
                const name = clean(p.name, 60);
                if (!name) return fail('Unesi ime i prezime.');
                if (!validPin(p.pin)) return fail('PIN mora imati 4–8 cifara.');
                const role = p.role === 'admin' ? 'admin' : 'parachutist';
                let n = 1, id;
                do { id = 'user_' + (Date.now().toString(36) + n); n++; } while (db.members.some(m => m.id === id));
                const m = Object.assign({ id, name, badge: clean(p.badge, 30) || (role === 'admin' ? 'Admin' : 'Član'), role }, hooks.hashPin(String(p.pin)));
                db.members.push(m);
                addLog(db, user, 'Novi član', null, name);
                return good({ id });
            }
            case 'updateMember': {
                if ((e = needAdmin())) return e;
                const m = db.members.find(x => x.id === p.id);
                if (!m) return fail('Član ne postoji.', 404);
                if (p.name !== undefined) { const n = clean(p.name, 60); if (!n) return fail('Unesi ime.'); m.name = n; }
                if (p.badge !== undefined) m.badge = clean(p.badge, 30);
                if (p.role !== undefined) {
                    const role = p.role === 'admin' ? 'admin' : 'parachutist';
                    if (m.role === 'admin' && role !== 'admin' && db.members.filter(x => x.role === 'admin').length <= 1) return fail('Mora ostati bar jedan administrator.', 409);
                    m.role = role;
                }
                if (p.pin) { if (!validPin(p.pin)) return fail('PIN mora imati 4–8 cifara.'); Object.assign(m, hooks.hashPin(String(p.pin))); delete m.pin; }
                addLog(db, user, 'Izmenjen član', null, m.name);
                return good();
            }
            case 'deleteMember': {
                if ((e = needAdmin())) return e;
                const i = db.members.findIndex(x => x.id === p.id);
                if (i < 0) return fail('Član ne postoji.', 404);
                if (p.id === user.id) return fail('Ne možeš obrisati sebe.', 409);
                if (db.gear.some(g => g.holderId === p.id)) return fail('Taj član ima zaduženu opremu.', 409);
                addLog(db, user, 'Obrisan član', null, db.members[i].name);
                db.members.splice(i, 1);
                return good();
            }
            case 'resetDemo': {
                if ((e = needAdmin())) return e;
                if (!hooks.allowReset) return fail('Nije dozvoljeno.', 403);
                const fresh = defaultDB();
                db.members = fresh.members.map(m => Object.assign({ id: m.id, name: m.name, badge: m.badge, role: m.role }, hooks.hashPin(m.pin)));
                db.categories = fresh.categories; db.locations = fresh.locations; db.gear = fresh.gear; db.log = [];
                return good();
            }
        }
        return fail('Nepoznata radnja.', 404);
    }

    const READ_ONLY = { members: 1, state: 1, login: 1 };

    return { QR_PREFIX, DEFAULT_CATEGORIES, ensureDB, LOC_TYPES, LOC_TYPE_LABELS, defaultDB, dispatch, viewFor, nowStr, READ_ONLY, validPin };
});
