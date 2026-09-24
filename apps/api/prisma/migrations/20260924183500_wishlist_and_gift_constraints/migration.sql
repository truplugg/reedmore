-- One PUBLIC wishlist per owner (§17).
-- Prisma's @@unique cannot express a filtered index, and a plain unique on
-- (ownerId, visibility) would also forbid a second PRIVATE list. A partial
-- index says exactly what is meant and nothing more.
CREATE UNIQUE INDEX "wishlists_one_public_per_owner"
  ON "wishlists" ("ownerId")
  WHERE "visibility" = 'PUBLIC';

-- An UNLISTED list is only reachable by its token, so it must have one, and a
-- list that is not UNLISTED must not carry a stale token around.
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_share_token_matches_visibility"
  CHECK (
    ("visibility" = 'UNLISTED' AND "shareToken" IS NOT NULL) OR
    ("visibility" <> 'UNLISTED' AND "shareToken" IS NULL)
  );

-- A reserved or fulfilled wishlist item must name the gift that claimed it,
-- and an available one must not. Together with the unique index Prisma already
-- puts on reservedByGiftId, this is what makes the race in §17 impossible:
-- two donors racing for one item both try to write the same row, and the
-- second transaction fails rather than overwriting the first.
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_reservation_is_consistent"
  CHECK (
    ("status" = 'AVAILABLE'  AND "reservedByGiftId" IS NULL) OR
    ("status" IN ('RESERVED', 'FULFILLED') AND "reservedByGiftId" IS NOT NULL)
  );

-- Money is an integer of minor units and is never negative.
ALTER TABLE "books" ADD CONSTRAINT "books_prices_are_non_negative"
  CHECK (
    "priceEurCents" >= 0 AND "priceUahCents" >= 0 AND
    ("salePriceEurCents" IS NULL OR "salePriceEurCents" >= 0) AND
    ("salePriceUahCents" IS NULL OR "salePriceUahCents" >= 0)
  );

ALTER TABLE "orders" ADD CONSTRAINT "orders_totals_are_non_negative"
  CHECK ("subtotal" >= 0 AND "shippingCost" >= 0 AND "discount" >= 0 AND "total" >= 0);

-- Stock cannot be reserved below zero or beyond what is on hand.
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_reserved_within_on_hand"
  CHECK ("reserved" >= 0 AND "onHand" >= 0 AND "reserved" <= "onHand");

-- Exactly one settings row.
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_is_a_singleton" CHECK ("id" = 1);
