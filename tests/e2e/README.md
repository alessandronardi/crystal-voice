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
| 2026-11-09 | stesso | headless (`channel: 'chromium'`, VC_E2E_HEADLESS=1) | 2/2 superati |

Limite noto: in I-01 `offscreen.html` non contiene ancora script (il modulo vuoto viene eliminato in build), quindi «senza errori» su quella pagina prova solo che il file esiste e si carica.

**Headless: verificato** per il caricamento dell'estensione e la messaggistica con il canale `chromium` di Playwright 1.64.0 su Windows. Non verificato su Linux; la CI esegue gli E2E sotto `xvfb-run` con finestra, per non dipendere dall'headless.

## Non verificato

- **Chrome 120** (`minimum_chrome_version`): non eseguito, nessuna build 120 disponibile in questo ambiente. Va caricato a mano (voce M0 della checklist manuale).
- **Google Chrome stabile installato**: non eseguito, nessuna installazione di Chrome trovata nell'ambiente. Voce M0 della checklist manuale.
- **`--load-extension` in Google Chrome «branded»:** è segnalato che le build recenti di Google Chrome ignorano questo flag. Per questo gli E2E usano il Chromium di Playwright, non Chrome stabile. `needs current-doc verification`.
- **Gesto utente sull'icona della toolbar** (necessario per `tabCapture`): da verificare in I-02. Il click su `chrome.action` non è raggiungibile dalle API di Playwright, che vedono solo le pagine.
