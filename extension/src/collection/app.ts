// Full-tab Collection & Comparison view (SPEC §6.2, §11, §12, §13; I-15).
// Privacy & security invariants:
// - Never writes or opens IndexedDB on read-only startup (listCrystals / estimateVaultStorage check DB existence first).
// - Text always goes through textContent, never innerHTML (R17).
// - Grid uses saved WebP thumbnails or lightweight SVG plates, never mounting WebGL per card (SPEC §12).
// - Comparison uses `fixedScale: true` on both crystals on a shared platter and enforces G0-DOC-02 copy.

import {
  DESCRIPTOR_KEYS,
  formatSpecimenCode,
  VAULT_PNG_SIZE,
  DEFAULT_PLATE_VIEW,
  type CrystalGeometry,
  type CrystalRecordV1,
  type CrystalSeed,
  type DescriptorKey,
  type VaultSource,
} from '@voicecrystal/contracts';
import { compareSpecimens, type SpecimenComparisonOutcome } from '@voicecrystal/comparator';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { renderPlateSvg } from '@voicecrystal/renderer-svg';
import {
  chooseProfile,
  exportCrystalPng,
  highlightTargetOf,
  probeGpu,
  renderCrystal,
  showPlateFallback,
  turntableAngle,
  veilIsVisible,
  type GpuProbe,
  type ProfileChoice,
  type RenderHandle,
} from '@voicecrystal/renderer-three';
import {
  deleteCrystal,
  estimateVaultStorage,
  listCrystals,
  openCrystal,
  VaultError,
  type VaultListItem,
  type VaultStorageEstimate,
} from '@voicecrystal/vault';
import { formatMeasure, labelWarnings, legendRows, percentileOf, veiledLines } from '../sidepanel/legend.ts';
import { strings } from '../ui/strings.it.ts';
import {
  INITIAL_COLLECTION_FILTERS,
  classifyColorBucket,
  classifyRecordHabit,
  filterCrystalRecords,
  type CollectionFilterState,
  type ColorBucket,
  type ColorFilter,
  type HabitFilter,
  type PrismFormFilter,
  type SourceFilter,
} from './filters.ts';

const s = strings;
const c = strings.collection;
const cmp = strings.comparison;

const NF0 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF4 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const RENDER_SIMPLIFIED_KEY = 'renderSimplified';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label: string, className: string, testId: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.dataset['testid'] = testId;
  b.addEventListener('click', onClick);
  return b;
}

function formatSourceSummary(source: VaultSource): string {
  if (source.kind === 'tab') return c.sources.tab;
  if (source.kind === 'mic') return c.sources.mic;
  return s.shell.revealed.provenanceFile(source.fileName);
}

function formatDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function colorBadgeText(bucket: ColorBucket): string {
  switch (bucket) {
    case 'ruby':
      return 'Rubino';
    case 'amber':
      return 'Ambra';
    case 'cyan':
      return 'Ciano';
    case 'sapphire':
      return 'Zaffiro';
  }
}

function colorBucketLabel(bucket: ColorBucket): string {
  return c.colors[bucket];
}

function vaultErrorText(error: unknown): { code: string; message: string } {
  if (error instanceof VaultError) {
    return { code: error.code, message: s.shell.home.archive.errors[error.code] };
  }
  return { code: 'STORAGE_ERROR', message: s.shell.home.archive.errors.STORAGE_ERROR };
}

function safeGeometry(record: CrystalRecordV1): CrystalGeometry | null {
  try {
    return generateCrystalGeometry(record.seed, record.confidence, record.geometryVersion);
  } catch {
    return null;
  }
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

interface DetailState {
  record: CrystalRecordV1;
  geometry: CrystalGeometry;
  selectedKey: DescriptorKey | null;
}

interface ComparisonState {
  recordA: CrystalRecordV1;
  geometryA: CrystalGeometry;
  recordB: CrystalRecordV1;
  geometryB: CrystalGeometry;
  outcome: SpecimenComparisonOutcome;
}

export function mountCollectionApp(root: HTMLElement): void {
  document.title = s.pages.collection.title;

  let mode: 'collection' | 'comparing' = 'collection';
  let items: VaultListItem[] = [];
  let storageEstimate: VaultStorageEstimate = { usageBytes: null, quotaBytes: null, warning: false };
  let filters: CollectionFilterState = { ...INITIAL_COLLECTION_FILTERS };
  let selectedAId: string | null = null;
  let selectedBId: string | null = null;
  let confirmingDeleteId: string | null = null;
  let activeDetail: DetailState | null = null;
  let comparison: ComparisonState | null = null;
  let errorBanner: { code: string; message: string } | null = null;
  let thumbUrls: string[] = [];

  let gpu: GpuProbe | null = null;
  let simplified = false;

  let detailHandle: RenderHandle | null = null;
  let compareHandleA: RenderHandle | null = null;
  let compareHandleB: RenderHandle | null = null;
  let compareRaf = 0;

  const revokeThumbs = (): void => {
    for (const url of thumbUrls) URL.revokeObjectURL(url);
    thumbUrls = [];
  };

  const disposeDetailStage = (): void => {
    detailHandle?.dispose();
    detailHandle = null;
  };

  const disposeComparisonStages = (): void => {
    if (compareRaf !== 0) cancelAnimationFrame(compareRaf);
    compareRaf = 0;
    compareHandleA?.dispose();
    compareHandleA = null;
    compareHandleB?.dispose();
    compareHandleB = null;
  };

  const cleanupAll = (): void => {
    revokeThumbs();
    disposeDetailStage();
    disposeComparisonStages();
  };
  window.addEventListener('unload', cleanupAll);

  const profileChoice = (): ProfileChoice => {
    gpu ??= probeGpu();
    return chooseProfile({
      userSimplified: simplified,
      rendererName: gpu.rendererName,
      majorPerformanceCaveat: gpu.majorPerformanceCaveat,
      frameCostsMs: null,
    });
  };

  const applyInitialQueryParams = async (): Promise<void> => {
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('id');
    const compA = params.get('a');
    const compB = params.get('b');
    if (compA !== null && compB !== null && items.some((x) => x.record.id === compA) && items.some((x) => x.record.id === compB)) {
      selectedAId = compA;
      selectedBId = compB;
      await startComparison();
      return;
    }
    if (openId !== null && items.some((x) => x.record.id === openId)) {
      await openDetail(openId);
    }
  };

  const refreshArchive = async (): Promise<void> => {
    try {
      const [loadedItems, est] = await Promise.all([listCrystals(), estimateVaultStorage()]);
      items = loadedItems;
      storageEstimate = est;
      const presentIds = new Set(items.map((x) => x.record.id));
      if (selectedAId !== null && !presentIds.has(selectedAId)) selectedAId = null;
      if (selectedBId !== null && !presentIds.has(selectedBId)) selectedBId = null;
      if (activeDetail !== null && !presentIds.has(activeDetail.record.id)) {
        disposeDetailStage();
        activeDetail = null;
      }
      if (confirmingDeleteId !== null && !presentIds.has(confirmingDeleteId)) {
        confirmingDeleteId = null;
      }
    } catch (error: unknown) {
      errorBanner = vaultErrorText(error);
    }
    render();
  };

  const openDetail = async (id: string): Promise<void> => {
    errorBanner = null;
    disposeDetailStage();
    try {
      const opened = await openCrystal(id);
      if (opened === null) {
        errorBanner = vaultErrorText(new VaultError('CORRUPT_RECORD', 'Crystal record missing'));
        render();
        return;
      }
      activeDetail = { record: opened.record, geometry: opened.geometry, selectedKey: null };
    } catch (error: unknown) {
      errorBanner = vaultErrorText(error);
    }
    render();
  };

  const startComparison = async (): Promise<void> => {
    if (selectedAId === null || selectedBId === null) return;
    errorBanner = null;
    disposeDetailStage();
    disposeComparisonStages();
    try {
      const [openedA, openedB] = await Promise.all([openCrystal(selectedAId), openCrystal(selectedBId)]);
      if (openedA === null || openedB === null) {
        errorBanner = vaultErrorText(new VaultError('CORRUPT_RECORD', 'Crystal record missing'));
        render();
        return;
      }
      const outcome = compareSpecimens(openedA.record, openedB.record);
      comparison = {
        recordA: openedA.record,
        geometryA: openedA.geometry,
        recordB: openedB.record,
        geometryB: openedB.geometry,
        outcome,
      };
      mode = 'comparing';
    } catch (error: unknown) {
      errorBanner = vaultErrorText(error);
    }
    render();
  };

  const buildSpecimenLabelCard = (record: CrystalRecordV1, geometry: CrystalGeometry): HTMLElement => {
    const code = formatSpecimenCode(record.specimenNumber);
    const label = el('div', 'vc-label');
    label.append(
      el('p', 'vc-cap', c.detailCaption),
      el('h2', 'vc-label-name', s.shell.revealed.specimenName(code)),
    );

    const rows: [string, string][] = [];
    if (record.title !== '') rows.push([s.shell.revealed.titleField, record.title]);
    if (record.speakerLabel !== null) rows.push([s.shell.revealed.speakerField, record.speakerLabel]);
    rows.push(
      [s.shell.revealed.habit, geometry.habitName],
      [c.colorLabel, colorBucketLabel(classifyColorBucket(record.seed[4]))],
      [s.shell.revealed.provenance, formatSourceSummary(record.source)],
      [s.shell.revealed.collected, formatDate(record.createdAt)],
      [s.shell.revealed.extractor, record.extractorVersion],
      [c.detailCaption, `${record.mappingVersion} · ${record.geometryVersion}`],
      [s.shell.revealed.seed, record.seed.join(' · ')],
    );

    const warnings = labelWarnings(record.quality.warnings);
    if (warnings.length > 0) rows.push([s.shell.revealed.warnings, warnings.join('; ')]);
    const veiled = veiledLines(geometry);
    if (veiled.length > 0) rows.push([s.shell.revealed.veiled, veiled.join('; ')]);

    const dl = el('dl', 'vc-data');
    for (const [k, v] of rows) {
      dl.append(el('dt', '', k), el('dd', '', v));
    }
    label.append(dl, el('p', 'vc-note', c.reopenNotice));
    return label;
  };

  const renderDetailSection = (detail: DetailState): HTMLElement => {
    const { record, geometry } = detail;
    const code = formatSpecimenCode(record.specimenNumber);
    const card = el('section', 'vc-card');
    card.dataset['testid'] = 'collection-detail';
    card.setAttribute('aria-label', s.shell.revealed.specimenName(code));

    const headerRow = el('div', 'vc-collection-header');
    headerRow.append(
      el('h2', 'vc-h2', s.shell.revealed.specimenName(code)),
      btn(c.closeDetail, 'vc-btn vc-btn-ghost vc-btn-sm', 'collection-detail-close', () => {
        disposeDetailStage();
        activeDetail = null;
        render();
      }),
    );

    const layout = el('div', 'vc-detail-layout');
    const leftCol = el('div', 'vc-detail-col');
    const stage = el('div', 'vc-stage vc-reveal');
    stage.dataset['testid'] = 'collection-detail-stage';
    stage.setAttribute('role', 'img');
    stage.setAttribute('aria-label', s.shell.revealed.showcaseLabel(geometry.habitName));

    const choice = profileChoice();
    try {
      detailHandle = renderCrystal(geometry, {
        container: stage,
        profile: choice.profile,
        reducedMotion: reducedMotion(),
        sizePx: 300,
      });
    } catch {
      showPlateFallback(stage, geometry, 300);
    }

    const detailActions = el('div', 'vc-btns');
    detailActions.append(
      btn(s.shell.revealed.exportSvg, 'vc-btn vc-btn-ghost vc-btn-sm', 'collection-detail-export-svg', () => {
        const svg = renderPlateSvg(geometry, { ...DEFAULT_PLATE_VIEW, sizePx: 512 });
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `voicecrystal-${record.seed.join('-')}.svg`);
      }),
    );
    const pngBtn = btn(s.shell.revealed.exportPng, 'vc-btn vc-btn-ghost vc-btn-sm', 'collection-detail-export-png', () => {
      const handle = detailHandle;
      if (handle?.state !== 'webgl') return;
      pngBtn.disabled = true;
      pngBtn.textContent = s.shell.revealed.exportingPng;
      void exportCrystalPng(handle, VAULT_PNG_SIZE)
        .then((blob) => {
          pngBtn.dataset['lastPngSize'] = String(blob.size);
          downloadBlob(blob, `voicecrystal-${record.seed.join('-')}.png`);
        })
        .catch(() => {
          errorBanner = { code: 'EXPORT_FAILED', message: s.shell.revealed.exportPngError };
          render();
        })
        .finally(() => {
          pngBtn.disabled = detailHandle?.state !== 'webgl';
          pngBtn.textContent = s.shell.revealed.exportPng;
        });
    });
    pngBtn.disabled = detailHandle?.state !== 'webgl';
    detailActions.append(pngBtn);

    const legendSection = el('section', 'vc-legend');
    legendSection.setAttribute('aria-label', s.shell.legend.title);
    legendSection.append(el('h3', 'vc-legend-title', s.shell.legend.title));
    const rows = legendRows(record.seed, record.rawMeasures, geometry);
    const list = el('ul');
    const legendBtns: HTMLButtonElement[] = [];
    const applyHighlight = (): void => {
      const key = activeDetail?.selectedKey ?? null;
      for (const b of legendBtns) {
        b.setAttribute('aria-pressed', String(b.dataset['key'] === key));
      }
      detailHandle?.highlight(rows.find((r) => r.key === key)?.highlight ?? null);
    };
    for (const row of rows) {
      const rowBtn = btn('', 'vc-legend-row', 'collection-legend-row', () => {
        if (activeDetail === null) return;
        activeDetail.selectedKey = activeDetail.selectedKey === row.key ? null : row.key;
        applyHighlight();
      });
      rowBtn.dataset['key'] = row.key;
      rowBtn.append(
        el('span', 'vc-legend-trait', `${row.trait} · ${row.descriptor}`),
        el('span', '', `${row.measure} · ${row.percentile}`),
      );
      if (row.veiled) {
        rowBtn.append(el('span', 'vc-legend-sub', s.shell.legend.lowConfidence));
      }
      legendBtns.push(rowBtn);
      const li = el('li');
      li.append(rowBtn);
      list.append(li);
    }
    legendSection.append(list);
    applyHighlight();

    leftCol.append(stage, detailActions);
    const rightCol = el('div', 'vc-detail-col');
    rightCol.append(buildSpecimenLabelCard(record, geometry), legendSection);
    layout.append(leftCol, rightCol);
    card.append(headerRow, layout);
    return card;
  };

  const renderFilterSection = (habitLookup: Map<string, PrismFormFilter>): HTMLElement => {
    const card = el('section', 'vc-card');
    card.dataset['testid'] = 'collection-filters';
    card.setAttribute('aria-label', c.filtersTitle);
    card.append(el('p', 'vc-card-title', c.filtersTitle));

    const grid = el('div', 'vc-filter-grid');

    // 1. Habit select
    const habitField = el('div', 'vc-field');
    const habitLabel = el('label', '', c.habitLabel);
    habitLabel.htmlFor = 'vc-filter-habit';
    const habitSelect = el('select', 'vc-input');
    habitSelect.id = 'vc-filter-habit';
    habitSelect.dataset['testid'] = 'filter-habit';
    const habitOptions: readonly [HabitFilter, string][] = [
      ['all', c.habits.all],
      ['trigonal', c.habits.trigonal],
      ['bevelledTrigonal', c.habits.bevelledTrigonal],
      ['hexagonal', c.habits.hexagonal],
      ['bevelledHexagonal', c.habits.bevelledHexagonal],
      ['doubleHexagonal', c.habits.doubleHexagonal],
    ];
    for (const [val, text] of habitOptions) {
      const opt = el('option', '', text);
      opt.value = val;
      habitSelect.append(opt);
    }
    habitSelect.value = filters.habit;
    habitSelect.addEventListener('change', () => {
      filters = { ...filters, habit: habitSelect.value as HabitFilter };
      renderCollectionCardsOnly(habitLookup);
    });
    habitField.append(habitLabel, habitSelect);

    // 2. Color select
    const colorField = el('div', 'vc-field');
    const colorLabel = el('label', '', c.colorLabel);
    colorLabel.htmlFor = 'vc-filter-color';
    const colorSelect = el('select', 'vc-input');
    colorSelect.id = 'vc-filter-color';
    colorSelect.dataset['testid'] = 'filter-color';
    const colorOptions: readonly [ColorFilter, string][] = [
      ['all', c.colors.all],
      ['ruby', c.colors.ruby],
      ['amber', c.colors.amber],
      ['cyan', c.colors.cyan],
      ['sapphire', c.colors.sapphire],
    ];
    for (const [val, text] of colorOptions) {
      const opt = el('option', '', text);
      opt.value = val;
      colorSelect.append(opt);
    }
    colorSelect.value = filters.color;
    colorSelect.addEventListener('change', () => {
      filters = { ...filters, color: colorSelect.value as ColorFilter };
      renderCollectionCardsOnly(habitLookup);
    });
    colorField.append(colorLabel, colorSelect);

    // 3. Source select
    const sourceField = el('div', 'vc-field');
    const sourceLabel = el('label', '', c.sourceLabel);
    sourceLabel.htmlFor = 'vc-filter-source';
    const sourceSelect = el('select', 'vc-input');
    sourceSelect.id = 'vc-filter-source';
    sourceSelect.dataset['testid'] = 'filter-source';
    const sourceOptions: readonly [SourceFilter, string][] = [
      ['all', c.sources.all],
      ['tab', c.sources.tab],
      ['mic', c.sources.mic],
      ['file', c.sources.file],
    ];
    for (const [val, text] of sourceOptions) {
      const opt = el('option', '', text);
      opt.value = val;
      sourceSelect.append(opt);
    }
    sourceSelect.value = filters.source;
    sourceSelect.addEventListener('change', () => {
      filters = { ...filters, source: sourceSelect.value as SourceFilter };
      renderCollectionCardsOnly(habitLookup);
    });
    sourceField.append(sourceLabel, sourceSelect);

    // 4. Date range
    const dateFromField = el('div', 'vc-field');
    const dateFromLabel = el('label', '', c.dateFromLabel);
    dateFromLabel.htmlFor = 'vc-filter-date-from';
    const dateFromInput = el('input', 'vc-input');
    dateFromInput.type = 'date';
    dateFromInput.id = 'vc-filter-date-from';
    dateFromInput.dataset['testid'] = 'filter-date-from';
    dateFromInput.value = filters.dateFrom;
    dateFromInput.addEventListener('change', () => {
      filters = { ...filters, dateFrom: dateFromInput.value };
      renderCollectionCardsOnly(habitLookup);
    });
    dateFromField.append(dateFromLabel, dateFromInput);

    const dateToField = el('div', 'vc-field');
    const dateToLabel = el('label', '', c.dateToLabel);
    dateToLabel.htmlFor = 'vc-filter-date-to';
    const dateToInput = el('input', 'vc-input');
    dateToInput.type = 'date';
    dateToInput.id = 'vc-filter-date-to';
    dateToInput.dataset['testid'] = 'filter-date-to';
    dateToInput.value = filters.dateTo;
    dateToInput.addEventListener('change', () => {
      filters = { ...filters, dateTo: dateToInput.value };
      renderCollectionCardsOnly(habitLookup);
    });
    dateToField.append(dateToLabel, dateToInput);

    const resetBtn = btn(c.resetFilters, 'vc-btn vc-btn-ghost vc-btn-sm', 'filter-reset', () => {
      filters = { ...INITIAL_COLLECTION_FILTERS };
      render();
    });

    grid.append(habitField, colorField, sourceField, dateFromField, dateToField, resetBtn);
    card.append(grid);
    return card;
  };

  let gridHost: HTMLElement | null = null;
  let countNode: HTMLElement | null = null;
  let compareBarHost: HTMLElement | null = null;

  const updateCompareBar = (): void => {
    if (compareBarHost === null) return;
    const recordA = items.find((x) => x.record.id === selectedAId)?.record ?? null;
    const recordB = items.find((x) => x.record.id === selectedBId)?.record ?? null;

    const slots = el('div', 'vc-compare-slots');
    const slotAEl = el(
      'span',
      'vc-compare-slot',
      recordA === null
        ? c.slotAEmpty
        : c.slotValue('A', formatSpecimenCode(recordA.specimenNumber), recordA.title !== '' ? recordA.title : (recordA.speakerLabel ?? '')),
    );
    slotAEl.dataset['testid'] = 'compare-slot-a';
    const slotBEl = el(
      'span',
      'vc-compare-slot',
      recordB === null
        ? c.slotBEmpty
        : c.slotValue('B', formatSpecimenCode(recordB.specimenNumber), recordB.title !== '' ? recordB.title : (recordB.speakerLabel ?? '')),
    );
    slotBEl.dataset['testid'] = 'compare-slot-b';
    slots.append(slotAEl, slotBEl);

    const actions = el('div', 'vc-btns');
    const startBtn = btn(c.compareBtn, 'vc-btn vc-btn-sm', 'start-comparison', () => {
      void startComparison();
    });
    startBtn.disabled = recordA === null || recordB === null;
    const clearBtn = btn(c.clearSelectionBtn, 'vc-btn vc-btn-ghost vc-btn-sm', 'clear-comparison', () => {
      selectedAId = null;
      selectedBId = null;
      render();
    });
    clearBtn.disabled = recordA === null && recordB === null;
    actions.append(startBtn, clearBtn);

    compareBarHost.replaceChildren(slots, actions);
  };

  const renderCollectionCardsOnly = (habitLookup: Map<string, PrismFormFilter>): void => {
    if (gridHost === null || countNode === null) return;
    revokeThumbs();
    const records = items.map((x) => x.record);
    const filteredRecords = filterCrystalRecords(records, filters, habitLookup);
    const filteredSet = new Set(filteredRecords.map((r) => r.id));
    const filteredItems = items.filter((item) => filteredSet.has(item.record.id));

    countNode.textContent = c.countSummary(filteredItems.length, items.length);

    if (items.length === 0) {
      const empty = el('p', 'vc-card vc-text vc-muted', c.emptyVault);
      empty.dataset['testid'] = 'collection-empty';
      gridHost.replaceChildren(empty);
      return;
    }
    if (filteredItems.length === 0) {
      const emptyFiltered = el('p', 'vc-card vc-text vc-muted', c.emptyFiltered);
      emptyFiltered.dataset['testid'] = 'collection-empty-filtered';
      gridHost.replaceChildren(emptyFiltered);
      return;
    }

    const ul = el('ul', 'vc-collection-grid');
    ul.dataset['testid'] = 'collection-grid';

    for (const item of filteredItems) {
      const { record, thumbnail } = item;
      const code = formatSpecimenCode(record.specimenNumber);
      const li = el('li', 'vc-specimen-card');
      li.dataset['testid'] = 'collection-card';
      li.dataset['specimenId'] = record.id;
      const slot: '' | 'A' | 'B' = selectedAId === record.id ? 'A' : selectedBId === record.id ? 'B' : '';
      li.dataset['selectedSlot'] = slot;

      const top = el('div');
      const preview = el('div', 'vc-specimen-preview');
      if (thumbnail !== null) {
        const img = el('img');
        const url = URL.createObjectURL(thumbnail);
        thumbUrls.push(url);
        img.src = url;
        img.alt = '';
        preview.append(img);
      } else {
        const g = safeGeometry(record);
        if (g !== null) showPlateFallback(preview, g, 128);
      }

      const habitInfo = classifyRecordHabit(record);
      const colorBucket = classifyColorBucket(record.seed[4]);
      const titleRow = el('div', 'vc-specimen-title-row');
      titleRow.append(
        el('strong', 'vc-card-title', s.shell.revealed.specimenName(code)),
        el('span', 'vc-color-badge', colorBadgeText(colorBucket)),
      );

      const meta = el('div', 'vc-recent-meta');
      meta.append(el('p', 'vc-text', habitInfo.habitName));
      const userTextParts: string[] = [];
      if (record.title !== '') userTextParts.push(record.title);
      if (record.speakerLabel !== null) userTextParts.push(record.speakerLabel);
      if (userTextParts.length > 0) {
        meta.append(el('p', 'vc-text', userTextParts.join(' · ')));
      }
      meta.append(
        el('p', 'vc-text vc-muted', `${formatSourceSummary(record.source)} · ${formatDate(record.createdAt)}`),
      );

      top.append(preview, titleRow, meta);
      li.append(top);

      if (confirmingDeleteId === record.id) {
        const dialog = el('div', 'vc-dialog');
        dialog.dataset['testid'] = 'collection-delete-confirm';
        dialog.setAttribute('role', 'alertdialog');
        dialog.append(el('p', 'vc-text', c.confirmDelete(code)));
        const dBtns = el('div', 'vc-btns');
        dBtns.append(
          btn(c.confirmYes, 'vc-btn vc-danger-solid vc-btn-sm', 'collection-delete-yes', () => {
            confirmingDeleteId = null;
            errorBanner = null;
            void deleteCrystal(record.id)
              .then(() => refreshArchive())
              .catch((error: unknown) => {
                errorBanner = vaultErrorText(error);
                render();
              });
          }),
          btn(c.confirmNo, 'vc-btn vc-btn-ghost vc-btn-sm', 'collection-delete-no', () => {
            confirmingDeleteId = null;
            renderCollectionCardsOnly(habitLookup);
          }),
        );
        dialog.append(dBtns);
        li.append(dialog);
      } else {
        const actions = el('div', 'vc-btns');
        const openBtn = btn(c.openSpecimen, 'vc-btn vc-btn-sm', 'open-specimen', () => {
          void openDetail(record.id);
        });
        openBtn.setAttribute('aria-label', `${c.openSpecimen} ${code}`);

        const isA = selectedAId === record.id;
        const selectABtn = btn(
          isA ? c.selectedAsA : c.selectAsA,
          isA ? 'vc-btn vc-btn-sm' : 'vc-btn vc-btn-ghost vc-btn-sm',
          'select-a',
          () => {
            if (selectedAId === record.id) {
              selectedAId = null;
            } else {
              if (selectedBId === record.id) selectedBId = null;
              selectedAId = record.id;
            }
            updateCompareBar();
            renderCollectionCardsOnly(habitLookup);
          },
        );
        selectABtn.setAttribute('aria-pressed', String(isA));
        selectABtn.setAttribute('aria-label', `${c.selectAsA} ${code}`);

        const isB = selectedBId === record.id;
        const selectBBtn = btn(
          isB ? c.selectedAsB : c.selectAsB,
          isB ? 'vc-btn vc-btn-sm' : 'vc-btn vc-btn-ghost vc-btn-sm',
          'select-b',
          () => {
            if (selectedBId === record.id) {
              selectedBId = null;
            } else {
              if (selectedAId === record.id) selectedAId = null;
              selectedBId = record.id;
            }
            updateCompareBar();
            renderCollectionCardsOnly(habitLookup);
          },
        );
        selectBBtn.setAttribute('aria-pressed', String(isB));
        selectBBtn.setAttribute('aria-label', `${c.selectAsB} ${code}`);

        const delBtn = btn(c.deleteBtn, 'vc-btn vc-btn-ghost vc-danger vc-btn-sm', 'delete-specimen', () => {
          confirmingDeleteId = record.id;
          renderCollectionCardsOnly(habitLookup);
        });
        delBtn.setAttribute('aria-label', `${c.deleteBtn} ${code}`);

        actions.append(openBtn, selectABtn, selectBBtn, delBtn);
        li.append(actions);
      }

      ul.append(li);
    }

    gridHost.replaceChildren(ul);
  };

  const renderCollectionView = (): HTMLElement => {
    const page = el('div', 'vc-collection-page');
    page.dataset['testid'] = 'collection-view';

    const header = el('header', 'vc-collection-header');
    const left = el('div', 'vc-collection-head-left');
    left.append(el('p', 'vc-cap', c.caption), el('h1', 'vc-title', c.title), el('p', 'vc-text vc-muted', c.lead));
    const right = el('div', 'vc-collection-head-right');
    countNode = el('span', 'vc-tag', c.countSummary(items.length, items.length));
    countNode.dataset['testid'] = 'collection-count';
    right.append(
      countNode,
      btn(c.refreshBtn, 'vc-btn vc-btn-ghost vc-btn-sm', 'collection-refresh', () => {
        errorBanner = null;
        void refreshArchive();
      }),
    );
    header.append(left, right);
    page.append(header);

    if (errorBanner !== null) {
      const err = el('p', 'vc-alert', errorBanner.message);
      err.setAttribute('role', 'alert');
      err.dataset['testid'] = 'collection-error';
      err.dataset['code'] = errorBanner.code;
      page.append(err);
    }

    if (storageEstimate.warning) {
      const warn = el('p', 'vc-warn', s.shell.home.archive.storageWarning);
      warn.dataset['testid'] = 'collection-storage-warning';
      page.append(warn);
    }

    const habitLookup = new Map<string, PrismFormFilter>();
    for (const item of items) {
      habitLookup.set(item.record.id, classifyRecordHabit(item.record).prismForm);
    }

    const compareBar = el('section', 'vc-compare-bar');
    compareBar.dataset['testid'] = 'collection-compare-bar';
    compareBar.setAttribute('aria-label', c.compareBarTitle);
    compareBarHost = compareBar;
    updateCompareBar();
    page.append(compareBar);

    page.append(renderFilterSection(habitLookup));

    if (activeDetail !== null) {
      page.append(renderDetailSection(activeDetail));
    }

    gridHost = el('div');
    page.append(gridHost);
    renderCollectionCardsOnly(habitLookup);

    return page;
  };

  const renderComparisonView = (state: ComparisonState): HTMLElement => {
    const { recordA, geometryA, recordB, geometryB, outcome } = state;
    const codeA = formatSpecimenCode(recordA.specimenNumber);
    const codeB = formatSpecimenCode(recordB.specimenNumber);

    const page = el('div', 'vc-collection-page');
    page.dataset['testid'] = 'comparison-view';

    const header = el('header', 'vc-collection-header');
    const left = el('div', 'vc-collection-head-left');
    left.append(
      el('p', 'vc-cap', cmp.caption),
      el('h1', 'vc-title', cmp.sectionTitle),
    );
    left.lastElementChild?.setAttribute('data-testid', 'comparison-heading');

    const right = el('div', 'vc-collection-head-right');
    right.append(
      btn(cmp.backToCollection, 'vc-btn vc-btn-ghost vc-btn-sm', 'comparison-back', () => {
        disposeComparisonStages();
        comparison = null;
        mode = 'collection';
        render();
      }),
    );
    header.append(left, right);
    page.append(header);

    // 1. Shared platter with same framing scale (`fixedScale: true`) and synchronized rotation.
    const platter = el('section', 'vc-platter');
    platter.dataset['testid'] = 'comparison-platter';
    platter.setAttribute('aria-label', cmp.platterTitle);
    platter.append(el('h2', 'vc-h2', cmp.platterTitle), el('p', 'vc-text vc-muted', cmp.platterSubtitle));

    const stagesGrid = el('div', 'vc-platter-stages');
    const choice = profileChoice();

    const mountPlatterSlot = (
      slot: 'A' | 'B',
      record: CrystalRecordV1,
      geometry: CrystalGeometry,
      code: string,
    ): { slotEl: HTMLElement; handle: RenderHandle | null } => {
      const slotEl = el('div', 'vc-platter-slot');
      const stage = el('div', 'vc-stage');
      stage.dataset['testid'] = slot === 'A' ? 'comparison-stage-a' : 'comparison-stage-b';
      stage.dataset['fixedScale'] = 'true';
      stage.setAttribute('role', 'img');
      stage.setAttribute('aria-label', `${cmp.specimenTag(slot, code)} · ${geometry.habitName}`);

      let handle: RenderHandle | null = null;
      try {
        // Start with reducedMotion: true so internal loops are off; the shared platter
        // loop drives handleA.renderAt(angle) and handleB.renderAt(angle) in lockstep.
        handle = renderCrystal(geometry, {
          container: stage,
          profile: choice.profile,
          reducedMotion: true,
          sizePx: 260,
          fixedScale: true,
        });
      } catch {
        showPlateFallback(stage, geometry, 260);
      }

      const tag = el('p', 'vc-cap', cmp.specimenTag(slot, code));
      const habit = el('p', 'vc-card-title', geometry.habitName);
      const subParts: string[] = [];
      if (record.title !== '') subParts.push(record.title);
      if (record.speakerLabel !== null) subParts.push(record.speakerLabel);
      subParts.push(formatSourceSummary(record.source));
      const sub = el('p', 'vc-text vc-muted', subParts.join(' · '));

      slotEl.append(tag, stage, habit, sub);
      return { slotEl, handle };
    };

    const mountedA = mountPlatterSlot('A', recordA, geometryA, codeA);
    const mountedB = mountPlatterSlot('B', recordB, geometryB, codeB);
    compareHandleA = mountedA.handle;
    compareHandleB = mountedB.handle;
    stagesGrid.append(mountedA.slotEl, mountedB.slotEl);
    platter.append(stagesGrid);

    // Accessible shared turntable rotation control.
    const controls = el('div', 'vc-platter-controls');
    const sliderLabel = el('label', 'vc-cap', cmp.rotationLabel);
    sliderLabel.htmlFor = 'vc-comparison-angle';
    const slider = el('input');
    slider.type = 'range';
    slider.id = 'vc-comparison-angle';
    slider.min = '0';
    slider.max = '360';
    slider.step = '1';
    slider.value = '0';
    slider.dataset['testid'] = 'comparison-angle-slider';
    let manualControl = reducedMotion();

    slider.addEventListener('input', () => {
      manualControl = true;
      if (compareRaf !== 0) {
        cancelAnimationFrame(compareRaf);
        compareRaf = 0;
      }
      const angleRad = (Number(slider.value) * Math.PI) / 180;
      compareHandleA?.renderAt(angleRad);
      compareHandleB?.renderAt(angleRad);
    });
    controls.append(sliderLabel, slider);
    platter.append(controls);
    page.append(platter);

    if (!manualControl) {
      let start = -1;
      const tick = (now: number): void => {
        if (mode !== 'comparing' || manualControl) return;
        if (start < 0) start = now;
        const angle = turntableAngle(now - start);
        compareHandleA?.renderAt(angle);
        compareHandleB?.renderAt(angle);
        compareRaf = requestAnimationFrame(tick);
      };
      compareRaf = requestAnimationFrame(tick);
    }

    // 2. Comparison outcome (blocked OR acoustic/geometric affinity).
    if (outcome.status === 'blocked') {
      const alert = el('section', 'vc-alert');
      alert.setAttribute('role', 'alert');
      alert.dataset['testid'] = 'comparison-blocked';
      alert.dataset['reason'] = outcome.reason;
      const vA =
        outcome.reason === 'INCOMPATIBLE_MAPPING_VERSION'
          ? outcome.mappingVersionA
          : outcome.extractorVersionA;
      const vB =
        outcome.reason === 'INCOMPATIBLE_MAPPING_VERSION'
          ? outcome.mappingVersionB
          : outcome.extractorVersionB;
      alert.append(
        el('h2', 'vc-h2', cmp.blockedTitle),
        el('p', 'vc-text', cmp.blockedReasons[outcome.reason](vA, vB)),
        el('p', 'vc-text', cmp.blockedHint),
      );
      page.append(alert);
      return page;
    }

    // Compatible result: primary nearness percentile + G0-DOC-02 disclaimer.
    const metricCard = el('section', 'vc-card');
    metricCard.dataset['testid'] = 'comparison-percentile';
    metricCard.setAttribute('aria-label', cmp.sectionTitle);
    const hero = el('p', 'vc-percentile-hero', `${outcome.nearnessPercentile}%`);
    hero.dataset['testid'] = 'comparison-percentile-value';
    const primaryLine = el('p', 'vc-card-title', cmp.primaryPercentile(outcome.nearnessPercentile));
    metricCard.append(hero, primaryLine);
    if (outcome.experimental) {
      metricCard.append(el('span', 'vc-tag', cmp.experimentalBadge));
    }
    const disclaimer = el('p', 'vc-note', cmp.nonBiometricNotice);
    disclaimer.dataset['testid'] = 'comparison-non-biometric-notice';
    metricCard.append(disclaimer);
    page.append(metricCard);

    if (outcome.contextWarnings.length > 0) {
      const warnCard = el('section', 'vc-warn');
      warnCard.dataset['testid'] = 'comparison-warnings';
      warnCard.setAttribute('aria-label', cmp.contextWarningsTitle);
      const list = el('ul', 'vc-list-plain');
      for (const w of outcome.contextWarnings) {
        list.append(el('li', '', cmp.contextWarnings[w]));
      }
      warnCard.append(el('p', 'vc-card-title', cmp.contextWarningsTitle), list);
      page.append(warnCard);
    }

    // 3. Six per-parameter contributions table.
    const contribCard = el('section', 'vc-card');
    contribCard.setAttribute('aria-label', cmp.contributionsTitle);
    contribCard.append(el('h2', 'vc-h2', cmp.contributionsTitle));
    const tableWrap = el('div', 'vc-contrib-wrap');
    const table = el('table', 'vc-contrib-table');
    table.dataset['testid'] = 'comparison-contributions';

    const thead = el('thead');
    const hRow = el('tr');
    for (const col of [
      cmp.columnDescriptor,
      cmp.columnA,
      cmp.columnB,
      cmp.columnDelta,
      cmp.columnContribution,
    ]) {
      const th = el('th', '', col);
      th.scope = 'col';
      hRow.append(th);
    }
    thead.append(hRow);

    const tbody = el('tbody');
    const veiledA = new Set(geometryA.appearance.veiledTraits);
    const veiledB = new Set(geometryB.appearance.veiledTraits);

    outcome.contributions.forEach((contrib, idx) => {
      const key = DESCRIPTOR_KEYS[idx] as DescriptorKey;
      const tr = el('tr');
      tr.dataset['testid'] = 'comparison-contribution-row';
      tr.dataset['parameter'] = key;

      const tdName = el('td');
      const descText = `${s.analysis.descriptors[key]} (${s.shell.legend.traits[key]})`;
      tdName.append(el('strong', '', descText));
      const highlightHint = highlightTargetOf(key);
      if (highlightHint !== null && !veilIsVisible(key, geometryA) && !veilIsVisible(key, geometryB)) {
        tdName.append(el('span', 'vc-contrib-sub', s.shell.legend.lowConfidence));
      }

      const rawA = recordA.rawMeasures[idx] ?? null;
      const tdA = el('td');
      tdA.append(
        el('span', '', cmp.pointValue(NF0.format(percentileOf(contrib.seedA)))),
        el('span', 'vc-contrib-sub', `${formatMeasure(key, rawA)}${veiledA.has(key) ? ` · ${s.shell.legend.lowConfidence}` : ''}`),
      );

      const rawB = recordB.rawMeasures[idx] ?? null;
      const tdB = el('td');
      tdB.append(
        el('span', '', cmp.pointValue(NF0.format(percentileOf(contrib.seedB)))),
        el('span', 'vc-contrib-sub', `${formatMeasure(key, rawB)}${veiledB.has(key) ? ` · ${s.shell.legend.lowConfidence}` : ''}`),
      );

      const tdDelta = el('td', '', cmp.deltaPoints(NF1.format(contrib.deltaPoints)));
      const tdWeight = el('td', '', NF4.format(contrib.weightedSquaredContribution));

      tr.append(tdName, tdA, tdB, tdDelta, tdWeight);
      tbody.append(tr);
    });

    table.append(thead, tbody);
    tableWrap.append(table);
    contribCard.append(tableWrap);

    // Collapsible technical math & versions section.
    const details = el('details', 'vc-details');
    details.dataset['testid'] = 'comparison-technical-details';
    details.append(el('summary', '', cmp.technicalSummary));
    const dl = el('dl', 'vc-data');
    const techRows: readonly [string, string][] = [
      [cmp.euclideanAffinityLabel, `${NF1.format(outcome.affinity)}%`],
      [cmp.weightedDistanceLabel, NF4.format(outcome.distance)],
      [cmp.comparatorVersionLabel, outcome.comparatorVersion],
      [cmp.mappingVersionLabel, outcome.mappingVersion],
      [cmp.extractorVersionLabel, outcome.extractorVersion],
      [cmp.geometryVersionLabel, `${outcome.geometryVersionA} / ${outcome.geometryVersionB}`],
    ];
    for (const [k, v] of techRows) {
      dl.append(el('dt', '', k), el('dd', '', v));
    }
    details.append(dl);
    contribCard.append(details);
    page.append(contribCard);

    return page;
  };

  function render(): void {
    revokeThumbs();
    disposeDetailStage();
    disposeComparisonStages();
    const content = mode === 'comparing' && comparison !== null ? renderComparisonView(comparison) : renderCollectionView();
    root.replaceChildren(content);
  }

  void (async () => {
    try {
      const stored = await chrome.storage.local.get(RENDER_SIMPLIFIED_KEY);
      simplified = stored[RENDER_SIMPLIFIED_KEY] === true;
    } catch {
      // No storage access: fall back to GPU auto profile.
    }
    await refreshArchive();
    await applyInitialQueryParams();
  })();
}

// Also export helper for testing Seed/type usage cleanly if needed.
export type { CrystalSeed };

const mountRoot = document.getElementById('app');
if (mountRoot !== null) {
  mountCollectionApp(mountRoot);
}
