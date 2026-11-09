// Non-conforming on purpose: the bundle guard must still see these after
// minification (bundle-guard.test.ts). Never imported by the extension.
/* eslint-disable @typescript-eslint/no-implied-eval, no-new-func -- fixture */
export const compile = (source: string): unknown => new Function(source);
export const evaluate = (source: string): unknown => (globalThis as { eval: (s: string) => unknown }).eval(source);
export const beacon = (): Promise<Response> => fetch('https://telemetry.example/e');
