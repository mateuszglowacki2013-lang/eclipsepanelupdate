import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { renderMarkdown } from "@/lib/markdown";
import { compareSemver, bumpPatch, SEMVER_RE } from "@/lib/semver";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Panel administracyjny — Eclipse Updates" },
      { name: "description", content: "Panel administracyjny serwera aktualizacji Eclipse Launchera." },
      { property: "og:title", content: "Panel administracyjny — Eclipse Updates" },
      { property: "og:description", content: "Panel administracyjny serwera aktualizacji Eclipse Launchera." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Release = {
  id: string;
  version: string;
  channel: string;
  notes: string | null;
  file_path: string | null;
  external_url: string | null;
  file_name: string | null;
  size: number | null;
  sha256: string | null;
  mandatory: boolean;
  published: boolean;
  published_at: string | null;
  downloads: number;
  created_at: string;
};

const inputCls =
  "w-full rounded-lg border border-input bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";
const btnPrimary =
  "btn-press rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40";
const btnGhost =
  "btn-press rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary";

function fmtMB(bytes: number | null): string {
  if (!bytes) return "—";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function AdminPage() {
  const [session, setSession] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(!!s));
    supabase.rpc("has_admin").then(({ data }) => setHasAdmin(!!data));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.rpc("claim_admin").then(() => {
      supabase
        .from("admins")
        .select("user_id")
        .then(({ data }) => setIsAdmin((data ?? []).length > 0));
    });
  }, [session]);

  if (session === null || hasAdmin === null) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Ładowanie…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-6">
        <Logo size={34} />
        <h1 className="font-display text-2xl">Eclipse Updates — panel</h1>
        {session && (
          <button className={`${btnGhost} ml-auto`} onClick={() => supabase.auth.signOut()}>
            Wyloguj
          </button>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-6 pb-16">
        {!session ? (
          <LoginForm allowSignup={!hasAdmin} />
        ) : !isAdmin ? (
          <p className="text-muted-foreground">To konto nie ma uprawnień administratora.</p>
        ) : (
          <AdminPanel />
        )}
      </main>
    </div>
  );
}

function LoginForm({ allowSignup }: { allowSignup: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      setMsg(error ? error.message : "Sprawdź skrzynkę e-mail i potwierdź konto, a potem zaloguj się ponownie.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg("Nieprawidłowy e-mail lub hasło.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="animate-rise mx-auto mt-10 max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
      <h2 className="font-display text-xl">{mode === "login" ? "Zaloguj się" : "Utwórz konto administratora"}</h2>
      <input className={inputCls} type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className={inputCls} type="password" placeholder="Hasło" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button className={`${btnPrimary} w-full`} disabled={busy}>
        {busy ? "…" : mode === "login" ? "Zaloguj" : "Zarejestruj"}
      </button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      {allowSignup && (
        <button type="button" className="text-xs text-accent underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Pierwszy raz? Utwórz konto administratora" : "Masz konto? Zaloguj się"}
        </button>
      )}
    </form>
  );
}

function AdminPanel() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const { data, error } = await supabase.from("releases").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setReleases((data ?? []) as Release[]);
  }

  useEffect(() => {
    load();
  }, []);

  const manifestUrl = `${window.location.origin}/api/public/latest`;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  async function togglePublish(r: Release) {
    await supabase
      .from("releases")
      .update(r.published ? { published: false } : { published: true, published_at: new Date().toISOString() })
      .eq("id", r.id);
    load();
  }

  async function remove(r: Release) {
    if (!window.confirm(`Usunąć wydanie ${r.version} (${r.channel})? Plik zostanie też usunięty.`)) return;
    if (r.file_path) await supabase.storage.from("releases").remove([r.file_path]);
    await supabase.from("releases").delete().eq("id", r.id);
    load();
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="space-y-8">
      <NewReleaseCard releases={releases} onSaved={load} />

      <section className="animate-rise rounded-xl border border-border bg-card p-6" style={{ animationDelay: "0.1s" }}>
        <h2 className="font-display text-xl">Wydania</h2>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-2 pr-4">Wersja</th>
                <th className="pb-2 pr-4">Kanał</th>
                <th className="pb-2 pr-4">Rozmiar</th>
                <th className="pb-2 pr-4">Data</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Pobrania</th>
                <th className="pb-2">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 pr-4 font-mono-num text-xs">{r.version}</td>
                  <td className="py-2 pr-4">{r.channel}</td>
                  <td className="py-2 pr-4 font-mono-num text-xs">{fmtMB(r.size)}</td>
                  <td className="py-2 pr-4 font-mono-num text-xs">
                    {r.published_at ? new Date(r.published_at).toLocaleDateString("pl-PL") : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {r.published ? (r.mandatory ? "Wymuszone" : "Opublikowane") : "Szkic"}
                  </td>
                  <td className="py-2 pr-4 font-mono-num text-xs">{r.downloads}</td>
                  <td className="flex flex-wrap gap-2 py-2">
                    <button className={btnGhost} onClick={() => togglePublish(r)}>
                      {r.published ? "Wycofaj" : "Opublikuj"}
                    </button>
                    <button className={btnGhost} onClick={() => copy(`${manifestUrl}?channel=${r.channel}&download=1`)}>
                      Kopiuj link
                    </button>
                    <button className={`${btnGhost} text-destructive`} onClick={() => remove(r)}>
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
              {releases.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    Brak wydań.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="animate-rise rounded-xl border border-border bg-card p-6" style={{ animationDelay: "0.2s" }}>
        <h2 className="font-display text-xl">Adres dla launchera</h2>
        <p className="mt-1 text-sm text-muted-foreground">Wklej to do launcher/electron/update.config.json</p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <code className="font-mono-num flex-1 overflow-x-auto rounded-lg bg-secondary px-3 py-2 text-xs">{manifestUrl}</code>
            <button className={btnGhost} onClick={() => copy(manifestUrl)}>Kopiuj</button>
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono-num flex-1 overflow-x-auto rounded-lg bg-secondary px-3 py-2 text-xs">{anonKey}</code>
            <button className={btnGhost} onClick={() => copy(anonKey)}>Kopiuj</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function NewReleaseCard({ releases, onSaved }: { releases: Release[]; onSaved: () => void }) {
  const [channel, setChannel] = useState<"stable" | "beta">("stable");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [externalMode, setExternalMode] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [manualSha, setManualSha] = useState("");
  const [manualSize, setManualSize] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sha, setSha] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [speed, setSpeed] = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const channelReleases = releases.filter((r) => r.channel === channel);

  useEffect(() => {
    const published = channelReleases.filter((r) => r.published);
    if (published.length) {
      const top = [...published].sort((a, b) => compareSemver(b.version, a.version))[0];
      setVersion(bumpPatch(top.version));
    } else {
      setVersion("1.0.0");
    }
  }, [channel, releases.length]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".exe")) {
      setStatus("Dozwolone są tylko pliki .exe");
      return;
    }
    setFile(f);
    setSha("");
    setStatus("Liczę sumę kontrolną…");
    const buf = await f.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    setSha(hex);
    setStatus("");
  }

  function validate(): string | null {
    if (!SEMVER_RE.test(version)) return "Nieprawidłowa wersja (oczekiwany format: 1.2.0 lub 1.3.0-beta.1).";
    for (const r of channelReleases.filter((x) => x.published)) {
      if (compareSemver(version, r.version) <= 0)
        return `Wersja musi być wyższa niż ${r.version} (najnowsza opublikowana w kanale ${channel}).`;
    }
    if (channelReleases.some((x) => x.version === version)) return "Ta wersja już istnieje w tym kanale.";
    if (externalMode) {
      if (!/^https?:\/\//.test(externalUrl)) return "Podaj prawidłowy zewnętrzny link.";
      if (!/^[0-9a-f]{64}$/.test(manualSha)) return "SHA-256 musi mieć 64 znaki hex (małe litery).";
      if (!/^\d+$/.test(manualSize)) return "Podaj rozmiar w bajtach.";
    } else if (!file) {
      return "Wybierz plik .exe albo przełącz na zewnętrzny link.";
    }
    return null;
  }

  function uploadFile(path: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      let lastT = performance.now();
      let lastLoaded = 0;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(e.loaded / e.total);
        const now = performance.now();
        if (now - lastT > 500) {
          const mbps = ((e.loaded - lastLoaded) / 1024 / 1024) / ((now - lastT) / 1000);
          setSpeed(mbps.toFixed(1) + " MB/s");
          lastT = now;
          lastLoaded = e.loaded;
        }
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(
        xhr.status === 413
          ? "Plik przekracza limit projektu. Użyj opcji „Zewnętrzny link”."
          : `Błąd przesyłania (${xhr.status}). Spróbuj ponownie lub użyj opcji „Zewnętrzny link”.`
      )));
      xhr.onerror = () => reject(new Error("Błąd sieci podczas przesyłania."));
      xhr.open("POST", `${base}/storage/v1/object/releases/${path}`);
      xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "true");
      xhr.send(file);
    });
  }

  async function save(publish: boolean) {
    const err = validate();
    if (err) {
      setStatus(err);
      return;
    }
    setStatus(publish ? "Publikuję…" : "Zapisuję…");
    setProgress(null);
    try {
      let file_path: string | null = null;
      if (!externalMode && file) {
        file_path = `${channel}/${version}/${file.name}`;
        setStatus("Przesyłam plik…");
        await uploadFile(file_path);
      }
      const row = {
        version,
        channel,
        notes,
        mandatory,
        file_path,
        external_url: externalMode ? externalUrl : null,
        file_name: externalMode ? null : file!.name,
        size: externalMode ? Number(manualSize) : file!.size,
        sha256: externalMode ? manualSha : sha,
        published: publish,
        published_at: publish ? new Date().toISOString() : null,
      };
      const { error } = await supabase.from("releases").insert(row);
      if (error) throw error;
      setStatus(publish ? "Opublikowano!" : "Zapisano szkic.");
      setFile(null);
      setSha("");
      setNotes("");
      setExternalUrl("");
      setManualSha("");
      setManualSize("");
      setProgress(null);
      onSaved();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Wystąpił błąd.");
    }
  }

  return (
    <section className="animate-rise rounded-xl border border-border bg-card p-6">
      <h2 className="font-display text-xl">Nowe wydanie</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted-foreground">Wersja</span>
          <input className={`${inputCls} mt-1 font-mono-num`} value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Kanał</span>
          <select className={`${inputCls} mt-1`} value={channel} onChange={(e) => setChannel(e.target.value as "stable" | "beta")}>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
          </select>
        </label>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={externalMode} onChange={(e) => setExternalMode(e.target.checked)} />
        Zewnętrzny link do .exe
      </label>

      {externalMode ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block text-sm sm:col-span-3">
            <span className="text-muted-foreground">Link do pliku</span>
            <input className={`${inputCls} mt-1`} placeholder="https://github.com/…/Eclipse.Setup.exe" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted-foreground">SHA-256 (64 znaki hex)</span>
            <input className={`${inputCls} mt-1 font-mono-num`} value={manualSha} onChange={(e) => setManualSha(e.target.value.toLowerCase())} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Rozmiar (bajty)</span>
            <input className={`${inputCls} mt-1 font-mono-num`} value={manualSize} onChange={(e) => setManualSize(e.target.value)} />
          </label>
        </div>
      ) : (
        <div
          className={`mt-4 rounded-xl border border-dashed p-8 text-center text-sm transition-colors ${dragOver ? "border-accent bg-secondary" : "border-border"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          {file ? (
            <p>
              <span className="font-mono-num text-xs">{file.name}</span> — {fmtMB(file.size)}
              {sha && <span className="block mt-1 font-mono-num text-[10px] text-muted-foreground break-all">SHA-256: {sha}</span>}
            </p>
          ) : (
            <p className="text-muted-foreground">Przeciągnij tu plik .exe lub</p>
          )}
          <input
            type="file"
            accept=".exe"
            className="mt-3 text-xs"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      )}

      {progress !== null && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-1 font-mono-num text-xs text-muted-foreground">
            {Math.round(progress * 100)}% · {speed}
            <button className="ml-3 text-destructive underline" onClick={() => xhrRef.current?.abort()}>
              Anuluj
            </button>
          </p>
        </div>
      )}

      <label className="mt-4 block text-sm">
        <span className="text-muted-foreground">Zmiany (markdown)</span>
        <textarea className={`${inputCls} mt-1 min-h-28`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {notes && (
        <div className="mt-2 rounded-lg border border-border bg-secondary p-3 text-sm">
          <p className="mb-1 text-xs text-muted-foreground">Podgląd:</p>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(notes) }} />
        </div>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
        Wymuszona aktualizacja
      </label>

      {status && <p className="mt-4 text-sm text-muted-foreground">{status}</p>}

      <div className="mt-4 flex gap-3">
        <button className={btnGhost} onClick={() => save(false)}>Zapisz szkic</button>
        <button className={btnPrimary} onClick={() => save(true)}>Opublikuj</button>
      </div>
    </section>
  );
}
