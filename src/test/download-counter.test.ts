import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: state.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)),
          error: null,
        }).then(resolve),
      };
      return query;
    },
    rpc: state.rpc,
  }),
}));

import { Route } from "@/routes/api/public/latest";

const handler = (Route.options as unknown as {
  server: { handlers: { GET: (args: { request: Request }) => Promise<Response> } };
}).server.handlers.GET;
const id = "11111111-1111-4111-8111-111111111111";
const fileUrl = "https://example.com/Eclipse.exe";

describe("Release download counting", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://example.com");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-key");
    state.rpc.mockReset().mockResolvedValue({ error: null });
    state.rows = [{ id, version: "1.0.9", channel: "stable", published: true, external_url: fileUrl }];
  });

  it("does not count update checks and returns a counted, release-pinned URL", async () => {
    const response = await handler({ request: new Request("https://eclipsepanelupdate.lovable.app/api/public/latest") });
    expect((await response.json()).url).toBe(`https://eclipsepanelupdate.lovable.app/api/public/latest?channel=stable&download=1&id=${id}`);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("counts each download request once and redirects to the existing installer", async () => {
    const response = await handler({ request: new Request(`https://eclipsepanelupdate.lovable.app/api/public/latest?channel=stable&download=1&id=${id}`) });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(fileUrl);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("record_release_download", { release_id: id });
  });

  it("does not count unavailable files", async () => {
    state.rows = [{ id, version: "1.0.9", channel: "stable", published: true, external_url: null }];
    const response = await handler({ request: new Request("https://eclipsepanelupdate.lovable.app/api/public/latest?download=1") });
    expect(response.status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does not count unpublished releases", async () => {
    state.rows = [{ id, version: "1.0.9", channel: "stable", published: false, external_url: fileUrl }];
    const response = await handler({ request: new Request("https://eclipsepanelupdate.lovable.app/api/public/latest?download=1") });
    expect(await response.json()).toEqual({ version: null });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});