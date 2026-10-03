import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type ru from './locales/ru.json';

/** Ключ UI-строки; набор определяется locales/ru.json (проверяется компилятором). */
export type StrKey = Exclude<keyof typeof ru, 'native-name'>;

/**
 * Читает все локали из каталога: имя файла без .json → словарь.
 * Нет каталога или файл бит — пропускается, исключение не бросается.
 */
export function loadLocales(dir?: string): Record<string, Record<string, string>> {
  const d = dir ?? fileURLToPath(new URL('./locales/', import.meta.url));
  const out: Record<string, Record<string, string>> = {};
  let names: string[] = [];
  try {
    names = readdirSync(d);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const code = name.slice(0, -5);
    try {
      const raw = JSON.parse(readFileSync(join(d, name), 'utf8')) as unknown;
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        out[code] = raw as Record<string, string>;
      }
    } catch {
      /* битый файл — пропускаем */
    }
  }
  return out;
}

const LOCALES = loadLocales();

/** Коды доступных локалей, отсортированы: для цикла ←/→ и строки в настройках. */
export function localeCodes(): string[] {
  return Object.keys(LOCALES).sort();
}

/** Название языка на собственном языке; файла нет — сам код. */
export function nativeName(code: string): string {
  const v = LOCALES[code]?.['native-name'];
  return typeof v === 'string' && v !== '' ? v : code;
}

/** Строка: словарь языка → fallback на ru. */
export function resolve(
  known: Record<string, Record<string, string>>,
  lang: string,
  key: string,
): string | undefined {
  return known[lang]?.[key] ?? known.ru?.[key];
}

/** Строка в указанном языке с подстановкой {param}. Неизвестный язык/ключ — fallback на ru, край — сам ключ. */
export function t(lang: string, key: StrKey, params?: Record<string, string | number>): string {
  let s = resolve(LOCALES, lang, key) ?? String(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Первый известный кандидат; нет — 'ru'. */
export function pickDefault(candidates: string[], known: string[]): string {
  for (const c of candidates) if (known.includes(c)) return c;
  return 'ru';
}

/** Системная локаль: Intl (полный ICU в Node ≥ 13), затем переменная LANG, затем 'ru'. */
export function defaultLang(known: string[]): string {
  const intl = (new Intl.DateTimeFormat().resolvedOptions().locale ?? '').toLowerCase();
  const envLang = (process.env.LANG ?? '').toLowerCase();
  return pickDefault([intl.slice(0, 2), envLang.slice(0, 2), 'ru'], known);
}
