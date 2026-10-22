// Taramayı ayrı iş parçacığında çalıştırır; büyük taramalar sunucuyu (arayüz sorgularını) dondurmaz.
import { parentPort, workerData } from 'node:worker_threads';
import { buildGraph } from './build.js';

try {
  const { stats } = buildGraph({
    full: !!workerData?.full,
    onProgress: (p) => parentPort.postMessage({ type: 'progress', ...p }),
  });
  parentPort.postMessage({ type: 'done', stats });
} catch (e) {
  parentPort.postMessage({ type: 'error', error: String(e?.stack || e) });
}
