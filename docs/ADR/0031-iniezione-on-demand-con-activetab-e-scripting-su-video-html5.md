# ADR-0031: Iniezione on-demand con `activeTab` e `scripting` su qualsiasi `<video>` HTML5 al posto del content script statico su `youtube.com` (G0-TECH-03)

- **Stato:** Accettato (2026-11-17, dal product owner; chiusura prescrizione G0-TECH-03 in I-16)
- **Data:** 2026-11-17
- **Decisori:** product owner

## Contesto

- **Il vincolo legale e di Store (`G0-TECH-03`):** la valutazione legale del Gate G0 (`docs/gates/G0-valutazione-2026-11-13.md`, §3.3 quesito `4.3.1` e §4.2 `G0-TECH-03`) rileva che dichiarare staticamente `"content_scripts": [{ "matches": ["https://www.youtube.com/*"], ... }]` insieme al permesso `tabCapture` in `extension/manifest.json` espone l'estensione a un elevato rischio di rifiuto automatico o manuale sul Chrome Web Store (per sospetto *stream-ripping* mirato a YouTube e potenziale contestazione dei Termini di Servizio di terzi).
- **La prescrizione `G0-TECH-03`:** rimuovere l'host match statico `"https://www.youtube.com/*"` dai `content_scripts` di `extension/manifest.json` e sostituirlo con l'iniezione on-demand tramite `activeTab` + `scripting` sull'elemento standard `<video>` HTML5 della scheda attiva esclusivamente al clic dell'utente sull'icona dell'estensione, presentando lo strumento come analizzatore acustico locale per qualunque scheda video HTML5 senza citare il marchio YouTube.
- **Conflitto con fonti esistenti (`AGENTS.md` §2, §4 R9, §10):**
  1. **Regola R9:** aggiungere il permesso `"scripting"` a `extension/manifest.json` e rimuovere `content_scripts` richiede un ADR approvato prima di toccare il manifest e la guardia del bundle (`extension/scripts/bundle-guard.ts`).
  2. **`docs/SPEC_v0.3.md` (§§1, 2, 5, 6, 9, 13, 14) `[F]`:** limitava la sorgente «Dalla scheda» a `https://www.youtube.com/watch`, dichiarava `content_scripts` statico in `manifest.json` e prevedeva il rifiuto `NOT_YOUTUBE_WATCH` fuori da YouTube `/watch`.
  3. **`docs/ADR/0021-content-script-su-tutto-www-youtube-com.md`:** estendeva il match statico del content script a `https://www.youtube.com/*` per sopravvivere alle navigazioni SPA (`history.pushState`) verso `/watch`.
  4. **`docs/ADR/0004-watchdog-di-sessione-con-heartbeat.md`:** vincolava l'heartbeat 1 Hz del content script e il controllo nell'offscreen alle pagine `/watch` di `www.youtube.com`.

## Decisione

1. **Manifest e permessi (`extension/manifest.json`, `extension/scripts/bundle-guard.ts`):**
   - Si rimuove interamente la chiave `"content_scripts"` da `extension/manifest.json` (nessun host permission statico, nessun match `https://www.youtube.com/*`).
   - Si aggiunge `"scripting"` a `"permissions"` in `extension/manifest.json`:
     `["tabCapture", "offscreen", "sidePanel", "activeTab", "scripting", "storage"]`.
   - Nella guardia del bundle (`extension/scripts/bundle-guard.ts`), `ALLOWED_PERMISSIONS` include `'scripting'` e `ALLOWED_CONTENT_SCRIPT_MATCHES` diventa vuoto (`[]`), così qualunque `content_scripts` statico futuro fallisce la build senza ADR.
   - Lo script iniettabile viene compilato come IIFE autonomo `video-content.js` in `dist/extension/` ed elencato in `REQUIRED_OUTPUTS` di `extension/scripts/build.ts`.
2. **Iniezione on-demand e verifica `<video>` HTML5 al clic (`extension/src/background/start-capture.ts`, `extension/src/content/youtube-adapter.ts`):**
   - In `chrome.action.onClicked`, `chrome.sidePanel.open({ tabId })` resta la **prima istruzione sincrona** prima di qualunque `await` (`R6`, `ADR-0002`).
   - Dopo la registrazione di `lastStart` e la verifica `anotherSessionRuns()` (`CAPTURE_BUSY`), il service worker verifica che l'URL della scheda sia `https:` con percorso potenzialmente associato a un contenuto (`isCapturableVideoUrl`: protocollo `https:`, non radice nuda `/` priva di query, non `/watch` privo di `?v=`, non `/shorts/`) e inietta on-demand `video-content.js` nella scheda attiva tramite `chrome.scripting.executeScript({ target: { tabId }, files: ['video-content.js'] })`.
   - L'iniezione registra in modo idempotente (guardia su `globalThis` nell'isolated world, senza duplicare listener su clic successivi nella stessa scheda) il listener per `SESSION_BIND` e restituisce come valore di completamento `hasVideo()` (`document.querySelector('video') !== null`).
   - Se `executeScript` fallisce (es. pagina protetta del browser) o restituisce `false` (nessun elemento `<video>` HTML5 nella pagina), l'avvio termina subito registrando `failure: 'NOT_YOUTUBE_WATCH'` in `lastStart`, **senza** creare il documento offscreen e **senza** chiedere `tabCapture.getMediaStreamId`.
   - Se un `<video>` è presente (`true`), il service worker procede con `ensureOffscreen()`, `tabCapture.getMediaStreamId`, invio di `OFFSCREEN_START_TAB` e `chrome.tabs.sendMessage(tabId, { v: 1, type: 'SESSION_BIND', sessionId })`.
3. **Sostituzione di `ADR-0021` e navigazioni SPA:**
   - **Questo ADR sostituisce `ADR-0021`.** Poiché `chrome.scripting.executeScript` viene eseguito al momento del clic dell'utente sull'icona della toolbar, lo script è sempre presente anche quando l'utente è arrivato al video tramite navigazione SPA (`history.pushState`) o in una scheda aperta prima dell'installazione dell'estensione, senza bisogno di caricare alcuno script preventivo su tutte le pagine. Prima del clic dell'utente, nessuno script di VoiceCrystal è presente in alcuna scheda.
4. **Estensione del watchdog `ADR-0004` a qualsiasi `<video>` HTML5 (`extension/src/content/player-monitor.ts`, `youtube-adapter.ts`, `extension/src/offscreen/capture-session.ts`, `extension/src/background/routing.ts`):**
   - `videoIdOf(href)` estrae un identificativo canonico della pagina video per qualsiasi sito `https:`: se è presente il parametro query `v` (es. `/watch?v=abc`), restituisce `v`; se il percorso è `/` o `/watch` senza `v`, restituisce `''`; altrimenti restituisce `pathname` (es. `/lectures/lesson-1.html`).
   - In `youtube-adapter.ts`, a ogni battito (1 Hz), se `currentVideo(b)` trova l'elemento `<video>` principale (`pickMainVideo`) e `id = videoIdOf(location.href)` non è vuoto, `PlayerMonitor.observe(...)` controlla seek, pausa, `playbackRate` e cambi di `currentSrc`/salti temporali su qualunque pagina (non solo su `location.pathname === '/watch'`). Se l'elemento `<video>` scompare dal DOM (`video === null`) o la pagina scarica il documento (`pagehide`), `videoId` diventa `''`.
   - In `CaptureSession.onHeartbeat` (`capture-session.ts`), l'offscreen memorizza al primo heartbeat valido l'`host` e il `videoId` della sessione:
     - interrompe subito con `INTERRUPTED / NAVIGATED_AWAY` se non riceve heartbeat per `3 s` (`HEARTBEAT_TIMEOUT_MS`), se `videoId` è vuoto (`''`), se l'URL non è valido o se `parsed.host !== this.host` (cambio dominio/sito);
     - interrompe subito con `INTERRUPTED / VIDEO_CHANGED` se sullo stesso `host` cambia `videoId` (es. navigazione SPA a un altro video);
     - mantiene invariate le interruzioni per `PLAYBACK_RATE_CHANGED`, `VIDEO_SEEK`, `AD_OR_SOURCE_CHANGE` e la pausa `PAUSED`.
   - Restano invariati i segnali aggiuntivi del service worker (`tabs.onRemoved`, `tabs.onUpdated` con `status: 'loading'` senza URL o URL fuori dai percorsi validi, `tabCapture.onStatusChanged`) e la chiusura immediata della cattura all'ingresso in `FINALIZING` (`R8`).
5. **Contratti e stringhe UI prive del marchio YouTube (`packages/contracts`, `extension/src/ui/strings.it.ts`):**
   - Per retrocompatibilità dei contratti `v1` (`SPEC §9`), il codice d'errore mantiene l'identificatore tecnico `'NOT_YOUTUBE_WATCH'` in `CaptureErrorCode`, ma il messaggio UI in `extension/src/ui/strings.it.ts` diventa generico («In questa scheda non c’è un video HTML5 riproducibile: apri una pagina con un video e clicca di nuovo l’icona.»), così come il titolo della card in Home (`tabTitle: 'Da un video nella scheda'`) e il testo `capture.idle`.
   - Nel bundle compilato `dist/extension/` l’unico riferimento ammesso a YouTube è l’identificatore tecnico `NOT_YOUTUBE_WATCH` mantenuto per retrocompatibilità.

## Conseguenze

- **Positive:**
  - Chiude la prescrizione `G0-TECH-03` (ultima prescrizione aperta del Gate G0), eliminando qualsiasi host permission statica e qualsiasi accoppiamento a `youtube.com` nel manifest, nel codice e nella UI.
  - Migliora la privacy e il principio del minimo privilegio: nessuno script viene iniettato in alcuna scheda finché l'utente non clicca esplicitamente l'icona di VoiceCrystal sulla scheda attiva (`activeTab`).
  - Estende il funzionamento della sorgente «Dalla scheda» a qualsiasi pagina web `https:` contenente un elemento `<video>` HTML5 standard, mantenendo intatte le regole `R4`, `R5`, `R6`, `R7`, `R8`.
- **Negative / compromessi:**
  - Aggiunge il permesso `"scripting"` nel manifest (coperto dalla stessa giustificazione CWS di `activeTab` già approvata in `G0-valutazione-2026-11-13.md` §5.2, senza nuovi avvisi di installazione per l'utente perché combinato con `activeTab` e senza `host_permissions`).
- **Modifiche a specifica e ADR:**
  - `docs/SPEC_v0.3.md` (§§1, 2, 5, 6, 9, 13, 14) riceve nota di prevalenza verso questo ADR.
  - `docs/ADR/0021-content-script-su-tutto-www-youtube-com.md` passa allo stato `Sostituito da ADR-0031`.
  - `docs/ADR/0004-watchdog-di-sessione-con-heartbeat.md` riceve una nota di aggiornamento per l'iniezione on-demand e la generalizzazione a qualsiasi `<video>` HTML5.
- **Versioni dei contratti:** nessuna modifica a `extractorVersion`, `mappingVersion`, `geometryVersion`, `comparatorVersion` o `schemaVersion`.

## Alternative scartate

- **Mantenere `"content_scripts"` con `"matches": ["https://www.youtube.com/*"]`:** viola `G0-TECH-03` ed espone a rifiuto sul Chrome Web Store.
- **Dichiarare `"content_scripts"` con `"matches": ["<all_urls>"]` o `"https://*/*"`:** vietato da `SPEC §5` e `AGENTS.md`, richiede permessi permanenti invasivi su tutti i siti e rallenta la revisione CWS.
- **Avviare `tabCapture` senza iniettare lo script sul `<video>`:** impedirebbe di rilevare pausa, seek, cambio velocità (`playbackRate !== 1`), cambio video SPA e la presenza stessa di un `<video>`, violando `SPEC §6` e `ADR-0004`.

## Verifica

- `extension/test/bundle-guard.test.ts`: verifica che `manifest.json` contenga `"scripting"` in `permissions`, non contenga `content_scripts`, che qualunque `content_scripts` con match venga rifiutato e che nessun file generato in `dist/extension/` contenga riferimenti a `youtube`.
- `extension/test/start-capture.test.ts`: verifica `sidePanel.open()` sincrono come prima istruzione, iniezione con `chrome.scripting.executeScript` prima di `ensureOffscreen()`, rifiuto con `NOT_YOUTUBE_WATCH` senza creare l'offscreen quando la pagina non ha `<video>` o non è `https:`, e avvio regolare quando `<video>` è presente.
- `extension/test/player-monitor.test.ts` e `extension/test/capture-session.test.ts`: verifica di `videoIdOf` e del watchdog su URL generici con `<video>` e su URL `/watch?v=...`, cambio `host` (`NAVIGATED_AWAY`), scomparsa del video (`NAVIGATED_AWAY`) e cambio `videoId` sullo stesso host (`VIDEO_CHANGED`).
- Suite E2E (`tests/e2e/tab-capture.spec.ts`, `tests/e2e/lifecycle.spec.ts`, `tests/e2e/cycles.spec.ts`): tutti gli scenari S2, S3, S6, S7, S8, navigazione SPA e 100 cicli verdi con iniezione on-demand.

## Riferimenti

- `docs/gates/G0-valutazione-2026-11-13.md` (§3.3 `4.3.1`, §4.2 `G0-TECH-03`, §5.2).
- `docs/SPEC_v0.3.md` (§§2, 5, 6, 9, 14).
- `docs/ADR/0002-avvio-sidepanel-open-sincrono-in-action-onclicked.md`.
- `docs/ADR/0004-watchdog-di-sessione-con-heartbeat.md`.
- `docs/ADR/0021-content-script-su-tutto-www-youtube-com.md`.
