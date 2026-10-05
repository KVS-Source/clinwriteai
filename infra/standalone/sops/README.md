# sops + age key management

Per [ADR 0006 (revised)](../../../docs/adr/0006-secrets-manager.md).

## What lives where

- **Public age recipients** → `infra/standalone/sops/.sops.yaml` (checked into git)
- **Private age key(s)** → NOT in git. One copy per team member who needs decrypt access, stored in their password manager.
- **Service private key** → `/etc/platform/age.key` on each VPS (mode 0400, root-owned, backed up to a sealed hardcopy in a safe)
- **Encrypted secrets** → `/opt/platform/env/*.env.enc` on each VPS (also checked into a private secrets repo, NOT this repo)

## Generating a new age key

```bash
# On your workstation (not the VPS)
age-keygen -o ~/age-platform.key
# Prints the public recipient to stdout — copy it
chmod 0600 ~/age-platform.key
# Store ~/age-platform.key in your password manager; delete from disk
```

## Adding a new team member

1. Team member generates their own age key (see above) and sends you the **public** recipient (starts with `age1...`).
2. Add the recipient to `.sops.yaml` under `age:` (comma-separated for multiple).
3. Re-encrypt all `.env.enc` files so the new recipient can decrypt:
   ```bash
   cd /opt/platform/repo
   for f in /opt/platform/env/*.env.enc; do
     sops updatekeys "$f"
   done
   ```
4. Commit the `.sops.yaml` change.

## Removing a departing team member

Reverse of the above — remove their recipient from `.sops.yaml`, run `sops updatekeys`, then **rotate every secret** (DB password, API keys) because they might have copies of the plaintext from their time on the team.

## Editing an encrypted file

```bash
export SOPS_AGE_KEY_FILE=~/age-platform.key   # or /etc/platform/age.key on the VPS
sops /opt/platform/env/api.env.enc
# Opens in $EDITOR with decrypted content; writes back encrypted on save
```

## Emergency recovery

If the service `/etc/platform/age.key` is lost (VPS reinstall without backup):

1. Retrieve the sealed hardcopy from the safe.
2. `age-keygen` isn't needed — the sealed copy IS the private key.
3. Restore it to `/etc/platform/age.key` on the new VPS, mode 0400.
4. Services restart cleanly on next boot.

If BOTH the sealed hardcopy AND every team member's personal copy are lost → every secret must be rotated and re-issued, and `.env.enc` files re-created from scratch.

## Rotation

Rotate the service `/etc/platform/age.key` yearly:

1. Generate new key: `age-keygen -o /tmp/new.key`
2. Add new recipient to `.sops.yaml`.
3. `sops updatekeys` on all `.env.enc` files.
4. Replace `/etc/platform/age.key` with the new key.
5. Remove old recipient from `.sops.yaml` and re-run `sops updatekeys`.
6. Replace the sealed hardcopy.
