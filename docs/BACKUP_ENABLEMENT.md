# Backup Enablement Runbook

Once the relay status POST is wired (see `services/backup_engine.py`), the
backup engine is code-complete. This document is the operator checklist for
flipping `backup.enabled` to true on a single hub.

`backup.enabled` ships as `false`. Do NOT enable until every step below is
complete on this hub.

Paths below show Linux first (production target: Ubuntu mini PC). The
founder dev box is Windows, so Windows paths appear in parentheses where
they differ.

## 1. Provision Backblaze B2 bucket

1. Log into the Backblaze console as the ops user.
2. Create a private bucket (recommend region: EU Central; matches relay).
3. Enable Object Lock NONE; lifecycle: 90 days hide, 365 days delete.
4. Note the bucket name and S3-compatible endpoint URL.

## 2. Generate per-home B2 application key

In the Backblaze console, App Keys > Add a New Application Key:

- Name: `ziggy-home-<home_id>`
- Bucket: the bucket from step 1
- Type of access: Read and Write
- File name prefix: `<home_id>/` (trailing slash matters)
- Duration: leave empty

Copy the keyID and applicationKey. They are shown ONCE.

## 3. Write the data_key

The data_key is 32 random bytes. Lives outside any backup so a B2 leak
alone cannot decrypt the archives.

Linux:

```
sudo mkdir -p /etc/ziggy
sudo head -c 32 /dev/urandom > /etc/ziggy/data_key
sudo chmod 600 /etc/ziggy/data_key
sudo chown ziggy:ziggy /etc/ziggy/data_key
```

Windows (run PowerShell as Administrator):

```
mkdir C:\ProgramData\ziggy
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[IO.File]::WriteAllBytes('C:\ProgramData\ziggy\data_key', $bytes)
icacls C:\ProgramData\ziggy\data_key /inheritance:r /grant:r "$env:USERNAME:F"
```

## 4. Write the B2 credentials JSON

Linux: `/etc/ziggy/b2_credentials` (mode 0600). Windows:
`C:\ProgramData\ziggy\b2_credentials`.

```
{
  "endpoint": "https://s3.eu-central-003.backblazeb2.com",
  "bucket":   "ziggy-backups-prod",
  "key_id":   "<paste keyID from step 2>",
  "app_key":  "<paste applicationKey from step 2>"
}
```

## 5. Write the kit manifest

Linux: `/etc/ziggy/kit_manifest.yaml`. Windows:
`C:\ProgramData\ziggy\kit_manifest.yaml`.

```
home_id:           <home_id from relay provisioning>
device_id:         <hub serial number or generated id>
coordinator_type:  smlight        # or sonoff_e
coordinator_ieee:  "00:12:4b:00:11:22:33:44"
```

## 6. Set env vars (alternative to step 4 if your deploy uses systemd EnvironmentFile)

```
ZIGGY_B2_KEY_ID=<keyID>
ZIGGY_B2_APP_KEY=<applicationKey>
```

Either step 4 OR step 6 satisfies the credential requirement. Step 6 is
preferred on systemd-managed hubs.

## 7. Seal the data_key on the relay

The relay needs an encrypted copy of the data_key so the founder can
unseal it during a disaster-recovery restore. Sealing requires the
master key (held only by the founder).

```
DATA_KEY_B64=$(base64 -w 0 < /etc/ziggy/data_key)
B2_CREDS_B64=$(base64 -w 0 < /etc/ziggy/b2_credentials)

curl -X POST \
  -H "Authorization: Bearer <founder-jwt>" \
  -H "Content-Type: application/json" \
  -d "{
    \"master_key_b64\":         \"<base64 master key>\",
    \"wrapped_data_key_b64\":   \"$DATA_KEY_B64\",
    \"wrapped_b2_credentials_b64\": \"$B2_CREDS_B64\"
  }" \
  https://ziggy-relay.fly.dev/api/homes/<home_id>/seal-key
```

The relay returns 200 on success. The wrapped blobs persist in the
`home_backup_keys` table. The master key never leaves the founder's
local machine.

## 8. Flip backup.enabled to true

In the hub's `home.yaml` (NOT `settings.example.yaml`):

```
backup:
  enabled: true
```

Restart the hub (`systemctl restart ziggy` on Linux; restart the service
on Windows).

## 9. Verify the next 02:00 local run

Either wait until 02:00 local time, or trigger one now:

Linux:

```
sudo -u ziggy /opt/ziggy/.venv/bin/python -m services.backup_engine --once
```

Windows (PowerShell):

```
cd C:\ziggy_pc
.\.venv\Scripts\python.exe -m services.backup_engine --once
```

Expected exit code 0 and JSON output with `"ok": true`.

## 10. Verify the backup landed in B2

```
b2 ls ziggy-backups-prod <home_id>/daily/$(date +%Y-%m-%d)/
b2 ls ziggy-backups-prod <home_id>/latest/
```

Both prefixes should list `manifest.json.enc`, `ha-config.tar.gz.enc`,
`ziggy-state.tar.gz.enc`, `zha-network-backup.json.enc`, and possibly
`recorder.db.enc` (skipped if oversized).

## 11. Verify the relay recorded the status

Founder GET:

```
curl -H "Authorization: Bearer <founder-jwt>" \
  https://ziggy-relay.fly.dev/api/homes/<home_id>/backup-status
```

Expected: 200 with `outcome: success`, `stage: done`, and a recent `ts`.
A 404 means the hub never POSTed — re-check steps 7 and 8.
