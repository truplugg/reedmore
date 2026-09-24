/** Cyrillic transliteration first, then the usual tidy-up. A Ukrainian title
 *  should make a readable address, not a row of hyphens. */
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ь: '', ю: 'iu', я: 'ia', ъ: '', ы: 'y', э: 'e', ё: 'e',
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss'
};

export function slugify(input: string): string {
  const lower = String(input).toLowerCase().trim();
  let out = '';
  for (const ch of lower) out += MAP[ch] ?? ch;
  return out
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'item';
}
