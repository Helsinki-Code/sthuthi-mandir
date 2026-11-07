# Placeholders

The site shows no placeholders (checked by C12). These build settings are still empty; each one hides or falls back silently:

| Setting | Status | Effect while empty |
|---|---|---|
| `SITE_URL` | empty | Live domain for canonical URLs, sitemaps and schema. The build uses https://www.sthuthi.example until it is set. |
| `PUBLIC_CONSULT_ENDPOINT` | empty | Form endpoint. Until it is set, the form hands every request to WhatsApp only. |
| `CONTACT_EMAIL` | empty | Email address. Until it is set, no email is shown anywhere. |