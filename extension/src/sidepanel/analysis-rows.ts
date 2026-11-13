// Technical rows of the experimental analysis (I-06b), shared by the local
// file and the capture views until the crystal view of I-13. Text only
// through textContent (AGENTS.md R17); strings from the central module.
import type { CaptureAnalysisFailure, CrystalSeed, DescriptorKey, QualityWarning } from '@voicecrystal/contracts';
import { strings } from '../ui/strings.it.ts';

const t = strings.analysis;

export interface AnalysisView {
  status: 'OK' | 'INSUFFICIENT_DATA' | null;
  seed: CrystalSeed | null;
  warnings: readonly QualityWarning[];
  missingFeatureKeys: readonly DescriptorKey[];
  veiledKeys: readonly DescriptorKey[] | null;
  validSpeechMs: number | null;
  /** Audio analysed (capture only); null for files, where the window is shown above. */
  analysedMs: number | null;
  failure: CaptureAnalysisFailure | null;
}

function row(label: string, value: string, testId: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'flex justify-between gap-4 text-sm';
  const term = document.createElement('dt');
  term.className = 'text-slate-600';
  term.textContent = label;
  const def = document.createElement('dd');
  def.className = 'font-mono tabular-nums break-all text-right';
  def.dataset['testid'] = testId;
  def.textContent = value;
  item.append(term, def);
  return item;
}

const names = (keys: readonly DescriptorKey[]): string => (keys.length === 0 ? t.none : keys.map((k) => t.descriptors[k]).join(', '));

/** A titled block: heading, note, then the rows (or the failure message). */
export function analysisBlock(view: AnalysisView, prefix: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'space-y-1 border-t border-slate-200 pt-2';
  section.dataset['testid'] = `${prefix}-analysis`;
  const heading = document.createElement('h3');
  heading.className = 'text-sm font-semibold';
  heading.textContent = t.heading;
  const note = document.createElement('p');
  note.className = 'text-xs text-slate-600';
  note.textContent = t.note;
  section.append(heading, note);
  if (view.failure !== null) {
    const p = document.createElement('p');
    p.className = 'text-sm text-red-700';
    p.dataset['testid'] = `${prefix}-analysis-failure`;
    p.dataset['code'] = view.failure;
    p.textContent = t.failures[view.failure];
    section.append(p);
    return section;
  }
  const list = document.createElement('dl');
  list.className = 'space-y-1';
  const outcome = row(t.outcome, view.status === 'OK' && view.seed !== null ? t.outcomeOk : t.outcomeInsufficient, `${prefix}-analysis-outcome`);
  list.append(outcome);
  if (view.seed !== null) list.append(row(t.seed, view.seed.join(' · '), `${prefix}-analysis-seed`));
  if (view.analysedMs !== null) list.append(row(t.analysed, `${(view.analysedMs / 1000).toFixed(1)} ${t.seconds}`, `${prefix}-analysis-analysed`));
  if (view.validSpeechMs !== null) list.append(row(t.validSpeech, `${(view.validSpeechMs / 1000).toFixed(1)} ${t.seconds}`, `${prefix}-analysis-speech`));
  list.append(row(t.missing, names(view.missingFeatureKeys), `${prefix}-analysis-missing`));
  if (view.veiledKeys !== null) list.append(row(t.veiled, names(view.veiledKeys), `${prefix}-analysis-veiled`));
  const warnings = view.warnings.map((w) => t.warningNames[w]);
  list.append(row(t.warnings, warnings.length === 0 ? t.none : warnings.join('; '), `${prefix}-analysis-warnings`));
  section.append(list);
  return section;
}
