# Ridmore — implementation plan

## The one decision everything else follows from

**Do not port the frontend to a framework.** The value in this repository is 3 258 lines of
hand-written CSS, a CSS-3D book that behaves like a real object, and a motion layer tuned
over ten rounds of feedback. A React/Next rewrite would throw all of it away and reproduce it
worse. The brief says so too ("не переписывай без необходимости", "максимально переиспользуй").

So: **keep the vanilla ES-module frontend and put a real server under it.**

```
ridmore/                       npm workspaces
├── apps/
│   ├── api/                   Fastify 5 + Prisma 6 + PostgreSQL 16, TypeScript
│   └── web/                   the existing site, moved intact, extended
├── docs/
└── package.json
```

`apps/web` is served by the API in production (`@fastify/static`), so there is one origin,
one cookie domain, no CORS.

## Stack chosen, and why

| Concern | Choice | Why this one |
|---|---|---|
| HTTP | **Fastify 5** | Fastest mature Node server, first-class TypeScript, schema-based validation and serialisation built in — which is exactly the mechanism §33 needs to stop private fields leaking. |
| DB | **PostgreSQL 16** | Already installed in this environment. Real relations, real transactions — needed for §17's race condition. |
| ORM | **Prisma 6** | Generated types, first-class migrations, `$transaction` with isolation levels. |
| Password hashing | **argon2id** | Current OWASP recommendation; bcrypt's 72-byte truncation is a real footgun. |
| Sessions | **DB-backed, httpOnly signed cookie** | Revocable — which JWT is not, and §26 (account deletion) and §15 (logout everywhere) both need revocation. |
| Validation | **Zod** + Fastify type provider | One schema validates the request and types the handler. |
| Media | **Local-disk driver behind a storage interface**, S3 driver written but unconfigured | §14 says production-ready object storage; §"не требуй API-ключей" says do not demand credentials yet. An interface satisfies both. |
| Frontend build | **esbuild**, production only | Gives §30's bundle splitting and minification without taking away the zero-build dev loop. |
| Tests | **Vitest** (unit + integration) + **Playwright** (E2E) | Playwright is already installed in this environment. |
| Email | **Nodemailer with a console transport by default** | Password reset must work end to end without an SMTP account; swapping the transport is one env var. |

New runtime dependencies, in full: `fastify`, `@fastify/cookie`, `@fastify/static`,
`@fastify/multipart`, `@fastify/rate-limit`, `@fastify/helmet`, `@prisma/client`, `argon2`,
`zod`, `nodemailer`, `sharp` (server-side image resizing for §14), `slugify`.
Dev: `prisma`, `typescript`, `tsx`, `vitest`, `@playwright/test`, `esbuild`.

## Money

Never floats. Every amount is an **integer of minor units** (`priceEurCents`, `priceUahCents`).
Each book carries both, entered by hand in the admin (§4). There is no conversion anywhere —
the currency switch picks which column to read. `Order` freezes the amounts it charged.

## Privacy, structurally

§20 and §33 are the hardest requirements in the brief, so they are enforced by the schema,
not by discipline:

- `ShippingAddress` is **never** reachable from a gift donor's query path. The donor's view of
  a `GiftOrder` is a Fastify response schema that has no address fields in it at all — an
  omitted field cannot be serialised by accident.
- Public wishlist responses come from a dedicated query selecting `nickname, avatar` only.
- `User.email` is returned by exactly one resolver: the account's own `/me`.

## Theme engine

A theme is **structured data, never CSS text** (§34). `ThemeVersion.tokens` is JSON validated
against a Zod schema of named token slots; the server compiles it to a `:root{}` block at
`GET /api/theme.css`. Nothing a theme author writes reaches the page as markup or script.
`Theme` holds `publishedVersionId` and `draftVersionId`; publishing swaps a pointer, so
rollback is one write.

## Phase order

Following §42. Each phase ends green — migrations apply, tests pass, the site still loads.

| # | Phase | State |
|---|---|---|
| 1 | Audit | **done** — `docs/AUDIT.md` |
| 2 | Architecture plan | **done** — this file |
| 3 | Reorganise into workspaces, rebrand to Ridmore | **done** — commit `fef474b` |
| 4 | Database, migrations, seed | **done** — `fef474b` |
| 5 | Auth, users, RBAC | **done** — `fef474b` |
| 6 | Books / catalogue admin | **done** — `ce8fde6` |
| 7 | Journal CMS | |
| 8 | Wishlists | **done** — `2b51082` |
| 9 | Gift flow + manager workflow | **done** — `2b51082` |
| 10 | Checkout + orders | |
| 11 | Theme engine + seasonal themes | |
| 12 | Hero book animation | |
| 13 | Catalogue 3D interaction | |
| 14 | Locales, currencies, geography | |
| 15 | Responsive polish | |
| 16 | Security / privacy audit | |
| 17 | Testing | |
| 18 | Production build verification | |

## Two things the brief mentions that I do not have

- **The reference images** for the autumn theme and the hero book's orientation are described
  in the brief but not attached to this turn. The autumn theme is built from the written
  description — light ground, the book, leaves, warm decorative elements — and the hero from
  "horizontal / in perspective, like an open book on the right". Both are theme data and
  layout, so both are cheap to adjust once the references are to hand.
- **`truplugg/reedmore.osnova`** is still empty and its purpose has never been stated. Work
  continues in the main repository; say the word if the API belongs there instead.
