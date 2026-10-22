import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { load } from "js-yaml";
import type { Logger } from "winston";

import { getShareDirs } from "../platform/paths";
import { DEFAULT_I18N_DIRNAME, DEFAULT_LOCALE } from "./schema";

type MessageDict = Record<string, string>;
const dictionaries: Map<string, MessageDict> = new Map<string, MessageDict>();

function tryLoadFromDir(dir: string, logger: Logger): boolean {
  logger.debug(`Attempting to load messages from ${dir}`);

  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  if (files.length === 0) return false;

  for (const file of files) {
    const filePath = resolve(dir, file);
    logger.debug(`Loading messages from ${filePath}`);

    const locale = file.replace(".yaml", "");
    const raw = readFileSync(filePath, "utf-8");
    const parsed = load(raw) as MessageDict;

    dictionaries.set(locale, parsed);
    logger.info(`Loaded ${Object.keys(parsed).length} messages for locale ${locale}`);
  }

  return true;
}

function loadFromCandidates(candidates: string[], logger: Logger): boolean {
  let loaded = false;

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loaded = tryLoadFromDir(candidate, logger);
      if (loaded) break;
      logger.warn(`No .yaml files found in: ${candidate}`);
    } else {
      logger.warn(`No such directory: ${candidate}`);
    }
  }

  if (!loaded) logger.error("No messages loaded from any source");

  return loaded;
}

/**
 * Loads i18n message files into the in-memory `dictionaries` map.
 *
 * Resolution order:
 * 1. **Explicit dir** — if `messagesDir` is provided, it is prepended to the
 *    candidate list and tried first.
 * 2. **Share dirs** — each entry from {@link getShareDirs} is checked for a
 *    `{DEFAULT_I18N_DIRNAME}` sub-directory in priority order.
 *
 * Stops at the first candidate that yields at least one `.yaml` file.
 * Logs a warning for each skipped candidate so the fallback chain is traceable.
 *
 * @param path - Caller-supplied directory to try first, or `undefined`
 *   to start directly from the share-dir fallback chain.
 * @param logger - Logger instance used for debug, warn, and error output.
 * @returns `true` if at least one locale was loaded; `false` if every candidate
 *   was exhausted without finding any `.yaml` files.
 * @throws {MessagesDirNotFoundError} If `messagesDir` is provided but does not
 *   exist on disk.
 */
export function loadMessages(path: string | undefined, logger: Logger): boolean {
  const candidates = getShareDirs({
    invert: true,
  }).map((dir) => resolve(dir, DEFAULT_I18N_DIRNAME));
  if (!path) logger.warn(`No messages path provided, falling back to share dirs only`);
  else candidates.unshift(resolve(path));

  return loadFromCandidates(candidates, logger);
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return vars[key] ? String(vars[key]) : `{{${key}}}`;
  });
}

export function resolveMessage(locale: string, code: string, context: Record<string, unknown> = {}): string {
  // Try exact locale, then base language (e.g., "fr" from "fr-FR"), then fallback
  const baseLocale = locale.split("-")[0];
  const dict = dictionaries.get(locale) ?? dictionaries.get(baseLocale) ?? dictionaries.get(DEFAULT_LOCALE);

  const template = dict?.[code] ?? dictionaries.get(DEFAULT_LOCALE)?.[code] ?? code;
  return interpolate(template, context);
}

/** The loaded catalog a language tag names, matched without regard to case. */
function catalogOf(tag: string): string | undefined {
  for (const locale of dictionaries.keys()) {
    if (locale.toLowerCase() === tag) return locale;
  }
  return undefined;
}

/**
 * The catalog an `Accept-Language` header prefers (RFC 9110 §12.5.4): its
 * ranges by decreasing q value, the header's order between equal ones, a
 * missing q being 1 and `q=0` a refusal. The first range with a catalog wins,
 * by its exact tag then its base language; `*` names none. Without one, `fallback`.
 */
export function negotiateLocale(acceptLanguage: string | undefined, fallback: string): string {
  const ranges = (acceptLanguage ?? "")
    .split(",")
    .map((range, index) => {
      const [tag = "", ...params] = range.split(";").map((part) => part.trim());
      const q = params.find((param) => /^q=/i.test(param));
      return {
        tag: tag.toLowerCase(),
        quality: q === undefined ? 1 : Number(q.slice(2)),
        index,
      };
    })
    .filter((range) => range.tag !== "" && range.tag !== "*" && range.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const { tag } of ranges) {
    const catalog = catalogOf(tag) ?? catalogOf(tag.split("-")[0] ?? "");
    if (catalog) return catalog;
  }
  return fallback || DEFAULT_LOCALE;
}

/** The English message of `key`, for the English-only `log.*` keys. */
export function translate(key: string, context: Record<string, unknown> = {}): string {
  return resolveMessage("en", key, context);
}
