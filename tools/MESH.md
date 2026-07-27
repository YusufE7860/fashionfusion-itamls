# MeshCentral RMM — first-time setup

The MeshCentral service ships as part of the ITAMLS stack. It gives you browser-based remote desktop, terminal, and file transfer for every Windows PC in your fleet — end-to-end encrypted, self-hosted.

## After `install.sh` finishes

1. Open the MeshCentral console at:

   `https://<your-server-ip>:4430`

   Accept the browser's self-signed-cert warning (Advanced → Proceed). You can put a real cert on it later via nginx or Caddy.

2. Create the first admin account (email + password). **This account becomes the MeshCentral super-admin.** Subsequent tech accounts are created from `My Server → My Users`.

3. Create a **Device Group** — call it `Fashion Fusion`. Pick "Manage using a software agent" as the type. This is the group all your PCs will register into.

4. In the group, click **Add Agent → Windows** → copy the "Group Install Command" — it contains a long ID that looks like `0xABC123...`. That's your **MeshId** — you'll pass it to Kaseya.

5. In the API's `.env` (`/opt/itamls/apps/api/.env`), set:

   ```env
   MESH_BASE_URL=https://<your-server-ip>:4430
   ```

   Then rebuild the API container:

   ```bash
   cd /opt/itamls
   sudo docker compose --env-file .env.prod -f docker-compose.prod.yml build api
   sudo docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api
   ```

## Deploy the agent to every store PC (via Kaseya VSA)

Create a one-off **Run Procedure** with a single Execute Shell Command step:

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -Command "$t=$env:TEMP+'\meshinstall.ps1'; iwr 'http://<api-server>:4000/api/v1/tools/mesh-agent.ps1' -OutFile $t; & $t -MeshUrl 'https://<your-server-ip>:4430' -MeshId '0xABC123...'"
```

Schedule it once against every Windows agent group in Kaseya. Each PC will:

- Download the MeshCentral agent installer from your MeshCentral server
- Install it silently and register as a device in your Fashion Fusion group
- Start the `Mesh Agent` Windows service so it survives reboots

Within a few seconds of the script completing on each PC, MeshCentral's dashboard shows the machine online.

## Using it day-to-day

- In ITAMLS, open any asset page. If the asset has a hostname (auto-populated by the daily discovery script), an orange **Remote Connect** button appears in the header.
- Clicking it opens a new tab pointing at MeshCentral, pre-filtered to the matching hostname.
- Sign in to MeshCentral once (separate account from ITAMLS for now — SSO is on the roadmap).
- Click the device → **Desktop / Terminal / Files / Wake-on-LAN / Router details** — everything MeshCentral does.

## Security notes

- MeshCentral listens on port **4430** (HTTPS). Only open this port on trusted networks (LAN or VPN) — do NOT expose it directly to the internet without a real TLS cert and rate limiting.
- Sessions are TLS + AES-256-GCM end-to-end (MeshCentral's own transport, not just the outer TLS).
- Agents authenticate to the server via a per-agent public/private keypair generated at install time — a stolen agent cert can only be used to *impersonate that PC*, not to invade others.
- The initial `ALLOW_NEW_ACCOUNTS: "0"` env means the login screen won't offer self-signup. The very first admin account is created via the setup wizard on first visit and then locked down.

## Roadmap

- **SSO from ITAMLS** — MeshCentral has a login-token API. Phase 2 will add a "Sign in with ITAMLS" button so techs use one account.
- **Real TLS** — put nginx/Caddy in front of MeshCentral with a Let's Encrypt cert.
- **Activity mirror** — pipe MeshCentral's server events into ITAMLS's Activity Log so you always know who connected where.
