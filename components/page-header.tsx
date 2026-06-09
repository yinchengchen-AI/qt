import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftOutlined } from "@ant-design/icons";
import styles from "./page-header.module.css";

type Crumb = { label: string; href?: string };

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** true = 显示 ←,string = 自定义返回文字(默认 "返回");function = 自定义 onClick */
  back?: boolean | string | (() => void);
  actions?: ReactNode;
  meta?: ReactNode;
  breadcrumb?: Crumb[];
  /** "page" 大标题 22px; "section" 子区块 16px */
  level?: "page" | "section";
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  meta,
  breadcrumb,
  level = "page",
  className
}: Props) {
  const isSection = level === "section";

  function renderBack() {
    if (!back) return null;
    const onClick = typeof back === "function" ? back : undefined;
    const label = typeof back === "string" ? back : "返回";
    return (
      <button
        type="button"
        className={styles.back}
        onClick={onClick}
        aria-label="返回上一页"
      >
        <ArrowLeftOutlined />
        <span>{label}</span>
      </button>
    );
  }

  function renderBreadcrumb() {
    if (!breadcrumb?.length) return null;
    return (
      <nav className={styles.crumbs} aria-label="breadcrumb">
        {breadcrumb.map((c, i) => {
          const last = i === breadcrumb.length - 1;
          return (
            <span key={i} className={styles.crumbItem}>
              {c.href && !last ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span className={last ? styles.crumbCurrent : ""}>{c.label}</span>
              )}
              {!last && <span className={styles.crumbSep}>/</span>}
            </span>
          );
        })}
      </nav>
    );
  }

  return (
    <header
      className={[
        styles.header,
        isSection ? styles.section : "",
        className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {renderBreadcrumb()}
      <div className={styles.row}>
        <div className={styles.titleBlock}>
          {renderBack()}
          <div className={styles.titles}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
        </div>
        {(actions || meta) && (
          <div className={styles.right}>
            {meta ? <div className={styles.meta}>{meta}</div> : null}
            {actions ? <div className={styles.actions}>{actions}</div> : null}
          </div>
        )}
      </div>
    </header>
  );
}
