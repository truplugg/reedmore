# Ridmore — security and privacy audit (§16)

Audited on 2026-09-25, against the code at `2dccc2f`. Everything below was
**probed**, not read: each promise has a test that tries to break it, and the
suite was itself checked by breaking an invariant on purpose to confirm the
test fails when it should.

The suite lives in `apps/api/test/security.test.ts` — 26 tests — so these
stay checked rather than becoming a document that ages.

---

## What was found

### 1. The production CSP had never run

`contentSecurityPolicy` is configured as `isProd ? {…} : false`. Since the
shop has only ever been served in development, the policy had never been
executed: nobody knew whether the site worked under it. A policy first met
on a deploy day is a policy that gets switched off on a deploy day.

Ran the app with `NODE_ENV=production` and loaded the shop and the admin
desk under the real header. **Zero violations, both pages render.** The
policy is now known to work, not merely written:

```
default-src 'self'; script-src 'self'; script-src-attr 'none';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: blob:; connect-src 'self';
frame-ancestors 'none'; object-src 'none'; base-uri 'self';
form-action 'self'; upgrade-insecure-requests
```

`style-src` allows inline styles because the covers are built from them;
`script-src` does not, and there is no inline `<script>` or `on*=` attribute
in either page.

### 2. The frame rules disagreed with each other

CSP said `frame-ancestors 'none'`; the legacy header said `SAMEORIGIN`. A
browser old enough to read only the header would have allowed a frame the
policy forbids. Now `frameguard: { action: 'deny' }`, and the two agree.

### 3. The logger had no redaction

Nothing sensitive is logged today — Fastify's default request serialiser
records method, url and address, not headers. But there was no `redact` at
all, so the first person to log a whole request while chasing a bug would
have put session cookies on disk, where each one is a working key to
somebody's account. Added redaction for cookies, authorization, `set-cookie`
and the password and token body fields.

### 4. The audit's own first draft proved nothing

Worth recording because it is the failure mode of security tests. The gift
privacy tests posted `itemId` where the API expects `wishlistItemId`. The
reservation failed, no gift existed, no address was ever attached — and
every "the donor cannot see the address" test passed against an empty
database. The fixture now asserts itself before any test runs, and the file
fails loudly rather than passing vacuously.

---

## What held

Each of these was attacked and did not give.

**A gift donor cannot reach the recipient.** With a real gift, a real
recipient address on file and the manager's address attached to the order,
the donor's own gift list, their own order list, the staff order route and
the wishlist the gift came from were all read and searched for the street,
the postcode, the city, the phone and the pickup point. Nothing. A gift
order carries no `shipTo` even for the donor who placed it. Breaking that
one line on purpose made the test fail naming the exact leaked strings.

**Nothing public carries a person.** The public wishlists and the catalogue
contain no `@`, no address, no phone. Password reset answers identically for
an address with an account and one without — same status, same body.

**One reader cannot read another.** A stranger's account call answers about
the stranger; their order list is empty; a signed-out visitor gets 401 from
every private route; another customer's order by number is 404, and so is a
guest's own order quoted with the wrong email — so order numbers cannot be
fished for.

**The screen is not the protection.** All twelve `/api/admin/*` read routes
were called as a signed-in reader and as a visitor with no account: every
one refused. A signup that also posts `roles: ['SUPER_ADMIN']` and
`permissions: […]` is created as an ordinary customer; a profile edit that
posts the same changes nothing.

**Text stays text.** An article block type that is not on the list is
refused; a `javascript:` link is refused; a theme colour holding
`red;background:url(javascript:alert(1))` is refused. In the browser, a
wishlist title containing `<img src=x onerror=…>` was rendered on the home
page and in the personal cabinet: no element was created, no handler ran,
and the payload appears as the characters that were typed. Checked against
both the real server and the static preview.

**An upload is not trusted to say what it is.** An SVG carrying a script,
named `innocent.png` and declared `image/png`, is refused — the format is
read from the bytes by sharp, not from the name or the header. So is a text
file called an image. A file named `../../../../etc/ridmore-escape.png` is
stored under a path built from the folder and the SHA-256 of the re-encoded
output; the posted name reaches neither the key nor the URL. Everything is
re-encoded to WebP, so a polyglot loses its second personality.

**Credentials are not kept in a usable form.** Passwords are argon2id, and
the stored hash contains nothing of the password. The session cookie is not
what is in the database: the row holds a hash of it, so a database read does
not hand over live sessions.

**No card data, anywhere.** No route accepts a card number, a CVC or a
token. A checkout request that posts all three is accepted as an order and
the stored row contains none of them. `/api/checkout/payment-methods`
answers `provider: null`.

**Errors say nothing extra.** In production a failed login is "Wrong email
or password" — no hint about whether the account exists — and an internal
error is a generic message with no stack.

---

## Standing notes

- **`style-src 'unsafe-inline'`** is a real weakening, taken deliberately:
  book covers are composed from inline styles. Moving covers to CSS custom
  properties set from a stylesheet would let it go, and is worth doing if
  the covers are ever reworked.
- **CSP is off in development.** That is the usual trade, and it now costs
  nothing because the production policy is exercised. Anyone changing the
  front end should re-run the check — `NODE_ENV=production` and load both
  pages — before shipping.
- **No CORS plugin is registered**, which is correct: the API and the site
  are one origin. Serving the front end from elsewhere would need an
  explicit, narrow origin list, never a reflected one.
- **Rate limits** are 300/minute globally and 10 per 10 minutes on the auth
  routes, keyed by IP. Behind a proxy this depends on `trustProxy`, which is
  on only in production — correct, but it means the limit is only as honest
  as the proxy's `X-Forwarded-For`.
