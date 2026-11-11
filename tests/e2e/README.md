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

## Non verificato

- **Chrome 120** (`minimum_chrome_version`): non eseguito, nessuna build 120 disponibile in questo ambiente. Va caricato a mano (voce M0 della checklist manuale).
- **Google Chrome stabile installato**: non eseguito, nessuna installazione di Chrome trovata nell'ambiente. Voce M0 della checklist manuale.
- **`--load-extension` in Google Chrome «branded»:** è segnalato che le build recenti di Google Chrome ignorano questo flag. Per questo gli E2E usano il Chromium di Playwright, non Chrome stabile. `needs current-doc verification`.
- **Gesto utente sull'icona della toolbar in Google Chrome stabile:** l'automazione sotto è verificata solo nel Chromium di Playwright. In Chrome stabile il gesto si verifica a mano (M1, M20 della checklist).
- **Ascolto:** che l'audio si senta una volta sola, senza distorsioni, e la latenza aggiunta dal pass-through. Lo dice solo una persona (M1, M3, M20, M21).
