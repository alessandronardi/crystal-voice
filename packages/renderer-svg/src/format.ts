// Output formatting with integer arithmetic only (ADR-0013): coordinates are
// rounded to 0.01 px and printed from integers, so the text never depends on
// a float-to-string algorithm, and "-0" never appears.

/** Rounds to 0.01 and prints the shortest form: 12.35, 7.1, 256, -1.5. */
export function formatCoord(x: number): string {
  if (!Number.isFinite(x)) throw new RangeError(`non-finite plate coordinate: ${String(x)}`);
  const n = Math.round(x * 100);
  if (n === 0) return '0';
  const negative = n < 0;
  const a = negative ? -n : n;
  const frac = a % 100;
  const int = (a - frac) / 100;
  let tail = '';
  if (frac !== 0) tail = frac % 10 === 0 ? `.${frac / 10}` : `.${frac < 10 ? '0' : ''}${frac}`;
  return `${negative ? '-' : ''}${int}${tail}`;
}

const XML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

// Characters not allowed in XML 1.0 (C0 controls except tab, LF, CR; U+FFFE,
// U+FFFF; lone surrogates): dropped, so untrusted text never breaks the SVG.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Escapes text for XML content and attributes, dropping characters XML cannot carry (R17). */
export function escapeXml(text: string): string {
  return text.replace(XML_INVALID, '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}
