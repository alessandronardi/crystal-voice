// Non-conforming on purpose: browser, extension and Node globals in a pure package (R10).
// Lines marked with the cross must be reported; unmarked lines must not.
export const id: unknown = chrome.runtime.id; // ✗
export const t: string = document.title; // ✗
export const w: unknown = window; // ✗
export const g: unknown = globalThis; // ✗
export const env: unknown = process.env; // ✗
export const net: unknown = fetch('x'); // ✗
export const xhr: unknown = new XMLHttpRequest(); // ✗
export const ws: unknown = new WebSocket('x'); // ✗
export const worker: unknown = new Worker('x'); // ✗
postMessage(1); // ✗
export const lazy: unknown = import('three'); // ✗
export const fine = (a: number, b: number): number => a + b;
