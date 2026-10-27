import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Prywatność — Eclipse Launcher" },
      { name: "description", content: "Jakie dane przechowuje Eclipse Launcher: znajomi, szyfrowany czat i anonimowy trening botów." },
      { property: "og:title", content: "Prywatność — Eclipse Launcher" },
      { property: "og:description", content: "Znajomi, szyfrowany czat end-to-end i anonimowy trening botów." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      <h1 className="font-display text-4xl">Prywatność</h1>
      <h2 className="mt-8 text-xl font-medium">Znajomi</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Przechowujemy Twój nick i UUID Minecraft, listę znajomych, publiczny klucz czatu, wiadomości (szyfrowane end-to-end — nie możemy ich odczytać; usuwane po 90 dniach) oraz to, czy jesteś online. Twój serwer widzą znajomi tylko, jeśli na to pozwolisz.
      </p>
      <h2 className="mt-8 text-xl font-medium">Trening botów</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Domyślnie wyłączony. Po włączeniu zapisujemy anonimowe liczniki układów bloków i ruchów (bez nicku, konta, współrzędnych i serwera), przechowywane 30 dni i łączone w publiczny model, dzięki któremu boty chodzą lepiej.
      </p>
      <a href="/" className="mt-10 inline-block text-sm text-accent underline">← Strona główna</a>
    </main>
  );
}
