# ADR-0029: Archivio locale ed export JSON senza metadati YouTube (G0-TECH-01, G0-TECH-02)

- **Stato:** Accettato (2026-11-14, dal product owner; chiusura prescrizioni G0-TECH-01 e G0-TECH-02 in I-14)
- **Data:** 2026-11-14
- **Decisori:** product owner

## Contesto

- **Il vincolo legale (G0):** la valutazione legale G0 (`docs/gates/G0-valutazione-2026-11-13.md`, §4.2) impone due modifiche tecniche vincolanti per la pubblicazione:
  - **G0-TECH-01:** né l'archivio locale né l'export JSON devono salvare `videoId`, URL, piattaforma o titolo dei video YouTube; per la sorgente scheda si conserva solo il fatto che provenga da una scheda del browser, oltre ai sei interi del seme, ai parametri di ricostruzione/verifica, alle versioni dell'algoritmo, alla miniatura 3D generata e a eventuali etichette manuali inserite dall'utente.
  - **G0-TECH-02:** l'export JSON (`voicecrystal-export-v1.json`) deve omettere di default le etichette testuali inserite dall'utente (titolo, `speakerLabel`, tag), richiedendo un opt-in esplicito con avviso sui dati personali di terzi (`VC-20`) quando presente `speakerLabel`.
- **Conflitto con SPEC v0.3:** `docs/SPEC_v0.3.md` §§9, 12 e 13 `[F]` prevedeva invece `videoId`, `title` di YouTube, l'indice `videoId` in IndexedDB e la ricostruzione di `youtube.com/watch?v=...` sul cartellino da collezione.
- **Disallineamento documentale (H-4, D-AK):** l'avviso G0 in Home (`G0-valutazione-2026-11-13.md` §5.1) affermava «nessun audio o dato viene mai salvato su disco», non coerente con l'esistenza del vault IndexedDB voluto dall'utente; e `PRIVACY.md` §3 citava solo `chrome.storage` senza nominare IndexedDB (`voicecrystal`).

## Decisione

1. **Sorgente `tab` nel vault e nell'export (`G0-TECH-01`):**
   - `VaultSource` (persistito in IndexedDB ed esportato in JSON) ammette esclusivamente:
     - `{ kind: 'tab' }` (nessun `videoId`, URL, piattaforma o titolo del video);
     - `{ kind: 'mic' }`;
     - `{ kind: 'file', fileName, durationSeconds, offsetStartSeconds, offsetEndSeconds }` (solo nome file normalizzato e validato come testo non fidato, mai il contenuto né il percorso completo).
   - Lo store IndexedDB `crystals` espone gli indici `createdAt`, `sourceKind`, `mappingVersion`; **l'indice `videoId` viene rimosso**.
   - In importazione JSON vengono rifiutati record la cui `source` contenga campi non ammessi (`videoId`, `url`, `platform`, titolo YouTube) o chiavi inattese.
2. **Cartellino da collezione:**
   - Per un cristallo da sorgente `tab`, il cartellino mostra «Provenienza: scheda del browser», senza ricostruire alcun link esterno o ID video.
3. **Minimizzazione dell'export JSON (`G0-TECH-02`, `VC-20`):**
   - Di default l'export `voicecrystal-export-v1.json` omette le etichette testuali inserite dall'utente (`title: ''`, `speakerLabel: null`, `tags: []`), conservando solo i sei interi del seme, confidenza, misure grezze per la legenda viva, versioni dell'algoritmo, `quality`, `captureExitReason`, `geometryHash` e `source` priva di metadati YouTube.
   - L'utente può attivare esplicitamente un'opzione «Includi etichette manuali nell'export»; se l'archivio contiene almeno uno `speakerLabel`, l'interfaccia mostra l'avviso sui dati personali di terzi (`VC-20`).
4. **Avviso Home e Privacy Policy (`H-4`, `D-AK`):**
   - Il testo G0 §5.1 e l'avviso nella Home chiariscono che nessun audio viene salvato su disco né inviato in rete, mentre i cristalli salvati dall'utente restano esclusivamente nell'archivio locale del browser.
   - `PRIVACY.md` §3 e G0 §5.3 distinguono `chrome.storage` (stato sessione e preferenza resa semplificata) da IndexedDB (`voicecrystal`, archivio locale dei cristalli e delle miniature WebP 256×256).

## Conseguenze

- **Positive:** chiude `G0-TECH-01` e `G0-TECH-02`, riduce l'impronta privacy dell'archivio e degli export condivisi ed elimina la superficie di validazione di URL/`videoId` nell'import.
- **Negative:** i cristalli raccolti da schede browser non riportano un riferimento cliccabile al video di origine; l'utente che lo desidera può annotarlo manualmente nel titolo (solo locale o opt-in esplicito in export).
- **Modifiche alla specifica:** `docs/SPEC_v0.3.md` §§9, 12 e 13 `[F]` ricevono nota esplicita che rimanda a questo ADR.
- **Versioni:** `schemaVersion` rimane `1` perché I-14 introduce il primo schema effettivo di `voicecrystal`; nessuna migrazione retroattiva su dati esistenti in produzione è necessaria.

## Alternative scartate

- **Mantenere `videoId` cifrato o hashato nel vault:** comunque superfluo rispetto ai requisiti legali G0 (`G0-TECH-01`) e non ricostruibile senza consenso/policy più ampia.
- **Esportare sempre le etichette manuali mostrando solo un banner:** viola `G0-TECH-02`, che richiede omissione di default oppure opt-in esplicito.

## Verifica

- Test unit in `packages/vault/test/vault.test.ts`: verifica assenza di indice `videoId`, salvataggio `{ kind: 'tab' }`, rifiuto di payload import con metadati `videoId`/`url`/`platform`, omissione etichette nell'export di default e inclusione solo con opt-in.
- Test `tests/unit/g0-notice.test.ts`: verifica corrispondenza letterale tra l'avviso in Home (`strings.it.ts`) e §5.1 del documento G0.
- Test E2E in `tests/e2e/vault.spec.ts`: salvataggio, controllo record in IndexedDB, export default vs opt-in con avviso `VC-20`, importazione con deduplica e rifiuti ostili.

## Riferimenti

- `docs/gates/G0-valutazione-2026-11-13.md` (§4.2 G0-TECH-01, G0-TECH-02, §5.1, §5.3).
- `docs/SPEC_v0.3.md` §§9, 12, 13.
- `docs/RISK_REGISTER.md` (`VC-18`, `VC-20`).
- `PRIVACY.md` §3.
