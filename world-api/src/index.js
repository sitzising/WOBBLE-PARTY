/**
 * WOBBLE PARTY World Browser API
 * Compatible with Tinybox world-database REST shape.
 * Stores catalog in GitHub repo sitzising/WOBBLE-PARTY (world_database/).
 *
 * Secrets:
 *   GITHUB_TOKEN - fine-grained PAT with Contents: Read/Write on WOBBLE-PARTY
 */
const OWNER = "sitzising";
const REPO = "WOBBLE-PARTY";
const BRANCH = "main";
const INDEX_PATH = "world_database/index.json";
const WORLD_PATH = (id) => `world_database/worlds/${id}.json`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function parseMetaFromTbw(tbw) {
  const meta = { author: "Unknown", version: "0", image: "" };
  for (const line of String(tbw).split("\n")) {
    if (line.startsWith("author ;")) meta.author = line.split(";")[1]?.trim() || meta.author;
    else if (line.startsWith("version ;")) meta.version = line.split(";")[1]?.trim() || meta.version;
    else if (line.startsWith("image ;")) meta.image = line.split(";").slice(1).join(";").trim();
  }
  return meta;
}

async function ghHeaders(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN secret missing");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "wobble-party-world-api",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getFile(env, path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  const res = await fetch(url, { headers: await ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = atob(String(data.content).replace(/\n/g, ""));
  return { sha: data.sha, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

async function putFile(env, path, content, message, sha) {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...(await ghHeaders(env)), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadIndex(env) {
  const f = await getFile(env, INDEX_PATH);
  if (!f || !Array.isArray(f.json)) return { sha: f?.sha, list: [] };
  return { sha: f.sha, list: f.json };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    try {
      if (request.method === "GET") {
        const id = url.searchParams.get("id");
        const report = url.searchParams.get("report");
        const sort = url.searchParams.get("sort");

        if (report != null) {
          const worldId = Number(report);
          const { sha, list } = await loadIndex(env);
          const item = list.find((w) => Number(w.id) === worldId);
          if (item) {
            item.reports = Number(item.reports || 0) + 1;
            await putFile(env, INDEX_PATH, JSON.stringify(list, null, 2) + "\n", `Report world ${worldId}`, sha);
          }
          return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders() });
        }

        if (id != null) {
          const worldId = Number(id);
          const file = await getFile(env, WORLD_PATH(worldId));
          if (!file) {
            return new Response(JSON.stringify([{ tbw: "" }]), { status: 404, headers: corsHeaders() });
          }
          // bump downloads (best-effort)
          try {
            const { sha, list } = await loadIndex(env);
            const item = list.find((w) => Number(w.id) === worldId);
            if (item) {
              item.downloads = Number(item.downloads || 0) + 1;
              await putFile(env, INDEX_PATH, JSON.stringify(list, null, 2) + "\n", `Download world ${worldId}`, sha);
            }
          } catch (_) {}
          // file.json may already be [{tbw}] or we wrap
          const payload = Array.isArray(file.json) ? file.json : [{ tbw: file.text }];
          return new Response(JSON.stringify(payload), { headers: corsHeaders() });
        }

        const { list } = await loadIndex(env);
        let out = Array.isArray(list) ? [...list] : [];
        if (sort === "popular") {
          out.sort((a, b) => Number(b.downloads || 0) - Number(a.downloads || 0));
        }
        // Game expects oldest-first then reverses for "recent"
        return new Response(JSON.stringify(out), { headers: corsHeaders() });
      }

      if (request.method === "POST") {
        const body = await request.json();
        const name = String(body?.name || "").trim();
        const tbw = String(body?.tbw || "");
        if (!name || !tbw) {
          return new Response("Missing name or tbw", { status: 400, headers: corsHeaders() });
        }
        const meta = parseMetaFromTbw(tbw);
        const { sha, list } = await loadIndex(env);
        const nextId = list.reduce((m, w) => Math.max(m, Number(w.id) || 0), 0) + 1;
        const today = new Date().toISOString().slice(0, 10);
        const entry = {
          id: nextId,
          name,
          featured: 0,
          date: today,
          downloads: 0,
          version: meta.version,
          author: meta.author,
          image: meta.image,
          tags: ["community"],
          reports: 0,
        };
        list.push(entry);
        await putFile(
          env,
          WORLD_PATH(nextId),
          JSON.stringify([{ tbw }], null, 0),
          `Upload world ${nextId}: ${name}`,
          null
        );
        await putFile(env, INDEX_PATH, JSON.stringify(list, null, 2) + "\n", `Index add world ${nextId}: ${name}`, sha);
        return new Response("OK", { status: 200, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" } });
      }

      return new Response("Not found", { status: 404, headers: corsHeaders() });
    } catch (e) {
      return new Response(String(e?.message || e), { status: 500, headers: corsHeaders() });
    }
  },
};
