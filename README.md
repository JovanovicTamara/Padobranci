# Tandem Skokovi Novi Sad – sajt + magacin opreme

Sve radi lokalno (bez interneta): fontovi, ikone i QR biblioteke su u folderu.

## Šta je u folderu
- `index.html` – javni sajt (telefon, cene i radno vreme menjaš u `js/config.js`)
- `magacin.html` – portal za članove (prijava PIN-om, QR skener, zaduživanje/razduživanje, admin)
- `server.js` – mali server za zajednički magacin (treba samo Node.js, bez dodatnih paketa)
- `data/` – pravi se sam; ovde je baza (`db.json`). Pravi backup ovog fajla!

## Pokretanje (zajednički magacin za sve telefone)
1. Instaliraj Node.js (nodejs.org, verzija 16 ili novija).
2. U folderu pokreni: `node server.js`
3. Otvori `http://localhost:8080` (sajt) ili `http://localhost:8080/magacin.html`.
4. Telefoni na istom Wi-Fi-ju otvaraju adresu koju server ispiše (npr. `http://192.168.1.20:8080/magacin.html`).

Probni PIN-ovi: Administrator `0000`, Marko `1111`, Ana `2222`.
**Odmah ih promeni:** Admin → Članovi (obriši probne članove, dodaj prave).

## Samo pogledaj bez servera
Dvoklik na `index.html` ili `magacin.html` radi. Portal tada radi u DEMO režimu
(podaci samo u tom pregledaču, nema deljenja između telefona).

## Kamera na telefonu traži HTTPS
Pregledači dozvoljavaju kameru samo na `https://` (ili `localhost`). Opcije:
- **Hosting / domen sa HTTPS** (najbolje): postavi ceo folder i `node server.js` na server/VPS iza Nginx/Caddy ili na Render/Railway/Fly – dobijaš HTTPS automatski.
- **Lokalno sa sopstvenim sertifikatom:** u `data/` napravi `cert.pem` i `key.pem`:
  `openssl req -x509 -newkey rsa:2048 -nodes -keyout data/key.pem -out data/cert.pem -days 825 -subj "/CN=magacin"`
  Restartuj server; otvori `https://IP:8080/magacin.html` na telefonu i prihvati upozorenje (jednom).
- Dok to ne podesiš, **ručni unos koda** (GLV-001…) uvek radi, kao i izbor sa liste.

## QR nalepnice
Admin → QR → „Štampaj sve nalepnice“ (ili QR pojedinačno, štampa/PNG). Zalepi na opremu i police.
Sadržaj koda je `TANDEM_NS_WMS_<ID>`.

## Ako menjaš dizajn (nije obavezno)
CSS je već izgrađen (`css/styles.css`). Ako menjaš Tailwind klase u HTML/JS:
`npm install` pa `npm run build:css`.
