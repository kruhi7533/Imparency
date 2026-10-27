import prisma from "@/lib/prisma";

/**
 * AI fault injection (AI-010). Forces every model call made through
 * lib/ai/telemetry.ts to fail as a TIMEOUT or an ERROR, so the degraded path
 * ("AI unavailable — human review required") can be observed on purpose.
 *
 * Two sources, env first:
 *   AI_FAULT_INJECTION=timeout|error   (process-wide)
 *   AppSetting "ai_fault_injection"    (toggled from /admin/ai-telemetry)
 *
 * Refused in production: when NODE_ENV=production both sources are ignored and
 * the admin toggle is rejected, unless AI_FAULT_INJECTION_ALLOW_PRODUCTION=true
 * is set explicitly — a forgotten switch must not take AI down for real users.
 */

export type AiFaultMode = "timeout" | "error";
export const AI_FAULT_SETTING_KEY = "ai_fault_injection";

export function parseFaultMode(value: string | null | undefined): AiFaultMode | null {
  const v = (value ?? "").trim().toLowerCase();
  return v === "timeout" || v === "error" ? v : null;
}

export function faultInjectionAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.AI_FAULT_INJECTION_ALLOW_PRODUCTION === "true";
}

let cache: { at: number; value: AiFaultMode | null } | null = null;
const CACHE_MS = 3000;

export function clearFaultCache(): void {
  cache = null;
}

/** The active fault, or null. Never throws: a settings read failure means "no fault". */
export async function getAiFaultMode(): Promise<AiFaultMode | null> {
  if (!faultInjectionAllowed()) return null;
  const fromEnv = parseFaultMode(process.env.AI_FAULT_INJECTION);
  if (fromEnv) return fromEnv;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: AiFaultMode | null = null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: AI_FAULT_SETTING_KEY } });
    value = parseFaultMode(row?.value);
  } catch {
    value = null;
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Where the active mode comes from — for the admin page. */
export async function describeFaultInjection(): Promise<{
  allowed: boolean;
  envMode: AiFaultMode | null;
  settingMode: AiFaultMode | null;
  effective: AiFaultMode | null;
}> {
  const allowed = faultInjectionAllowed();
  const envMode = parseFaultMode(process.env.AI_FAULT_INJECTION);
  let settingMode: AiFaultMode | null = null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: AI_FAULT_SETTING_KEY } });
    settingMode = parseFaultMode(row?.value);
  } catch {
    settingMode = null;
  }
  return { allowed, envMode, settingMode, effective: allowed ? envMode ?? settingMode : null };
}

export async function setAiFaultSetting(mode: AiFaultMode | null): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: AI_FAULT_SETTING_KEY },
    create: { key: AI_FAULT_SETTING_KEY, value: mode ?? "off" },
    update: { value: mode ?? "off" },
  });
  clearFaultCache();
}
