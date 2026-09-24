# Ridmore

A Ukrainian bookshop and gift platform for Germany and Ukraine.

The shop front is hand-written HTML, CSS and native ES modules — no framework, no
client build in development. The book on every shelf is a real CSS-3D volume with six
faces, not a picture of one. Underneath it runs a Fastify API on PostgreSQL.

```
apps/
  api/   Fastify 5 · Prisma 6 · PostgreSQL 16 · TypeScript
  web/   the shop front, served by the API
docs/
  AUDIT.md          what the prototype was, before any change
  ARCHITECTURE.md   the plan, the stack and why each piece was chosen
```

## Running it

Requires Node 22 and PostgreSQL 16.

```bash
npm install
cp .env.example .env                      # then set SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

createdb ridmore                          # or: psql -c "CREATE DATABASE ridmore"
npm run db:migrate                        # apply migrations
npm run db:seed                           # roles, permissions, themes, avatars, catalogue

npm run dev                               # http://localhost:3000
```

The seed is idempotent — it upserts on natural keys and never deletes, so it is safe to
re-run against a database that already holds real data.

In development it also creates a super admin, `admin@ridmore.local` /
`ridmore-dev-password`. Override with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, and
see below for making one in production.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + shop front with reload |
| `npm run build` | Production build of both workspaces |
| `npm start` | Run the built server |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:deploy` | Apply pending migrations (production) |
| `npm run db:seed` | Seed reference data |
| `npm run db:reset` | Drop, re-migrate, re-seed. **Destroys data.** |
| `npm run create:admin` | Make a super admin interactively |
| `npm run typecheck` | `tsc --noEmit` over the API |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Playwright |

## Two rules that run through the code

**Money is never a float.** Every amount is an integer of minor units. Every book carries
a euro price and a hryvnia price, both entered by hand — the shop never converts between
them, it picks a column. There is no exchange rate anywhere in this repository, and there
should never be one.

**A gift donor cannot reach the recipient's address.** Not because a template leaves the
field out, but because the donor's query path does not lead to it and the response schema
has no such field to serialise. See `docs/ARCHITECTURE.md`.

## Environment

Everything is in `.env.example` with a comment on each. The two that must be set before
anything real: `DATABASE_URL` and `SESSION_SECRET`. Media storage defaults to the local
disk and email to a console transport, so a fresh clone works end to end — including
password reset — with no third-party account.
