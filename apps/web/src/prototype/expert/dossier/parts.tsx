import type { ReactNode } from "react";

/** Список «подпись — значение», как на странице компании; на узком экране — в одну колонку. */
export function Fields({ children }: { children: ReactNode }) {
  return <dl className="grid gap-3 text-sm sm:grid-cols-2">{children}</dl>;
}

export function FieldItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
