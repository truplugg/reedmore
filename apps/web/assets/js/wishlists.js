/* ============================================================
   RIDMORE — public wishlists and the gift flow
   The block on the home page is open to everyone: a shop
   window nobody can see into is not a shop window. Giving
   needs an account, and the ask comes at the moment it is
   needed rather than at the door.
   ============================================================ */

import { api, ApiError, currentViewer, onViewer, setApiContext, isOffline } from './api.js';
import { t } from './i18n.js';
import { esc } from './covers.js';
import { bookHTML } from './book3d.js';
import { money, get } from './store.js';
import { toast } from './ui.js';
import { initReveals } from './motion.js';
import { requireAccount, openAccount } from './account.js';

let section, grid, sheet, sheetBody;

/* ---------------------------------------------------------- cards */

/** A face, a name, a few covers, a count — and nothing else about a
 *  person. No address, no email, no real name (§18). */
function card(w) {
  const covers = w.covers.slice(0, 4);
  return `
    <article class="wcard reveal" data-wishlist="${esc(w.id)}">
      <header class="wcard__head">
        <img class="wcard__avatar" src="${esc(w.owner.avatarUrl ?? '')}" alt="" width="44" height="44" loading="lazy">
        <div>
          <b class="wcard__name">${esc(w.owner.nickname)}</b>
          <p class="wcard__meta">
            <span class="num">${w.availableCount}</span> ${esc(t('wish.stillWanted'))}
          </p>
        </div>
      </header>

      <ul class="wcard__covers" aria-hidden="true">
        ${covers.map((b) => `
          <li class="wcard__cover" style="--paper:${esc(b.cover.pal.paper ?? '#1d3b5c')};--ink:${esc(b.cover.pal.ink ?? '#efe9db')}">
            ${b.cover.front
              ? `<img src="${esc(b.cover.front)}" alt="" loading="lazy">`
              : `<span class="wcard__spine">${esc(b.title)}</span>`}
          </li>`).join('')}
        ${covers.length < 4 ? `<li class="wcard__cover wcard__cover--ghost"></li>`.repeat(4 - covers.length) : ''}
      </ul>

      <footer class="wcard__foot">
        <button class="btn btn--ghost btn--sm" data-open-wishlist="${esc(w.id)}" type="button">
          ${esc(t('wish.view'))}
        </button>
        <button class="btn btn--ink btn--sm" data-gift-from="${esc(w.id)}" type="button">
          ${esc(t('wish.gift'))}
        </button>
      </footer>
    </article>`;
}

function skeleton(n = 3) {
  return Array.from({ length: n }, () => `
    <article class="wcard wcard--skeleton" aria-hidden="true">
      <header class="wcard__head"><span class="sk sk--avatar"></span><span class="sk sk--line"></span></header>
      <ul class="wcard__covers"><li class="sk sk--cover"></li><li class="sk sk--cover"></li><li class="sk sk--cover"></li><li class="sk sk--cover"></li></ul>
      <footer class="wcard__foot"><span class="sk sk--btn"></span><span class="sk sk--btn"></span></footer>
    </article>`).join('');
}

/* ---------------------------------------------------------- sheet */

function ensureSheet() {
  if (sheet) return;
  const d = document.createElement('div');
  d.innerHTML = `
    <div class="dialog wish" id="wish-dialog" role="dialog" aria-modal="true" aria-labelledby="wish-title" hidden>
      <div class="dialog__panel wish__panel">
        <button class="dialog__close" data-act="close" aria-label="${esc(t('a11y.close'))}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <div class="wish__body" id="wish-body"></div>
      </div>
    </div>`;
  sheet = d.firstElementChild;
  document.body.append(sheet);
  sheetBody = sheet.querySelector('#wish-body');

  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-act="close"]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) { e.stopPropagation(); closeSheet(); }
  });
  sheetBody.addEventListener('click', onSheetClick);
}

function openSheet(html) {
  ensureSheet();
  sheetBody.innerHTML = html;
  sheet.hidden = false;
  const scrim = document.getElementById('scrim');
  scrim.hidden = false;
  requestAnimationFrame(() => { sheet.classList.add('is-open'); scrim.classList.add('is-on'); });
  document.body.classList.add('is-locked');
  sheet.querySelector('.dialog__close')?.focus();
}

function closeSheet() {
  if (!sheet || sheet.hidden) return;
  sheet.classList.remove('is-open');
  const scrim = document.getElementById('scrim');
  scrim.classList.remove('is-on');
  document.body.classList.remove('is-locked');
  setTimeout(() => { sheet.hidden = true; scrim.hidden = true; }, 320);
}

/** One wishlist, open for anyone to read. */
async function showWishlist(id, { token = null } = {}) {
  openSheet(`<p class="acct__empty">${esc(t('acct.loading'))}</p>`);
  try {
    const res = token ? await api.sharedWishlist(token) : await api.wishlist(id);
    const w = res.wishlist;
    const items = w.items ?? [];
    const signedIn = !!currentViewer();

    sheetBody.innerHTML = `
      <header class="wish__head">
        <img class="wish__avatar" src="${esc(w.owner?.avatarUrl ?? '')}" alt="" width="56" height="56">
        <div>
          <h2 id="wish-title">${esc(w.owner?.nickname ?? w.title)}</h2>
          <p class="wish__meta">${esc(w.title)} · <span class="num">${items.length}</span> ${esc(t('wish.stillWanted'))}</p>
        </div>
      </header>

      ${signedIn ? '' : `
        <p class="wish__gate">
          ${esc(t('wish.gateNote'))}
          <button class="link link--strong" data-act="sign-in" type="button">${esc(t('acct.signIn'))}</button>
        </p>`}

      ${items.length ? `<ul class="wish__items">${items.map((i) => `
        <li class="wish__item">
          <div class="wish__thumb" style="--paper:${esc(i.book.cover.pal.paper ?? '#1d3b5c')};--ink:${esc(i.book.cover.pal.ink ?? '#efe9db')}">
            ${i.book.cover.front ? `<img src="${esc(i.book.cover.front)}" alt="" loading="lazy">` : `<span>${esc(i.book.title)}</span>`}
          </div>
          <div class="wish__info">
            <b>${esc(i.book.title)}</b>
            <span class="book__author">${esc(i.book.author)}</span>
            ${i.note ? `<em class="wish__note">${esc(i.note)}</em>` : ''}
            <span class="book__price">${money(i.book.price, i.book.currency)}</span>
          </div>
          <button class="btn btn--ink btn--sm" data-give="${esc(i.id)}" type="button">${esc(t('wish.giveThis'))}</button>
        </li>`).join('')}</ul>` : `<p class="acct__empty">${esc(t('wish.empty'))}</p>`}`;
  } catch (err) {
    sheetBody.innerHTML = `<p class="acct__empty">${esc(err instanceof ApiError ? err.message : t('acct.genericError'))}</p>`;
  }
}

/** The confirmation step. Nothing is ever bought by surprise (§19). */
function confirmGift(item) {
  openSheet(`
    <h2 id="wish-title">${esc(t('gift.confirmTitle'))}</h2>
    <p class="wish__meta">${esc(t('gift.confirmLede'))}</p>
    <div class="gift__book">
      <b>${esc(item.title)}</b>
      <span class="book__author">${esc(item.author)}</span>
      <span class="book__price">${esc(item.priceLabel)}</span>
    </div>
    <form class="acct__form" data-form="gift" data-item="${esc(item.id)}">
      <label class="check">
        <input type="checkbox" name="anonymous">
        <span>${esc(t('gift.anonymous'))}</span>
      </label>
      <label class="field">
        <span class="field__label">${esc(t('gift.message'))}</span>
        <textarea class="input" name="message" maxlength="500" rows="3" placeholder="${esc(t('gift.messagePlaceholder'))}"></textarea>
      </label>
      <p class="acct__error" data-form-error hidden></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${esc(t('gift.confirm'))}</button>
    </form>`);

  sheetBody.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const submit = e.target.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api.reserveGift({
        wishlistItemId: item.id,
        anonymous: !!data.anonymous,
        message: data.message || undefined
      });
      openSheet(`
        <div class="gift__done">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>
          <h2 id="wish-title">${esc(t('gift.doneTitle'))}</h2>
          <p>${esc(t('gift.doneLede'))}</p>
          <button class="btn btn--ghost" data-act="close" type="button">${esc(t('a11y.close'))}</button>
        </div>`);
      refresh();
    } catch (err) {
      const box = e.target.querySelector('[data-form-error]');
      box.textContent = err instanceof ApiError ? err.message : t('acct.genericError');
      box.hidden = false;
      submit.disabled = false;
    }
  });
}

async function onSheetClick(e) {
  if (e.target.closest('[data-act="sign-in"]')) { closeSheet(); openAccount('signin'); return; }

  const give = e.target.closest('[data-give]');
  if (!give) return;

  /* The gate is here, at the moment it matters — not at the front door. */
  if (!requireAccount(t('wish.gateReason'))) { closeSheet(); return; }

  const li = give.closest('.wish__item');
  confirmGift({
    id: give.dataset.give,
    title: li.querySelector('b').textContent,
    author: li.querySelector('.book__author').textContent,
    priceLabel: li.querySelector('.book__price').textContent
  });
}

/* ---------------------------------------------------------- section */

async function refresh() {
  if (!grid) return;
  try {
    const res = await api.publicWishlists(6);
    const lists = res.wishlists ?? [];
    if (!lists.length) {
      /* Nobody has opened a list yet. Rather than an empty shelf, invite. */
      grid.innerHTML = `
        <div class="wish__invite">
          <p>${esc(t('wish.noneYet'))}</p>
          <button class="btn btn--ink" data-act="start-list" type="button">${esc(t('wish.startOne'))}</button>
        </div>`;
      section.classList.add('is-empty');
      return;
    }
    section.classList.remove('is-empty');
    grid.innerHTML = lists.map(card).join('');
    /* The cards arrive after the reveal observer has already walked the page,
       so they would sit at opacity 0 for ever. Hand them to it now. */
    initReveals();
  } catch (err) {
    /* No API behind this page — a static preview. Take the section away
       rather than leaving three grey boxes pulsing for ever. */
    if (isOffline() || err?.code === 'offline') { section.hidden = true; return; }
    grid.innerHTML = `<p class="acct__empty">${esc(t('acct.genericError'))}</p>`;
  }
}

export function initWishlists() {
  section = document.getElementById('wishlists');
  if (!section) return;
  setApiContext(() => ({ locale: get('lang'), currency: get('currency') }));
  grid = section.querySelector('.wishgrid');
  grid.innerHTML = skeleton();

  section.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open-wishlist], [data-gift-from]');
    if (open) {
      showWishlist(open.dataset.openWishlist ?? open.dataset.giftFrom);
      return;
    }
    if (e.target.closest('[data-act="start-list"]')) {
      if (currentViewer()) openAccount('lists'); else openAccount('signup');
      return;
    }
    if (e.target.closest('[data-act="random"]')) {
      if (!requireAccount(t('wish.gateReason'))) return;
      try {
        const res = await api.randomBook();
        const s = res.suggestion;
        confirmGift({
          id: s.wishlistItemId, title: s.book.title, author: s.book.author,
          priceLabel: money(s.book.price, s.book.currency)
        });
      } catch (err) {
        toast(err instanceof ApiError ? err.message : t('acct.genericError'));
      }
    }
  });

  document.addEventListener('ridmore:open-shared', (e) => showWishlist(null, { token: e.detail }));
  /* a currency or language change picks a different column and a different
     title, so the block is asked again rather than re-rendered from stale data */
  document.addEventListener('ridmore:refresh', refresh);
  onViewer(() => { if (sheet && !sheet.hidden) return; });
  refresh();
}

export { refresh as refreshWishlists };
