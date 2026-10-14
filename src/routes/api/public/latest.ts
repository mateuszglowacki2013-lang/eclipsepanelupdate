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

async function pickLatest(channel: string): Promise<ReleaseRow | null> {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const { data, error } = await client
    .from("releases")
    .select("id,version,channel,notes,file_path,external_url,size,sha256,mandatory,published_at,downloads")
    .eq("channel", channel)
    .eq("published", true);
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

        let release: ReleaseRow | null;
        try {
          release = await pickLatest(channel);
        } catch {
          return Response.json({ error: "server error" }, { status: 500, headers: CORS });
        }

        if (!release) {
          return Response.json({ version: null }, { status: 200, headers: CORS });
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

        if (wantDownload) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("releases")
            .update({ downloads: (release.downloads ?? 0) + 1 })
            .eq("id", release.id);
          return new Response(null, {
            status: 302,
            headers: { ...CORS, Location: fileUrl! },
          });
        }

        return Response.json(
          {
            version: release.version,
            notes: release.notes ?? "",
            url: fileUrl,
            sha256: release.sha256,
            size: release.size,
            mandatory: release.mandatory,
            publishedAt: release.published_at,
          },
          { status: 200, headers: CORS },
        );
      },
    },
  },
});
