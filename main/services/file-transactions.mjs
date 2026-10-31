import path from "node:path";
export class FileTransactions {
  constructor() {
    this.pending = new Map();
  }
  async acquire(file) {
    const key = path.resolve(file).toLowerCase(),
      previous = this.pending.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this.pending.set(key, current);
    await previous;
    return () => {
      release();
      if (this.pending.get(key) === current) this.pending.delete(key);
    };
  }
}
