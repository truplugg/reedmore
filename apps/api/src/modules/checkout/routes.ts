import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Currency, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound, badRequest, conflict } from '../../lib/errors.js';
import { priceOf } from '../../lib/money.js';
import { orderNumber } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { readContext } from '../books/public.js';
import { quoteShipping } from './shipping.js';

/**
 * Checkout (§22, §23).
 *
 * Three things this file is careful about.
 *
 * **The basket is priced here, not in the browser.** A cart arrives as book
 * ids and quantities and nothing else. Every figure — unit price, line total,
 * delivery, the sum — is read from the database at the moment the order is
 * written. A price posted by a client is not read, so it cannot be changed.
 *
 * **Payment is a separate concern from the order.** Stripe is deliberately
 * not connected. The order carries the shape a payment will have —
 * paymentProvider, paymentIntentId, paymentStatus, paymentCurrency,
 * paymentAmount, paidAt — filled in as NONE / UNPAID, and a provider is
 * attached later by writing those columns. Nothing above them changes when
 * that happens. No card number, expiry, CVC or token is accepted by any
 * route in this repository, and none should ever be: a card belongs to the
 * provider's own form, and the shop's server should never be able to see it.
 *
 * **An order freezes what it sold.** Title, author and unit price are copied
 * onto the line. Editing a book tomorrow must not rewrite what someone was
 * charged today.
 */

const COUNTRY_CURRENCY_HINT: Record<string, Currency> = { DE: 'EUR', UA: 'UAH' };

const addressBody = z.object({
  fullName: z.string().min(1).max(120),
  phone: z.string().max(40).nullish(),
  country: z.enum(['DE', 'UA']),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullish(),
  /** Nova Poshta branch or Packstation; both countries lean on them. */
  pickupPoint: z.string().max(200).nullish(),
  label: z.string().max(60).nullish(),
  /** Keep it on the account for next time. Signed-out guests cannot. */
  save: z.boolean().default(false)
});

const cartBody = z.object({
  items: z.array(z.object({
    bookId: z.string().min(1),
    quantity: z.number().int().min(1).max(20)
  })).min(1).max(50)
});

type CartLine = z.infer<typeof cartBody>['items'][number];

/** Read the real books behind a cart, refusing anything not for sale. */
async function priceCart(lines: CartLine[], currency: Currency) {
  /* A cart that names the same book twice is one line with the sum of the
     quantities, not two lines that each pass the stock check separately. */
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.bookId, (wanted.get(l.bookId) ?? 0) + l.quantity);

  /* The shop addresses a book by its slug — that is what the catalogue, the
     URLs and the wishlists all carry — while the admin desk works in ids.
     Both arrive here, so both resolve, and a basket built in either place
     prices the same way. */
  const keys = [...wanted.keys()];
  const books = await prisma.book.findMany({
    where: { status: 'PUBLISHED', OR: [{ id: { in: keys } }, { slug: { in: keys } }] },
    include: { inventory: true }
  });

  const missing = keys.filter((k) => !books.some((b) => b.id === k || b.slug === k));
  if (missing.length) {
    throw badRequest('book_unavailable', 'One of those books is no longer for sale.', { bookIds: missing });
  }

  const priced = books.map((b) => {
    const quantity = wanted.get(b.id) ?? wanted.get(b.slug)!;
    const { amount } = priceOf(b, currency);
    return {
      book: b,
      quantity,
      unitPrice: amount,
      lineTotal: amount * quantity,
      /* No inventory row means stock is not being tracked for that book,
         which is not the same as being out of stock. */
      shortBy: b.inventory ? Math.max(0, quantity - (b.inventory.onHand - b.inventory.reserved)) : 0
    };
  });

  const short = priced.filter((p) => p.shortBy > 0);
  if (short.length) {
    throw conflict('out_of_stock',
      short.length === 1
        ? `We have fewer copies of “${short[0]!.book.title}” than that.`
        : 'We have fewer copies of some of those than that.');
  }

  return { priced, subtotal: priced.reduce((s, p) => s + p.lineTotal, 0) };
}

/** What a customer may see of their own order. */
function customerOrder(o: Prisma.OrderGetPayload<{
  include: { items: true; shippingAddress: true; gift: true };
}>) {
  return {
    id: o.id,
    number: o.number,
    type: o.type,
    status: o.status,
    currency: o.currency,
    subtotal: o.subtotal,
    shippingCost: o.shippingCost,
    discount: o.discount,
    total: o.total,
    /* The payment block is the shape a provider will fill. It is reported so
       the page can say "awaiting payment" honestly, and so the day Stripe is
       connected nothing above has to change. */
    payment: {
      provider: o.paymentProvider,
      status: o.paymentStatus,
      currency: o.paymentCurrency,
      amount: o.paymentAmount,
      paidAt: o.paidAt
    },
    items: o.items.map((i) => ({
      id: i.id,
      bookId: i.bookId,
      title: i.titleSnapshot,
      author: i.authorSnapshot,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal
    })),
    /* A customer sees the address they gave. A gift order's recipient
       address is not on this path at all — a donor's order carries no
       shippingAddressId, and the manager writes one only into the order
       the recipient never sees a donor on (§21, §31). */
    shipTo: o.type === 'GIFT' || !o.shippingAddress ? null : {
      fullName: o.shippingAddress.fullName,
      country: o.shippingAddress.country,
      city: o.shippingAddress.city,
      postalCode: o.shippingAddress.postalCode,
      line1: o.shippingAddress.line1,
      line2: o.shippingAddress.line2,
      pickupPoint: o.shippingAddress.pickupPoint
    },
    placedAt: o.createdAt
  };
}

const ORDER_INCLUDE = { items: true, shippingAddress: true, gift: true } satisfies Prisma.OrderInclude;

export default async function checkoutRoutes(app: FastifyInstance) {
  /**
   * Price a basket without committing to anything. The page calls this on
   * every change, so it is a read and writes nothing.
   */
  app.post('/quote', async (req) => {
    const body = cartBody.extend({
      country: z.enum(['DE', 'UA']).optional()
    }).parse(req.body);

    const { currency } = readContext(req);
    const country = body.country ?? (currency === 'UAH' ? 'UA' : 'DE');
    const { priced, subtotal } = await priceCart(body.items, currency);
    const quote = await quoteShipping(subtotal, currency, country);

    return {
      ...quote,
      lines: priced.map((p) => ({
        bookId: p.book.id,
        slug: p.book.slug,
        title: p.book.title,
        author: p.book.author,
        unitPrice: p.unitPrice,
        quantity: p.quantity,
        lineTotal: p.lineTotal
      }))
    };
  });

  /**
   * Place the order.
   *
   * Everything happens in one transaction: the lines are priced from the
   * database, stock is reserved with a conditional update, and the order is
   * written. A reservation that loses a race fails the whole thing rather
   * than selling a copy twice.
   */
  app.post('/orders', async (req, reply) => {
    const body = cartBody.extend({
      address: addressBody,
      /** Where to write when there is something to say about this order. */
      email: z.string().email().max(200).optional(),
      notes: z.string().max(500).nullish()
    }).parse(req.body);

    const viewer = req.viewer;
    const { currency } = readContext(req);
    const country = body.address.country;

    /* A guest has to leave an address to write to; an account already has one. */
    const email = viewer?.email ?? body.email;
    if (!email) throw badRequest('email_required', 'We need an email address to send the confirmation to.');

    const { priced, subtotal } = await priceCart(body.items, currency);
    const quote = await quoteShipping(subtotal, currency, country);

    const order = await prisma.$transaction(async (tx) => {
      /* Reserve before writing the order.
     
         The test has to be against the row as it stands, not as it was read:
         `onHand - reserved >= quantity` names both live columns, so the
         second of two orders racing for the last copy sees the first one's
         increment and updates nothing.
     
         Writing it against the reserved count read a moment earlier — which
         is what this was at first — has both racers testing 1 >= 1 and both
         winning. The database caught it: a CHECK constraint says reserved can
         never exceed onHand, so the oversell became a failed transaction
         rather than a second sale of one copy. It also became a 500, which is
         the right outcome reported the wrong way. The code bends to the
         constraint instead, the way the gift claim does.
     
         Prisma's updateMany cannot compare one column with another, so this
         is raw; $executeRaw returns the number of rows it changed. */
      for (const p of priced) {
        if (!p.book.inventory) continue;
        const claimed = await tx.$executeRaw`
          UPDATE "inventory"
             SET "reserved" = "reserved" + ${p.quantity}, "updatedAt" = now()
           WHERE "bookId" = ${p.book.id}
             AND "onHand" - "reserved" >= ${p.quantity}`;
        if (claimed !== 1) {
          throw conflict('out_of_stock', `We have fewer copies of “${p.book.title}” than that.`);
        }
      }

      const address = await tx.shippingAddress.create({
        data: {
          userId: viewer && body.address.save ? viewer.id : null,
          fullName: body.address.fullName,
          phone: body.address.phone ?? null,
          country,
          city: body.address.city,
          postalCode: body.address.postalCode,
          line1: body.address.line1,
          line2: body.address.line2 ?? null,
          pickupPoint: body.address.pickupPoint ?? null,
          label: body.address.label ?? null
        }
      });

      return tx.order.create({
        data: {
          number: orderNumber('RM'),
          type: 'REGULAR',
          status: 'PENDING',
          customerId: viewer?.id ?? null,
          /* Kept so the record still balances after an account is deleted. */
          customerEmailSnapshot: email,
          customerNameSnapshot: body.address.fullName,
          currency,
          subtotal: quote.subtotal,
          shippingCost: quote.shippingCost,
          discount: 0,
          total: quote.total,
          shippingCountry: country,
          shippingAddressId: address.id,

          /* The Stripe-shaped columns, filled with what is true today: no
             provider, nothing paid. Connecting a provider means writing
             these, and only these (§23). */
          paymentProvider: 'NONE',
          paymentStatus: 'UNPAID',
          paymentCurrency: currency,
          paymentAmount: quote.total,

          notes: body.notes ?? null,
          items: {
            create: priced.map((p) => ({
              bookId: p.book.id,
              titleSnapshot: p.book.title,
              authorSnapshot: p.book.author,
              unitPrice: p.unitPrice,
              quantity: p.quantity,
              lineTotal: p.lineTotal
            }))
          },
          history: { create: { to: 'PENDING', note: 'Placed', actorId: viewer?.id ?? null } }
        },
        include: ORDER_INCLUDE
      });
    });

    await audit(viewer?.id ?? null, 'order.place', 'order', order.id, { number: order.number }, req.ip);

    /* The confirmation goes out after the transaction, never inside it: an
       email that cannot be unsent must not be sent for an order that rolls
       back. A console transport stands in until SMTP is configured, so this
       works with no account anywhere. */
    try {
      const { sendMail } = await import('../../lib/mail.js');
      await sendMail({
        to: email,
        subject: `Ridmore — замовлення ${order.number}`,
        text: [
          `Дякуємо! Замовлення ${order.number} прийнято.`,
          '',
          ...order.items.map((i) => `${i.quantity} × ${i.titleSnapshot}`),
          '',
          `Разом: ${(order.total / 100).toFixed(2)} ${currency}`,
          '',
          'Оплата ще не підключена — ми напишемо, коли замовлення буде готове до відправлення.'
        ].join('\n')
      });
    } catch (err) {
      /* A confirmation that fails must not unmake a paid-for order. */
      req.log.error({ err, order: order.number }, 'order confirmation email failed');
    }

    reply.code(201);
    return { order: customerOrder(order) };
  });

  /** A customer's own orders. Never anyone else's. */
  app.get('/orders', async (req) => {
    const viewer = req.requireViewer();
    const rows = await prisma.order.findMany({
      where: { customerId: viewer.id },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    return { items: rows.map(customerOrder) };
  });

  /**
   * One order, by number. A signed-in customer reads their own; a guest
   * reads theirs by quoting the email it was placed with, because a guest
   * has no account for it to belong to.
   */
  app.get('/orders/:number', async (req) => {
    const { number } = z.object({ number: z.string().min(4).max(40) }).parse(req.params);
    const { email } = z.object({ email: z.string().email().optional() }).parse(req.query);
    const viewer = req.viewer;

    const order = await prisma.order.findUnique({ where: { number }, include: ORDER_INCLUDE });
    /* A wrong email and a missing order answer the same way, so this cannot
       be used to find out which order numbers exist. */
    if (!order) throw notFound('No such order.');

    const mine = viewer && order.customerId === viewer.id;
    const quoted = email && order.customerEmailSnapshot &&
      email.toLowerCase() === order.customerEmailSnapshot.toLowerCase();
    if (!mine && !quoted) throw notFound('No such order.');

    return { order: customerOrder(order) };
  });

  /** The addresses an account has kept, to fill the form in. */
  app.get('/addresses', async (req) => {
    const viewer = req.requireViewer();
    const rows = await prisma.shippingAddress.findMany({
      where: { userId: viewer.id },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      take: 10
    });
    return { items: rows };
  });

  /**
   * What the shop can take money with, today.
   *
   * It answers honestly: no provider is connected. The page reads this
   * rather than hard-coding the fact, so connecting Stripe is a server
   * change and the checkout picks it up without being rewritten (§23).
   */
  app.get('/payment-methods', async () => ({
    /* The country hint is here because a currency does not imply a country;
       it is a default for the form, never a rule. */
    countries: Object.keys(COUNTRY_CURRENCY_HINT),
    methods: [
      { id: 'on_delivery', label: 'Оплата при отриманні', available: true, provider: 'NONE' },
      { id: 'card', label: 'Картка', available: false, provider: 'STRIPE',
        note: 'Ще не підключено' }
    ],
    /* No key, no publishable id, nothing to configure. When a provider is
       connected this becomes its client token and nothing else moves. */
    provider: null
  }));
}
