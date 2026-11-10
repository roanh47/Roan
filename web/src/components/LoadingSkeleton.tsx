import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { cssVar, radii, space } from "../theme";

export interface LoadingSkeletonProps {
  rows?: number;
  variant?: "transcript" | "tool" | "compact";
  label?: string;
}

type Variant = NonNullable<LoadingSkeletonProps["variant"]>;

/** Fixed widths (%) — deterministic so every render looks identical. */
const WIDTHS = [96, 82, 64, 91, 74, 56, 88, 69, 47, 78] as const;

const ROW_HEIGHT: Record<Variant, number> = { transcript: 13, tool: 11, compact: 9 };
const WIDTH_SCALE: Record<Variant, number> = { transcript: 1, tool: 0.9, compact: 0.62 };
const MAX_ROWS = 10;

const KEYFRAMES = `@keyframes loadingSkeletonPulse{0%,100%{opacity:1}50%{opacity:.45}}`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function clampRows(rows: number): number {
  if (!Number.isFinite(rows)) return 1;
  return Math.min(MAX_ROWS, Math.max(1, Math.round(rows)));
}

export function LoadingSkeleton({
  rows = 3,
  variant = "transcript",
  label = "Waiting for the model",
}: LoadingSkeletonProps): ReactElement {
  const [animate, setAnimate] = useState<boolean>(() => !prefersReducedMotion());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = (): void => setAnimate(!query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const count = clampRows(rows);
  const height = ROW_HEIGHT[variant];
  const scale = WIDTH_SCALE[variant];

  return (
    <div
      className={`loadingSkeleton loadingSkeleton--${variant}`}
      role="status"
      aria-busy="true"
      style={{ display: "flex", flexDirection: "column", gap: space.sm }}
    >
      <style>{KEYFRAMES}</style>
      {label ? (
        <span style={{ color: cssVar("faint"), fontSize: 11.5, lineHeight: 1.4 }}>{label}</span>
      ) : null}
      <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
        {Array.from({ length: count }, (_unused, index) => {
          const base = WIDTHS[index % WIDTHS.length] ?? 60;
          const style: CSSProperties = {
            width: `${Math.round(base * scale)}%`,
            height,
            borderRadius: radii.sm,
            background: cssVar("line"),
            animation: animate
              ? `loadingSkeletonPulse 1.6s ease-in-out ${(index % 3) * 0.18}s infinite`
              : undefined,
          };
          return <span key={index} style={style} />;
        })}
      </div>
    </div>
  );
}
