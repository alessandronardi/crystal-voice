// I-03 DoD: 100 start/stop cycles without crash, with memory growth ≤ 20 MB [H].
//
// Every cycle closes the offscreen document (ADR-0003). What survives the
// cycles, and where a capture leak would pile up, is measured and asserted:
//   - the extension renderer process, which hosts the offscreen document, the
//     service worker, the side panel and the probe page (Chromium flag
//     --extension-process on its command line);
//   - the browser process and the audio service.
// PIDs and types come from the CDP command SystemInfo.getProcessInfo; bytes
// from the OS (Windows: PrivateMemorySize64; Linux: VmRSS). The probe page's
// recorded diagnostics are cleared at every reading so that the test's own
// bookkeeping does not grow inside the measured process.
// Also reported, not asserted: the used JS heap of the offscreen document
// while listening (CDP Runtime.getHeapUsage) and the whole process tree, which
// with the test's video page and the GPU swings by tens of MB with no capture
// at all (docs/BENCHMARK_PROTOCOL.md §7, 2026-11-11).
// Each reading is the median of three, after a warm-up. Requires `pnpm build`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ExtensionHarness } from './harness.ts';

/** [H] DoD of I-03. */
const MAX_GROWTH_MB = 20;
// Overridable for diagnostic runs only; the DoD value is 100.
const CYCLES = Number(process.env['VC_CYCLES'] ?? 100);
const WARM_UP = 5;
const SAMPLE_EVERY = 25;
const PERSISTENT_TYPES = ['browser', 'audio.mojom.AudioService'];

const h = new ExtensionHarness();

test.beforeAll(async () => {
  await h.launch();
});

test.afterAll(async () => {
  await h.close();
});

const click = (testId: string): string =>
  `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (el === null) return false; el.click(); return true; })()`;

interface ProcessInfo {
  id: number;
  type: string;
}

interface OsProcess {
  bytes: number;
  extension: boolean;
}

/** Memory and «is the extension renderer» for each PID, from the OS. */
function osProcesses(pids: readonly number[]): Map<number, OsProcess> {
  const out = new Map<number, OsProcess>();
  if (process.platform === 'win32') {
    const script =
      `$ids = @(${pids.join(',')}); ` +
      `Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } | ` +
      `ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; ` +
      `if ($p) { "$($_.ProcessId) $($p.PrivateMemorySize64) $([int]($_.CommandLine -like '*--extension-process*'))" } }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    for (const line of result.stdout.split(/\r?\n/)) {
      const [pid, bytes, extension] = line.trim().split(' ');
      if (pid === undefined || bytes === undefined) continue;
      out.set(Number(pid), { bytes: Number(bytes), extension: extension === '1' });
    }
    return out;
  }
  for (const pid of pids) {
    try {
      const match = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      out.set(pid, {
        bytes: match?.[1] === undefined ? 0 : Number(match[1]) * 1024,
        extension: cmdline.includes('--extension-process'),
      });
    } catch {
      // Process gone between listing and reading.
    }
  }
  return out;
}

interface Reading {
  /** Asserted: extension renderer + browser + audio service, MB. */
  persistentMb: number;
  /** Of which the extension renderer, MB. */
  extensionMb: number;
  extensionProcesses: number;
  /** Reported only: every Chromium process, MB. */
  treeMb: number;
}

async function readOnce(): Promise<Reading> {
  const info = (await h.browserCdp('SystemInfo.getProcessInfo', {})) as { processInfo: ProcessInfo[] };
  const known = info.processInfo.filter((p) => p.id > 0);
  const os = osProcesses(known.map((p) => p.id));
  let persistent = 0;
  let extension = 0;
  let extensionProcesses = 0;
  let tree = 0;
  for (const p of known) {
    const o = os.get(p.id);
    if (o === undefined) continue;
    tree += o.bytes;
    if (o.extension) {
      extension += o.bytes;
      extensionProcesses++;
    }
    if (o.extension || PERSISTENT_TYPES.includes(p.type)) persistent += o.bytes;
  }
  return {
    persistentMb: persistent / 2 ** 20,
    extensionMb: extension / 2 ** 20,
    extensionProcesses,
    treeMb: tree / 2 ** 20,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function measure(): Promise<Reading> {
  // The probe page lives in the extension process: drop its bookkeeping first.
  await h.probe.evaluate(() => {
    const g = globalThis as unknown as { vcDiags: unknown[]; vcTypes: string[] };
    g.vcDiags.length = 0;
    g.vcTypes.length = 0;
  });
  const readings: Reading[] = [];
  for (let i = 0; i < 3; i++) {
    await h.probe.waitForTimeout(1_000);
    readings.push(await readOnce());
  }
  return {
    persistentMb: median(readings.map((r) => r.persistentMb)),
    extensionMb: median(readings.map((r) => r.extensionMb)),
    extensionProcesses: median(readings.map((r) => r.extensionProcesses)),
    treeMb: median(readings.map((r) => r.treeMb)),
  };
}

const round = (mb: number): number => Math.round(mb * 10) / 10;

test(`${CYCLES} start/stop cycles: clean state each time, memory growth ≤ ${MAX_GROWTH_MB} MB [H]`, async () => {
  test.setTimeout(20 * 60_000);
  const page = await h.openWatch();
  const offscreenHeapMb: { cycle: number; mb: number }[] = [];
  const cycle = async (index: number | null): Promise<void> => {
    const seen = await h.seenSessions();
    await h.clickAction(page);
    const session = await h.waitForSession('LISTENING', seen);
    if (index !== null) offscreenHeapMb.push({ cycle: index, mb: round((await h.heapUsed('/offscreen.html')) / 2 ** 20) });
    expect(await h.inSidePanel(click('capture-stop'))).toBe(true);
    expect(await h.waitForEnd(session.sessionId)).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
    await expect.poll(() => h.offscreenCount(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => h.storage('activeSession')).toBeUndefined();
  };

  for (let i = 0; i < WARM_UP; i++) await cycle(i === 0 ? 0 : null);
  const samples: { cycle: number; reading: Reading }[] = [{ cycle: 0, reading: await measure() }];
  for (let i = 1; i <= CYCLES; i++) {
    const sampled = i % SAMPLE_EVERY === 0;
    await cycle(sampled ? i : null);
    if (sampled) samples.push({ cycle: i, reading: await measure() });
  }
  const first = samples[0]?.reading;
  const last = samples.at(-1)?.reading;
  if (first === undefined || last === undefined) throw new Error('no readings');
  // The extension renderer must have been found, or the measure is not what it claims.
  expect(first.extensionProcesses).toBeGreaterThan(0);
  const growthMb = last.persistentMb - first.persistentMb;
  const report = {
    platform: process.platform,
    cycles: CYCLES,
    warmUp: WARM_UP,
    asserted: `extension renderer + ${PERSISTENT_TYPES.join(' + ')} (${process.platform === 'win32' ? 'PrivateMemorySize64' : 'VmRSS'})`,
    samples: samples.map((s) => ({
      cycle: s.cycle,
      persistentMb: round(s.reading.persistentMb),
      extensionMb: round(s.reading.extensionMb),
      extensionProcesses: s.reading.extensionProcesses,
      treeMb: round(s.reading.treeMb),
    })),
    offscreenHeapMb,
    growthMb: round(growthMb),
    extensionGrowthMb: round(last.extensionMb - first.extensionMb),
    treeGrowthMb: round(last.treeMb - first.treeMb),
  };
  test.info().annotations.push({ type: 'memory', description: JSON.stringify(report) });
  console.log(`cycles: ${JSON.stringify(report)}`);
  expect(growthMb).toBeLessThanOrEqual(MAX_GROWTH_MB);
  await page.close();
});
