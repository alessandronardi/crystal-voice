# Test E2E dell'estensione

I test in questa cartella caricano il bundle reale (`dist/extension/`) in Chromium tramite Playwright. Quello che non si può automatizzare sta in [`MANUAL_CHECKLIST.md`](MANUAL_CHECKLIST.md).

## Come si eseguono

```bash
pnpm build
pnpm test:e2e                     # con finestra
VC_E2E_HEADLESS=1 pnpm test:e2e   # senza finestra
```

Il browser è il Chromium distribuito con `@playwright/test` (versione fissata in `package.json`). Se manca: `pnpm exec playwright install chromium`.

## Come si carica l'estensione

Le estensioni in Playwright richiedono un **contesto persistente** con una directory profilo temporanea:

```ts
chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless,
  args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
});
```

- L'ID dell'estensione si ricava dall'URL del service worker (`context.serviceWorkers()` o l'evento `serviceworker`).
- Le pagine dell'estensione si aprono come `chrome-extension://<id>/sidepanel.html` e da lì possono chiamare `chrome.runtime.sendMessage`.
- Il service worker risponde al messaggio diagnostico `PING` con `PONG` (`packages/contracts/src/diagnostic.ts`). Il messaggio non fa parte di `CaptureMessage` e non trasporta dati di sessione.

## Esiti verificati

| Data | Ambiente | Modalità | Esito |
|---|---|---|---|
| 2026-11-09 | Windows 11 Home 10.0.26300, Node 24.4.1, `@playwright/test` 1.64.0, Chromium 156.0.8078.4 (revisione Playwright 1248) | con finestra | 2/2 superati: estensione caricata, `PONG` ricevuto, quattro pagine senza errori in console |
| 2026-11-09 | stesso, dopo ADR-0015 | con finestra | 3/3 superati: in più, `fetch` verso un URL esterno rifiutato dalla CSP (`connect-src`) da Side Panel e service worker; richiesta alla propria origine consentita |
| 2026-11-09 | stesso, dopo ADR-0015 | headless (`channel: 'chromium'`, VC_E2E_HEADLESS=1) | 3/3 superati |

Limite noto: in I-01 `offscreen.html` non contiene ancora script (il modulo vuoto viene eliminato in build), quindi «senza errori» su quella pagina prova solo che il file esiste e si carica.

**Headless: verificato** per il caricamento dell'estensione e la messaggistica con il canale `chromium` di Playwright 1.64.0 su Windows. Non verificato su Linux; la CI esegue gli E2E sotto `xvfb-run` con finestra, per non dipendere dall'headless.

## Gesto sull'icona della toolbar (I-02)

**Esito: automatizzabile nel Chromium di Playwright, senza flag aggiuntivi.** Verificato il 2026-11-10 su Windows 11 Home 10.0.26300, Node 26.13.0, `@playwright/test` 1.64.0 e Chromium 156 di Playwright, sia con finestra sia headless.

Il click su `chrome.action` non è raggiungibile dalle API di Playwright. Lo è però dal comando CDP `Extensions.triggerAction({ id, targetId })` («Runs an extension default action», nelle definizioni CDP di `playwright-core` 1.64.0). Va mandato a una sessione CDP del **browser** (`context.browser().newBrowserCDPSession()`). Il `targetId` deve essere quello del target di tipo **`tab`**, non della pagina:

- su un target `page`, la risposta è `Action can only be triggered on a tab target`;
- da una sessione CDP di pagina, `Method not allowed`;
- `Target.getTargets` restituisce i target `tab` solo se li si chiede con `filter: [{ type: 'tab' }]`.

Su un target `tab` Chromium tratta il comando come il click: `action.onClicked` arriva, `sidePanel.open()` apre il pannello e `tabCapture.getMediaStreamId` concede lo stream (gesto e `activeTab` validi). Non sono serviti `--enable-unsafe-extension-debugging` né `--remote-debugging-port`.

Il pannello laterale non compare fra le pagine di Playwright. Il test ci entra con `Target.attachToTarget` (`flatten: false`) e `Target.sendMessageToTarget`.

Cosa **non** prova: il click di una persona in Google Chrome stabile, perché il comando è un'interfaccia di automazione; e se nel tempo Chrome cambierà la semantica di gesto per questo comando (`needs current-doc verification` a ogni aggiornamento di Playwright).

`tab-capture.spec.ts` usa una finta pagina `https://www.youtube.com/watch?v=vc-e2e-tone` servita da `context.route()`: nessuna rete, tono WebAudio sintetico (R16) avviato da un click nella pagina, come un player. Nessun flag di autoplay: l'`AudioContext` dell'offscreen parte senza un gesto proprio (i campioni contati lo provano: un contesto sospeso non ne conta). La «pausa» è il tono a guadagno 0, non un `<video>` in pausa.

| Data | Ambiente | Modalità | Esito |
|---|---|---|---|
| 2026-11-10 | come sopra, con `--autoplay-policy=no-user-gesture-required` (poi tolto) | con finestra e headless | 5/5 superati. In `tab-capture.spec.ts`: pagina non `/watch` → `NOT_YOUTUBE_WATCH`, nessun offscreen; avvio dalla toolbar → `running`; campioni contati a circa la frequenza (48.000 Hz, 42.112 campioni/s misurati su 4 s con report ogni 0,5 s); secondo click → `CAPTURE_BUSY`, un solo offscreen; 60 s di silenzio con offscreen vivo (`chrome.runtime.getContexts`) e campioni ancora in crescita; stop dal pulsante del pannello → `stopped`, offscreen chiuso; nuovo avvio e nuovo stop. Stime del browser: `baseLatency` 10 ms, `outputLatency` 40 ms (non sono una misura con loopback) |
| 2026-11-10 | come sopra, dopo la revisione avversariale, **senza flag di autoplay** | con finestra e headless | 6/6 superati. Stessi esiti, più: offscreen chiuso dall'esterno durante la cattura → il pannello mostra «Nessun aggiornamento dalla cattura» entro 10 s, e un nuovo avvio funziona. Tolleranza sul ritmo dei campioni: tra 0,6 e 1,4 volte la frequenza su 4 s (granularità dei report 0,5 s); sui 60 s di pausa almeno 50 s di campioni, cioè ≥ 83% |
| 2026-11-10 | come sopra | con finestra | **Controprova** con il bundle modificato a mano perché crei l'offscreen con il solo motivo `AUDIO_PLAYBACK`: il test fallisce, con 0 offscreen dopo 60 s di silenzio invece di 1. Chrome chiude il documento, cioè VC-03 si riproduce e il test se ne accorge. Bundle ricostruito subito dopo |

## Ciclo di vita e watchdog (I-03)

File: `harness.ts` (helper comuni), `tab-capture.spec.ts`, `lifecycle.spec.ts`, `cycles.spec.ts`.

**Come sono costruiti i test:**
- **Pagine sintetiche** servite da `context.route()`, senza rete:
  - `/watch*`: un `<video>` standard che riproduce un tono WAV a 8 kHz generato nella pagina (R16), avviato con un click;
  - `/`: una «home» che diventa una pagina video con `pushState`, come la navigazione SPA di YouTube (ADR-0021).
  - I comandi `window.vc.*` agiscono sul player come farebbe una persona: pausa, velocità, seek, cambio di sorgente.
- **Pagina sonda:** i diagnostici li registra una pagina dell'estensione aperta in una scheda (`collection.html`), non il service worker. Così sopravvivono al riavvio del worker (S8).
- **Pannello laterale:** ogni scheda aperta con `sidePanel.open({ tabId })` ha il suo documento, e Chrome lo elenca due volte, come target `page` e come target `tab`. Gli helper valutano le espressioni in tutti i documenti di tipo `page`.
- **S8:** il worker si termina con `ServiceWorker.stopAllWorkers` da una sessione CDP della pagina sonda, che ha la stessa origine. Un marcatore nello scope globale prova che il worker successivo è un'istanza nuova. `Target.closeTarget` sul worker risponde senza errori ma non lo termina.

**Scenari automatizzati, in Chromium 156 di Playwright, Windows 11:**

| Scenario | Esito atteso |
|---|---|
| Senza sessione | Il content script non invia messaggi (3 s osservati) |
| S2, pausa di 60 s | `PAUSED`, offscreen vivo, tempo di ascolto fermo; alla ripresa `LISTENING` |
| S3, navigazione verso un altro sito | `INTERRUPTED / NAVIGATED_AWAY`. Con il solo watchdog: 2,6–2,8 s (tre misure). Con il segnale `tabs.onUpdated` (`status: 'loading'` senza URL leggibile): 77–143 ms (tredici misure, con finestra e headless) |
| S7, velocità 1,5× | `PLAYBACK_RATE_CHANGED` |
| Seek | `VIDEO_SEEK` |
| S6 sintetico (cambio di `src`) | `AD_OR_SOURCE_CHANGE`. Gli annunci veri restano manuali (M8) |
| Altro video nella stessa pagina (`pushState`) | `VIDEO_CHANGED` |
| Navigazione SPA dalla home a `/watch`, poi avvio | Cattura viva per 5 s |
| Chiusura della scheda | Fine della sessione e risorse rilasciate. Senza attesa l'uscita era `ERROR / STREAM_ENDED`, perché la traccia termina prima che arrivi `tabs.onRemoved`; con 500 ms di attesa dopo la fine della traccia è `INTERRUPTED / NAVIGATED_AWAY` (una corsa headless). Il test accetta entrambe |
| Due schede | La seconda riceve `CAPTURE_BUSY`; «Interrompi la cattura in corso» ferma la prima; poi la seconda parte |
| S8, service worker terminato | La cattura prosegue; lo stop risveglia il worker e funziona; anche il nuovo avvio con il worker appena svegliato funziona |
| 45 s di ascolto | `INSUFFICIENT_DATA / WALL_TIMEOUT` (manca il rilevatore di voce) |
| Pausa fino a 120 s | `INSUFFICIENT_DATA / ABSOLUTE_TIMEOUT` |
| 100 cicli avvio/stop | Ogni ciclo torna a `IDLE`, nessun offscreen, routing pulito. Memoria: vedi `docs/BENCHMARK_PROTOCOL.md` §7 |

| Data | Ambiente | Modalità | Esito |
|---|---|---|---|
| 2026-11-11 | Windows 11 Home 10.0.26300, Node 26.13.0, `@playwright/test` 1.64.0, Chromium 156 | con finestra | 20/20 superati (6,7 min), prima del segnale `status: 'loading'` |
| 2026-11-11 | idem, dopo la revisione | con finestra | 20/20 (6,3 min); S3 132 ms; memoria +8,2 MB |
| 2026-11-11 | idem | headless | **19/20**: in `tab-capture.spec.ts` l'offerta «Interrompi la cattura in corso» spariva prima del controllo. Difetto vero del pannello (la diagnostica della sessione attiva cancellava l'errore del click), corretto; aggiunta la regressione; memoria +14,1 MB |
| 2026-11-11 | idem, codice finale | con finestra | 20/20 (6,4 min); S3 143 ms; memoria +13,0 MB |
| 2026-11-11 | idem, codice finale | headless | 20/20 (6,1 min); S3 109 ms; memoria +16,7 MB; chiusura della scheda `INTERRUPTED / NAVIGATED_AWAY` |
| 2026-11-11 | CI `ubuntu-latest`, Chromium di Playwright 1.64.0, PR crystal-voice#10 (`4879972`), metodo finale della memoria, 300 cicli | con finestra sotto `xvfb-run`, corsa 1 | 20/20; S3 nell'intervallo 61–68 ms delle due corse; persistenti +7,3 MB; chiusura della scheda `INTERRUPTED / NAVIGATED_AWAY` |
| 2026-11-11 | idem | con finestra sotto `xvfb-run`, corsa 2 | 20/20; S3 nell'intervallo 61–68 ms delle due corse; persistenti +6,5 MB; chiusura della scheda `INTERRUPTED / NAVIGATED_AWAY` |

**`tabs.onUpdated` senza permesso `tabs`, misurato in Chromium 156:** con `pushState` dentro YouTube arriva `status: 'loading'` *con* il nuovo URL, che è leggibile tramite l'host del content script; con una navigazione verso un altro host arriva `status: 'loading'` senza URL. Il service worker ferma subito la sessione per un URL leggibile fuori da `/watch` e per un `loading` senza URL. Un URL `/watch` lo lascia al watchdog, che riconosce `VIDEO_CHANGED`. La prima versione fermava ogni `loading`, e in headless il test `VIDEO_CHANGED` falliva con `NAVIGATED_AWAY`.

**Cosa non provano:** un vero annuncio di YouTube; la pagina reale di YouTube, dove il `<video>` principale si sceglie come il più grande fra quelli visibili (non provato con anteprime al passaggio del mouse o con il miniplayer); Google Chrome stabile e Chrome 120. Linux: solo in CI, con finestra sotto `xvfb-run` (righe sopra); headless su Linux non eseguito.

## Microfono (I-17, `mic.spec.ts`)

Lancio dedicato con `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=tests/fixtures/voice-a.wav`, fixture sintetica generata da script (R16). **Senza** `--use-fake-ui-for-media-stream`: concederebbe anche la richiesta dell'offscreen e nasconderebbe la domanda di I-17. Il consenso dato in `permission.html` è simulato con il comando CDP `Browser.grantPermissions` (`audioCapture`) sull'origine `chrome-extension://<id>`; il prompt vero e l'indicatore di registrazione sono manuali (M13, M13b, M13c, M14).

| Scenario | Esito atteso |
|---|---|
| Senza permesso, «Usa il microfono» nel pannello | Messaggio `MIC_PERMISSION_REQUIRED`, pulsante che apre `permission.html` in una scheda, nessun offscreen |
| Senza permesso, avvio forzato dalla pagina sonda | `ERROR / MIC_PERMISSION_REQUIRED` in 20–31 ms, senza attendere il timeout di 10 s. Il pannello legge lo stato `prompt`; l'offscreen non riporta il proprio, quindi non si distingue se il rifiuto viene dal controllo del permesso o da `getUserMedia` |
| Con permesso | `LISTENING`, campioni del dispositivo finto in crescita; `activeSession` = `{ sessionId, source: 'mic' }` senza `tabId`; la sessione oltrepassa i 3 s di aggancio, quindi la porta del pannello la tiene viva; «Interrompi» → `INTERRUPTED / USER_STOP` |
| Pannello chiuso (CDP `Target.closeTarget`) | `INTERRUPTED / USER_STOP` entro 1 s, offscreen chiuso, routing pulito |
| Permesso negato (CDP `Browser.setPermission`, `microphone: denied`) | `permission.html` mostra «Il microfono non è autorizzato…» |
| Una cattura fra le sorgenti | Scheda in corso → avvio mic `CAPTURE_BUSY`; mic in corso → click sulla toolbar `CAPTURE_BUSY`; «Interrompi la cattura in corso» ferma la prima in entrambi i casi |
| S8 col microfono | Worker terminato: la cattura prosegue, lo stop e un nuovo avvio funzionano |
| Doppio click su «Usa il microfono» | Una sola sessione, viva oltre i 3 s di aggancio, `lastStart` senza errore |
| Offscreen chiuso senza messaggio finale | «Usa il microfono» torna disponibile e il nuovo avvio parte |
| 45 s | `INSUFFICIENT_DATA / WALL_TIMEOUT` |
| `permission-page.spec.ts`, lancio a parte con `--use-fake-ui-for-media-stream` | Il pulsante porta a «concesso» e tutte le tracce ottenute risultano `ended`. Prova solo la pagina: con l'interfaccia finta il permesso risulta già concesso al caricamento |

| Data | Ambiente | Modalità | Esito |
|---|---|---|---|
| 2026-11-11 | Windows 11 Home 10.0.26300, Node 26.13.0, `@playwright/test` 1.64.0, Chromium 156; branch `issue/I-17-mic-source`, non committato | con finestra | 3/3; senza permesso rifiuto in 31 ms; 48 kHz, 36.051 campioni/s misurati sull'arrivo dei diagnostici (finestra di 4 s, diagnostici ogni 0,5 s); pannello chiuso → fine in 384 ms |
| 2026-11-11 | idem | headless | 3/3; rifiuto in 20 ms; 48 kHz, 42.091 campioni/s; pannello chiuso → fine in 375 ms |
| 2026-11-11 | idem, fase B prima della revisione | con finestra | `mic.spec.ts` 6/6 e `permission-page.spec.ts` 1/1; rifiuto in 19 ms; pannello chiuso → fine in 383 ms. Suite intera 27/27 con finestra e 27/27 headless |
| 2026-11-11 | idem, codice finale dopo la revisione | con finestra | Suite intera **29/29** (6,9 min): `mic.spec.ts` 8/8, `permission-page.spec.ts` 1/1; S3 111 ms; 100 cicli della scheda +8,3 MB |
| 2026-11-11 | idem, codice finale dopo la revisione | headless | Suite intera **29/29** (6,7 min); S3 97 ms; 100 cicli della scheda +13,3 MB |

**Cosa non provano:** che il prompt vero di `permission.html` lasci all'offscreen un permesso utilizzabile (M13, punto chiave: riportato superato in Brave dal product owner), il permesso «solo questa volta» (M13b), l'indicatore di registrazione, la revoca o lo scollegamento durante l'ascolto (M14c), un microfono reale, l'assenza di pass-through (solo all'ascolto), Google Chrome. Il conteggio dei campioni sotto i 48.000/s viene dalla misura sull'arrivo dei messaggi, non da una verifica del flusso: non è stato indagato oltre.

## Non verificato

- **Chrome 120** (`minimum_chrome_version`): non eseguito, nessuna build 120 disponibile in questo ambiente. Va caricato a mano (voce M0 della checklist manuale).
- **Google Chrome stabile installato**: non eseguito, nessuna installazione di Chrome trovata nell'ambiente. Voce M0 della checklist manuale.
- **`--load-extension` in Google Chrome «branded»:** è segnalato che le build recenti di Google Chrome ignorano questo flag. Per questo gli E2E usano il Chromium di Playwright, non Chrome stabile. `needs current-doc verification`.
- **Gesto utente sull'icona della toolbar in Google Chrome stabile:** l'automazione sotto è verificata solo nel Chromium di Playwright. In Chrome stabile il gesto si verifica a mano (M1, M20 della checklist).
- **Ascolto:** che l'audio si senta una volta sola, senza distorsioni, e la latenza aggiunta dal pass-through. Lo dice solo una persona (M1, M3, M20, M21).
