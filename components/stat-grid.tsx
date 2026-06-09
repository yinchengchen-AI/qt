import type { ReactNode } from "react";
import styles from "./stat-grid.module.css";

export type StatItem = {
  label: ReactNode;
  value: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** 数字下方的小说明 */
  description?: ReactNode;
  /** 强调色:default | accent(琥珀) | danger */
  tone?: "default" | "accent" | "danger" | "success" | "info";
  /** delta:正绿/负红 */
  delta?: { value: ReactNode; direction?: "up" | "down" | "flat" };
};

type Props = {
  items: StatItem[];
  /** 桌面列数:2 / 3 / 4 / 6,默认 4 */
  columns?: 2 | 3 | 4 | 6;
  loading?: boolean;
  className?: string;
};

const COLS: Record<number, string> = {
  2: "cols2",
  3: "cols3",
  4: "cols4",
  6: "cols6"
};

const TONE_CLASS: Record<string, string> = {
  default: styles.toneDefault ?? "",
  accent:  styles.toneAccent  ?? "",
  danger:  styles.toneDanger  ?? "",
  success: styles.toneSuccess ?? "",
  info:    styles.toneInfo    ?? ""
};

export function StatGrid({ items, columns = 4, loading, className }: Props) {
  const colClass = COLS[columns] ?? "cols4";
  return (
    <div data-testid="stat-grid" className={[styles.grid, styles[colClass] ?? "", className ?? ""].filter(Boolean).join(" ")}>
      {items.map((it, i) => {
        const tone = it.tone ?? "default";
        return (
          <div
            key={i}
            className={[styles.card, TONE_CLASS[tone] ?? "", loading ? styles.loading : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className={styles.label}>{it.label}</div>
            <div className={styles.valueRow}>
              {it.prefix ? <span className={styles.affix}>{it.prefix}</span> : null}
              <span className={styles.value}>
                {loading ? <span className={styles.skel} /> : it.value}
              </span>
              {it.suffix ? <span className={styles.affix}>{it.suffix}</span> : null}
            </div>
            {it.description ? <div className={styles.desc}>{it.description}</div> : null}
            {it.delta ? (
              <div
                className={[
                  styles.delta,
                  it.delta.direction === "down" ? styles.deltaDown : "",
                  it.delta.direction === "flat"  ? styles.deltaFlat  : ""
                ].filter(Boolean).join(" ")}
              >
                {it.delta.value}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
