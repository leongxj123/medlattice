/** User-facing copy: never leak upstream hostnames / raw API errors. */
export function friendlyError(err: unknown, fallback = "请求失败，请稍后重试"): string {
  const raw = err instanceof Error ? err.message : String(err || "");
  if (!raw) return fallback;
  if (/429|Too Many|rate limit/i.test(raw)) return "检索繁忙，请稍后再试或换个关键词。";
  if (/timeout|AbortError|aborted/i.test(raw)) return "请求超时，请重试。";
  if (/Upstream|ECONN|ENOTFOUND|fetch failed/i.test(raw)) return fallback;
  if (/https?:\/\/|api\.|\.org|\.gov|\.edu/i.test(raw)) return fallback;
  if (raw.length > 100) return fallback;
  return raw;
}

export function friendlyWarning(raw?: string | null): string | null {
  if (!raw) return null;
  if (/429|Too Many|rate/i.test(raw)) return "部分检索通道繁忙，已自动改用备用通道返回结果。";
  if (/Upstream|https?:\/\/|api\.|\.org|\.gov/i.test(raw)) {
    return "部分通道暂时不可用，已尽量用可用结果展示。";
  }
  // Allow short Chinese API notices through (e.g. 公开数据源暂时不可用)
  if (raw.length <= 160) return raw;
  return "部分通道暂时不可用，已尽量用可用结果展示。";
}
