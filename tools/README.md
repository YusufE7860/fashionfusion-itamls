# Discovery agent for Kaseya VSA

`Invoke-ITAMLSDiscovery.ps1` reports every Windows endpoint (HQ PCs, store POS PCs, back office machines) into the IT Asset Management & Logistics System. It runs silently, talks only outbound HTTPS, and is safe to schedule daily.

## What it sends

For each machine, the script POSTs the following JSON to `<ApiBase>/discovery/report`:

```json
{
  "hostname":     "FF-STORE001-POS01",
  "manufacturer": "Dell Inc.",
  "model":        "OptiPlex 3000",
  "serialNo":     "JK4NQ73",
  "osVersion":    "Microsoft Windows 11 Pro 10.0.22631",
  "cpuModel":     "Intel(R) Core(TM) i5-12500",
  "ramGb":        16,
  "macAddresses": ["00-1A-2B-3C-4D-5E"],
  "locationCode": "STR-001"
}
```

The endpoint:

1. Looks up an existing asset by **serial number** first, then by **hostname**.
2. If a match is found, it refreshes the hardware metadata and stamps `lastSeenAt`.
3. If nothing matches, it creates a new asset (auto-generates a tag like `FF-D-000123`), sets its location from `locationCode` if supplied, and records an `asset_history` entry.

In every case it writes a row to `discovery_reports` for forensic history.

## One-time setup

1. **Generate an API key** in ITAMLS:
   - Sign in as an administrator.
   - Go to **Admin → API Keys → New key**.
   - Label it e.g. *Kaseya VSA discovery*.
   - Copy the key shown once (`itamls_…`). You can't see it again — only the prefix is stored after that.

2. **Decide on the API base URL** the agents will hit. For on-prem ITAMLS reachable from stores, it's typically:

   ```
   https://itamls.fashionfusion.local/api/v1
   ```

   For lab/dev, the LAN IP of the machine running the API:

   ```
   http://10.0.0.15:4000/api/v1
   ```

## Run it once, manually

From any Windows machine:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\Invoke-ITAMLSDiscovery.ps1 `
    -ApiBase "https://itamls.fashionfusion.local/api/v1" `
    -ApiKey  "itamls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" `
    -LocationCode "HO"
```

A successful run prints `[OK] Success. assetTag=FF-D-000123` and exits with code 0.

## Deploy via Kaseya VSA

Two options. Pick whichever your environment prefers.

### Option A — single "Run Procedure" with embedded script (simplest)

1. **Agent Procedures → Manage Procedures → New Procedure**.
2. Name: `ITAMLS - Daily Discovery`.
3. Step type: **Execute Shell Command** (Run As: Use Credential of Logged on User → No → Use System Account).
4. Command:

   ```text
   powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "C:\ProgramData\Kaseya\Agent\ITAMLS\Invoke-ITAMLSDiscovery.ps1" -ApiBase "https://itamls.fashionfusion.local/api/v1" -ApiKey "itamls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -LocationCode "#vCustomField.LocationCode#"
   ```

   The `#vCustomField.LocationCode#` placeholder pulls a custom field from the Kaseya agent record so each machine reports its store code (set it once per agent, e.g. *STR-001*).

5. Add a preceding **"Write File"** step that pushes `Invoke-ITAMLSDiscovery.ps1` to `C:\ProgramData\Kaseya\Agent\ITAMLS\` from a Managed File.

6. **Schedule Procedure** → daily at 03:00 → apply to **All Windows Agents**.

### Option B — schedule via a generic scheduled task (no embedded args)

1. Use Kaseya to deliver the script and a small wrapper `.cmd` to `C:\ProgramData\ITAMLS\`.
2. Create a Windows scheduled task that runs the `.cmd` daily.
3. Use a Kaseya credential vault item for the API key so it isn't visible in the procedure text.

## Security notes

* The key is hashed (SHA-256) at rest; the raw value is shown to you only once at creation.
* Treat the key like a password — store it in Kaseya's credential vault, not in plaintext procedures where possible.
* Revoke any leaked key in **Admin → API Keys**; reports with revoked keys are rejected with HTTP 401.
* The endpoint is intentionally narrow: a `DISCOVERY`-scope key can only POST `/discovery/report`. It cannot read or modify other data.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `HTTP 401 - Invalid API key` | Key revoked or typo | Generate a new key, update the Kaseya procedure |
| `HTTP 404 Not Found` | Wrong `ApiBase` | Verify the URL ends with `/api/v1` |
| `The remote server returned an error: (500)` | API can't reach Postgres or Prisma migration not applied | Check `pnpm api:dev` logs |
| Connection times out | Firewall between store and HQ | Open outbound 443 from store to ITAMLS host |
| Asset created twice for the same PC | The PC's BIOS serial number is generic (e.g. `To Be Filled By O.E.M.`) | The script also matches by hostname; ensure hostnames are unique |

## Roadmap

* MAC-address-based matching as a tertiary lookup
* macOS & Linux agents (Bash + system_profiler / lshw)
* Pull-mode integration: optional Kaseya VSA REST API connector that imports agents on a schedule, removing the need for a per-endpoint script
