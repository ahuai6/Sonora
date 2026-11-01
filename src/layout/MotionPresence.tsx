import { useEffect, useState, type ReactNode } from "react";
export default function MotionPresence({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(
      () => setMounted(false),
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.dataset.motion === "reduced"
        ? 0
        : 280,
    );
    return () => clearTimeout(timer);
  }, [visible]);
  return mounted || visible ? (
    <div className="listening-presence" data-open={visible}>
      {children}
    </div>
  ) : null;
}
