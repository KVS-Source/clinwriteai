# Nginx vhost configs

Byte-perfect nginx configs committed to the repo — pull them into place
instead of pasting into a terminal (avoids paste-mangling on multi-line
heredocs).

## clinwrite-proto.conf

Serves the ClinWrite.AI prototype at `https://proto.clinwrite.ai`
and 301-mirrors `https://proto.clinwriteai.com` to the canonical host.

### First-time install

```bash
# 1. Get the SAN cert covering both hostnames
sudo certbot --nginx -d proto.clinwrite.ai -d proto.clinwriteai.com --expand
# When prompted about auto-redirects, choose "No redirect" (option 1) —
# this config file handles redirects manually.

# 2. Deploy the vhost from the repo
cd ~/clinwriteai
sudo cp deploy/nginx/clinwrite-proto.conf /etc/nginx/sites-available/clinwrite-proto
sudo ln -sf /etc/nginx/sites-available/clinwrite-proto /etc/nginx/sites-enabled/

# 3. Reload
sudo nginx -t && sudo systemctl reload nginx
```

### Update after a config change

```bash
cd ~/clinwriteai && git pull
sudo cp deploy/nginx/clinwrite-proto.conf /etc/nginx/sites-available/clinwrite-proto
sudo nginx -t && sudo systemctl reload nginx
```

### Verify

```bash
# Canonical serves the app
curl -sI https://proto.clinwrite.ai/                     | head -1
# expect: HTTP/2 200

# .com HTTPS 301s to .ai
curl -sI https://proto.clinwriteai.com/                  | grep -Ei 'HTTP|location'
# expect: HTTP/2 301 · location: https://proto.clinwrite.ai/

# .com HTTP → HTTPS → .ai (2 hops)
curl -sIL http://proto.clinwriteai.com/path?x=1          | grep -Ei 'HTTP|^location'
# expect three lines: 301, 301, 200

# SPA fallback + query preserved
curl -sIL https://proto.clinwriteai.com/projects/some-id | grep -Ei '^HTTP|^location'
# expect: 301 → 200
```
