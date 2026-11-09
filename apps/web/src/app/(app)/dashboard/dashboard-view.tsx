"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { serializeCatalog } from "@/lib/catalog-params";

interface Dashboard {
  total: number;
  byRegion: { region: string; count: number }[];
  byCommodityGroup: { group: string; count: number }[];
  siteSurveyed: number;
  unifiedRegister: number;
  updateStatus: { active: number; outdated: number; inactive: number };
  generatedAt: string;
}

/** Дашборд (OPR-70…73): каждый счётчик ведёт в каталог с тем же фильтром. */
export function DashboardView() {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/v1/dashboard") });

  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  const tiles = [
    { label: t("total"), value: data.total, href: "/catalog" },
    { label: t("siteSurveyed"), value: data.siteSurveyed, href: `/catalog${serializeCatalog({ surveyed: true })}` },
    {
      label: t("unifiedRegister"),
      value: data.unifiedRegister,
      href: `/catalog${serializeCatalog({ unifiedRegister: true })}`,
    },
    { label: t("active"), value: data.updateStatus.active },
    { label: t("outdated"), value: data.updateStatus.outdated },
    { label: t("inactive"), value: data.updateStatus.inactive },
  ];
  const maxRegion = Math.max(1, ...data.byRegion.map((r) => r.count));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const card = (
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader>
                <CardDescription>{tile.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{format.number(tile.value)}</CardTitle>
              </CardHeader>
            </Card>
          );
          return tile.href ? (
            <Link key={tile.label} href={tile.href}>
              {card}
            </Link>
          ) : (
            <div key={tile.label}>{card}</div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("byRegion")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.byRegion.map((r) => (
              <Link key={r.region} href={`/catalog${serializeCatalog({ region: [r.region] })}`} className="block">
                <div className="flex justify-between text-sm">
                  <span>{r.region}</span>
                  <span className="tabular-nums text-muted-foreground">{format.number(r.count)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(r.count / maxRegion) * 100}%` }} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("byGroup")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-5 gap-2">
            {data.byCommodityGroup.map((g) => (
              <Link
                key={g.group}
                href={`/catalog${serializeCatalog({ group: [g.group as "A"] })}`}
                className="rounded-lg border p-3 text-center hover:border-primary/40"
              >
                <div className="text-sm text-muted-foreground">{g.group}</div>
                <div className="text-xl font-semibold tabular-nums">{format.number(g.count)}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("generatedAt", {
          time: format.dateTime(new Date(data.generatedAt), { timeStyle: "short", dateStyle: "short" }),
        })}
      </p>
    </div>
  );
}
