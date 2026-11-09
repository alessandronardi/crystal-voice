# ADR-0015: CSP con `connect-src 'self'` per imporre R2 a runtime

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner (decisione D-A, approvata in chat il 2026-11-09); proposta nata dalle due revisioni avversariali di I-01

## Contesto

R2 (AGENTS.md) vieta qualunque chiamata di rete a runtime: niente telemetria, CDN o codice remoto.

**Fatti verificati (I-01, 2026-11-09)**
- La CSP di SPEC §5 [F] è `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`. Impedisce di eseguire codice remoto e `eval`, ma non contiene `connect-src` né `default-src`. Quindi non limita `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` né `navigator.sendBeacon`.
- La guardia sul bundle (`extension/scripts/bundle-guard.ts`) è un controllo testuale: non rileva un URL costruito a runtime senza frammenti letterali dello schema. Le due revisioni avversariali di I-01 hanno dimostrato aggiramenti di questo tipo e raccomandano una difesa a runtime.
- Il lint vieta i globali di rete solo nei pacchetti puri, non in `extension/src/`.

**Ipotesi (`needs current-doc verification`)**
- In MV3 la policy `extension_pages` vale per le pagine dell'estensione e per il service worker, ma non per i content script, che girano nel mondo isolato della pagina ospite.
- `'self'` copre le risorse `chrome-extension://<id>/` del bundle: le tabelle di calibrazione JSON (I-09) e un eventuale VAD in WASM (I-05).

## Decisione

- La CSP `extension_pages` diventa: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self';`
- La guardia sul bundle rende `connect-src` obbligatoria e accetta come unico valore `'self'`. Ogni sorgente in più richiede un nuovo ADR.
- Per il content script R2 resta difesa da lint, guardia e revisione: la CSP delle pagine non lo copre.

## Conseguenze

**Positive**
- Una richiesta di rete da pagine o service worker viene bloccata dal browser prima di partire, comunque sia costruito l'URL.
- La guardia testuale diventa una seconda linea di difesa, non più l'unica.

**Negative e rischi**
- `fetch()` su URL `blob:` o `data:` viene bloccato da `connect-src 'self'`. Se serve (per esempio per le miniature in I-14), richiede un ADR che aggiunga `blob:`. Si usino di preferenza API che non passano da `connect-src`, come `createImageBitmap` e `FileReader`.
- Il content script non è coperto (vedi Ipotesi).

**Versioni:** nessuna versione semantica dei dati cambia. La versione dell'estensione resta 0.3.0, perché non c'è ancora una release.

**Da aggiornare in `docs/SPEC_v0.3.md` (approvato, da fare in una modifica di documentazione separata):**
- §5, «Permessi di partenza»: il blocco JSON del manifest, chiave `content_security_policy.extension_pages`.
- §14, sicurezza e privacy: citare `connect-src 'self'` fra le difese di R2.

Fino ad allora vale questo ADR, che prevale su SPEC §5 limitatamente alla CSP.

## Alternative scartate

- **`default-src 'self'`:** più ampio. Si applicherebbe anche a stili, immagini, font e media con effetti più difficili da prevedere su Tailwind e Three.js. Scartato per ora; si può rivalutare in I-16.
- **`connect-src 'none'`:** bloccherebbe anche il caricamento di risorse proprie del bundle via `fetch` (tabelle JSON, WASM).
- **Solo guardia testuale:** già dimostrata aggirabile.

## Verifica

- Test unitari della guardia: CSP senza `connect-src`, oppure con una sorgente diversa da `'self'`, fa fallire la build.
- E2E (`tests/e2e/extension-loads.spec.ts`): un `fetch` verso un URL esterno, fatto dalla Side Panel e dal service worker, viene rifiutato. Il test non dipende dalla rete perché il rifiuto della CSP avviene prima della connessione.
- Ipotesi sui content script: da verificare in I-03, quando il content script avrà codice.

## Riferimenti

- SPEC §5, §14; AGENTS.md R2.
- Rilievi H-B e M-B della seconda revisione avversariale di I-01.
- [Manifest: content_security_policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
