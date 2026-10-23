// Ukrainian → Latin as in KSE emails (official KMU 2010 transliteration),
// so "Плетмінцев" finds pletmintsev@… . Russian-only letters are mapped too.
const FIRST: Record<string, string> = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };
const ANY: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh',
  ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'e', ъ: '', "'": '', 'ʼ': '', '’': '',
};

export function toLatin(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[^а-яґєіїё])([єїйюя])/g, (_, before, ch) => before + FIRST[ch])
    .replace(/зг/g, 'zgh')
    .replace(/[а-яґєіїёʼ’']/g, (ch) => ANY[ch] ?? ch);
}
