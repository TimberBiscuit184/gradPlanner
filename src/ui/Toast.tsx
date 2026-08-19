import { useEffect } from "react";
import { usePlan } from "../store";

export function Toast() {
  const toast = usePlan((s) => s.toast);
  const showToast = usePlan((s) => s.showToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => showToast(null), toast.level === "ok" ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [toast, showToast]);

  if (!toast) return null;
  const style =
    toast.level === "blocked"
      ? "border-danger text-danger"
      : toast.level === "warning"
        ? `border-warn text-warn ${toast.unconfirmed ? "border-dashed" : ""}`
        : toast.level === "ok"
          ? "border-ok text-ok"
          : "border-line text-ink-dim";
  return (
    <div
      role="alert"
      className={`absolute left-1/2 top-12 z-50 max-w-md -translate-x-1/2 rounded-md border-2 bg-surface px-3 py-2 text-xs shadow-xl ${style}`}
    >
      {toast.text}
    </div>
  );
}
