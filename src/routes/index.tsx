import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { renderMarkdown } from "@/lib/markdown";
import { compareSemver } from "@/lib/semver";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pobierz Eclipse Launcher" },
      { name: "description", content: "Pobierz najnowszą wersję Eclipse Launchera dla Windows 10/11." },
      { property: "og:title", content: "Pobierz Eclipse Launcher" },
      { property: "og:description", content: "Pobierz najnowszą wersję Eclipse Launchera dla Windows 10/11." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Rel = {
  version: string;
  notes: string | null;
  size: number | null;
  published_at: string | null;
  downloads: number;
};

function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1200);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n.toLocaleString("pl-PL")}</>;
}

function Index() {
  const [rels, setRels] = useState<Rel[] | null>(null);

  useEffect(() => {
    supabase
      .from("releases")
      .select("version,notes,size,published_at,downloads")
      .eq("channel", "stable")
      .eq("published", true)
      .then(({ data }) => {
        const rows = ((data ?? []) as Rel[]).sort((a, b) => compareSemver(b.version, a.version));
        setRels(rows);
      });
  }, []);

  const latest = rels?.[0];
  const total = (rels ?? []).reduce((s, r) => s + (r.downloads ?? 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <header className="animate-rise flex items-center gap-3">
          <Logo size={44} />
          <span className="font-display text-2xl">Eclipse</span>
        </header>

        <section className="animate-rise mt-16" style={{ animationDelay: "0.1s" }}>
          <h1 className="font-display text-6xl leading-none sm:text-7xl">Eclipse Launcher</h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            Jeden launcher. Aktualizuje się sam, zawsze w najnowszej wersji.
          </p>
        </section>

        <section className="animate-rise mt-10 rounded-2xl border border-border bg-card p-6" style={{ animationDelay: "0.2s" }}>
          {latest ? (
            <>
              <a
                href="/api/public/latest?channel=stable&download=1"
                className="btn-press inline-flex items-center rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground"
              >
                Pobierz Eclipse Launcher
              </a>
              <div className="font-mono-num mt-5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>v{latest.version}</span>
                <span>{latest.size ? (latest.size / 1024 / 1024).toFixed(1) + " MB" : ""}</span>
                <span>{latest.published_at ? new Date(latest.published_at).toLocaleDateString("pl-PL") : ""}</span>
                <span>
                  <CountUp value={total} /> pobrań
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{rels === null ? "Ładowanie…" : "Brak opublikowanych wydań."}</p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Wymagania: Windows 10/11 64-bit</p>
        </section>

        {rels && rels.length > 0 && (
          <section className="mt-14">
            <h2 className="animate-rise font-display text-3xl" style={{ animationDelay: "0.3s" }}>Lista zmian</h2>
            <div className="mt-6 space-y-4">
              {rels.slice(0, 5).map((r, i) => (
                <article
                  key={r.version}
                  className="animate-rise rounded-xl border border-border bg-surface-2 p-5"
                  style={{ animationDelay: `${0.35 + i * 0.08}s` }}
                >
                  <div className="font-mono-num flex justify-between text-xs text-muted-foreground">
                    <span className="text-accent">v{r.version}</span>
                    <span>{r.published_at ? new Date(r.published_at).toLocaleDateString("pl-PL") : ""}</span>
                  </div>
                  <div className="mt-2 text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.notes ?? "") }} />
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
