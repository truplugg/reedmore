import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signUp, signIn, grantRole, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * The admin panel's server side (§10–13).
 *
 * These tests are about the rules that exist because a screen cannot be
 * trusted to enforce them: the shop must always have an owner, staff must
 * not be handed customers' contact details, a theme must not be served
 * half-finished, and an article body must not be able to carry markup.
 */

let app: FastifyInstance;
let owner = { cookie: '', id: '' };
let second = { cookie: '', id: '' };
let editor = { cookie: '', id: '' };
let reader = { cookie: '', id: '' };

async function asRole(nickname: string, role: 'SUPER_ADMIN' | 'MANAGER' | 'CONTENT_EDITOR') {
  const actor = await signUp(app, { nickname });
  await grantRole(actor.id, role);
  const cookie = await signIn(app, `${nickname}@example.test`, 'a-long-enough-password');
  return { cookie, id: actor.id };
}

beforeAll(async () => {
  app = await makeApp();
  owner = await asRole(unique('owner'), 'SUPER_ADMIN');
  second = await asRole(unique('owner2'), 'SUPER_ADMIN');
  editor = await asRole(unique('ed'), 'CONTENT_EDITOR');
  reader = await signUp(app, { nickname: unique('reader') });
});

afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const send = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie }, payload: payload as never });

describe('the dashboard', () => {
  it('answers in one request', async () => {
    const res = await get('/api/admin/dashboard', owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().catalog).not.toBeNull();
    expect(res.json().orders).not.toBeNull();
  });

  it('leaves out the blocks a viewer may not see, rather than hiding them', async () => {
    const res = await get('/api/admin/dashboard', editor.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    /* A content editor has article.read but neither order.read nor user.read. */
    expect(body.journal).not.toBeNull();
    expect(body.orders).toBeNull();
    expect(body.people).toBeNull();
  });

  it('reports money per currency and never adds the two together', async () => {
    const body = (await get('/api/admin/dashboard', owner.cookie)).json();
    const seen = body.orders.revenue.map((r: { currency: string }) => r.currency);
    expect(new Set(seen).size).toBe(seen.length);
    expect(JSON.stringify(body)).not.toMatch(/rate|converted|inEur|inUah/i);
  });

  it('is closed to a signed-in reader', async () => {
    expect((await get('/api/admin/dashboard', reader.cookie)).statusCode).toBe(403);
  });
});

describe('people', () => {
  it('shows staff accounts without contact details', async () => {
    await prisma.userProfile.update({
      where: { userId: reader.id }, data: { phone: '+49 30 111111', firstName: 'Anneliese' }
    });
    const res = await get(`/api/admin/users?search=${reader.id.slice(0, 4)}`, owner.cookie);
    expect(res.statusCode).toBe(200);
    const one = (await get(`/api/admin/users/${reader.id}`, owner.cookie)).json().user;
    expect(one.id).toBe(reader.id);
    /* The staff view is an account, not a dossier. */
    expect(JSON.stringify(one)).not.toContain('111111');
    expect(JSON.stringify(one)).not.toContain('Anneliese');
    expect(one.phone).toBeUndefined();
    expect(one.addresses).toBeUndefined();
  });

  it('refuses to leave the shop without an owner', async () => {
    /* The database is shared with every other test file and carries a seeded
       owner of its own, so "the last owner" has to be arranged rather than
       assumed. Their grants come back in the finally, whatever happens. */
    const others = await prisma.userRole.findMany({
      where: { role: { key: 'SUPER_ADMIN' }, userId: { not: owner.id } },
      select: { userId: true, roleId: true, grantedBy: true }
    });
    await prisma.userRole.deleteMany({
      where: { role: { key: 'SUPER_ADMIN' }, userId: { not: owner.id } }
    });
    try {
    const demote = await send('PUT', `/api/admin/users/${owner.id}/roles`, owner.cookie, { roles: ['MANAGER'] });
    expect(demote.statusCode).toBe(400);
    expect(demote.json().error.code).toBe('last_owner');

    const suspend = await send('POST', `/api/admin/users/${owner.id}/status`, owner.cookie, { status: 'SUSPENDED' });
    expect(suspend.statusCode).toBe(400);
    expect(suspend.json().error.code).toBe('last_owner');

    /* And the account really is untouched. */
    const after = (await get(`/api/admin/users/${owner.id}`, owner.cookie)).json().user;
    expect(after.roles.map((r: { key: string }) => r.key)).toContain('SUPER_ADMIN');
    expect(after.status).toBe('ACTIVE');
    } finally {
      await prisma.userRole.createMany({ data: others, skipDuplicates: true });
    }
  });

  it('allows the demotion once somebody else can administer the shop', async () => {
    await send('PUT', `/api/admin/users/${second.id}/roles`, owner.cookie, { roles: ['SUPER_ADMIN'] });
    const ok = await send('PUT', `/api/admin/users/${owner.id}/roles`, owner.cookie,
      { roles: ['SUPER_ADMIN', 'MANAGER'] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.roles.map((r: { key: string }) => r.key).sort()).toEqual(['MANAGER', 'SUPER_ADMIN']);
  });

  it('will not let the owner role be edited', async () => {
    const res = await send('PUT', '/api/admin/roles/SUPER_ADMIN/permissions', owner.cookie, { permissions: ['book.read'] });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a permission that does not exist', async () => {
    const res = await send('PUT', '/api/admin/roles/MANAGER/permissions', owner.cookie,
      { permissions: ['book.read', 'book.invent'] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unknown_permission');
  });

  it('keeps role editing away from a content editor', async () => {
    const res = await send('PUT', `/api/admin/users/${reader.id}/roles`, editor.cookie, { roles: ['MANAGER'] });
    expect(res.statusCode).toBe(403);
  });
});

describe('themes', () => {
  let themeId = '';

  it('copies an existing theme rather than starting from nothing', async () => {
    const list = (await get('/api/admin/themes', owner.cookie)).json();
    expect(list.items.length).toBeGreaterThan(0);
    const res = await send('POST', '/api/admin/themes', owner.cookie, {
      name: unique('Autumn trial'), season: 'AUTUMN', basedOn: list.items[0].id
    });
    expect(res.statusCode).toBe(201);
    themeId = res.json().theme.id;
  });

  it('saves a draft without touching what readers are served', async () => {
    const before = (await get(`/api/admin/themes/${themeId}`, owner.cookie)).json();
    expect(before.theme.publishedVersion).toBeNull();

    const tokens = { ...(before.draft as Record<string, unknown>) };
    (tokens.colors as Record<string, string>).accent = '#123456';
    const save = await send('POST', `/api/admin/themes/${themeId}/draft`, owner.cookie, { tokens });
    expect(save.statusCode).toBe(200);

    const after = (await get(`/api/admin/themes/${themeId}`, owner.cookie)).json();
    expect(after.theme.publishedVersion).toBeNull();
    expect((after.draft as { colors: Record<string, string> }).colors.accent).toBe('#123456');
  });

  it('refuses to serve a theme with a missing colour', async () => {
    const t = (await get(`/api/admin/themes/${themeId}`, owner.cookie)).json();
    const holed = JSON.parse(JSON.stringify(t.draft));
    delete holed.colors.accent;
    await send('POST', `/api/admin/themes/${themeId}/draft`, owner.cookie, { tokens: holed });

    const res = await send('POST', `/api/admin/themes/${themeId}/publish`, owner.cookie, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('incomplete_theme');
  });

  it('refuses CSS smuggled into a colour slot', async () => {
    const t = (await get(`/api/admin/themes/${themeId}`, owner.cookie)).json();
    const bad = JSON.parse(JSON.stringify(t.draft));
    bad.colors.accent = 'red; background: url(javascript:alert(1))';
    const res = await send('POST', `/api/admin/themes/${themeId}/draft`, owner.cookie, { tokens: bad });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a decoration that is not on the list', async () => {
    const t = (await get(`/api/admin/themes/${themeId}`, owner.cookie)).json();
    const bad = JSON.parse(JSON.stringify(t.draft));
    bad.decor.heroFigure = '<script>';
    expect((await send('POST', `/api/admin/themes/${themeId}/draft`, owner.cookie, { tokens: bad })).statusCode).toBe(400);
  });

  it('publishes, then rolls back to the version before it', async () => {
    const first = (await get(`/api/admin/themes/${themeId}`, owner.cookie)).json();
    const good = JSON.parse(JSON.stringify(first.live ?? first.draft));
    good.colors.accent = '#aa0000';
    /* Fill any hole the earlier test left. */
    for (const slot of first.slots as string[]) good.colors[slot] ??= '#808080';
    /* the alpha-composed slots are channels, never a hex */
    for (const slot of ['overlay', 'sh-color', 'card-shadow']) good.colors[slot] = '26 24 16';
    await send('POST', `/api/admin/themes/${themeId}/draft`, owner.cookie, { tokens: good });
    const pub1 = await send('POST', `/api/admin/themes/${themeId}/publish`, owner.cookie, {});
    expect(pub1.statusCode).toBe(200);
    const v1 = pub1.json().theme.publishedVersion.id;

    good.colors.accent = '#00aa00';
    await send('POST', `/api/admin/themes/${themeId}/draft`, owner.cookie, { tokens: good });
    const pub2 = await send('POST', `/api/admin/themes/${themeId}/publish`, owner.cookie, {});
    expect(pub2.json().theme.publishedVersion.id).not.toBe(v1);

    const back = await send('POST', `/api/admin/themes/${themeId}/publish`, owner.cookie, { versionId: v1 });
    expect(back.statusCode).toBe(200);
    expect(back.json().theme.publishedVersion.id).toBe(v1);
    /* The rolled-past version is still there to go forward to. */
    expect(back.json().theme.versions.length).toBeGreaterThanOrEqual(2);
  });

  it('will not delete a theme the shop ships with', async () => {
    const list = (await get('/api/admin/themes', owner.cookie)).json();
    const system = list.items.find((t: { system: boolean }) => t.system);
    const res = await send('DELETE', `/api/admin/themes/${system.id}`, owner.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('system_theme');
  });
});

describe('the journal', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    title: 'Чому ми друкуємо на папері',
    content: { blocks: [
      { type: 'heading', level: 2, text: 'Про папір' },
      { type: 'paragraph', text: 'Текст статті.' },
      { type: 'list', ordered: false, items: ['перше', 'друге'] }
    ] },
    ...over
  });

  it('takes a block document and counts the reading time from it', async () => {
    const res = await send('POST', '/api/admin/articles', owner.cookie, body({ slug: unique('paper') }));
    expect(res.statusCode).toBe(201);
    expect(res.json().article.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it('refuses a block type it does not know', async () => {
    const res = await send('POST', '/api/admin/articles', owner.cookie,
      body({ slug: unique('bad'), content: { blocks: [{ type: 'html', text: '<script>alert(1)</script>' }] } }));
    expect(res.statusCode).toBe(400);
  });

  it('refuses extra fields smuggled onto a known block', async () => {
    const res = await send('POST', '/api/admin/articles', owner.cookie,
      body({ slug: unique('bad2'),
             content: { blocks: [{ type: 'paragraph', text: 'ok', onclick: 'alert(1)' }] } }));
    expect(res.statusCode).toBe(400);
  });

  it('refuses a javascript: link', async () => {
    const res = await send('POST', '/api/admin/articles', owner.cookie,
      body({ slug: unique('bad3'),
             content: { blocks: [{ type: 'link', href: 'javascript:alert(1)', text: 'tap' }] } }));
    expect(res.statusCode).toBe(400);
  });

  it('lets a content editor run the journal end to end', async () => {
    const draft = await send('POST', '/api/admin/articles', editor.cookie, body({ slug: unique('ed') }));
    expect(draft.statusCode).toBe(201);
    expect(draft.json().article.status).toBe('DRAFT');

    /* Publishing the journal is the editor's job, and the seeded role says so. */
    const publish = await send('POST', `/api/admin/articles/${draft.json().article.id}/status`,
      editor.cookie, { status: 'PUBLISHED' });
    expect(publish.statusCode).toBe(200);
  });

  it('keeps the journal away from a manager, who has no business in it', async () => {
    const mgr = await signUp(app, { nickname: unique('mgr') });
    await grantRole(mgr.id, 'MANAGER');
    const cookie = await signIn(app, `${(await prisma.user.findUniqueOrThrow({
      where: { id: mgr.id }, select: { email: true } })).email}`, 'a-long-enough-password');
    const res = await send('POST', '/api/admin/articles', cookie, body({ slug: unique('mgr') }));
    expect(res.statusCode).toBe(403);
  });

  it('will not schedule into the past', async () => {
    const a = await send('POST', '/api/admin/articles', owner.cookie, body({ slug: unique('sched') }));
    const res = await send('POST', `/api/admin/articles/${a.json().article.id}/status`, owner.cookie,
      { status: 'DRAFT', scheduledFor: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('past_schedule');
  });

  it('keeps the first publication date when re-published', async () => {
    const a = await send('POST', '/api/admin/articles', owner.cookie, body({ slug: unique('once'), status: 'PUBLISHED' }));
    const first = a.json().article.publishedAt;
    await send('POST', `/api/admin/articles/${a.json().article.id}/status`, owner.cookie, { status: 'HIDDEN' });
    const again = await send('POST', `/api/admin/articles/${a.json().article.id}/status`, owner.cookie, { status: 'PUBLISHED' });
    expect(again.json().article.publishedAt).toBe(first);
  });
});

describe('settings', () => {
  it('has a figure for each currency and no rate between them', async () => {
    const res = await get('/api/admin/settings', owner.cookie);
    expect(res.statusCode).toBe(200);
    const s = res.json().settings;
    expect(s.freeShippingEurCents).toBeTypeOf('number');
    expect(s.freeShippingUahCents).toBeTypeOf('number');
    expect(JSON.stringify(s)).not.toMatch(/rate|exchange/i);
  });

  it('will not wear a theme nobody has published', async () => {
    const made = await send('POST', '/api/admin/themes', owner.cookie, {
      name: unique('Unpublished'),
      basedOn: (await get('/api/admin/themes', owner.cookie)).json().items[0].id
    });
    const res = await send('PATCH', '/api/admin/settings', owner.cookie, { activeThemeId: made.json().theme.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('theme_unpublished');
  });

  it('writes staff actions to the audit log', async () => {
    await send('PATCH', '/api/admin/settings', owner.cookie, { siteName: unique('Ridmore') });
    const res = await get('/api/admin/settings/audit?entity=settings', owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
    expect(res.json().items[0].actor.id).toBe(owner.id);
  });

  it('keeps settings away from a content editor', async () => {
    expect((await get('/api/admin/settings', editor.cookie)).statusCode).toBe(403);
  });
});
