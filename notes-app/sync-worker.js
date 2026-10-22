// Vault dizinini ayrı iş parçacığında eşitler (artımlı; ilk çalıştırmada tümünü indeksler).
import { parentPort } from 'node:worker_threads';
import { Vault } from '../core/vault.js';

const vault = new Vault();
const result = vault.idx.sync((p) => parentPort.postMessage({ type: 'progress', ...p }));
vault.close();
parentPort.postMessage({ type: 'done', result });
