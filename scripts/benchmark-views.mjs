// CPU microbenchmark only: this does not measure browser frames or Tauri latency.
// Run from the repository root: node scripts/benchmark-views.mjs
import { createServer } from "vite";
import { performance } from "node:perf_hooks";
import { cpus, platform, arch } from "node:os";
const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});
try {
  const { viewsFixture } = await server.ssrLoadModule(
    "/tests/reference/views59.ts",
  );
  const samples = 100,
    batch = 100;
  const results = {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    samples,
    operationsPerSample: batch,
    measurements: [],
  };
  for (const [pieces, combinations] of [
    [1, 0],
    [20, 20],
  ]) {
    const project = viewsFixture(pieces, combinations);
    const reduced = { ...project, pieces: [project.pieces[0]] };
    const times = { full: [], reduced: [] };
    for (let i = -10; i < samples; i++) {
      // Alternate order to reduce systematic warm-up/drift bias.
      for (const name of i % 2 ? ["full", "reduced"] : ["reduced", "full"]) {
        const data = name === "full" ? project : reduced;
        const start = performance.now();
        for (let j = 0; j < batch; j++) structuredClone(data);
        if (i >= 0) times[name].push((performance.now() - start) / batch);
      }
    }
    const stats = (values) => {
      values.sort((a, b) => a - b);
      return {
        medianMs: values[Math.floor(values.length / 2)],
        p95Ms: values[Math.ceil(values.length * 0.95) - 1],
      };
    };
    results.measurements.push({
      pieces,
      additionalCombinations: combinations,
      jsonBytes: {
        full: Buffer.byteLength(JSON.stringify(project)),
        reduced: Buffer.byteLength(JSON.stringify(reduced)),
      },
      structuredClone: {
        full: stats(times.full),
        reduced: stats(times.reduced),
      },
    });
  }
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
} finally {
  await server.close();
}
