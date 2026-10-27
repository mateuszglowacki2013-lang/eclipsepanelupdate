import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};
const json = (d: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
const err = (m: string, s: number) => json({ error: m }, s);

const MOVES = ["WALK", "STEP_UP", "JUMP_UP", "DROP1", "DROP2", "DROP3", "CLIMB_UP", "CLIMB_DOWN", "CROUCH"];
const UUID_RE = /^[0-9a-f]{32}$/;
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmacKey() {
  const secret = process.env["ECLIPSE_JWT_SECRET"] || "eclipse-jwt:" + process.env["SUPABASE_SERVICE_ROLE_KEY"];
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signJwt(sub: string) {
  const h = b64u(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const p = b64u(enc.encode(JSON.stringify({ sub, iat: now, exp: now + 30 * 86400 })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
async function verifyJwt(req: Request): Promise<string | null> {
  const t = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const [h, p, s] = t.split(".");
  if (!h || !p || !s) return null;
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), sig, enc.encode(`${h}.${p}`));
  if (!ok) return null;
  const pl = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  if (!pl.exp || pl.exp < Date.now() / 1000 || !UUID_RE.test(pl.sub)) return null;
  return pl.sub;
}
const pair = (x: string, y: string) => (x < y ? { a: x, b: y } : { a: y, b: x });

async function handle(request: Request, name: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const m = request.method;
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  // ---------- public (no login) ----------
  if (name === "eclipse-auth-start" && m === "POST") {
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await db.from("auth_challenges").delete().lt("created_at", new Date(Date.now() - 600000).toISOString());
    const { count } = await db.from("auth_challenges").select("server_id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if ((count ?? 0) >= 30) return err("Too many sign-in attempts", 429);
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const serverId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await db.from("auth_challenges").insert({ server_id: serverId, ip });
    return json({ serverId });
  }
  if (name === "eclipse-auth" && m === "POST") {
    const b = await body();
    const H = { "User-Agent": "EclipseLauncher/1.0", Accept: "application/json" };
    let uuid: string, pname: string;
    if (typeof b.serverId === "string" && typeof b.name === "string") {
      if (!/^[0-9a-f]{40}$/.test(b.serverId) || !/^[A-Za-z0-9_]{1,16}$/.test(b.name)) return err("Sign-in expired, try again", 401);
      const { data: ch } = await db.from("auth_challenges").delete().eq("server_id", b.serverId).select().maybeSingle();
      if (!ch || Date.now() - new Date(ch.created_at).getTime() > 600000) return err("Sign-in expired, try again", 401);
      const r = await fetch(`https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(b.name)}&serverId=${b.serverId}`, { headers: H });
      if (r.status !== 200) return err("Minecraft did not confirm this account", 401);
      const prof = await r.json().catch(() => null);
      if (!prof?.id) return err("Minecraft did not confirm this account", 401);
      uuid = String(prof.id).replace(/-/g, "").toLowerCase(); pname = prof.name;
    } else {
      const { mcAccessToken } = b;
      if (typeof mcAccessToken !== "string" || !mcAccessToken) return err("name and serverId required", 400);
      const r = await fetch("https://api.minecraftservices.com/minecraft/profile", { headers: { ...H, Authorization: `Bearer ${mcAccessToken}` } });
      if (r.status === 401) return err("Invalid Minecraft token", 401);
      if (r.status !== 200) return err(`Mojang is not reachable right now (status ${r.status})`, 502);
      const prof = await r.json();
      uuid = String(prof.id).replace(/-/g, "").toLowerCase(); pname = prof.name;
    }
    await db.from("players").upsert({ uuid, name: pname, last_seen: new Date().toISOString() });
    return json({ token: await signJwt(uuid), uuid, name: pname });
  }
  if (name === "training-upload" && m === "POST") {
    const raw = await request.text();
    if (raw.length > 200 * 1024) return err("Upload too large", 413);
    let b: any; try { b = JSON.parse(raw); } catch { return err("Invalid JSON", 400); }
    const id = b?.installId;
    if (typeof id !== "string" || id.length < 8 || id.length > 64) return err("Invalid installId", 400);
    if (!Array.isArray(b.samples) || b.samples.length > 2000) return err("Invalid samples", 400);
    for (const s of b.samples) {
      if (typeof s?.pattern !== "string" || !/^[A-Z0-9.|]{1,64}$/.test(s.pattern)) return err("Invalid pattern", 400);
      if (!MOVES.includes(s.move)) return err("Invalid move", 400);
      if (!Number.isInteger(s.count) || s.count < 1 || s.count > 10000) return err("Invalid count", 400);
    }
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await db.from("training_uploads").select("id", { count: "exact", head: true }).eq("install_id", id).gte("received_at", since);
    if ((count ?? 0) >= 30) return err("Daily upload limit reached", 429);
    const samples = b.samples.map((s: any) => ({ pattern: s.pattern, move: s.move, count: s.count }));
    await db.from("training_uploads").insert({ install_id: id, mc_version: String(b.mcVersion ?? "").slice(0, 20) || null, samples });
    return json({ ok: true });
  }
  if (name === "training-model" && m === "GET") {
    const { data: meta } = await db.from("movement_model_meta").select("*").eq("id", 1).maybeSingle();
    const { data } = await db.from("movement_model").select("pattern,move,count,players").gte("players", 3).order("count", { ascending: false }).limit(20000);
    return json({ version: meta?.version ?? 0, generatedAt: meta?.generated_at ?? null, moves: data ?? [] }, 200, { "Cache-Control": "public, max-age=3600" });
  }

  // ---------- login required ----------
  const me = await verifyJwt(request);
  if (!me) return err("Unauthorized", 401);

  if (name === "keys" && m === "POST") {
    const { publicKey } = await body();
    if (typeof publicKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) return err("Invalid publicKey", 400);
    await db.from("players").update({ public_key: publicKey }).eq("uuid", me);
    return json({ ok: true });
  }
  if (name === "settings" && m === "POST") {
    const { shareServer } = await body();
    if (typeof shareServer !== "boolean") return err("shareServer must be boolean", 400);
    await db.from("players").update({ share_server: shareServer }).eq("uuid", me);
    return json({ ok: true });
  }
  if (name === "presence" && m === "POST") {
    const b = await body();
    if (!["online", "in_game", "offline"].includes(b.status)) return err("Invalid status", 400);
    await db.from("presence").upsert({
      uuid: me, status: b.status, updated_at: new Date().toISOString(),
      server_address: typeof b.serverAddress === "string" ? b.serverAddress.slice(0, 255) : null,
      mc_version: typeof b.mcVersion === "string" ? b.mcVersion.slice(0, 20) : null,
    });
    await db.from("players").update({ last_seen: new Date().toISOString() }).eq("uuid", me);
    return json({ ok: true });
  }
  if (name === "friends-list" && m === "GET") {
    const { data: fr } = await db.from("friendships").select("a,b").eq("status", "accepted").or(`a.eq.${me},b.eq.${me}`);
    const ids = (fr ?? []).map((f: any) => (f.a === me ? f.b : f.a));
    if (!ids.length) return json([]);
    const [{ data: pl }, { data: pr }, { data: un }] = await Promise.all([
      db.from("players").select("uuid,name,share_server,public_key,last_seen").in("uuid", ids),
      db.from("presence").select("*").in("uuid", ids),
      db.from("messages").select("sender").eq("recipient", me).is("read_at", null).in("sender", ids),
    ]);
    const out = (pl ?? []).map((p: any) => {
      const s = (pr ?? []).find((x: any) => x.uuid === p.uuid);
      const fresh = s && Date.now() - new Date(s.updated_at).getTime() < 90000;
      const status = fresh ? s.status : "offline";
      return {
        uuid: p.uuid, name: p.name, status,
        server: fresh && p.share_server && s.server_address ? { address: s.server_address, version: s.mc_version } : null,
        lastSeen: p.last_seen,
        unread: (un ?? []).filter((x: any) => x.sender === p.uuid).length,
        publicKey: p.public_key,
      };
    });
    return json(out);
  }
  if (name === "friends-requests" && m === "GET") {
    const { data: fr } = await db.from("friendships").select("*").eq("status", "pending").or(`a.eq.${me},b.eq.${me}`);
    const ids = (fr ?? []).map((f: any) => (f.a === me ? f.b : f.a));
    const { data: pl } = ids.length ? await db.from("players").select("uuid,name").in("uuid", ids) : { data: [] };
    const nm = (u: string) => (pl ?? []).find((p: any) => p.uuid === u)?.name ?? null;
    const incoming: any[] = [], outgoing: any[] = [];
    for (const f of fr ?? []) {
      const other = f.a === me ? f.b : f.a;
      (f.requested_by === me ? outgoing : incoming).push({ uuid: other, name: nm(other), at: f.created_at });
    }
    return json({ incoming, outgoing });
  }
  if (name === "friends-add" && m === "POST") {
    const { name: nick } = await body();
    if (typeof nick !== "string" || !/^[A-Za-z0-9_]{1,16}$/.test(nick)) return err("Invalid name", 400);
    const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${nick}`);
    if (r.status !== 200) return err("No Minecraft account with that name", 404);
    const p = await r.json();
    const other = String(p.id).toLowerCase();
    if (other === me) return err("You cannot add yourself", 400);
    const { count } = await db.from("friendships").select("a", { count: "exact", head: true }).or(`a.eq.${me},b.eq.${me}`);
    if ((count ?? 0) >= 200) return err("Friend limit reached (200)", 400);
    await db.from("players").upsert({ uuid: other, name: p.name }, { onConflict: "uuid", ignoreDuplicates: true });
    const k = pair(me, other);
    const { data: ex } = await db.from("friendships").select("*").match(k).maybeSingle();
    if (ex) {
      if (ex.status === "pending" && ex.requested_by !== me) {
        await db.from("friendships").update({ status: "accepted" }).match(k);
        return json({ ok: true, status: "accepted" });
      }
      return json({ ok: true, status: ex.status });
    }
    await db.from("friendships").insert({ ...k, status: "pending", requested_by: me });
    return json({ ok: true, status: "pending" });
  }
  if (name === "friends-respond" && m === "POST") {
    const { uuid, accept } = await body();
    if (!UUID_RE.test(uuid ?? "")) return err("Invalid uuid", 400);
    const k = pair(me, uuid);
    const { data: ex } = await db.from("friendships").select("*").match(k).maybeSingle();
    if (!ex || ex.status !== "pending" || ex.requested_by === me) return err("No such request", 404);
    if (accept === true) await db.from("friendships").update({ status: "accepted" }).match(k);
    else await db.from("friendships").delete().match(k);
    return json({ ok: true });
  }
  if (name === "friends-remove" && m === "POST") {
    const { uuid } = await body();
    if (!UUID_RE.test(uuid ?? "")) return err("Invalid uuid", 400);
    await db.from("friendships").delete().match(pair(me, uuid));
    return json({ ok: true });
  }
  if (name === "messages") {
    const isFriend = async (o: string) => {
      const { data } = await db.from("friendships").select("status").match(pair(me, o)).maybeSingle();
      return data?.status === "accepted";
    };
    if (m === "GET") {
      const u = new URL(request.url);
      const w = u.searchParams.get("with") ?? "";
      if (!UUID_RE.test(w)) return err("Invalid with", 400);
      let q = db.from("messages").select("id,sender,recipient,text,created_at,read_at")
        .or(`and(sender.eq.${me},recipient.eq.${w}),and(sender.eq.${w},recipient.eq.${me})`);
      const after = u.searchParams.get("after");
      if (after && !isNaN(Date.parse(after))) q = q.gt("created_at", new Date(after).toISOString());
      const { data } = await q.order("created_at", { ascending: false }).limit(100);
      await db.from("messages").update({ read_at: new Date().toISOString() }).eq("sender", w).eq("recipient", me).is("read_at", null);
      return json((data ?? []).reverse());
    }
    if (m === "POST") {
      const { to, text } = await body();
      if (!UUID_RE.test(to ?? "")) return err("Invalid to", 400);
      if (typeof text !== "string" || !text.startsWith("e2e1:") || text.length < 6 || text.length > 4000) return err("Message must be encrypted (e2e1:)", 400);
      if (!(await isFriend(to))) return err("Not friends", 403);
      const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("sender", me).gte("created_at", new Date(Date.now() - 60000).toISOString());
      if ((count ?? 0) >= 20) return err("Too many messages", 429);
      const { data } = await db.from("messages").insert({ sender: me, recipient: to, text }).select("id,created_at").single();
      return json({ ok: true, id: data?.id, createdAt: data?.created_at });
    }
  }
  return err("Not found", 404);
}

const run = async ({ request, params }: { request: Request; params: { _splat?: string } }) => {
  try { return await handle(request, params._splat ?? ""); }
  catch (e) { console.error(e); return err("Server error", 500); }
};

export const Route = createFileRoute("/api/public/eclipse/$")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: run,
      POST: run,
    },
  },
});
