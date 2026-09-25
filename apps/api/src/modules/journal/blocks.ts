import { z } from 'zod';

/**
 * The block document (§13).
 *
 * An article is an array of typed blocks, never a string of HTML. That is
 * the whole security model for the journal: there is no point at which
 * author-supplied markup is parsed, so there is no point at which a script
 * tag, an onerror attribute or a javascript: URL can survive into a reader's
 * page. The renderer builds elements from these fields and sets textContent.
 *
 * Adding a block type means adding it here and teaching the renderer. It
 * cannot be done by an author, which is the point.
 */

const inline = z.string().max(5000);

/** Links are the one place a URL reaches the page, so the scheme is fixed. */
const href = z.string().max(500).refine(
  (u) => /^https?:\/\//i.test(u) || u.startsWith('/'),
  'Links must be http(s) or a path inside the shop.'
);

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: inline }).strict(),
  z.object({ type: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text: inline }).strict(),
  z.object({ type: z.literal('quote'), text: inline, cite: z.string().max(200).nullish() }).strict(),
  z.object({ type: z.literal('list'), ordered: z.boolean().default(false), items: z.array(inline).max(100) }).strict(),
  z.object({
    type: z.literal('image'),
    mediaId: z.string().min(1),
    caption: z.string().max(300).nullish(),
    /** How wide it sits in the column; not a stylesheet, a choice from a list. */
    width: z.enum(['column', 'wide', 'full']).default('column')
  }).strict(),
  z.object({ type: z.literal('divider') }).strict(),
  /** A book from the shop's own catalogue, rendered as a card by the reader's
   *  page. The author picks an id; nothing about the book is copied in, so
   *  the price and cover stay correct forever. */
  z.object({ type: z.literal('book'), bookId: z.string().min(1), note: z.string().max(300).nullish() }).strict(),
  z.object({ type: z.literal('link'), href, text: inline }).strict()
]);

export const documentSchema = z.object({
  blocks: z.array(blockSchema).max(400)
}).strict();

export type BlockDocument = z.infer<typeof documentSchema>;

/** Roughly how long this takes to read, for the byline. Counted from the
 *  text the blocks actually carry, not from a character count of the JSON. */
export function readingMinutes(doc: BlockDocument): number {
  let words = 0;
  for (const b of doc.blocks) {
    const text =
      b.type === 'paragraph' || b.type === 'heading' || b.type === 'link' ? b.text
      : b.type === 'quote' ? b.text
      : b.type === 'list' ? b.items.join(' ')
      : b.type === 'image' ? (b.caption ?? '')
      : b.type === 'book' ? (b.note ?? '')
      : '';
    if (text) words += text.trim().split(/\s+/).length;
  }
  return Math.max(1, Math.round(words / 200));
}
