# MetaPolymarket DNS Checklist

Canonical hosts:

- `metapolymarket.com` serves the App Hosting backend.
- `www.metapolymarket.com` points to Firebase Hosting and redirects to the apex domain.
- `metapolymarket.web.app` remains the public fallback URL.

Namecheap records:

- `A` record: host `@`, value `35.219.200.248`.
- `CNAME` record: host `www`, value `metapolymarket.web.app.`.
- App Hosting ACME `CNAME`: host `_acme-challenge_qtuyiqsf7peq64tl`, value `75de607e-ce0a-43b1-a68c-5b4bdad8c78a.8.authorize.certificatemanager.goog.`.

Post-deploy verification:

1. Check authoritative DNS:
   - `dig @dns1.registrar-servers.com +short metapolymarket.com A`
   - `dig @dns1.registrar-servers.com +short www.metapolymarket.com CNAME`
   - `dig @dns1.registrar-servers.com +short _acme-challenge_qtuyiqsf7peq64tl.metapolymarket.com CNAME`
2. Check health:
   - `curl -sS https://metapolymarket.web.app/api/health`
   - `curl -sS https://metapolymarket.com/api/health`
3. Check UI hosts:
   - `https://metapolymarket.web.app/`
   - `https://metapolymarket.com/`
   - `https://www.metapolymarket.com/`

If apex HTTPS fails but DNS is correct, wait for Firebase App Hosting certificate state to move from `CERT_VALIDATING` or `CERT_PROPAGATING` to `CERT_ACTIVE`.
