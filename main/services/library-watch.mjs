import fs from "node:fs";
import path from "node:path";
export class LibraryWatch {
  constructor(library, publish) {
    this.library = library;
    this.publish = publish;
    this.watchers = new Map();
    this.timers = new Map();
  }
  watch(folder) {
    folder = path.resolve(folder);
    if (this.watchers.has(folder)) return;
    try {
      const watcher = fs.watch(
        folder,
        { recursive: true, persistent: false },
        (_type, filename) => {
          if (!filename || /(?:^|[\\/])\.sonora-|tag-backups/.test(filename))
            return;
          clearTimeout(this.timers.get(folder));
          this.timers.set(
            folder,
            setTimeout(async () => {
              this.timers.delete(folder);
              if (this.closed) return;
              try {
                await this.library.refresh();
                if (this.closed) return;
                const result = await this.library.scan(folder, {
                  automatic: true,
                });
                this.publish(result.items);
              } catch {}
            }, 900),
          );
        },
      );
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(folder);
      });
      this.watchers.set(folder, watcher);
    } catch {}
  }
  close() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const watcher of this.watchers.values()) watcher.close();
  }
}
