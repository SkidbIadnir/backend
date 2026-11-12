# VPS: enabling tasting photos

Handoff for whoever manages the Docker Compose stack on the VPS. The backend
(`ghcr.io/<GHCR_REPOSITORY>:latest`, built by CI on every push to `master`) now accepts one
photo per tasting and stores the files **on local disk** inside the container at
`/data/photos`. Without the steps below, photos either fail to upload or vanish on the next
redeploy.

Do them **in this order**, before pulling the image that contains the feature.

## 1. Add the database column

Production runs with TypeORM `synchronize` off, so the schema is not changed automatically.
The column is nullable, so the currently running (old) image is unaffected by it.

```bash
docker compose exec -T <postgres-service> \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'ALTER TABLE tasteep_tastings ADD COLUMN IF NOT EXISTS photo_id uuid;'
```

(If Postgres is not in this compose file, run the same SQL with `psql` against
`POSTGRES_HOST`.)

## 2. Persist the photos directory

Create the host directory and bind-mount it into the backend service:

```bash
sudo mkdir -p /srv/tasteep/photos
```

```yaml
services:
  backend:
    # ...existing config...
    volumes:
      - /srv/tasteep/photos:/data/photos
    environment:
      TASTEEP_PHOTOS_DIR: /data/photos   # already the image default; explicit is fine
```

The container runs as root, so no `chown` is needed. Prefer a bind mount over a named volume:
it is easier to back up and to inspect (`<2 hex>/<uuid>.webp` + `<uuid>.thumb.webp`).

Optional env: `TASTEEP_PHOTO_URL_SECRET` (signing key for photo URLs; defaults to one derived
from `TASTEEP_JWT_SECRET`). Rotating either secret invalidates issued photo URLs — harmless,
the app fetches fresh ones.

## 3. Let 20 MB uploads through the reverse proxy

Uploads go to `PUT /tasteep/tastings/:id/photo` and may be up to **20 MB**.

- **nginx**: the default `client_max_body_size` is 1 MB → uploads fail with `413` before
  reaching the app. Set it in the API's `server` block:
  ```nginx
  client_max_body_size 25m;
  ```
- **Caddy / Traefik**: no body limit by default — nothing to do unless one was configured.

Photos are served by the backend itself at `GET /tasteep/photos/:id/:size` (signed URLs, no
token). No static-file route in the proxy is needed or wanted.

## 4. Deploy

```bash
docker compose pull backend
docker compose up -d backend
docker compose logs --tail=50 backend   # should boot without TypeORM errors
```

## 5. Back up the photos

The photos are **not in Postgres**. Back up `/srv/tasteep/photos` together with the database
dump, off the VPS (same disk ≠ backup). Example with restic, nightly via cron/systemd timer:

```bash
restic -r <remote-repo> backup /srv/tasteep/photos /path/to/pg-dumps
restic -r <remote-repo> forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

Files are immutable (a new upload gets a new name), so incremental backups stay tiny.
Expect roughly 300–600 KB per photo (both sizes).

## 6. Verify

```bash
TOKEN=<a Tasteep bearer token>
ID=$(uuidgen | tr A-Z a-z)
API=https://api.skidhub.fr

curl -sf -X PUT "$API/tasteep/tastings/$ID" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"photo check"}' >/dev/null
curl -s -X PUT "$API/tasteep/tastings/$ID/photo" -H "Authorization: Bearer $TOKEN" \
  -F photo=@some-photo.jpg | jq -r .photo_url          # → signed URL
curl -sI "<that photo_url>" | head -3                    # → 200, image/webp, no token needed
ls -R /srv/tasteep/photos | tail -3                      # → the two .webp files on the host

docker compose up -d --force-recreate backend            # files must survive this
curl -sI "<that photo_url>" | head -1                    # → still 200

curl -s -X DELETE "$API/tasteep/tastings/$ID" -H "Authorization: Bearer $TOKEN"  # cleanup, deletes the files
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `413` on upload of a few MB | Reverse-proxy body limit (step 3) |
| `500` on any tasting route, log mentions `photo_id` | Column missing (step 1) |
| Photos `404` after a redeploy | Volume not mounted (step 2) |
| Photo URL `403` | Expired (24–48 h) or a secret changed — the app re-fetches the tasting |
