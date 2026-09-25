/**
 * RIDMORE — the admin shell (§10–13).
 *
 * One rail of sections, one panel at a time. The book desk is its own module
 * and keeps its own markup; everything else is drawn here.
 *
 * Two habits run through the whole file:
 *
 *   Nothing is built from a string of HTML that contains data. Every value
 *   from the server goes in through textContent or a property, so a book
 *   title, a nickname or an article heading cannot become markup.
 *
 *   The panel hides a section the account cannot reach, and that is a
 *   courtesy, not the protection. Every one of these endpoints is refused by
 *   the server for an account without the permission (§31).
 */

import { api, loadViewer, currentViewer, can, isStaff, isOffline } from './api.js';
import { toast } from './ui.js';

/* ---------- small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build an element. Children that are strings become text, never markup. */
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') throw new Error('admin-shell builds no markup from data');
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list' && k !== 'form') node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtWhen = (v) => (v ? new Date(v).toLocaleString('uk-UA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Minor units to a readable figure. Each currency prints itself; the two
 *  are never added, here or anywhere else. */
function money(minor, currency) {
  const sign = currency === 'UAH' ? '₴' : '€';
  return `${(minor / 100).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sign}`;
}

const STATUS_PILL = {
  PENDING: 'warn', AWAITING_RECIPIENT_CONTACT: 'warn', AWAITING_ADDRESS: 'warn',
  RECIPIENT_CONTACTED: 'accent', READY_FOR_PROCESSING: 'accent', PROCESSING: 'accent',
  SHIPPED: 'ok', DELIVERED: 'ok', CANCELLED: 'danger',
  DRAFT: '', PUBLISHED: 'ok', HIDDEN: 'warn',
  ACTIVE: 'ok', SUSPENDED: 'danger', DELETED: 'danger'
};
const STATUS_TEXT = {
  PENDING: 'Нове', AWAITING_RECIPIENT_CONTACT: 'Чекає на контакт',
  RECIPIENT_CONTACTED: 'Отримувача сповіщено', AWAITING_ADDRESS: 'Чекає адресу',
  READY_FOR_PROCESSING: 'Готове до збірки', PROCESSING: 'Збирається',
  SHIPPED: 'Відправлено', DELIVERED: 'Доставлено', CANCELLED: 'Скасовано',
  DRAFT: 'Чернетка', PUBLISHED: 'Опубліковано', HIDDEN: 'Приховано',
  ACTIVE: 'Активний', SUSPENDED: 'Призупинено', DELETED: 'Видалений'
};
const pill = (status) =>
  el('span', { class: `pill${STATUS_PILL[status] ? ' pill--' + STATUS_PILL[status] : ''}`,
               text: STATUS_TEXT[status] ?? status });

function head(title, eyebrow, ...tools) {
  return el('div', { class: 'pane__head' },
    el('div', {},
      el('p', { class: 'eyebrow eyebrow--plain', text: eyebrow }),
      el('h1', { class: 'pane__title', text: title })),
    tools.length ? el('div', { class: 'pane__tools' }, tools) : null);
}

function table(columns, rows, empty = 'Поки порожньо') {
  if (!rows.length) return el('div', { class: 'tbl-wrap' }, el('p', { class: 'tbl__empty', text: empty }));
  return el('div', { class: 'tbl-wrap' },
    el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { text: c })))),
      el('tbody', {}, rows)));
}

function stat(n, label, mod = '') {
  return el('div', { class: `stat${mod ? ' stat--' + mod : ''}` },
    el('div', { class: 'stat__n', text: String(n ?? '—') }),
    el('span', { class: 'stat__k', text: label }));
}

const field = (label, input) => el('label', { class: 'fld' }, el('span', { class: 'fld__l', text: label }), input);
const input = (props) => el('input', { class: 'fld__i', type: 'text', ...props });
const select = (props, options, value) =>
  el('select', { class: 'fld__i', ...props },
    options.map(([v, l]) => el('option', { value: v, selected: v === value, text: l })));

/** Show what went wrong in the reader's own words, not a stack trace. */
function fail(err) {
  console.error(err);
  toast(err?.message ?? 'Не вдалося. Спробуйте ще раз.');
}

function busy(pane) {
  pane.replaceChildren(el('p', { class: 'pane-note', text: 'Завантаження…' }));
}

/* ==================================================================
   Overview
   ================================================================== */

async function renderDashboard(pane) {
  busy(pane);
  const d = await api.dashboard(30);
  const parts = [head('Огляд', 'За останні 30 днів')];

  const figures = [];
  if (d.catalog) {
    figures.push(stat(d.catalog.books, 'книжок'));
    figures.push(stat(d.catalog.drafts, 'чернеток', d.catalog.drafts ? 'warn' : ''));
    figures.push(stat(d.catalog.lowStock, 'закінчуються', d.catalog.lowStock ? 'warn' : ''));
  }
  if (d.orders) {
    figures.push(stat(d.orders.open, 'відкритих замовлень', 'accent'));
    if (d.orders.giftsAwaiting !== null && d.orders.giftsAwaiting !== undefined) {
      figures.push(stat(d.orders.giftsAwaiting, 'подарунків чекають', d.orders.giftsAwaiting ? 'warn' : ''));
    }
  }
  if (d.people) {
    figures.push(stat(d.people.active, 'читачів'));
    figures.push(stat(d.people.joined, 'нових за місяць'));
  }
  if (d.journal) {
    figures.push(stat(d.journal.articles, 'статей'));
    if (d.journal.scheduled) figures.push(stat(d.journal.scheduled, 'заплановано', 'accent'));
  }
  parts.push(el('div', { class: 'stats' }, figures));

  /* Two currencies, two lines. Never one total. */
  if (d.orders?.revenue?.length) {
    parts.push(el('div', { class: 'pane-card' },
      el('h2', { class: 'pane-card__h', text: 'Виручка за 30 днів' }),
      el('div', { class: 'stats' },
        d.orders.revenue.map((r) => stat(money(r.totalMinor, r.currency), `${r.count} замовлень`, 'accent'))),
      el('p', { class: 'pane-note',
        text: 'Валюти рахуються окремо і ніколи не додаються одна до одної — курсу в системі немає.' })));
  }

  if (d.recent?.length) {
    parts.push(el('div', { class: 'pane-card' },
      el('h2', { class: 'pane-card__h', text: 'Останні дії' }),
      table(['Коли', 'Хто', 'Що'], d.recent.map((r) => el('tr', {},
        el('td', { text: fmtWhen(r.at) }),
        el('td', { text: r.actor ?? 'система' }),
        el('td', { class: 'wrap', text: `${r.action} · ${r.entity}` }))))));
  }
  pane.replaceChildren(...parts);
}

/* ==================================================================
   Orders
   ================================================================== */

const ORDER_NEXT = {
  PENDING: ['PROCESSING', 'CANCELLED'],
  AWAITING_RECIPIENT_CONTACT: ['RECIPIENT_CONTACTED', 'CANCELLED'],
  RECIPIENT_CONTACTED: ['AWAITING_ADDRESS', 'CANCELLED'],
  AWAITING_ADDRESS: ['READY_FOR_PROCESSING', 'CANCELLED'],
  READY_FOR_PROCESSING: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [], CANCELLED: []
};

async function renderOrders(pane) {
  busy(pane);
  let filter = '';
  const body = el('div', {});

  const draw = async () => {
    busy(body);
    const res = await api.adminOrders(filter ? `?status=${filter}` : '');
    const rows = res.items.map((o) => {
      const next = ORDER_NEXT[o.status] ?? [];
      return el('tr', {},
        el('td', {}, el('b', { text: o.number })),
        el('td', {}, o.type === 'GIFT' ? el('span', { class: 'pill pill--accent', text: 'Подарунок' }) : 'Звичайне'),
        el('td', {}, pill(o.status)),
        el('td', { text: money(o.total, o.currency) }),
        el('td', { text: fmtDate(o.createdAt) }),
        el('td', {}, next.length
          ? select({ onchange: async (e) => {
              const to = e.target.value;
              if (!to) return;
              try { await api.orderStatus(o.id, { status: to }); toast(`${o.number}: ${STATUS_TEXT[to]}`); draw(); }
              catch (err) { fail(err); e.target.value = ''; }
            } }, [['', 'Далі…'], ...next.map((s) => [s, STATUS_TEXT[s]])], '')
          : el('span', { class: 'pane-note', text: 'Завершено' })));
    });
    body.replaceChildren(table(['Номер', 'Тип', 'Стан', 'Сума', 'Створено', 'Дія'], rows, 'Замовлень ще немає'));
  };

  const filterSel = select({ onchange: (e) => { filter = e.target.value; draw(); } },
    [['', 'Усі стани'], ...Object.keys(ORDER_NEXT).map((s) => [s, STATUS_TEXT[s]])], '');

  pane.replaceChildren(
    head('Замовлення', 'Звичайні та подарункові', filterSel),
    el('p', { class: 'pane-note',
      text: 'Адреса отримувача показується лише тому, хто збирає це замовлення. Дарувальник її не бачить ніколи.' }),
    body);
  await draw();
}

/* ==================================================================
   People and roles
   ================================================================== */

const PERM_GROUPS = {
  catalog: 'Каталог', orders: 'Замовлення', journal: 'Журнал',
  media: 'Медіа', people: 'Люди', themes: 'Теми', system: 'Система'
};

async function renderPeople(pane) {
  busy(pane);
  const [roleData] = await Promise.all([api.adminRoles()]);
  const roleOptions = roleData.roles.map((r) => [r.key, r.name]);

  const usersBox = el('div', {});
  let search = '';

  const drawUsers = async () => {
    busy(usersBox);
    const res = await api.adminUsers(search ? `?search=${encodeURIComponent(search)}` : '');
    const rows = res.items.map((u) => el('tr', {},
      el('td', {}, el('b', { text: u.displayName ?? '—' })),
      el('td', { class: 'ell', title: u.email, text: u.email }),
      el('td', {}, pill(u.status)),
      el('td', { text: u.roles.map((r) => r.name).join(', ') || 'Читач' }),
      el('td', { text: String(u.orders) }),
      el('td', { text: fmtDate(u.createdAt) }),
      el('td', {},
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Ролі',
          onclick: () => editRoles(u) }))));
    usersBox.replaceChildren(
      table(['Нік', 'Пошта', 'Стан', 'Ролі', 'Замовлень', 'З нами з', ''], rows, 'Нікого не знайдено'));
  };

  function editRoles(u) {
    const chosen = new Set(u.roles.map((r) => r.key));
    const list = el('div', { class: 'perms__list' },
      roleOptions.map(([key, name]) => el('label', { class: 'perm' },
        el('input', { type: 'checkbox', checked: chosen.has(key),
          onchange: (e) => (e.target.checked ? chosen.add(key) : chosen.delete(key)) }),
        el('span', {}, name))));

    const card = el('div', { class: 'pane-card' },
      el('h2', { class: 'pane-card__h', text: `Ролі: ${u.displayName ?? u.email}` }),
      list,
      el('p', { class: 'pane-note',
        text: 'Останній власник не може втратити цю роль — інакше крамницю не буде кому відкрити.' }),
      el('div', { class: 'pane__tools' },
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Зберегти',
          onclick: async () => {
            try {
              await api.setUserRoles(u.id, [...chosen]);
              toast('Ролі оновлено');
              card.remove();
              drawUsers();
            } catch (err) { fail(err); }
          } }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Скасувати',
          onclick: () => card.remove() }),
        u.status === 'ACTIVE'
          ? el('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: 'Призупинити',
              onclick: async () => {
                try { await api.userStatus(u.id, 'SUSPENDED'); toast('Обліковий запис призупинено'); card.remove(); drawUsers(); }
                catch (err) { fail(err); }
              } })
          : el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Поновити',
              onclick: async () => {
                try { await api.userStatus(u.id, 'ACTIVE'); toast('Обліковий запис поновлено'); card.remove(); drawUsers(); }
                catch (err) { fail(err); }
              } })));
    usersBox.before(card);
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* --- the role catalogue --- */
  const rolesBox = el('div', {});
  const drawRoles = () => {
    rolesBox.replaceChildren(...roleData.roles.map((role) => {
      const owner = role.key === 'SUPER_ADMIN';
      const held = new Set(role.permissions);
      const groups = {};
      for (const p of roleData.permissions) (groups[p.group] ??= []).push(p);

      return el('div', { class: 'pane-card' },
        el('h2', { class: 'pane-card__h', text: `${role.name} · ${role.users} осіб` }),
        role.description ? el('p', { class: 'pane-note', text: role.description }) : null,
        owner
          ? el('p', { class: 'pane-note',
              text: 'Власник завжди має всі права. Цю роль не можна редагувати — саме вона відновлює всі інші.' })
          : el('div', { class: 'perms' },
              Object.entries(groups).map(([g, perms]) => el('div', { class: 'perms__group' },
                el('p', { class: 'perms__legend', text: PERM_GROUPS[g] ?? g }),
                el('div', { class: 'perms__list' },
                  perms.map((p) => el('label', { class: 'perm' },
                    el('input', { type: 'checkbox', checked: held.has(p.key),
                      onchange: (e) => (e.target.checked ? held.add(p.key) : held.delete(p.key)) }),
                    el('span', {}, p.key, el('small', { text: p.description ?? '' })))))))),
        owner ? null : el('div', { class: 'pane__tools' },
          el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Зберегти права',
            onclick: async () => {
              try {
                await api.setRolePerms(role.key, [...held]);
                role.permissions = [...held];
                toast(`Права ролі «${role.name}» оновлено`);
              } catch (err) { fail(err); }
            } })));
    }));
  };

  const searchInput = input({ placeholder: 'Пошук за нікнеймом або поштою',
    oninput: (e) => { search = e.target.value.trim(); clearTimeout(searchInput._t);
                      searchInput._t = setTimeout(drawUsers, 250); } });

  pane.replaceChildren(
    head('Люди та ролі', 'Облікові записи крамниці', searchInput),
    el('p', { class: 'pane-note',
      text: 'Тут видно обліковий запис, а не досьє: пошта, нік і ролі. Адреси й телефони належать замовленню, а не цій таблиці.' }),
    usersBox,
    el('h2', { class: 'pane-card__h', style: 'margin-top:2.4rem', text: 'Ролі та права' }),
    rolesBox);
  drawRoles();
  await drawUsers();
}

/* ==================================================================
   Themes
   ================================================================== */

async function renderThemes(pane) {
  busy(pane);
  const list = await api.adminThemes();
  const editor = el('div', {});

  const cards = el('div', { class: 'themes' },
    list.items.map((t) => {
      const card = el('button', {
        class: `theme-card${t.id === list.activeThemeId ? ' is-active' : ''}`,
        type: 'button',
        onclick: () => openTheme(t.id)
      },
        el('div', { class: 'theme-card__swatches' }),
        el('div', { class: 'theme-card__body' },
          el('div', { class: 'theme-card__name', text: t.name }),
          el('p', { class: 'theme-card__meta',
            text: [t.id === list.activeThemeId ? 'На вітрині' : null,
                   t.publishedVersion ? `в. ${t.publishedVersion.version}` : 'не опубліковано',
                   t.hasDraft ? 'є чернетка' : null].filter(Boolean).join(' · ') })));
      /* Swatches are painted, never written as a style string with data in it. */
      api.adminTheme(t.id).then((full) => {
        const c = (full.live ?? full.draft)?.colors ?? {};
        const strip = card.querySelector('.theme-card__swatches');
        for (const slot of ['bg', 'accent', 'navy-900', 'gold', 'surface']) {
          const sw = el('div', { class: 'theme-card__sw' });
          if (c[slot]) sw.style.background = c[slot].startsWith('#') ? c[slot] : `rgb(${c[slot]})`;
          strip.append(sw);
        }
      }).catch(() => {});
      return card;
    }));

  async function openTheme(id) {
    busy(editor);
    const full = await api.adminTheme(id);
    const tokens = structuredClone(full.draft ?? full.live);
    if (!tokens) { editor.replaceChildren(el('p', { class: 'pane-note', text: 'У цієї теми ще немає версій.' })); return; }

    const slots = el('div', { class: 'slots' },
      full.slots.map((slot) => {
        const raw = tokens.colors[slot] ?? '#808080';
        /* The channel form cannot go in a colour input, so it is edited as
           text; the hex form gets a picker. Both stay in their own shape. */
        const isHex = raw.startsWith('#');
        const ctl = isHex
          ? el('input', { type: 'color', value: raw.slice(0, 7),
              oninput: (e) => { tokens.colors[slot] = e.target.value; } })
          : el('input', { class: 'fld__i', type: 'text', value: raw, size: 10,
              oninput: (e) => { tokens.colors[slot] = e.target.value; } });
        return el('label', { class: 'slot' }, ctl, el('code', { text: slot }));
      }));

    const missing = full.slots.filter((s) => !tokens.colors[s]);

    editor.replaceChildren(el('div', { class: 'pane-card' },
      el('h2', { class: 'pane-card__h', text: full.theme.name }),
      el('p', { class: 'pane-note',
        text: 'Збереження пише нову версію і не чіпає те, що бачать читачі. Публікація переводить вказівник, відкат — повертає його назад.' }),
      missing.length ? el('p', { class: 'pane-note', style: 'color:var(--warn)',
        text: `Без кольору: ${missing.join(', ')} — таку тему можна зберегти, але не можна показати.` }) : null,
      slots,
      el('div', { class: 'pane__tools', style: 'margin-top:1.2rem' },
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Зберегти чернетку',
          onclick: async () => {
            try { await api.saveThemeDraft(id, { tokens }); toast('Чернетку збережено'); openTheme(id); }
            catch (err) { fail(err); }
          } }),
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Опублікувати',
          onclick: async () => {
            try {
              await api.saveThemeDraft(id, { tokens });
              await api.publishTheme(id, {});
              toast('Тему опубліковано');
              openTheme(id);
            } catch (err) { fail(err); }
          } }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Вдягти на крамницю',
          onclick: async () => {
            try { await api.publishTheme(id, { activate: true }); toast('Крамниця вдягла цю тему'); renderThemes(pane); }
            catch (err) { fail(err); }
          } })),
      full.theme.versions.length > 1
        ? el('div', { style: 'margin-top:1.4rem' },
            el('p', { class: 'perms__legend', text: 'Версії' }),
            table(['Версія', 'Підпис', 'Створено', ''], full.theme.versions.map((v) => el('tr', {},
              el('td', { text: `в. ${v.version}` }),
              el('td', { text: v.label ?? '—' }),
              el('td', { text: fmtWhen(v.createdAt) }),
              el('td', {}, v.isPublished
                ? el('span', { class: 'pill pill--ok', text: 'На сайті' })
                : el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Відкотити сюди',
                    onclick: async () => {
                      try { await api.publishTheme(id, { versionId: v.id }); toast(`Відкочено до версії ${v.version}`); openTheme(id); }
                      catch (err) { fail(err); }
                    } }))))))
        : null));
    editor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  pane.replaceChildren(
    head('Теми', 'Вигляд крамниці',
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Нова з копії',
        onclick: async () => {
          const name = prompt('Назва нової теми');
          if (!name) return;
          try {
            const made = await api.createTheme({ name, basedOn: list.items[0].id });
            toast(`Тему «${name}» створено`);
            renderThemes(pane);
            openTheme(made.theme.id);
          } catch (err) { fail(err); }
        } })),
    el('p', { class: 'pane-note',
      text: 'Тема — це набір іменованих кольорів, а не CSS. Нічого з написаного тут не може стати кодом на сторінці.' }),
    cards, editor);
}

/* ==================================================================
   The journal, with a block editor
   ================================================================== */

const BLOCK_KINDS = [
  ['paragraph', 'Абзац'], ['heading', 'Підзаголовок'], ['quote', 'Цитата'],
  ['list', 'Список'], ['image', 'Зображення'], ['book', 'Книжка'],
  ['link', 'Посилання'], ['divider', 'Розділювач']
];

function blockEditor(doc) {
  const wrap = el('div', { class: 'blocks' });

  const draw = () => {
    wrap.replaceChildren(...doc.blocks.map((b, i) => {
      const move = (delta) => {
        const j = i + delta;
        if (j < 0 || j >= doc.blocks.length) return;
        [doc.blocks[i], doc.blocks[j]] = [doc.blocks[j], doc.blocks[i]];
        draw();
      };
      const bar = el('div', { class: 'block__bar' },
        el('span', { class: 'block__kind', text: BLOCK_KINDS.find(([k]) => k === b.type)?.[1] ?? b.type }),
        el('button', { class: 'block__btn', type: 'button', text: '↑', title: 'Вище', onclick: () => move(-1) }),
        el('button', { class: 'block__btn', type: 'button', text: '↓', title: 'Нижче', onclick: () => move(1) }),
        el('button', { class: 'block__btn', type: 'button', text: '×', title: 'Прибрати',
          onclick: () => { doc.blocks.splice(i, 1); draw(); } }));

      const body = [];
      if (b.type === 'paragraph' || b.type === 'quote') {
        body.push(el('textarea', { rows: 3, value: b.text ?? '',
          oninput: (e) => { b.text = e.target.value; } }));
        if (b.type === 'quote') {
          body.push(input({ placeholder: 'Хто сказав', value: b.cite ?? '',
            oninput: (e) => { b.cite = e.target.value || null; } }));
        }
      } else if (b.type === 'heading') {
        body.push(input({ value: b.text ?? '', placeholder: 'Текст підзаголовка',
          oninput: (e) => { b.text = e.target.value; } }));
        body.push(select({ onchange: (e) => { b.level = Number(e.target.value); } },
          [['2', 'Рівень 2'], ['3', 'Рівень 3']], String(b.level ?? 2)));
      } else if (b.type === 'list') {
        body.push(el('textarea', { rows: 4, value: (b.items ?? []).join('\n'),
          placeholder: 'Один пункт на рядок',
          oninput: (e) => { b.items = e.target.value.split('\n').filter((x) => x.trim()); } }));
        body.push(el('label', { class: 'perm' },
          el('input', { type: 'checkbox', checked: !!b.ordered,
            onchange: (e) => { b.ordered = e.target.checked; } }),
          el('span', {}, 'Нумерований')));
      } else if (b.type === 'image') {
        body.push(input({ placeholder: 'ID медіа', value: b.mediaId ?? '',
          oninput: (e) => { b.mediaId = e.target.value; } }));
        body.push(input({ placeholder: 'Підпис', value: b.caption ?? '',
          oninput: (e) => { b.caption = e.target.value || null; } }));
        body.push(select({ onchange: (e) => { b.width = e.target.value; } },
          [['column', 'У колонку'], ['wide', 'Ширше'], ['full', 'На всю']], b.width ?? 'column'));
      } else if (b.type === 'book') {
        body.push(input({ placeholder: 'ID книжки з каталогу', value: b.bookId ?? '',
          oninput: (e) => { b.bookId = e.target.value; } }));
        body.push(input({ placeholder: 'Коментар', value: b.note ?? '',
          oninput: (e) => { b.note = e.target.value || null; } }));
      } else if (b.type === 'link') {
        body.push(input({ placeholder: 'https://… або /шлях', value: b.href ?? '',
          oninput: (e) => { b.href = e.target.value; } }));
        body.push(input({ placeholder: 'Текст посилання', value: b.text ?? '',
          oninput: (e) => { b.text = e.target.value; } }));
      }
      return el('div', { class: 'block' }, bar, body);
    }),
    el('div', { class: 'blocks__add' },
      BLOCK_KINDS.map(([kind, label]) => el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: '+ ' + label,
        onclick: () => {
          const fresh = { paragraph: { type: 'paragraph', text: '' },
            heading: { type: 'heading', level: 2, text: '' },
            quote: { type: 'quote', text: '', cite: null },
            list: { type: 'list', ordered: false, items: [] },
            image: { type: 'image', mediaId: '', caption: null, width: 'column' },
            book: { type: 'book', bookId: '', note: null },
            link: { type: 'link', href: '', text: '' },
            divider: { type: 'divider' } }[kind];
          doc.blocks.push(fresh);
          draw();
        } }))));
  };
  draw();
  return wrap;
}

async function renderJournal(pane) {
  busy(pane);
  const listBox = el('div', {});
  const editorBox = el('div', {});

  const drawList = async () => {
    busy(listBox);
    const res = await api.adminArticles('');
    const rows = res.items.map((a) => el('tr', {},
      el('td', { class: 'wrap' }, el('b', { text: a.title })),
      el('td', {}, pill(a.status)),
      el('td', { text: a.readingMinutes ? `${a.readingMinutes} хв` : '—' }),
      el('td', { text: a.publishedAt ? fmtDate(a.publishedAt) : (a.scheduledFor ? `→ ${fmtDate(a.scheduledFor)}` : '—') }),
      el('td', {},
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Редагувати',
          onclick: () => openArticle(a.id) }))));
    listBox.replaceChildren(table(['Заголовок', 'Стан', 'Читати', 'Дата', ''], rows, 'Статей ще немає'));
  };

  function form(article) {
    const doc = structuredClone(article?.content ?? { blocks: [] });
    const titleI = input({ value: article?.title ?? '', placeholder: 'Заголовок' });
    const slugI = input({ value: article?.slug ?? '', placeholder: 'адреса-статті' });
    const excerptI = el('textarea', { class: 'fld__i', rows: 2, value: article?.excerpt ?? '',
      placeholder: 'Короткий опис для картки' });

    const save = async (status) => {
      const body = {
        title: titleI.value.trim(),
        slug: slugI.value.trim() || undefined,
        excerpt: excerptI.value.trim() || null,
        content: doc
      };
      if (!body.title) { toast('Потрібен заголовок'); return; }
      try {
        if (article) {
          await api.updateArticle(article.id, body);
          if (status && status !== article.status) await api.articleStatus(article.id, { status });
        } else {
          const made = await api.createArticle({ ...body, status: status ?? 'DRAFT' });
          article = made.article;
        }
        toast('Статтю збережено');
        editorBox.replaceChildren();
        drawList();
      } catch (err) { fail(err); }
    };

    return el('div', { class: 'pane-card' },
      el('h2', { class: 'pane-card__h', text: article ? 'Редагування статті' : 'Нова стаття' }),
      el('div', { class: 'pane-form' },
        field('Заголовок', titleI),
        field('Адреса', slugI),
        field('Опис', excerptI)),
      el('p', { class: 'perms__legend', style: 'margin-top:1.4rem', text: 'Тіло статті' }),
      el('p', { class: 'pane-note',
        text: 'Стаття складається з блоків, а не з HTML. Тому в неї неможливо вписати скрипт.' }),
      blockEditor(doc),
      el('div', { class: 'pane__tools', style: 'margin-top:1.4rem' },
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Зберегти чернетку',
          onclick: () => save('DRAFT') }),
        can('article.publish')
          ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Опублікувати',
              onclick: () => save('PUBLISHED') })
          : null,
        el('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: 'Закрити',
          onclick: () => editorBox.replaceChildren() })));
  }

  async function openArticle(id) {
    try {
      const res = await api.adminArticle(id);
      editorBox.replaceChildren(form(res.article));
      editorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) { fail(err); }
  }

  pane.replaceChildren(
    head('Журнал', 'Статті крамниці',
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Нова стаття',
        onclick: () => { editorBox.replaceChildren(form(null)); editorBox.scrollIntoView({ block: 'nearest' }); } })),
    editorBox, listBox);
  await drawList();
}

/* ==================================================================
   Media
   ================================================================== */

async function renderMedia(pane) {
  busy(pane);
  const res = await api.adminMedia('');
  const items = res.items ?? [];
  pane.replaceChildren(
    head('Медіа', `${items.length} файлів`),
    el('p', { class: 'pane-note',
      text: 'Кожен завантажений файл перекодовується наново — формат читається з самих байтів, а не з того, як файл назвали.' }),
    items.length
      ? el('div', { class: 'media-grid' },
          items.map((m) => el('div', { class: 'media-item' },
            el('img', { src: m.url, alt: m.alt ?? '', loading: 'lazy' }),
            el('span', { class: 'media-item__f', text: m.alt || m.folder || 'файл' }))))
      : el('p', { class: 'tbl__empty', text: 'Бібліотека порожня' }));
}

/* ==================================================================
   Settings
   ================================================================== */

async function renderSettings(pane) {
  busy(pane);
  const [{ settings: s }, themes] = await Promise.all([api.settings(), api.adminThemes().catch(() => ({ items: [] }))]);

  const f = {};
  const num = (key, label) => {
    f[key] = input({ type: 'number', min: 0, step: 1, value: String((s[key] ?? 0) / 100) });
    return field(label, f[key]);
  };
  f.siteName = input({ value: s.siteName ?? '' });
  f.contactEmail = input({ type: 'email', value: s.contactEmail ?? '' });
  f.defaultLocale = select({}, [['UK', 'Українська'], ['DE', 'Deutsch'], ['EN', 'English']], s.defaultLocale);
  f.defaultCurrency = select({}, [['EUR', 'Євро'], ['UAH', 'Гривня']], s.defaultCurrency);
  f.activeThemeId = select({}, [['', '— не змінювати —'],
    ...themes.items.filter((t) => t.publishedVersion).map((t) => [t.id, t.name])], '');

  pane.replaceChildren(
    head('Налаштування', 'Крамниця'),
    el('div', { class: 'pane-card' },
      el('h2', { class: 'pane-card__h', text: 'Загальне' }),
      el('div', { class: 'pane-form' },
        field('Назва крамниці', f.siteName),
        field('Пошта для звʼязку', f.contactEmail),
        el('div', { class: 'pane-form__row' },
          field('Мова за замовчуванням', f.defaultLocale),
          field('Валюта за замовчуванням', f.defaultCurrency)),
        field('Тема на вітрині', f.activeThemeId))),
    el('div', { class: 'pane-card' },
      el('h2', { class: 'pane-card__h', text: 'Доставка' }),
      el('div', { class: 'pane-form' },
        el('div', { class: 'pane-form__row' },
          num('freeShippingEurCents', 'Безкоштовно від, €'),
          num('freeShippingUahCents', 'Безкоштовно від, ₴')),
        el('div', { class: 'pane-form__row' },
          num('shippingFlatEurCents', 'Доставка, €'),
          num('shippingFlatUahCents', 'Доставка, ₴'))),
      el('p', { class: 'pane-note',
        text: 'Кожна сума вводиться окремо для кожної валюти. Курсу в системі немає і не буде — одна валюта ніколи не перераховується в іншу.' })),
    el('div', { class: 'pane__tools' },
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Зберегти',
        onclick: async () => {
          const body = {
            siteName: f.siteName.value.trim(),
            contactEmail: f.contactEmail.value.trim() || null,
            defaultLocale: f.defaultLocale.value,
            defaultCurrency: f.defaultCurrency.value,
            freeShippingEurCents: Math.round(Number(f.freeShippingEurCents.value) * 100),
            freeShippingUahCents: Math.round(Number(f.freeShippingUahCents.value) * 100),
            shippingFlatEurCents: Math.round(Number(f.shippingFlatEurCents.value) * 100),
            shippingFlatUahCents: Math.round(Number(f.shippingFlatUahCents.value) * 100)
          };
          if (f.activeThemeId.value) body.activeThemeId = f.activeThemeId.value;
          try { await api.saveSettings(body); toast('Налаштування збережено'); }
          catch (err) { fail(err); }
        } })));
}

/* ==================================================================
   The shell itself
   ================================================================== */

const PANELS = {
  dashboard: renderDashboard,
  orders: renderOrders,
  people: renderPeople,
  themes: renderThemes,
  journal: renderJournal,
  media: renderMedia,
  settings: renderSettings
  /* books is the desk in admin.js and renders itself */
};

const drawn = new Set();

function show(name) {
  const links = $$('.adm-nav__link');
  const allowed = links.filter((a) => !a.hidden).map((a) => a.getAttribute('href').slice(1));
  if (!allowed.includes(name)) name = allowed[0] ?? 'dashboard';

  for (const panel of $$('.adm-panel')) panel.hidden = panel.dataset.panel !== name;
  for (const a of links) {
    const on = a.getAttribute('href') === '#' + name;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  $('#adm-nav')?.classList.remove('is-open');
  $('#nav-burger')?.setAttribute('aria-expanded', 'false');

  const render = PANELS[name];
  const pane = $('#pane-' + name);
  if (render && pane && !drawn.has(name)) {
    drawn.add(name);
    render(pane).catch((err) => {
      drawn.delete(name);
      pane.replaceChildren(el('p', { class: 'pane-note', text: err?.message ?? 'Не вдалося завантажити розділ.' }));
    });
  }
  document.title = `RIDMORE — ${$(`.adm-nav__link[href="#${name}"]`)?.textContent.trim() ?? 'адмінка'}`;
}

async function boot() {
  /* The book desk already wires the theme caret. Wiring it twice gives the
     button two handlers that open and close the menu in one click — which
     cost an afternoon once, and is not going to cost another. */
  await loadViewer({ force: true });
  const viewer = currentViewer();

  if (!viewer || !isStaff()) {
    $('.adm-shell')?.setAttribute('hidden', '');
    const gate = $('#adm-gate');
    if (gate) {
      gate.hidden = false;
      $('#gate-lede').textContent = viewer
        ? 'Цей обліковий запис не має доступу до адміністрування. Попросіть власника крамниці надати роль.'
        : 'Увійдіть обліковим записом, що має доступ до адміністрування.';
      /* The very first account to register becomes the owner, so on a fresh
         shop the way in is to sign up, not to be granted anything. */
      if (!viewer && isOffline()) {
        $('#gate-lede').textContent =
          'Це демонстрація в браузері. Зареєструйтесь у крамниці — перший обліковий запис одразу стає власником.';
      }
    }
    return;
  }

  /* A section the account cannot reach is not drawn as a locked door. */
  for (const a of $$('.adm-nav__link')) {
    const needs = (a.dataset.needs ?? '').split(',').filter(Boolean);
    a.hidden = needs.length > 0 && !needs.some((k) => can(k));
  }

  $('#nav-who').replaceChildren(
    el('b', { text: viewer.nickname ?? viewer.email ?? 'Ви' }),
    document.createTextNode(`${viewer.permissions?.length ?? 0} прав доступу`));

  $('#nav-burger')?.addEventListener('click', () => {
    const nav = $('#adm-nav');
    const open = nav.classList.toggle('is-open');
    $('#nav-burger').setAttribute('aria-expanded', String(open));
  });

  addEventListener('hashchange', () => show(location.hash.slice(1) || 'dashboard'));
  show(location.hash.slice(1) || 'dashboard');
}

boot().catch((err) => {
  console.error(err);
  toast('Адмінка не змогла завантажитись.');
});
