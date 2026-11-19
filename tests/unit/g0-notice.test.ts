// I-13a, review H-4; I-16 (G0-DOC-01, G0-DOC-03): the panel's notice and
// PRIVACY.md match the approved texts of docs/gates/G0-valutazione-2026-11-13.md
// (§5.1 and §5.3), verbatim, and agree with the actual browser storage used.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strings } from '../../extension/src/ui/strings.it.ts';

const REPO = resolve(import.meta.dirname, '../..');
const doc = readFileSync(resolve(REPO, 'docs/gates/G0-valutazione-2026-11-13.md'), 'utf8').replace(/\r\n/g, '\n');

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

describe('G0-DOC-03 PRIVACY.md alignment', () => {
  it('matches §5.3 word for word and reflects actual CSP, chrome.storage and IndexedDB usage', () => {
    const section = doc.slice(doc.indexOf('### 5.3'), doc.indexOf('### 5.4'));
    const startMarker = '```markdown\n';
    const start = section.indexOf(startMarker);
    const end = section.indexOf('\n```', start + startMarker.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const approved = section.slice(start + startMarker.length, end).trim();
    const privacy = readFileSync(resolve(REPO, 'PRIVACY.md'), 'utf8').replace(/\r\n/g, '\n').trim();
    expect(privacy).toBe(approved);
    expect(privacy).toContain("connect-src 'self'");
    expect(privacy).toContain('chrome.storage');
    expect(privacy).toContain('IndexedDB');
    expect(privacy).toContain('voicecrystal');
  });
});
