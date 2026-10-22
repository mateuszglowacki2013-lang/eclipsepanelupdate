import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { compareSemver } from "@/lib/semver";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Cache-Control": "no-store",
};

type ReleaseRow = {
  id: string;
  version: string;
  channel: string;
  notes: string | null;
  file_path: string | null;
  external_url: string | null;
  size: number | null;
  sha256: string | null;
  mandatory: boolean;
  published_at: string | null;
  downloads: number;
};

function publicClient() {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) throw new Error("Missing storage configuration");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
        if (key.startsWith('sb_') && headers.get('Authorization') === `Bearer ${key}`) {
          headers.delete('Authorization');
        }
        headers.set('apikey', key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function pickLatest(channel: string, releaseId: string | null): Promise<ReleaseRow | null> {
  const client = publicClient();
  let query = client
    .from("releases")
    .select("id,version,channel,notes,file_path,external_url,size,sha256,mandatory,published_at,downloads")
    .eq("channel", channel)
    .eq("published", true);
  if (releaseId) query = query.eq("id", releaseId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as ReleaseRow[];
  rows.sort((a, b) => compareSemver(b.version, a.version));
  return rows[0] ?? null;
}

export const Route = createFileRoute("/api/public/latest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const channel = u.searchParams.get("channel") === "beta" ? "beta" : "stable";
        const wantDownload = u.searchParams.get("download") === "1";
        const releaseId = u.searchParams.get("id");
        if (releaseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(releaseId)) {
          return Response.json({ error: "invalid release" }, { status: 400, headers: CORS });
        }

        let release: ReleaseRow | null;
        try {
          release = await pickLatest(channel, releaseId);
        } catch {
          return Response.json({ error: "server error" }, { status: 500, headers: CORS });
        }

        if (!release) {
          return Response.json({ version: null }, { status: 200, headers: CORS });
        }

        if (!wantDownload) {
          return Response.json(
            {
              version: release.version,
              notes: release.notes ?? "",
              url: release.external_url || release.file_path
                ? `${u.origin}/api/public/latest?channel=${channel}&download=1&id=${release.id}`
                : null,
              sha256: release.sha256,
              size: release.size,
              mandatory: release.mandatory,
              publishedAt: release.published_at,
            },
            { status: 200, headers: CORS },
          );
        }

        let fileUrl = release.external_url;
        if (!fileUrl && release.file_path) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.storage
            .from("releases")
            .createSignedUrl(release.file_path, 3600);
          if (error || !data?.signedUrl) {
            return Response.json({ error: "file unavailable" }, { status: 500, headers: CORS });
          }
          fileUrl = data.signedUrl;
        }

        if (!fileUrl) {
          return Response.json({ error: "file unavailable" }, { status: 404, headers: CORS });
        }
        // Only this narrowly granted function may update a public download counter.
        // It increments in SQL, so simultaneous downloads do not overwrite each other.
        const { error } = await publicClient().rpc("record_release_download", { release_id: release.id });
        if (error) console.error("Download counter update failed:", error.code);
        return new Response(null, {
          status: 302,
          headers: { ...CORS, Location: fileUrl },
        });
      },
    },
  },
});
