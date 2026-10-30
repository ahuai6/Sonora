import path from "node:path";
import fs from "node:fs";

export class CollectionActions {
  constructor(
    library,
    downloads,
    { confirmTrash, trashFile, suspendFile } = {},
  ) {
    Object.assign(this, {
      library,
      downloads,
      confirmTrash,
      trashFile,
      suspendFile,
    });
    this.refreshing = null;
    this.busy = false;
  }
  snapshot(extra = {}) {
    return {
      ...extra,
      items: this.library.list(),
      jobs: this.downloads.publicJobs(),
    };
  }
  refresh() {
    if (!this.refreshing)
      this.refreshing = (async () => {
        const result = await this.library.refresh();
        await this.downloads.refresh();
        return this.snapshot(result);
      })().finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
  async batch(scope, ids, action) {
    if (
      !["library", "downloads"].includes(scope) ||
      !Array.isArray(ids) ||
      ids.length > 15000 ||
      ids.some((id) => typeof id !== "string")
    )
      throw Error("批量选择不正确");
    const actions =
      scope === "library"
        ? ["remove", "trash"]
        : ["pause", "cancel", "retry", "remove", "trash"];
    if (!actions.includes(action)) throw Error("不支持的批量操作");
    if (this.busy) throw Error("上一项批量操作尚未完成，请稍候");
    this.busy = true;
    try {
      const selected = new Set(ids),
        failures = [];
      let changed = 0,
        skipped = 0;
      const list = (
        scope === "library" ? this.library.list() : this.downloads.jobs
      ).filter((item) => selected.has(item.id));
      if (action === "remove" && scope === "library") {
        this.library.removeMany(list.map((item) => item.id));
        changed = list.length;
      } else if (action !== "trash") {
        ({ changed, skipped } = await this.downloads.batchAction(ids, action));
      } else {
        const eligible = list.filter(
          (item) =>
            scope === "library" ||
            (!!item.path &&
              ![
                "queued",
                "resolving",
                "downloading",
                "tagging",
                "committing",
              ].includes(item.status)),
        );
        skipped = list.length - eligible.length;
        if (!eligible.length)
          return this.snapshot({ changed, skipped, failures });
        if (!(await this.confirmTrash(eligible.length)))
          return this.snapshot({
            changed: 0,
            skipped: 0,
            failures,
            cancelled: true,
          });
        for (const item of eligible) {
          // Re-check live state after the native confirmation dialog.
          if (
            scope === "downloads" &&
            (!this.downloads.jobs.includes(item) ||
              [
                "queued",
                "resolving",
                "downloading",
                "tagging",
                "committing",
              ].includes(item.status))
          ) {
            skipped++;
            continue;
          }
          if (scope === "library" && !this.library.list().includes(item)) {
            skipped++;
            continue;
          }
          let release;
          try {
            release = await this.suspendFile?.(item.path);
            try {
              await fs.promises.lstat(item.path);
              await this.trashFile(item.path);
            } catch (e) {
              if (!["ENOENT", "ENOTDIR"].includes(e.code)) {
                // Electron's trashItem errors do not consistently include a code.
                let exists = true;
                try {
                  await fs.promises.lstat(item.path);
                } catch (check) {
                  if (["ENOENT", "ENOTDIR"].includes(check.code))
                    exists = false;
                  else throw e;
                }
                if (exists) throw e;
              }
            }
            const key = path.resolve(item.path).toLowerCase();
            this.library.removeMany(
              this.library
                .list()
                .filter((x) => path.resolve(x.path).toLowerCase() === key)
                .map((x) => x.id),
            );
            if (scope === "downloads")
              await this.downloads.batchAction([item.id], "remove");
            changed++;
          } catch (e) {
            failures.push({ id: item.id, message: e.message });
          } finally {
            release?.();
          }
        }
        await this.downloads.refresh();
      }
      return this.snapshot({ changed, skipped, failures });
    } finally {
      this.busy = false;
    }
  }
}
