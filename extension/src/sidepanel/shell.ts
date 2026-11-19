// The side panel screens of I-13a (SPEC §13, view machine of §6.2):
// home, listening as nucleation, revelation with the label, outcome. Style
// Text goes through textContent only (R17); the plate SVG is our own, parsed
// by renderer-three's fallback, never innerHTML.
import {
  DEFAULT_PLATE_VIEW,
  formatSpecimenCode,
  GEOMETRY_VERSIONS,
  MAX_SPEAKER_LABEL_LENGTH,
  MAX_VAULT_TITLE_LENGTH,
  VAULT_EXPORT_FILENAME,
  VAULT_PNG_SIZE,
  VAULT_THUMBNAIL_SIZE,
  type CaptureDiag,
  type CrystalGeometry,
  type CrystalSeed,
  type DescriptorKey,
  type SeedConfidence,
  type VaultSource,
} from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { renderPlateSvg } from '@voicecrystal/renderer-svg';
import {
  chooseProfile,
  exportCrystalPng,
  probeGpu,
  renderCrystal,
  renderCrystalThumbnail,
  showPlateFallback,
  type GpuProbe,
  type ProfileChoice,
  type ProfileInput,
  type RenderHandle,
} from '@voicecrystal/renderer-three';
import {
  deleteCrystal,
  estimateVaultStorage,
  exportVaultJson,
  hasAnySpeakerLabel,
  importVaultJson,
  listCrystals,
  openCrystal,
  saveCrystal,
  VaultError,
  type VaultListItem,
  type VaultStorageEstimate,
} from '@voicecrystal/vault';
import { CAPTURE_LIMITS } from '../offscreen/capture-machine.ts';
import { strings } from '../ui/strings.it.ts';
import { errorText, exitText, mountCaptureView } from './capture-view.ts';
import { mountFileView } from './file-view.ts';
import { homeIcon } from './home-icons.ts';
import { labelWarnings, legendRows, veiledLines } from './legend.ts';
import { INITIAL_VIEW, viewTransition, type RevealedResult, type ViewEvent, type ViewOutcome, type ViewState } from './view-machine.ts';

const s = strings.shell;
/** The geometry of habit-1, the one version today (review L-2). */
const GEOMETRY_VERSION = GEOMETRY_VERSIONS[0];
/** The germ is drawn without veils: it is a sketch of the current estimates, not a result (review L-3). */
const GERM_CONFIDENCE: SeedConfidence = [1, 1, 1, 1, 1, 1];
/** [H] Showcase and germ sizes in CSS pixels, for a side panel about 360 px wide. */
const SHOWCASE_PX = 300;
const GERM_PX = 180;
/** [H] An answer to the several-voices notice that changed nothing after this long can be given again (review L-1). */
const ANSWER_RETRY_MS = 3_000;
/**
 * I-13b: the «Resa semplificata» option, kept across sessions in
 * chrome.storage.local (the `storage` permission is already declared). A
 * boolean only: nothing about the GPU is stored.
 */
export const RENDER_SIMPLIFIED_KEY = 'renderSimplified';

/** The licence texts copied into the package (extension/scripts/build.ts), G0-DOC-01. */
const LICENSES: readonly { label: string; href: string }[] = [
  { label: 'three.js (MIT)', href: 'THIRD_PARTY/three/LICENSE.txt' },
  { label: 'libfvad (BSD-3-Clause)', href: 'THIRD_PARTY/libfvad/LICENSE.txt' },
  { label: 'WebRTC PATENTS', href: 'THIRD_PARTY/libfvad/PATENTS.txt' },
  { label: 'Emscripten (MIT / NCSA)', href: 'THIRD_PARTY/emscripten/emscripten-LICENSE.txt' },
  { label: 'musl (MIT)', href: 'THIRD_PARTY/emscripten/musl-COPYRIGHT.txt' },
  { label: 'compiler-rt (Apache-2.0 con eccezione LLVM)', href: 'THIRD_PARTY/emscripten/compiler-rt-LICENSE.txt' },
  { label: 'dlmalloc (pubblico dominio)', href: 'THIRD_PARTY/emscripten/dlmalloc-NOTICE.txt' },
  { label: 'Tailwind CSS (MIT)', href: 'THIRD_PARTY/tailwindcss/LICENSE.txt' },
  { label: 'Spectral (SIL OFL 1.1)', href: 'THIRD_PARTY/spectral/OFL.txt' },
  { label: 'IBM Plex Mono (SIL OFL 1.1)', href: 'THIRD_PARTY/ibm-plex-mono/OFL.txt' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== '') e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, className: string, testId: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.dataset['testid'] = testId;
  b.addEventListener('click', onClick);
  return b;
}

/** A definition list whose values can be updated in place. */
function dataList(rows: readonly [string, string][]): { element: HTMLElement; values: HTMLElement[] } {
  const dl = el('dl', 'vc-data');
  const values: HTMLElement[] = [];
  for (const [k, v] of rows) {
    const dd = el('dd', '', v);
    values.push(dd);
    dl.append(el('dt', '', k), dd);
  }
  return { element: dl, values };
}

function geometryOf(seed: CrystalSeed, confidence: SeedConfidence): CrystalGeometry | null {
  try {
    return generateCrystalGeometry(seed, confidence, GEOMETRY_VERSION);
  } catch {
    return null; // a seed the generator refuses shows no crystal, never a wrong one
  }
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function vaultErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof VaultError) {
    return { code: error.code, message: s.home.archive.errors[error.code] };
  }
  return { code: 'STORAGE_ERROR', message: s.home.archive.errors.STORAGE_ERROR };
}

function buildVaultSource(r: RevealedResult): VaultSource {
  if (r.source === 'tab') return { kind: 'tab' };
  if (r.source === 'mic') return { kind: 'mic' };
  if (r.fileSource !== null) {
    return {
      kind: 'file',
      fileName: r.fileSource.fileName,
      durationSeconds: r.fileSource.durationSeconds,
      offsetStartSeconds: r.fileSource.offsetStartSeconds,
      offsetEndSeconds: r.fileSource.offsetEndSeconds,
    };
  }
  const durationSeconds = Math.max(1, r.quality.validSpeechMs / 1000);
  return {
    kind: 'file',
    fileName: r.fileName ?? 'audio.wav',
    durationSeconds,
    offsetStartSeconds: 0,
    offsetEndSeconds: durationSeconds,
  };
}

/** The listening screen, built once per session and updated in place (review H-2: focus and clicks survive the ticks). */
interface LiveView {
  key: string;
  nodes: HTMLElement[];
  update(v: Extract<ViewState, { screen: 'LIVE' }>): void;
}

export function mountShell(root: HTMLElement): void {
  const shell = el('div', 'vc-shell');
  const screen = el('section');
  screen.dataset['testid'] = 'shell-screen';
  // Screen changes are announced once (SPEC §13 accessibility), not every progress tick.
  const announce = el('p', 'sr-only');
  announce.setAttribute('aria-live', 'polite');
  // A refused or failed start is visible on whichever screen is shown.
  const failure = el('div', 'vc-card');
  failure.dataset['testid'] = 'shell-start-failure';
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  const failureText = el('p', 'vc-text');
  const permissionBtn = el('button', 'vc-btn vc-btn-ghost', strings.capture.openPermission);
  permissionBtn.type = 'button';
  permissionBtn.dataset['testid'] = 'capture-open-permission';
  failure.append(failureText, permissionBtn);
  const captureTools = el('div', 'vc-tools');
  const fileTools = el('div', 'vc-tools');
  const tech = el('details', 'vc-details');
  tech.append(el('summary', '', s.details));
  shell.append(failure, screen, announce);
  root.replaceChildren(shell);

  let view: ViewState = INITIAL_VIEW;
  let showcase: { key: string; stage: HTMLElement; handle: RenderHandle | null; geometry: CrystalGeometry | null; choice: ProfileChoice } | null = null;
  let live: LiveView | null = null;
  let announced = '';
  // I-13b: rendering profile inputs. The GPU name lives only in this object, in memory (BACKLOG I-13 DoD).
  let simplified = false;
  let gpu: GpuProbe | null = null;
  /** The vetrina was too slow on its first frames (D-AN): economy for the rest of this panel (review L-7: no flicker at each reveal). */
  let slow = false;
  /** The legend row selected for the shown result (ADR-0028). */
  let selected: { result: string; key: DescriptorKey } | null = null;
  let revealDraft: {
    result: RevealedResult;
    title: string;
    speakerLabel: string;
    pending: boolean;
    error: ReturnType<typeof vaultErrorInfo> | null;
  } | null = null;

  /** Home vault state (I-14): refreshed asynchronously without creating DB on read-only paths. */
  let recentItems: VaultListItem[] = [];
  let hasSpeakerLabels = false;
  let storageEstimate: VaultStorageEstimate = { usageBytes: null, quotaBytes: null, warning: false };
  let includeLabelsInExport = false;
  let confirmingDeleteId: string | null = null;
  let vaultError: { code: string; message: string } | null = null;
  let archiveStatus: string | null = null;
  let homeRefreshGen = 0;
  let thumbUrls: string[] = [];
  let openedRecentId: string | null = null;
  let returnSource: keyof typeof s.home.sources | null = null;

  const revokeThumbUrls = (): void => {
    for (const url of thumbUrls) URL.revokeObjectURL(url);
    thumbUrls = [];
  };
  window.addEventListener('unload', revokeThumbUrls);

  const openCollectionPage = (): void => {
    const url = chrome.runtime.getURL('collection.html');
    if (typeof chrome.tabs.create === 'function') {
      void chrome.tabs.create({ url }).catch(() => {
        window.open(url, '_blank', 'noopener');
      });
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  const recentCard = el('section', 'vc-home-section');
  recentCard.dataset['testid'] = 'shell-recent';
  const recentHost = el('div');
  recentCard.append(el('h2', 'vc-cap', s.home.recent.title), recentHost);

  const archive = el('details', 'vc-details vc-home-disclosure');
  const archiveSummary = el('summary', '', s.home.archive.title);
  archiveSummary.dataset['testid'] = 'shell-archive-toggle';
  const archiveCard = el('div', 'vc-card');
  archiveCard.dataset['testid'] = 'shell-archive';
  archive.append(archiveSummary, archiveCard);
  const storageWarningEl = el('p', 'vc-warn', s.home.archive.storageWarning);
  storageWarningEl.dataset['testid'] = 'shell-storage-warning';
  storageWarningEl.hidden = true;
  const vc20WarningEl = el('p', 'vc-warn', s.home.archive.vc20Warning);
  vc20WarningEl.dataset['testid'] = 'shell-vc20-warning';
  vc20WarningEl.hidden = true;

  const exportLabelsInput = el('input');
  exportLabelsInput.type = 'checkbox';
  exportLabelsInput.id = 'vc-export-labels';
  exportLabelsInput.dataset['testid'] = 'shell-export-labels';
  const exportLabelsRow = el('label', 'vc-toggle');
  exportLabelsRow.htmlFor = exportLabelsInput.id;
  exportLabelsRow.append(exportLabelsInput, el('span', '', s.home.archive.includeLabels));

  const archiveStatusEl = el('p', 'vc-status');
  archiveStatusEl.dataset['testid'] = 'shell-archive-status';
  archiveStatusEl.hidden = true;

  const vaultErrorEl = el('p', 'vc-alert');
  vaultErrorEl.setAttribute('role', 'alert');
  vaultErrorEl.dataset['testid'] = 'shell-vault-error';
  vaultErrorEl.hidden = true;

  const importInput = el('input');
  importInput.type = 'file';
  importInput.hidden = true;
  importInput.accept = '.json,application/json';
  importInput.dataset['testid'] = 'shell-import-input';

  const exportJsonBtn = button(s.home.archive.exportBtn, 'vc-btn vc-btn-ghost vc-btn-sm', 'shell-export-json', () => {
    vaultError = null;
    archiveStatus = null;
    syncArchiveControls();
    void exportVaultJson({ includeLabels: includeLabelsInExport })
      .then((res) => {
        if (res.recordCount === 0) {
          archiveStatus = s.home.archive.emptyExport;
          syncArchiveControls();
          return;
        }
        exportJsonBtn.dataset['lastExportJson'] = res.json;
        downloadBlob(new Blob([res.json], { type: 'application/json' }), VAULT_EXPORT_FILENAME);
        archiveStatus = s.home.archive.exportedSummary(res.recordCount, res.labelsIncluded);
        syncArchiveControls();
      })
      .catch((error: unknown) => {
        vaultError = vaultErrorInfo(error);
        syncArchiveControls();
      });
  });

  const importJsonBtn = button(s.home.archive.importBtn, 'vc-btn vc-btn-ghost vc-btn-sm', 'shell-import-btn', () => {
    importInput.click();
  });
  const archiveBtns = el('div', 'vc-btns');
  archiveBtns.append(exportJsonBtn, importJsonBtn);

  archiveCard.append(
    el('p', 'vc-text vc-muted', s.home.archive.description),
    exportLabelsRow,
    vc20WarningEl,
    archiveBtns,
    importInput,
    archiveStatusEl,
  );

  function syncArchiveControls(): void {
    storageWarningEl.hidden = !storageEstimate.warning;
    vc20WarningEl.hidden = !(hasSpeakerLabels || includeLabelsInExport);
    exportLabelsInput.checked = includeLabelsInExport;
    archiveStatusEl.textContent = archiveStatus ?? '';
    archiveStatusEl.hidden = archiveStatus === null;
    vaultErrorEl.textContent = vaultError?.message ?? '';
    vaultErrorEl.dataset['code'] = vaultError?.code ?? '';
    vaultErrorEl.hidden = vaultError === null;
  }

  function focusRecent(id: string, action = 'shell-recent-open'): boolean {
    const item = recentHost.querySelector(`[data-specimen-id="${CSS.escape(id)}"]`);
    const target = item?.querySelector<HTMLElement>(`[data-testid="${action}"]`);
    target?.focus();
    return target !== null && target !== undefined;
  }

  function syncRecentList(): void {
    const active = document.activeElement?.closest<HTMLElement>('.vc-recent-item');
    const focusedId = active?.dataset['specimenId'];
    const focusedAction = document.activeElement?.getAttribute('data-testid') ?? undefined;
    revokeThumbUrls();
    if (recentItems.length === 0) {
      recentHost.replaceChildren(el('p', 'vc-text vc-muted', s.home.recent.empty));
      return;
    }
    const ul = el('ul', 'vc-recent-list');
    ul.setAttribute('role', 'list');
    for (const item of recentItems) {
      const { record, thumbnail } = item;
      const code = formatSpecimenCode(record.specimenNumber);
      const title = record.title.trim() || code;
      const li = el('li', 'vc-recent-item');
      li.dataset['testid'] = 'shell-recent-item';
      li.dataset['specimenId'] = record.id;

      const preview = el('span', 'vc-specimen-preview');
      preview.setAttribute('aria-hidden', 'true');
      if (thumbnail !== null) {
        const img = el('img');
        const url = URL.createObjectURL(thumbnail);
        thumbUrls.push(url);
        img.src = url;
        img.alt = '';
        preview.append(img);
      } else {
        try {
          const geometry = generateCrystalGeometry(record.seed, record.confidence, record.geometryVersion);
          showPlateFallback(preview, geometry, VAULT_THUMBNAIL_SIZE);
        } catch {
          // Opening the record reports vault errors with the usual validation.
        }
      }
      const openBtn = button('', 'vc-specimen-button vc-recent-preview', 'shell-recent-open', () => {
        vaultError = null;
        syncArchiveControls();
        void openCrystal(record.id)
          .then((opened) => {
            if (view.screen !== 'HOME') return;
            if (opened === null) throw new VaultError('CORRUPT_RECORD', 'Missing crystal record');
            openedRecentId = record.id;
            dispatch({ type: 'OPEN_SAVED', record: opened.record });
          })
          .catch((error: unknown) => {
            vaultError = vaultErrorInfo(error);
            syncArchiveControls();
          });
      });
      openBtn.append(preview, el('span', 'vc-recent-title', title));
      li.append(openBtn);

      if (confirmingDeleteId === record.id) {
        const dialog = el('div', 'vc-dialog');
        dialog.dataset['testid'] = 'shell-delete-confirm';
        dialog.setAttribute('role', 'group');
        const prompt = el('p', 'vc-text', s.home.recent.confirmDelete(code));
        prompt.id = 'vc-recent-delete-prompt';
        dialog.setAttribute('aria-labelledby', prompt.id);
        dialog.append(prompt);
        const cBtns = el('div', 'vc-btns');
        const yesBtn = button(s.home.recent.confirmYes, 'vc-btn vc-danger-solid vc-btn-sm', 'shell-delete-yes', () => {
          confirmingDeleteId = null;
          vaultError = null;
          archiveStatus = null;
          void deleteCrystal(record.id)
            .then(async () => {
              await refreshHomeVault();
              if (view.screen === 'HOME' && document.activeElement === document.body) {
                (recentHost.querySelector<HTMLElement>('[data-testid="shell-recent-open"]') ?? openCollectionHomeBtn).focus();
              }
            })
            .catch((error: unknown) => {
              vaultError = vaultErrorInfo(error);
              syncArchiveControls();
              syncRecentList();
            });
        });
        const noBtn = button(s.home.recent.confirmNo, 'vc-btn vc-btn-ghost vc-btn-sm', 'shell-delete-no', () => {
          confirmingDeleteId = null;
          syncRecentList();
          focusRecent(record.id, 'shell-recent-delete');
        });
        cBtns.append(yesBtn, noBtn);
        dialog.append(cBtns);
        li.append(dialog);
      } else {
        const delBtn = button(s.home.recent.deleteBtn, 'vc-link vc-recent-delete', 'shell-recent-delete', () => {
          confirmingDeleteId = record.id;
          syncRecentList();
          focusRecent(record.id, 'shell-delete-no');
        });
        delBtn.setAttribute('aria-label', s.home.recent.deleteNamed(title));
        li.append(delBtn);
      }
      ul.append(li);
    }
    recentHost.replaceChildren(ul);
    if (focusedId !== undefined) focusRecent(focusedId, focusedAction);
  }

  async function refreshHomeVault(): Promise<void> {
    const gen = ++homeRefreshGen;
    try {
      const [items, speakerPresent, est] = await Promise.all([
        listCrystals({ limit: 3 }),
        hasAnySpeakerLabel(),
        estimateVaultStorage(),
      ]);
      if (gen !== homeRefreshGen) return;
      recentItems = items;
      hasSpeakerLabels = speakerPresent;
      storageEstimate = est;
      syncRecentList();
      syncArchiveControls();
    } catch (error) {
      if (gen !== homeRefreshGen) return;
      vaultError = vaultErrorInfo(error);
      syncArchiveControls();
    }
  }

  exportLabelsInput.addEventListener('change', () => {
    includeLabelsInExport = exportLabelsInput.checked;
    syncArchiveControls();
  });

  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file === undefined) return;
    vaultError = null;
    archiveStatus = null;
    syncArchiveControls();
    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const res = await importVaultJson(bytes, {
          renderThumbnail: (g) => renderCrystalThumbnail(g, VAULT_THUMBNAIL_SIZE),
        });
        archiveStatus = s.home.archive.importedSummary(res.importedCount, res.ignoredDuplicateIds.length);
        await refreshHomeVault();
      } catch (error) {
        vaultError = vaultErrorInfo(error);
        syncArchiveControls();
      } finally {
        importInput.value = '';
      }
    })();
  });

  const dispatch = (event: ViewEvent): void => {
    const next = viewTransition(view, event);
    if (next === view) return;
    const leaving = view.screen === 'REVEALED' || view.screen === 'OUTCOME';
    view = next;
    // I-13a review L-10: clear the closed session's technical rows on return.
    if (leaving && next.screen === 'HOME') {
      capture.clearResult();
      file.clearResult();
    }
    render();
  };

  const sourceButton = (source: keyof typeof s.home.sources, id: string, activate: () => void): HTMLButtonElement => {
    const control = button(s.home.sources[source], 'vc-source-button', id, activate);
    control.prepend(homeIcon(source));
    return control;
  };
  const micBtn = el('button', 'vc-source-button', s.home.sources.mic);
  micBtn.type = 'button';
  micBtn.dataset['testid'] = 'capture-use-mic';
  micBtn.prepend(homeIcon('mic'));

  const capture = mountCaptureView(captureTools, { mic: micBtn, permission: permissionBtn }, {
    onDiag: (diag, source) => {
      dispatch({ type: 'CAPTURE_DIAG', diag, source });
    },
    onLost: (sessionId) => {
      dispatch({ type: 'CAPTURE_LOST', sessionId });
    },
    onStartFailure: (message, busy) => {
      failureText.textContent = message ?? '';
      failureText.hidden = message === null;
      failure.querySelector('[data-testid="shell-stop-active"]')?.remove();
      if (busy) failure.append(button(strings.capture.stopActive, 'vc-btn vc-btn-ghost', 'shell-stop-active', () => {
        capture.stopActive();
      }));
      failure.hidden = message === null && permissionBtn.hidden;
    },
  });
  const file = mountFileView(fileTools, { onEvent: dispatch });

  void (async () => {
    try {
      const items = await chrome.storage.local.get(RENDER_SIMPLIFIED_KEY);
      const stored = items[RENDER_SIMPLIFIED_KEY] === true;
      if (stored === simplified) return;
      simplified = stored;
      if (view.screen === 'REVEALED') render();
    } catch {
      // No storage: the default (vetrina when the GPU allows it).
    }
  })();

  const disposeShowcase = (): void => {
    showcase?.handle?.dispose();
    showcase = null;
  };

  const homeHeader = el('header', 'vc-home-header');
  const openCollectionHomeBtn = button('', 'vc-home-icon', 'shell-open-collection', openCollectionPage);
  openCollectionHomeBtn.setAttribute('aria-label', s.home.recent.openCollectionTab);
  openCollectionHomeBtn.title = s.home.recent.openCollectionTab;
  openCollectionHomeBtn.append(homeIcon('collection'));
  homeHeader.append(el('p', 'vc-home-brand', s.brand), openCollectionHomeBtn);
  const homeHeading = el('h1', 'vc-title vc-home-title', s.home.title);
  homeHeading.tabIndex = -1;
  const sources = el('div', 'vc-source-list');
  const tabPanel = el('div', 'vc-card');
  tabPanel.id = 'vc-tab-source';
  tabPanel.append(el('h2', 'vc-card-title', s.home.tabTitle), el('p', 'vc-text', s.home.tabText));
  const filePanel = el('div', 'vc-card');
  filePanel.id = 'vc-file-source';
  let expandedSource: 'tab' | 'file' | null = null;
  const tabBtn = sourceButton('tab', 'shell-source-tab', () => {
    setSource(expandedSource === 'tab' ? null : 'tab');
  });
  const fileBtn = sourceButton('file', 'shell-source-file', () => {
    setSource(expandedSource === 'file' ? null : 'file');
  });
  tabBtn.setAttribute('aria-controls', tabPanel.id);
  fileBtn.setAttribute('aria-controls', filePanel.id);
  sources.append(tabBtn, micBtn, fileBtn);
  const sourceButtons = { tab: tabBtn, mic: micBtn, file: fileBtn };

  function setSource(source: typeof expandedSource): void {
    expandedSource = source;
    tabPanel.hidden = source !== 'tab';
    filePanel.hidden = source !== 'file';
    tabBtn.setAttribute('aria-expanded', String(!tabPanel.hidden));
    fileBtn.setAttribute('aria-expanded', String(!filePanel.hidden));
  }
  setSource(null);

  const notice = el('details', 'vc-details vc-home-disclosure');
  notice.dataset['testid'] = 'shell-notice';
  const noticeSummary = el('summary', '', s.home.noticeTitle);
  noticeSummary.dataset['testid'] = 'shell-notice-toggle';
  const noticeBody = el('div', 'vc-home-notice');
  const list = el('ul', 'vc-licenses');
  list.id = 'vc-home-licenses';
  list.hidden = true;
  for (const l of LICENSES) {
    const link = el('a', 'vc-link', l.label);
    link.href = l.href;
    link.target = '_blank';
    link.rel = 'noopener';
    const li = el('li');
    li.append(link);
    list.append(li);
  }
  const toggle = button(s.home.licenses, 'vc-link', 'shell-licenses', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
  });
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', list.id);
  noticeBody.append(el('p', 'vc-text', s.home.noticeText), toggle, list);
  notice.append(noticeSummary, noticeBody);

  const buildLive = (v: Extract<ViewState, { screen: 'LIVE' }>): LiveView => {
    const caption = v.source === 'file' ? `${s.sources.file} «${v.fileName ?? ''}»` : s.sources[v.source];
    const stage = el('div', 'vc-stage vc-germ');
    stage.dataset['testid'] = 'shell-germ';
    const tag = el('span', 'vc-tag', s.live.provisional);
    const max = CAPTURE_LIMITS.maxValidSpeechMs;
    const rows: [string, string][] = v.source === 'file' ? [[s.live.state, '']] : [[s.live.validSpeech, ''], [s.live.state, '']];
    const list = dataList(rows);
    const bar = el('div', 'vc-bar');
    const fill = el('span');
    bar.append(fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(max / 1000));
    bar.setAttribute('aria-label', s.live.validSpeech);
    const stop = button(s.live.stop, 'vc-btn vc-btn-ghost', 'shell-stop', () => {
      if (v.source === 'file') file.stop();
      else capture.stop();
    });
    // I-13b: the several-voices notice (SPEC §13 [F], D4): non-blocking, announced, two answers (D-AM).
    const m = s.multiSpeaker;
    const dialog = el('div', 'vc-dialog');
    dialog.dataset['testid'] = 'shell-multi-speaker';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'false');
    const question = el('p', 'vc-text', m.question);
    question.id = 'vc-multi-speaker-question';
    dialog.setAttribute('aria-labelledby', question.id);
    let answeredAt = -1;
    const answer = (single: boolean): void => {
      yes.disabled = true;
      no.disabled = true;
      answeredAt = performance.now();
      capture.answerMultiSpeaker(single);
    };
    const yes = button(m.yes, 'vc-btn', 'shell-multi-yes', () => {
      answer(true);
    });
    const no = button(m.no, 'vc-btn vc-btn-ghost', 'shell-multi-no', () => {
      answer(false);
    });
    const answers = el('div', 'vc-btns');
    answers.append(yes, no);
    dialog.append(question, answers);
    dialog.hidden = true;
    const confirmed = el('p', 'vc-text vc-muted', m.confirmed);
    confirmed.dataset['testid'] = 'shell-multi-confirmed';
    confirmed.hidden = true;
    const nodes: HTMLElement[] = [el('p', 'vc-cap', s.live.caption(caption)), el('h2', 'vc-h2', s.live.title), dialog, confirmed, stage, tag, list.element];
    if (v.source !== 'file') nodes.push(bar, el('p', 'vc-text vc-muted', s.live.barNote));
    nodes.push(stop);
    let germKey = '';
    return {
      key: `${v.source}|${v.sessionId ?? v.fileName ?? ''}`,
      nodes,
      update(now) {
        const diag: CaptureDiag | null = now.diag;
        const speakers = diag?.multiSpeaker ?? 'NONE';
        const ask = now.source !== 'file' && speakers === 'PENDING' && diag?.state !== 'FINALIZING';
        // Review L-1: an answer that got no effect within ANSWER_RETRY_MS can be given again.
        if (ask && (dialog.hidden || (yes.disabled && performance.now() - answeredAt > ANSWER_RETRY_MS))) {
          yes.disabled = false;
          no.disabled = false;
          if (dialog.hidden) announce.textContent = m.question;
        }
        dialog.hidden = !ask;
        // Review L-6: the confirmation is announced once, like the question.
        if (speakers === 'CONFIRMED' && confirmed.hidden) announce.textContent = m.confirmed;
        confirmed.hidden = speakers !== 'CONFIRMED';
        // The germ is redrawn only when the provisional seed changes.
        const seed = diag?.provisionalSeed ?? null;
        const nextKey = seed?.join(',') ?? '';
        if (nextKey !== germKey) {
          germKey = nextKey;
          const g = seed === null ? null : geometryOf(seed, GERM_CONFIDENCE);
          if (g !== null) showPlateFallback(stage, g, GERM_PX);
          else stage.replaceChildren(el('p', 'vc-text vc-muted', s.live.waiting));
          tag.hidden = g === null;
        }
        const state =
          now.source === 'file' || diag?.state === 'FINALIZING'
            ? s.live.states.finalizing
            : diag?.state === 'PAUSED'
              ? s.live.states.paused
              : diag === null || diag.state === 'AUTHORIZING'
                ? s.live.states.starting
                : s.live.states.collecting;
        const validMs = diag?.validSpeechMs ?? 0;
        const [first, second] = list.values;
        if (now.source === 'file') {
          if (first !== undefined) first.textContent = state;
        } else {
          if (first !== undefined) first.textContent = s.live.validSpeechOf((validMs / 1000).toFixed(1).replace('.', ','), String(max / 1000));
          if (second !== undefined) second.textContent = state;
          fill.style.width = `${String(Math.round(Math.min(1, validMs / max) * 100))}%`;
          bar.setAttribute('aria-valuenow', (validMs / 1000).toFixed(1));
        }
      },
    };
  };

  const revealedScreen = (r: RevealedResult): HTMLElement[] => {
    const resultKey = `${r.source}|${r.sessionId ?? r.fileName ?? ''}|${r.seed.join(',')}`;
    // I-13b: the profile (BACKLOG I-13 DoD, D-AN). The probe runs once per panel.
    gpu ??= probeGpu();
    const input: ProfileInput = { userSimplified: simplified, rendererName: gpu.rendererName, majorPerformanceCaveat: gpu.majorPerformanceCaveat, frameCostsMs: null };
    const base = chooseProfile(input);
    const choice: ProfileChoice = base.profile === 'vetrina' && slow ? { profile: 'economy', reason: 'SLOW_FRAMES' } : base;
    // The reason is part of the key (CI, 2026-11-14): «Resa semplificata» over an economy already
    // chosen for the GPU changes the reason shown, not the profile.
    const key = `${resultKey}|${choice.profile}|${choice.reason}`;
    if (selected?.result !== resultKey) selected = null;
    const previousDraft = revealDraft?.result === r ? revealDraft : null;
    const draft = previousDraft ?? { result: r, title: '', speakerLabel: '', pending: false, error: null };
    revealDraft = draft;
    const disclosure = (title: string, testId: string): HTMLDetailsElement => {
      const details = el('details', 'vc-details vc-result-details');
      details.dataset['testid'] = testId;
      details.open = previousDraft !== null && screen.querySelector<HTMLDetailsElement>(`[data-testid="${testId}"]`)?.open === true;
      const summary = el('summary', '', title);
      summary.dataset['testid'] = `${testId}-summary`;
      details.append(summary);
      return details;
    };
    const header = el('header', 'vc-collection-brand vc-result-header');
    header.append(el('p', '', s.brand));
    if (showcase?.key !== key) {
      disposeShowcase();
      const stage = el('div', 'vc-stage vc-reveal');
      stage.dataset['testid'] = 'shell-showcase';
      stage.dataset['profile'] = choice.profile;
      stage.dataset['profileReason'] = choice.reason;
      const geometry = geometryOf(r.seed, r.quality.confidence);
      let handle: RenderHandle | null = null;
      if (geometry !== null) {
        stage.setAttribute('role', 'img');
        stage.setAttribute('aria-label', s.revealed.showcaseLabel(geometry.habitName));
        // renderCrystal falls back to the SVG plate by itself without WebGL
        // (SPEC §13); it throws only on a malformed geometry, which then shows
        // no crystal rather than breaking the screen (review L-1).
        try {
          handle = renderCrystal(geometry, {
            container: stage,
            profile: choice.profile,
            reducedMotion: reducedMotion(),
            sizePx: SHOWCASE_PX,
            onFallback: (reason) => {
              if (reason !== 'context-lost') return;
              queueMicrotask(() => {
                if (view.screen === 'REVEALED' && showcase?.stage === stage) render();
              });
            },
            // D-AN: the first frames of the vetrina decide, once, whether it stays.
            ...(choice.profile === 'vetrina'
              ? {
                  onFrameCosts: (costs: number[]) => {
                    if (chooseProfile({ ...input, frameCostsMs: costs }).reason !== 'SLOW_FRAMES') return;
                    slow = true;
                    queueMicrotask(() => {
                      if (view.screen === 'REVEALED') render();
                    });
                  },
                }
              : {}),
          });
        } catch {
          stage.replaceChildren();
        }
      }
      showcase = { key, stage, handle, geometry, choice };
    }
    const shown = showcase;
    const geometry = shown.geometry;
    const mic = r.source === 'mic';
    const provenance = r.source === 'tab' ? s.revealed.provenanceTab : mic ? s.revealed.provenanceMic : s.revealed.provenanceFile(r.fileName ?? '');
    const dateRef = r.saved !== null ? new Date(r.saved.createdAt) : new Date();
    const savedCode = r.saved === null ? null : formatSpecimenCode(r.saved.specimenNumber);
    const habit = geometry?.habitName ?? s.revealed.caption;
    const rows: [string, string][] = [];
    if (r.saved !== null && r.saved.title !== '') rows.push([s.revealed.titleField, r.saved.title]);
    if (r.saved !== null && r.saved.speakerLabel !== null) rows.push([s.revealed.speakerField, r.saved.speakerLabel]);
    rows.push(
      [s.revealed.habit, geometry?.habitName ?? '—'],
      [s.revealed.provenance, provenance],
      [s.revealed.collected, dateRef.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })],
    );
    if (r.exitReason !== null) rows.push([s.revealed.ending, exitText(r.exitReason, mic)]);
    // ADR-0014: report low-confidence traits on the label.
    const warnings = labelWarnings(r.quality.warnings);
    const veiled = geometry === null ? [] : veiledLines(geometry);
    if (veiled.length > 0) {
      rows.push([s.revealed.veiled, veiled.join('; ')]);
      warnings.push(s.revealed.veiled);
    }
    rows.push([s.revealed.extractor, r.extractorVersion ?? '—'], [s.revealed.seed, r.seed.join(' · ')]);

    const labelDetails = disclosure(r.saved === null ? s.revealed.nameAndLabel : s.revealed.label, 'shell-label-details');
    const label = el('div', 'vc-label');
    label.dataset['testid'] = 'shell-label';
    labelDetails.append(label);

    if (r.saved === null) {
      const titleField = el('div', 'vc-field');
      const titleLabel = el('label', '', s.revealed.titleLabel);
      titleLabel.htmlFor = 'vc-title-input';
      const titleInput = el('input', 'vc-input');
      titleInput.type = 'text';
      titleInput.id = 'vc-title-input';
      titleInput.maxLength = MAX_VAULT_TITLE_LENGTH;
      titleInput.placeholder = s.revealed.titlePlaceholder;
      titleInput.value = draft.title;
      titleInput.dataset['testid'] = 'shell-title-input';
      titleInput.addEventListener('input', () => {
        draft.title = titleInput.value;
      });
      titleField.append(titleLabel, titleInput);

      const speakerField = el('div', 'vc-field');
      const speakerLabel = el('label', '', s.revealed.speakerLabel);
      speakerLabel.htmlFor = 'vc-speaker-input';
      const speakerInput = el('input', 'vc-input');
      speakerInput.type = 'text';
      speakerInput.id = 'vc-speaker-input';
      speakerInput.maxLength = MAX_SPEAKER_LABEL_LENGTH;
      speakerInput.placeholder = s.revealed.speakerPlaceholder;
      speakerInput.value = draft.speakerLabel;
      speakerInput.dataset['testid'] = 'shell-speaker-input';
      speakerInput.addEventListener('input', () => {
        draft.speakerLabel = speakerInput.value;
      });
      speakerField.append(speakerLabel, speakerInput);
      label.append(titleField, speakerField);
    }
    label.append(dataList(rows).element);

    const saveError = el('p', 'vc-alert', draft.error?.message);
    saveError.id = 'vc-save-error';
    saveError.setAttribute('role', 'alert');
    saveError.dataset['testid'] = 'shell-save-error';
    if (draft.error !== null) saveError.dataset['code'] = draft.error.code;
    saveError.hidden = draft.error === null;

    const actions = el('div', 'vc-btns');
    const exportError = el('p', 'vc-alert', s.revealed.exportPngError);
    exportError.setAttribute('role', 'alert');
    exportError.hidden = true;
    const exportPngBtn = button(s.revealed.exportPng, 'vc-btn vc-btn-ghost', 'shell-export-png', () => {
      const activeHandle = shown.handle;
      if (activeHandle?.state !== 'webgl') return;
      exportPngBtn.disabled = true;
      exportPngBtn.textContent = s.revealed.exportingPng;
      exportError.hidden = true;
      void exportCrystalPng(activeHandle, VAULT_PNG_SIZE)
        .then((blob) => {
          exportPngBtn.dataset['lastPngSize'] = String(blob.size);
          downloadBlob(blob, `voicecrystal-${r.seed.join('-')}.png`);
        })
        .catch(() => {
          exportError.hidden = false;
        })
        .finally(() => {
          exportPngBtn.disabled = shown.handle?.state !== 'webgl';
          exportPngBtn.textContent = s.revealed.exportPng;
        });
    });
    exportPngBtn.disabled = shown.handle?.state !== 'webgl';

    actions.append(
      button(s.revealed.exportSvg, 'vc-btn vc-btn-ghost', 'shell-export-svg', () => {
        if (geometry !== null) downloadPlate(geometry, r.seed);
      }),
      exportPngBtn,
    );

    const saveBtn = el('button', 'vc-btn', draft.pending ? s.revealed.saving : s.revealed.save);
    saveBtn.type = 'button';
    saveBtn.dataset['testid'] = 'shell-save';
    saveBtn.disabled = geometry === null;
    if (draft.pending) saveBtn.setAttribute('aria-disabled', 'true');
    if (draft.error !== null) saveBtn.setAttribute('aria-describedby', saveError.id);
    saveBtn.addEventListener('click', () => {
      if (view.screen !== 'REVEALED' || view.result !== r || r.saved !== null || geometry === null || draft.pending) return;
      draft.pending = true;
      draft.error = null;
      saveBtn.setAttribute('aria-disabled', 'true');
      saveBtn.removeAttribute('aria-describedby');
      saveBtn.textContent = s.revealed.saving;
      saveError.hidden = true;
      void saveCrystal(
        {
          title: draft.title,
          speakerLabel: draft.speakerLabel === '' ? null : draft.speakerLabel,
          source: buildVaultSource(r),
          seed: r.seed,
          confidence: r.quality.confidence,
          rawMeasures: r.rawMeasures ?? [null, null, null, null, null, null],
          extractorVersion: r.extractorVersion ?? 'extractor-0',
          mappingVersion: r.mappingVersion ?? 'mapping-0',
          geometryVersion: GEOMETRY_VERSION,
          comparatorVersion: 'comparator-0',
          captureExitReason: r.exitReason ?? 'MAX_VALID_SPEECH',
          quality: r.quality,
        },
        {
          renderThumbnail: (g) => renderCrystalThumbnail(g, VAULT_THUMBNAIL_SIZE),
        },
      )
        .then((saved) => {
          draft.pending = false;
          if (view.screen === 'REVEALED' && view.result === r) {
            const focusWasInPanel = screen.contains(document.activeElement) || document.activeElement === document.body;
            selected = null;
            dispatch({ type: 'MARK_SAVED', record: saved.record });
            announce.textContent = s.revealed.saved(formatSpecimenCode(saved.record.specimenNumber));
            if (focusWasInPanel) screen.querySelector<HTMLElement>('[data-testid="shell-revealed-open-collection"]')?.focus();
          }
          void refreshHomeVault();
        })
        .catch((error: unknown) => {
          draft.pending = false;
          draft.error = vaultErrorInfo(error);
          if (view.screen === 'REVEALED' && view.result === r) render();
        });
    });

    const openCollectionBtn = button(
      savedCode === null ? '' : s.revealed.collection,
      savedCode === null ? 'vc-result-collection-icon' : 'vc-btn vc-btn-ghost',
      'shell-revealed-open-collection',
      openCollectionPage,
    );
    openCollectionBtn.setAttribute('aria-label', s.revealed.openCollectionTab);
    const title = el('h1', 'vc-result-name', r.saved?.title || (savedCode === null ? habit : s.revealed.specimenName(savedCode)));
    if (savedCode === null) title.classList.add('vc-result-habit');
    title.dataset['testid'] = 'shell-specimen-name';
    title.tabIndex = -1;
    const identity = el('div', 'vc-result-identity');
    identity.append(title);
    const primary = el('div', 'vc-result-primary');
    primary.append(identity, savedCode === null ? saveBtn : openCollectionBtn);
    if (savedCode === null) {
      header.append(openCollectionBtn);
    } else {
      identity.append(el('p', 'vc-text vc-muted', habit));
      const confirmation = el('p', 'vc-result-code', s.revealed.saved(savedCode));
      confirmation.dataset['testid'] = 'shell-save-confirmation';
      primary.append(confirmation);
    }
    const legend = disclosure(s.legend.disclosure, 'shell-legend-details');
    legend.append(legendSection(r, resultKey, shown));
    const tools = disclosure(s.revealed.tools, 'shell-reveal-tools');
    tools.append(actions, exportError, profileSection(shown.choice, shown.handle?.state === 'webgl'));
    const back = button(r.saved === null ? s.revealed.discard : s.revealed.back, 'vc-link vc-result-back', 'shell-discard', () => {
      dispatch({ type: 'DISCARD' });
    });
    const nodes = [header, shown.stage, primary, saveError];
    if (warnings.length > 0) {
      const warning = el('p', 'vc-warn', s.revealed.qualityNotice(warnings.join(' · ')));
      warning.dataset['testid'] = 'shell-reveal-warnings';
      nodes.push(warning);
    }
    return [...nodes, labelDetails, legend, tools, back];
  };

  /** I-13b: the live legend (SPEC §13, ADR-0028): rows select a trait, the showcase lights it up. */
  const legendSection = (r: RevealedResult, resultKey: string, shown: NonNullable<typeof showcase>): HTMLElement => {
    const l = s.legend;
    const section = el('section', 'vc-legend');
    section.dataset['testid'] = 'shell-legend';
    section.setAttribute('aria-label', l.title);
    if (shown.handle?.state === 'webgl') section.append(el('p', 'vc-text vc-muted', l.hint));
    const rows = shown.geometry === null ? [] : legendRows(r.seed, r.rawMeasures, shown.geometry);
    const list = el('ul');
    const buttons: HTMLButtonElement[] = [];
    const apply = (): void => {
      const key = selected?.key ?? null;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset['key'] === key));
      // The renderer states what it lit on the stage (data-highlight): nothing on the SVG plate.
      shown.handle?.highlight(rows.find((row) => row.key === key)?.highlight ?? null);
    };
    for (const row of rows) {
      const b = button('', 'vc-legend-row', 'legend-row', () => {
        selected = selected?.key === row.key ? null : { result: resultKey, key: row.key };
        apply();
      });
      b.dataset['key'] = row.key;
      b.append(el('span', 'vc-legend-trait', `${row.trait} · ${row.descriptor}`), el('span', '', `${row.measure} · ${row.percentile}`));
      const notes: string[] = [];
      if (row.veiled) notes.push(l.lowConfidence);
      if (row.nothing !== null) notes.push(row.nothing);
      else if (row.highlight === null) notes.push(l.wholeCrystal);
      if (notes.length > 0) b.append(el('span', 'vc-legend-sub', notes.join(' · ')));
      buttons.push(b);
      const li = el('li');
      li.append(b);
      list.append(li);
    }
    section.append(list, el('p', 'vc-note', l.note));
    apply();
    return section;
  };

  /** I-13b: «Resa semplificata», remembered across sessions; the profile in use and why. */
  const profileSection = (choice: ProfileChoice, webgl: boolean): HTMLElement => {
    const r = s.revealed;
    const box = el('div', 'vc-card');
    if (!webgl) {
      // Review M-3: the SVG plate stands in for the showcase (SPEC §13): no profile to choose.
      const used = el('p', 'vc-text vc-muted', `${r.profile}: ${r.noWebgl}`);
      used.dataset['testid'] = 'shell-profile';
      box.append(used);
      return box;
    }
    const label = el('label', 'vc-toggle');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = simplified;
    input.dataset['testid'] = 'shell-simplified';
    input.addEventListener('change', () => {
      simplified = input.checked;
      // Stored only while chosen: with the option off nothing is kept (the file privacy E2E expects an empty local storage).
      void (simplified ? chrome.storage.local.set({ [RENDER_SIMPLIFIED_KEY]: true }) : chrome.storage.local.remove(RENDER_SIMPLIFIED_KEY)).catch(() => undefined);
      render();
      // The screen was rebuilt: keep the keyboard focus on the option.
      screen.querySelector<HTMLInputElement>('[data-testid="shell-simplified"]')?.focus();
    });
    label.append(input, el('span', '', r.simplified));
    const reason = r.profileReasons[choice.reason];
    const used = el('p', 'vc-text vc-muted', `${r.profile}: ${r.profiles[choice.profile]}${reason === '' ? '' : ` (${reason})`}`);
    used.dataset['testid'] = 'shell-profile';
    box.append(label, el('p', 'vc-text vc-muted', r.simplifiedNote), used);
    return box;
  };

  const outcomeScreen = (o: ViewOutcome): HTMLElement[] => {
    const mic = o.source === 'mic';
    const title = o.state === 'INSUFFICIENT_DATA' ? s.outcome.insufficient : o.state === 'INTERRUPTED' ? s.outcome.interrupted : s.outcome.error;
    // Review M-1/M-2: the source's own words (microphone texts of I-17, file refusals of I-18).
    const reason =
      o.message !== null
        ? o.message
        : o.code === 'FILE_DECODE_FAILED'
          ? s.outcome.fileError
          : o.code !== null
            ? errorText(o.code, mic)
            : o.exitReason !== null && o.exitReason !== 'QUALITY_REJECTED' && o.state !== 'INSUFFICIENT_DATA'
              ? exitText(o.exitReason, mic)
              : s.outcome.insufficientText;
    const out: HTMLElement[] = [el('p', 'vc-cap', s.outcome.caption), el('h2', 'vc-h2', title), el('p', 'vc-text', reason)];
    if (o.state === 'INSUFFICIENT_DATA') {
      const card = el('div', 'vc-card');
      card.append(el('p', 'vc-card-title', s.outcome.tryTitle), el('p', 'vc-text vc-muted', s.outcome.tryText));
      out.push(card);
    }
    out.push(
      button(s.outcome.back, 'vc-btn', 'shell-back', () => {
        dispatch({ type: 'DISMISS' });
      }),
    );
    return out;
  };

  let lastScreen: ViewState['screen'] | null = null;

  function render(): void {
    const active = document.activeElement;
    const revealFocus = view.screen === 'REVEALED' && revealDraft?.result === view.result &&
      active instanceof HTMLElement && screen.contains(active) ? active.dataset : null;
    const enteredReveal = view.screen === 'REVEALED' && lastScreen !== 'REVEALED';
    if (view.screen !== 'REVEALED') {
      disposeShowcase();
      revealDraft = null;
      selected = null;
    }
    if (view.screen !== 'LIVE') live = null;
    if (view.screen !== 'HOME') {
      revokeThumbUrls();
      confirmingDeleteId = null;
    }
    const previousScreen = lastScreen;
    const enteredHome = view.screen === 'HOME' && previousScreen !== 'HOME';
    if (enteredHome) {
      vaultError = null;
      archiveStatus = null;
    }
    lastScreen = view.screen;
    let title: string;
    let children: HTMLElement[];
    switch (view.screen) {
      case 'HOME':
        sources.insertBefore(micBtn, fileBtn);
        filePanel.append(fileTools);
        tech.append(captureTools);
        syncRecentList();
        syncArchiveControls();
        children = [homeHeader, homeHeading, sources, tabPanel, filePanel, failure, recentCard, vaultErrorEl, notice, storageWarningEl, archive, tech];
        title = s.home.title;
        break;
      case 'LIVE': {
        returnSource = view.source;
        const key = `${view.source}|${view.sessionId ?? view.fileName ?? ''}`;
        if (live?.key === key) {
          // Same session: update in place, nothing is rebuilt (review H-2).
          live.update(view);
          return;
        }
        live = buildLive(view);
        live.update(view);
        children = [...live.nodes];
        title = s.live.title;
        break;
      }
      case 'REVEALED':
        returnSource = view.result.source;
        children = revealedScreen(view.result);
        title = s.revealed.caption;
        break;
      case 'OUTCOME':
        returnSource = view.outcome.source;
        children = outcomeScreen(view.outcome);
        title = s.outcome.caption;
        break;
    }
    if (view.screen !== 'HOME') {
      if (failure.parentElement !== shell) shell.prepend(failure);
      // Controls and technical rows of the running views, folded away; the
      // same <details> element, so its open state is kept.
      tech.append(captureTools, micBtn, fileTools);
      children.push(tech);
    }
    screen.dataset['screen'] = view.screen;
    screen.replaceChildren(...children);
    if (enteredHome) {
      if (previousScreen !== null) {
        if (openedRecentId !== null) {
          if (!focusRecent(openedRecentId)) homeHeading.focus();
          openedRecentId = null;
        } else {
          if (returnSource === 'file') setSource('file');
          const target = returnSource === null ? homeHeading : sourceButtons[returnSource];
          (target instanceof HTMLButtonElement && target.disabled ? homeHeading : target).focus();
        }
      }
      void refreshHomeVault();
    } else if (!enteredReveal && view.screen !== 'HOME' && previousScreen !== view.screen) {
      const heading = screen.querySelector('h1, h2');
      if (heading instanceof HTMLElement) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
    if (title !== announced) {
      announced = title;
      announce.textContent = title;
    }
    if (enteredReveal) {
      failure.hidden = true;
      window.scrollTo(0, 0);
      screen.querySelector<HTMLElement>('[data-testid="shell-specimen-name"]')?.focus({ preventScroll: true });
    } else if (revealFocus?.['testid'] !== undefined) {
      const key = revealFocus['key'];
      const trait = key === undefined ? '' : `[data-key="${CSS.escape(key)}"]`;
      screen.querySelector<HTMLElement>(`[data-testid="${CSS.escape(revealFocus['testid'])}"]${trait}`)?.focus({ preventScroll: true });
    }
  }

  render();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);
}

/** «Esporta tavola SVG»: the canonical plate (ADR-0013), saved by the browser; nothing leaves the computer. */
function downloadPlate(geometry: CrystalGeometry, seed: CrystalSeed): void {
  const svg = renderPlateSvg(geometry, { ...DEFAULT_PLATE_VIEW, sizePx: 512 });
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `voicecrystal-${seed.join('-')}.svg`);
}
