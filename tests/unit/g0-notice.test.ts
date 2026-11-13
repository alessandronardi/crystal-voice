// I-13a, review H-4: the panel's notice is the approved text of the G0
// assessment (G0-DOC-01, docs/gates/G0-valutazione-2026-11-13.md §5.1),
// verbatim. A change to either side fails here and needs the product owner.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strings } from '../../extension/src/ui/strings.it.ts';

const doc = readFileSync(resolve(import.meta.dirname, '../../docs/gates/G0-valutazione-2026-11-13.md'), 'utf8').replace(/\r\n/g, '\n');

describe('G0-DOC-01 notice', () => {
  it('is the approved §5.1 text, word for word', () => {
    const section = doc.slice(doc.indexOf('### 5.1'), doc.indexOf('### 5.2'));
    const quote = section
      .split('\n')
      .filter((l) => l.startsWith('> '))
      .map((l) => l.slice(2))
      .join(' ')
      .replace(/\*\*/g, '')
      .trim();
    const { noticeTitle, noticeText } = strings.shell.home;
    expect(`${noticeTitle} ${noticeText}`).toBe(quote);
  });
});
