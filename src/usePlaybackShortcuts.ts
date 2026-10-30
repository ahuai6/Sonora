import { useEffect } from "react";
import { isInteractiveTarget } from "./interaction";
export function usePlaybackShortcuts({
  enabled,
  onToggle,
  onSearch,
  onEscape,
}: {
  enabled: boolean;
  onToggle: () => void;
  onSearch: () => void;
  onEscape: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInteractiveTarget(e.target)) return;
      if (e.code === "Space" && enabled) {
        e.preventDefault();
        onToggle();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        onSearch();
      }
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onToggle, onSearch, onEscape]);
}
