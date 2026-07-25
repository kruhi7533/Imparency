import prisma from "@/lib/prisma";

/**
 * Platform-wide toggles stored in the AppSetting key/value table.
 * Add a key here rather than scattering string literals across the codebase.
 */
export const SETTING_KEYS = {
  /** Email ADMIN_EMAIL whenever an NGO writes on a review thread (reply or new appeal). */
  EMAIL_ON_NGO_REPLY: "email_on_ngo_reply",
} as const;

/**
 * Read a boolean setting. Returns `fallback` when the row is absent or the DB
 * read fails, so a settings hiccup can never break the calling flow.
 */
export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    return row.value === "true";
  } catch (err) {
    console.error(`[app-settings] failed to read "${key}":`, err);
    return fallback;
  }
}

/**
 * Upsert a boolean setting. Returns false when the write failed, so callers can
 * report an honest outcome instead of surfacing a raw Prisma error — the mirror
 * of getBoolSetting's "a settings hiccup can never break the calling flow".
 */
export async function setBoolSetting(key: string, value: boolean): Promise<boolean> {
  const str = value ? "true" : "false";
  try {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: str },
      update: { value: str },
    });
    return true;
  } catch (err) {
    console.error(`[app-settings] failed to write "${key}":`, err);
    return false;
  }
}
