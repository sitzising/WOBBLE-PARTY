# World Browser API (Cloudflare Worker)

Implements Tinybox-compatible world DB REST API and stores data in this repo under `world_database/`.

## Endpoints

- `GET /` list worlds
- `GET /?id=X` download TBW
- `GET /?report=X` report
- `POST /` upload `{ "name", "tbw" }` → returns `OK`

## Deploy

```bash
cd world-api
npx wrangler login
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT: Contents R/W on this repo
npx wrangler deploy
```

Then set `default_database_repo.txt` to the Worker URL and update game defaults.
