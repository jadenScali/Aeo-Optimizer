const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

const CATEGORIES = [
  "PERFORMANCE",
  "ACCESSIBILITY",
  "BEST_PRACTICES",
  "SEO",
] as const;

export type Strategy = "MOBILE" | "DESKTOP";

export type CategoryScore = {
  id: string;
  title: string;
  /** 0-100 */
  score: number;
};

export type AuditFeedback = {
  id: string;
  title: string;
  description: string;
  displayValue: string | null;
  categoryTitle: string;
  /** 0-100, null for purely informative audits */
  score: number | null;
};

export type LighthouseReport = {
  requestedUrl: string;
  finalUrl: string;
  fetchTime: string;
  strategy: Strategy;
  /** 0-100, average of available category scores */
  overallScore: number;
  categories: CategoryScore[];
  feedback: AuditFeedback[];
};

type PsiAudit = {
  id: string;
  title: string;
  description?: string;
  score: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
};

type PsiCategory = {
  id: string;
  title: string;
  score: number | null;
  auditRefs?: Array<{ id: string; weight: number }>;
};

type PsiResponse = {
  error?: { message?: string };
  lighthouseResult?: {
    requestedUrl: string;
    finalUrl: string;
    fetchTime: string;
    categories: Record<string, PsiCategory>;
    audits: Record<string, PsiAudit>;
  };
};

// PSI audit descriptions embed markdown links like [Learn more](https://...).
const stripMarkdownLinks = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

const FEEDBACK_LIMIT = 10;
const PASSING_SCORE = 0.9;

/**
 * Runs Google Lighthouse against a public URL via the PageSpeed Insights API
 * and condenses the result into category scores plus the highest-impact
 * failing audits.
 */
export async function runLighthouse(
  url: string,
  strategy: Strategy = "MOBILE",
  apiKey?: string,
): Promise<LighthouseReport> {
  const params = new URLSearchParams({ url, strategy });
  for (const category of CATEGORIES) params.append("category", category);
  if (apiKey) params.set("key", apiKey);

  const res = await fetch(`${PSI_ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(90_000),
  });

  let json: PsiResponse;
  try {
    json = (await res.json()) as PsiResponse;
  } catch {
    throw new Error(
      `PageSpeed Insights returned an unreadable response (HTTP ${res.status}).`,
    );
  }

  if (json.error?.message) {
    throw new Error(json.error.message);
  }
  const result = json.lighthouseResult;
  if (!res.ok || !result) {
    throw new Error(
      `PageSpeed Insights request failed (HTTP ${res.status}).`,
    );
  }

  const categories: CategoryScore[] = [];
  const auditMeta = new Map<string, { weight: number; categoryTitle: string }>();
  for (const category of Object.values(result.categories)) {
    if (category.score !== null) {
      categories.push({
        id: category.id,
        title: category.title,
        score: Math.round(category.score * 100),
      });
    }
    for (const ref of category.auditRefs ?? []) {
      const existing = auditMeta.get(ref.id);
      if (!existing || ref.weight > existing.weight) {
        auditMeta.set(ref.id, {
          weight: ref.weight,
          categoryTitle: category.title,
        });
      }
    }
  }

  const failing = Object.values(result.audits)
    .filter(
      (audit) =>
        audit.score !== null &&
        audit.score < PASSING_SCORE &&
        audit.scoreDisplayMode !== "informative" &&
        audit.scoreDisplayMode !== "manual" &&
        audit.scoreDisplayMode !== "notApplicable",
    )
    .map((audit) => {
      const meta = auditMeta.get(audit.id);
      return {
        feedback: {
          id: audit.id,
          title: audit.title,
          description: stripMarkdownLinks(audit.description ?? ""),
          displayValue: audit.displayValue ?? null,
          categoryTitle: meta?.categoryTitle ?? "General",
          score:
            audit.score === null ? null : Math.round(audit.score * 100),
        } satisfies AuditFeedback,
        impact: (1 - (audit.score ?? 0)) * ((meta?.weight ?? 0) + 1),
      };
    })
    .sort((a, b) => b.impact - a.impact)
    .slice(0, FEEDBACK_LIMIT)
    .map((entry) => entry.feedback);

  const overallScore = categories.length
    ? Math.round(
        categories.reduce((sum, c) => sum + c.score, 0) / categories.length,
      )
    : 0;

  return {
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    fetchTime: result.fetchTime,
    strategy,
    overallScore,
    categories,
    feedback: failing,
  };
}
