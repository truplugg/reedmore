/* ============================================================
   RIDMORE — accounts
   Signing up, signing in, and the reader's own corner of the
   shop: profile, avatar, lists and gifts. One dialog holds all
   of it, so there is one focus trap and one place to close.
   ============================================================ */

import { api, ApiError, loadViewer, setViewer, currentViewer, onViewer, isStaff, isOffline } from './api.js';
import { t, getLang, LANGS } from './i18n.js';
import { esc } from './covers.js';
import { get, set } from './store.js';
import { toast } from './ui.js';

let dialog, panel, body, lastFocus = null, view = 'signin';

const el = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
};

/* ---------------------------------------------------------- shell */

function ensureDialog() {
  if (dialog) return;
  dialog = el(`
    <div class="dialog acct" id="account-dialog" role="dialog" aria-modal="true" aria-labelledby="acct-title" hidden>
      <div class="dialog__panel acct__panel">
        <button class="dialog__close" data-act="close" aria-label="${esc(t('a11y.close'))}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <div class="acct__body" id="acct-body"></div>
      </div>
    </div>`);
  document.body.append(dialog);
  panel = dialog.querySelector('.dialog__panel');
  body = dialog.querySelector('#acct-body');

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-act="close"]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialog.hidden) { e.stopPropagation(); close(); }
  });
  panel.addEventListener('keydown', trapFocus);
  body.addEventListener('click', onClick);
  body.addEventListener('submit', onSubmit);
}

function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function openAccount(which = null) {
  ensureDialog();
  lastFocus = document.activeElement;
  view = which ?? (currentViewer() ? 'home' : 'signin');
  render();
  dialog.hidden = false;
  document.getElementById('scrim').hidden = false;
  requestAnimationFrame(() => {
    dialog.classList.add('is-open');
    document.getElementById('scrim').classList.add('is-on');
  });
  document.body.classList.add('is-locked');
  panel.querySelector('input, button')?.focus();
}

export function close() {
  if (!dialog || dialog.hidden) return;
  dialog.classList.remove('is-open');
  const scrim = document.getElementById('scrim');
  if (!document.getElementById('cart')?.classList.contains('is-open')) {
    scrim.classList.remove('is-on');
    document.body.classList.remove('is-locked');
    setTimeout(() => { scrim.hidden = true; }, 320);
  }
  setTimeout(() => { dialog.hidden = true; }, 320);
  lastFocus?.focus?.();
}

/** Somewhere else in the shop needs an account before it can go on. */
export function requireAccount(reason) {
  if (currentViewer()) return true;
  openAccount('signin');
  if (reason) {
    const note = body.querySelector('.acct__why');
    if (note) { note.textContent = reason; note.hidden = false; }
  }
  return false;
}

/* ---------------------------------------------------------- views */

const field = (name, label, type = 'text', attrs = '') => `
  <label class="field">
    <span class="field__label">${esc(label)}</span>
    <input class="input" name="${name}" type="${type}" ${attrs}>
    <span class="field__err" data-err="${name}" hidden></span>
  </label>`;

function signInView() {
  return `
    <h2 id="acct-title">${esc(t('acct.signInTitle'))}</h2>
    <p class="acct__why" hidden></p>
    ${previewNote()}
    <form class="acct__form" data-form="signin" novalidate>
      ${field('email', t('acct.email'), 'email', 'autocomplete="email" required')}
      ${field('password', t('acct.password'), 'password', 'autocomplete="current-password" required')}
      <p class="acct__error" data-form-error hidden></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${esc(t('acct.signIn'))}</button>
    </form>
    <div class="acct__alt">
      <button class="link" data-go="forgot" type="button">${esc(t('acct.forgot'))}</button>
      <span>${esc(t('acct.noAccount'))} <button class="link link--strong" data-go="signup" type="button">${esc(t('acct.signUp'))}</button></span>
    </div>`;
}

function previewNote() {
  return isOffline()
    ? `<p class="acct__preview">${esc(t('acct.previewNote'))}</p>`
    : '';
}

function signUpView() {
  return `
    <h2 id="acct-title">${esc(t('acct.signUpTitle'))}</h2>
    <p class="acct__lede">${esc(t('acct.signUpLede'))}</p>
    ${previewNote()}
    <form class="acct__form" data-form="signup" novalidate>
      ${field('nickname', t('acct.nickname'), 'text', 'autocomplete="nickname" required minlength="2" maxlength="24"')}
      <p class="field__hint">${esc(t('acct.nicknameHint'))}</p>
      ${field('email', t('acct.email'), 'email', 'autocomplete="email" required')}
      ${field('password', t('acct.password'), 'password', 'autocomplete="new-password" required minlength="10"')}
      <p class="field__hint">${esc(t('acct.passwordHint'))}</p>
      <p class="acct__error" data-form-error hidden></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${esc(t('acct.createAccount'))}</button>
    </form>
    <div class="acct__alt">
      <span>${esc(t('acct.haveAccount'))} <button class="link link--strong" data-go="signin" type="button">${esc(t('acct.signIn'))}</button></span>
    </div>`;
}

function forgotView() {
  return `
    <h2 id="acct-title">${esc(t('acct.forgotTitle'))}</h2>
    <p class="acct__lede">${esc(t('acct.forgotLede'))}</p>
    <form class="acct__form" data-form="forgot" novalidate>
      ${field('email', t('acct.email'), 'email', 'autocomplete="email" required')}
      <p class="acct__error" data-form-error hidden></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${esc(t('acct.sendLink'))}</button>
    </form>
    <div class="acct__alt">
      <button class="link" data-go="signin" type="button">${esc(t('acct.backToSignIn'))}</button>
    </div>`;
}

function homeView(account) {
  const a = account ?? {};
  const lists = a.lists ?? {};
  const total = (lists.PUBLIC ?? 0) + (lists.PRIVATE ?? 0) + (lists.UNLISTED ?? 0);
  return `
    <div class="acct__head">
      <img class="acct__avatar" src="${esc(a.avatarUrl ?? '')}" alt="" width="64" height="64">
      <div>
        <h2 id="acct-title">${esc(a.nickname ?? '')}</h2>
        <p class="acct__email">${esc(a.email ?? '')}</p>
        ${a.staff ? `<p class="acct__role">${esc(roleLabel(a.roles))}</p>` : ''}
      </div>
    </div>

    ${a.staff ? `
      <a class="acct__admin" href="admin.html">
        <span>
          <strong>${esc(t('acct.adminTitle'))}</strong>
          <small>${esc(t('acct.adminLede'))}</small>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>
      </a>` : ''}

    <div class="acct__stats">
      <div><b class="num">${total}</b><span>${esc(t('acct.lists'))}</span></div>
      <div><b class="num">${a.giftsSent ?? 0}</b><span>${esc(t('acct.giftsSent'))}</span></div>
    </div>

    <nav class="acct__nav">
      <button class="acct__link" data-go="orders" type="button">${esc(t('acct.myOrders'))}</button>
      <button class="acct__link" data-go="lists" type="button">${esc(t('acct.myLists'))}</button>
      <button class="acct__link" data-go="gifts" type="button">${esc(t('acct.myGifts'))}</button>
      <button class="acct__link" data-go="profile" type="button">${esc(t('acct.editProfile'))}</button>
      <button class="acct__link" data-go="security" type="button">${esc(t('acct.security'))}</button>
    </nav>

    <button class="btn btn--ghost btn--block" data-act="signout" type="button">${esc(t('acct.signOut'))}</button>`;
}

function roleLabel(roles = []) {
  const key = roles.find((r) => r !== 'CUSTOMER');
  return key ? t(`role.${key}`) : '';
}

function profileView(account, avatars) {
  const a = account ?? {};
  return `
    <h2 id="acct-title">${esc(t('acct.editProfile'))}</h2>
    <form class="acct__form" data-form="profile" novalidate>
      ${field('nickname', t('acct.nickname'), 'text', `value="${esc(a.nickname ?? '')}" required maxlength="24"`)}
      <fieldset class="acct__avatars">
        <legend class="field__label">${esc(t('acct.avatar'))}</legend>
        <div class="acct__avatarGrid">
          ${(avatars ?? []).map((av) => `
            <label class="acct__avatarOpt">
              <input type="radio" name="avatarUrl" value="${esc(av.url)}" ${av.url === a.avatarUrl ? 'checked' : ''}>
              <img src="${esc(av.url)}" alt="${esc(av.alt ?? '')}" width="48" height="48" loading="lazy">
            </label>`).join('')}
        </div>
      </fieldset>
      <p class="acct__error" data-form-error hidden></p>
      <div class="acct__row">
        <button class="btn btn--ghost" data-go="home" type="button">${esc(t('acct.back'))}</button>
        <button class="btn btn--primary" type="submit">${esc(t('acct.save'))}</button>
      </div>
    </form>`;
}

function securityView() {
  return `
    <h2 id="acct-title">${esc(t('acct.security'))}</h2>
    <form class="acct__form" data-form="password" novalidate>
      <h3 class="acct__sub">${esc(t('acct.changePassword'))}</h3>
      ${field('current', t('acct.currentPassword'), 'password', 'autocomplete="current-password" required')}
      ${field('password', t('acct.newPassword'), 'password', 'autocomplete="new-password" required minlength="10"')}
      <p class="acct__error" data-form-error hidden></p>
      <button class="btn btn--primary btn--block" type="submit">${esc(t('acct.save'))}</button>
    </form>

    <form class="acct__form acct__danger" data-form="delete" novalidate>
      <h3 class="acct__sub">${esc(t('acct.deleteTitle'))}</h3>
      <p class="acct__lede">${esc(t('acct.deleteLede'))}</p>
      ${field('password', t('acct.password'), 'password', 'autocomplete="current-password" required')}
      <p class="acct__error" data-form-error hidden></p>
      <button class="btn btn--danger btn--block" type="submit">${esc(t('acct.deleteAccount'))}</button>
    </form>

    <button class="btn btn--ghost btn--block" data-go="home" type="button">${esc(t('acct.back'))}</button>`;
}

function listsView(wishlists) {
  if (!wishlists) return loading();
  return `
    <h2 id="acct-title">${esc(t('acct.myLists'))}</h2>
    <form class="acct__inline" data-form="newlist">
      <input class="input" name="title" maxlength="80" required placeholder="${esc(t('acct.newListName'))}">
      <select class="select" name="visibility">
        <option value="PRIVATE">${esc(t('wish.private'))}</option>
        <option value="PUBLIC">${esc(t('wish.public'))}</option>
        <option value="UNLISTED">${esc(t('wish.unlisted'))}</option>
      </select>
      <button class="btn btn--ink" type="submit">${esc(t('acct.addList'))}</button>
    </form>
    <p class="acct__error" data-form-error hidden></p>

    ${wishlists.length ? `<ul class="acct__lists">${wishlists.map((w) => `
      <li class="acct__list">
        <div class="acct__listHead">
          <b>${esc(w.title)}</b>
          <span class="chip chip--${w.visibility.toLowerCase()}">${esc(t('wish.' + w.visibility.toLowerCase()))}</span>
        </div>
        <p class="acct__listMeta"><span class="num">${w.itemCount}</span> ${esc(t('acct.books'))}</p>
        ${w.shareToken ? `<button class="link" data-copy="${esc(location.origin)}/?wishlist=${esc(w.shareToken)}" type="button">${esc(t('acct.copyLink'))}</button>` : ''}
        ${w.items.length ? `<ul class="acct__items">${w.items.map((i) => `
          <li class="${i.status !== 'AVAILABLE' ? 'is-taken' : ''}">
            <span>${esc(i.book.title)}</span>
            ${i.status === 'AVAILABLE'
              ? `<button class="acct__x" data-remove="${esc(w.id)}:${esc(i.id)}" type="button" aria-label="${esc(t('acct.remove'))}">×</button>`
              : `<em>${esc(t('wish.taken'))}</em>`}
          </li>`).join('')}</ul>` : ''}
      </li>`).join('')}</ul>` : `<p class="acct__empty">${esc(t('acct.noLists'))}</p>`}

    <button class="btn btn--ghost btn--block" data-go="home" type="button">${esc(t('acct.back'))}</button>`;
}

function giftsView(sent, received) {
  if (!sent) return loading();
  const line = (g, who) => `
    <li class="acct__gift">
      <div><b>${esc(g.items?.[0]?.title ?? '')}</b><small>${esc(who)}</small></div>
      <span class="chip">${esc(t('status.' + g.status) || g.status)}</span>
    </li>`;
  return `
    <h2 id="acct-title">${esc(t('acct.myGifts'))}</h2>
    <h3 class="acct__sub">${esc(t('acct.sent'))}</h3>
    ${sent.length ? `<ul class="acct__gifts">${sent.map((g) =>
      line(g, g.anonymous ? t('gift.anonymously') : `${t('acct.to')} ${g.recipient?.nickname ?? ''}`)).join('')}</ul>`
      : `<p class="acct__empty">${esc(t('acct.noGiftsSent'))}</p>`}
    <h3 class="acct__sub">${esc(t('acct.received'))}</h3>
    ${received?.length ? `<ul class="acct__gifts">${received.map((g) =>
      line(g, g.from ? `${t('acct.from')} ${g.from.nickname}` : t('gift.anonymously'))).join('')}</ul>`
      : `<p class="acct__empty">${esc(t('acct.noGiftsReceived'))}</p>`}
    <button class="btn btn--ghost btn--block" data-go="home" type="button">${esc(t('acct.back'))}</button>`;
}


/**
 * A customer's own orders (§22).
 *
 * The figures are the ones the order was written with, not today's prices —
 * an order is a record of what somebody was charged, so it never re-prices
 * itself when the catalogue changes.
 */
function ordersView(orders) {
  if (!orders) return loading();
  const sum = (o) => new Intl.NumberFormat(o.currency === 'UAH' ? 'uk-UA' : 'de-DE',
    { style: 'currency', currency: o.currency, minimumFractionDigits: o.currency === 'UAH' ? 0 : 2 })
    .format(o.total / 100);
  return `
    <h2 id="acct-title">${esc(t('acct.myOrders'))}</h2>
    ${orders.length ? `<ul class="acct__gifts">${orders.map((o) => `
      <li class="acct__gift">
        <div>
          <b>${esc(o.number)}</b>
          <small>${esc(o.items.map((i) => `${i.quantity} × ${i.title}`).join(', '))}</small>
        </div>
        <span class="chip">${esc(t('status.' + o.status) || o.status)} · ${esc(sum(o))}</span>
      </li>`).join('')}</ul>`
      : `<p class="acct__empty">${esc(t('acct.noOrders'))}</p>`}
    <button class="btn btn--ghost btn--block" data-go="home" type="button">${esc(t('acct.back'))}</button>`;
}

const loading = () => `<p class="acct__empty" aria-live="polite">${esc(t('acct.loading'))}</p>`;

/* ---------------------------------------------------------- render */

let cache = { account: null, avatars: null, wishlists: null, sent: null, received: null, orders: null };

function render() {
  if (!body) return;
  const v = currentViewer();
  if (view === 'signin')  body.innerHTML = signInView();
  else if (view === 'signup') body.innerHTML = signUpView();
  else if (view === 'forgot') body.innerHTML = forgotView();
  else if (!v) { view = 'signin'; body.innerHTML = signInView(); }
  else if (view === 'profile')  body.innerHTML = profileView(cache.account, cache.avatars);
  else if (view === 'security') body.innerHTML = securityView();
  else if (view === 'lists')    body.innerHTML = listsView(cache.wishlists);
  else if (view === 'gifts')    body.innerHTML = giftsView(cache.sent, cache.received);
  else if (view === 'orders')   body.innerHTML = ordersView(cache.orders);
  else body.innerHTML = homeView(cache.account);
  panel.scrollTop = 0;
}

async function go(next) {
  view = next;
  render();
  try {
    if (next === 'home' && !cache.account) { cache.account = (await api.account()).account; render(); }
    if (next === 'profile') {
      if (!cache.account) cache.account = (await api.account()).account;
      if (!cache.avatars) cache.avatars = (await api.avatars()).avatars;
      render();
    }
    if (next === 'lists') { cache.wishlists = (await api.myWishlists()).wishlists; render(); }
    if (next === 'orders') { cache.orders = (await api.myOrders()).items; render(); }
    if (next === 'gifts') {
      const [a, b] = await Promise.all([api.giftsSent(), api.giftsReceived()]);
      cache.sent = a.gifts; cache.received = b.gifts; render();
    }
  } catch (err) { showError(err); }
}

function showError(err, form) {
  const box = (form ?? body).querySelector('[data-form-error]');
  const message = err instanceof ApiError ? err.message : t('acct.genericError');
  if (box) { box.textContent = message; box.hidden = false; }
  else toast(message);

  if (err instanceof ApiError && Array.isArray(err.details) && form) {
    for (const d of err.details) {
      const slot = form.querySelector(`[data-err="${d.path}"]`);
      if (slot) { slot.textContent = d.message; slot.hidden = false; }
    }
  }
}

function clearErrors(form) {
  form.querySelectorAll('[data-err]').forEach((e) => { e.hidden = true; e.textContent = ''; });
  const box = form.querySelector('[data-form-error]');
  if (box) { box.hidden = true; box.textContent = ''; }
}

/* ---------------------------------------------------------- events */

function onClick(e) {
  const goTo = e.target.closest('[data-go]');
  if (goTo) { go(goTo.dataset.go); return; }

  const copy = e.target.closest('[data-copy]');
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy).then(
      () => toast(t('acct.linkCopied')), () => toast(copy.dataset.copy));
    return;
  }

  const remove = e.target.closest('[data-remove]');
  if (remove) {
    const [listId, itemId] = remove.dataset.remove.split(':');
    api.removeFromWishlist(listId, itemId)
      .then(() => go('lists'))
      .catch(showError);
    return;
  }

  if (e.target.closest('[data-act="signout"]')) {
    api.signOut().finally(() => {
      setViewer(null);
      cache = { account: null, avatars: null, wishlists: null, sent: null, received: null };
      toast(t('acct.signedOut'));
      close();
    });
  }
}

async function onSubmit(e) {
  const form = e.target.closest('form');
  if (!form) return;
  e.preventDefault();
  clearErrors(form);

  const data = Object.fromEntries(new FormData(form).entries());
  const submit = form.querySelector('[type="submit"]');
  if (submit) { submit.disabled = true; submit.dataset.busy = '1'; }

  try {
    switch (form.dataset.form) {
      case 'signin': {
        await api.signIn({ email: data.email, password: data.password });
        await loadViewer({ force: true });
        toast(t('acct.welcomeBack'));
        cache.account = (await api.account()).account;
        go('home');
        break;
      }
      case 'signup': {
        const res = await api.signUp({
          email: data.email, password: data.password, nickname: data.nickname,
          locale: (get('lang') || 'en').toUpperCase(), currency: get('currency') || 'EUR'
        });
        setViewer(res.user);
        cache.account = (await api.account()).account;
        /* The first account on a fresh shop owns it, and should be told so. */
        toast(res.owner ? t('acct.ownerWelcome') : t('acct.welcome'), { long: res.owner });
        go('home');
        break;
      }
      case 'forgot':
        await api.forgotPassword(data.email);
        body.innerHTML = `<h2 id="acct-title">${esc(t('acct.forgotTitle'))}</h2>
          <p class="acct__lede">${esc(t('acct.forgotSent'))}</p>
          <button class="btn btn--ghost btn--block" data-go="signin" type="button">${esc(t('acct.backToSignIn'))}</button>`;
        break;
      case 'profile': {
        const res = await api.saveProfile({
          nickname: data.nickname,
          avatarUrl: data.avatarUrl || null
        });
        cache.account = { ...cache.account, ...res.account };
        await loadViewer({ force: true });
        toast(t('acct.profileSaved'));
        go('home');
        break;
      }
      case 'password':
        await api.changePassword({ current: data.current, password: data.password });
        toast(t('acct.passwordChanged'));
        go('home');
        break;
      case 'delete':
        if (!confirm(t('acct.deleteConfirm'))) break;
        await api.deleteAccount(data.password);
        setViewer(null);
        cache = { account: null, avatars: null, wishlists: null, sent: null, received: null };
        toast(t('acct.deleted'));
        close();
        break;
      case 'newlist':
        await api.createWishlist({ title: data.title, visibility: data.visibility });
        go('lists');
        break;
    }
  } catch (err) {
    showError(err, form);
  } finally {
    if (submit) { submit.disabled = false; delete submit.dataset.busy; }
  }
}

/* ---------------------------------------------------------- header */

export function initAccount() {
  const btn = document.getElementById('account-btn');
  if (!btn) return;

  const paint = (v) => {
    btn.classList.toggle('is-in', !!v);
    btn.setAttribute('aria-label', v ? `${t('acct.account')}: ${v.nickname}` : t('acct.signIn'));
    btn.setAttribute('title', btn.getAttribute('aria-label'));
    const img = btn.querySelector('.iconbtn__avatar');
    if (v?.avatarUrl) {
      if (img) img.src = v.avatarUrl;
      else btn.insertAdjacentHTML('beforeend', `<img class="iconbtn__avatar" src="${esc(v.avatarUrl)}" alt="" width="22" height="22">`);
    } else img?.remove();
  };

  btn.addEventListener('click', () => openAccount());
  onViewer(paint);
  loadViewer().then(paint);

  /* Deep link: a share token in the address opens that list. */
  const token = new URLSearchParams(location.search).get('wishlist');
  if (token) document.dispatchEvent(new CustomEvent('ridmore:open-shared', { detail: token }));
}

export { isStaff };
