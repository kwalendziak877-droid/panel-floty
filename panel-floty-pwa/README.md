# Panel Floty – wersja instalowana na telefonie

Gotowa aplikacja PWA dla jednej osoby. Przechowuje ciągniki i naczepy, pilnuje przeglądu, tachografu, OC i AC oraz wysyła automatyczne powiadomienia push i e-mail z Gmaila.

Podgląd bez serwera: otwórz plik `public/index.html`. W tym trybie dane zostają tylko w przeglądarce, a wysyłka przypomnień jest wyłączona.

## Koszt

Przy jednej firmie i typowej liczbie pojazdów aplikacja mieści się w darmowych limitach Cloudflare, OneSignal oraz Google Apps Script. Zwykłych SMS-ów nie używa – zastępują je bezpłatne powiadomienia na ekranie telefonu.

## Co trzeba założyć

1. Darmowe konto Cloudflare – hosting, baza i codzienne sprawdzanie terminów.
2. Darmowe konto OneSignal – powiadomienia push.
3. Zwykłe darmowe konto Google/Gmail – wysyłka e-maili.

## Uruchomienie

### 1. OneSignal

1. Utwórz aplikację typu Web Push i ustaw adres strony Cloudflare (po pierwszym wdrożeniu można go uzupełnić).
2. Skopiuj `App ID` i `REST API Key`.
3. W sekcji Web Push wybierz typową stronę HTTPS i plik workera `OneSignalSDKWorker.js`.

### 2. Gmail przez Google Apps Script

1. Otwórz [script.google.com](https://script.google.com), utwórz nowy projekt i nazwij go `Panel Floty Mail`.
2. Zawartość pliku `google-apps-script/Code.gs` wklej do edytora.
3. W ustawieniach projektu dodaj właściwość skryptu `WEBHOOK_SECRET` i wpisz długi, losowy ciąg minimum 32 znaków.
4. Wybierz **Wdróż → Nowe wdrożenie → Aplikacja internetowa**.
5. Ustaw **Wykonuj jako: Ja** oraz dostęp **Każdy**, zaakceptuj uprawnienie do wysyłki e-maili i skopiuj adres kończący się `/exec`.

### 3. Cloudflare

W katalogu projektu wykonaj:

```bash
npm install
npx wrangler login
npx wrangler d1 create panel-floty
```

Id utworzonej bazy wklej do `wrangler.toml` jako `database_id`, a następnie:

```bash
npm run db:remote
npx wrangler secret put APP_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ONESIGNAL_REST_API_KEY
npx wrangler secret put EMAIL_WEBHOOK_URL
npx wrangler secret put EMAIL_WEBHOOK_SECRET
npm run deploy
```

- `APP_PASSWORD` – Twoje hasło do aplikacji.
- `SESSION_SECRET` – długi losowy ciąg znaków, np. minimum 32 znaki.
- `ONESIGNAL_REST_API_KEY` – klucz skopiowany z OneSignal.
- `EMAIL_WEBHOOK_URL` – adres wdrożenia Google Apps Script kończący się `/exec`.
- `EMAIL_WEBHOOK_SECRET` – dokładnie ten sam losowy ciąg, który zapisano we właściwościach skryptu Google.

Po wdrożeniu wpisz w `wrangler.toml`:

- `ONESIGNAL_APP_ID` – App ID z OneSignal,
- `APP_URL` – pełny adres aplikacji kończący się `.workers.dev`,

i ponownie wykonaj `npm run deploy`.

### 4. Instalacja na iPhonie

1. Otwórz adres aplikacji w Safari.
2. Wybierz **Udostępnij → Do ekranu początkowego → Dodaj**.
3. Uruchom ikonę **Flota**, otwórz Ustawienia i wybierz **Włącz powiadomienia na tym telefonie**.
4. Wpisz adres e-mail i zapisz ustawienia.

Codziennie około 8:00 czasu polskiego serwer sprawdza terminy. Domyślne przypomnienia są wysyłane 30, 14 i 7 dni wcześniej oraz w dniu terminu.
