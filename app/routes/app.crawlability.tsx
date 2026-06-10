import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { runLighthouse, type Strategy } from "../lighthouse.server";

const SHOP_PRIMARY_DOMAIN_QUERY = `#graphql
  query ShopPrimaryDomain {
    shop {
      primaryDomain {
        url
      }
    }
  }`;

async function fetchStoreUrl(admin: {
  graphql: (query: string) => Promise<Response>;
}): Promise<string> {
  const res = await admin.graphql(SHOP_PRIMARY_DOMAIN_QUERY);
  const json = (await res.json()) as {
    data?: { shop?: { primaryDomain?: { url?: string } } };
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  const url = json.data?.shop?.primaryDomain?.url;
  if (!url) throw new Error("Could not determine your storefront URL.");
  return url;
}

/**
 * Checks whether the storefront is password-protected by fetching it the
 * same way Lighthouse will: as an anonymous visitor. Protected stores
 * redirect anonymous requests to /password. Returns false when the check
 * itself fails, so a flaky check never blocks the audit.
 */
async function isPasswordProtected(storeUrl: string): Promise<boolean> {
  try {
    const res = await fetch(storeUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const location = res.headers.get("location") ?? "";
    return res.status >= 300 && res.status < 400 && location.includes("/password");
  } catch {
    return false;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const storeUrl = await fetchStoreUrl(admin);
  const passwordProtected = await isPasswordProtected(storeUrl);
  const shopHandle = session.shop.replace(".myshopify.com", "");
  return {
    storeUrl,
    passwordProtected,
    preferencesUrl: `https://admin.shopify.com/store/${shopHandle}/online_store/preferences`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const strategy: Strategy =
    formData.get("strategy") === "DESKTOP" ? "DESKTOP" : "MOBILE";

  try {
    const storeUrl = await fetchStoreUrl(admin);
    if (await isPasswordProtected(storeUrl)) {
      return {
        ok: false as const,
        error:
          "Your storefront is password-protected, so Lighthouse would only score the password page. Temporarily disable the password in Online Store → Preferences, then use Check again.",
      };
    }
    const report = await runLighthouse(
      storeUrl,
      strategy,
      // eslint-disable-next-line no-undef
      process.env.PSI_API_KEY,
    );
    return { ok: true as const, report };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: msg };
  }
};

const scoreColor = (score: number) =>
  score >= 90 ? "#108043" : score >= 50 ? "#b86e00" : "#d72c0d";

const scoreLabel = (score: number) =>
  score >= 90 ? "Good" : score >= 50 ? "Needs improvement" : "Poor";

function ScoreRing({ score, size = 104 }: { score: number; size?: number }) {
  const color = scoreColor(score);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `6px solid ${color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size / 3,
        fontWeight: 700,
        color,
        background: "#fff",
      }}
    >
      {score}
    </div>
  );
}

export default function Crawlability() {
  const { storeUrl, passwordProtected, preferencesUrl } =
    useLoaderData<typeof loader>();
  const [strategy, setStrategy] = useState<Strategy | "">("");
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const running = fetcher.state !== "idle";
  const checking = revalidator.state !== "idle";

  const handleRun = () => {
    if (!strategy) return;
    fetcher.submit({ strategy }, { method: "POST" });
  };

  const report = fetcher.data?.ok ? fetcher.data.report : null;

  return (
    <s-page heading="Store audit">
      <s-section>
        <s-stack direction="block" gap="large">
          <s-paragraph>
            Run Google Lighthouse against your live storefront (
            <s-text>{storeUrl}</s-text>) to score its performance,
            accessibility, best practices, and SEO, with feedback on what to
            improve.
          </s-paragraph>
          <s-select
            label="Device to simulate"
            name="strategy"
            placeholder="Select a device…"
            value={strategy}
            onChange={(event: { target?: { value?: string } | null } | Event) => {
              const target = (event as { target?: { value?: string } | null })
                .target;
              setStrategy(target?.value === "DESKTOP" ? "DESKTOP" : "MOBILE");
            }}
          >
            <s-option value="MOBILE">Mobile</s-option>
            <s-option value="DESKTOP">Desktop</s-option>
          </s-select>
          {passwordProtected ? (
            <s-banner heading="Your store is password-protected" tone="warning">
              <s-stack direction="block" gap="base">
                <s-paragraph>
                  Lighthouse visits your storefront like an anonymous shopper,
                  so right now it would only score your password page — not
                  your real store. It cannot log in, so there is no point
                  entering your storefront password here (and you should never
                  share passwords with apps). To run a real audit, temporarily
                  disable the storefront password under Online Store →
                  Preferences, run the audit, then turn it back on.
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  <s-button href={preferencesUrl} target="_blank">
                    Open store preferences
                  </s-button>
                  <s-button
                    onClick={() => revalidator.revalidate()}
                    {...(checking ? { loading: true } : {})}
                  >
                    Check again
                  </s-button>
                </s-stack>
              </s-stack>
            </s-banner>
          ) : null}
          {fetcher.data?.ok === false ? (
            <s-banner heading="Audit failed" tone="critical">
              {fetcher.data.error}
            </s-banner>
          ) : null}
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              onClick={handleRun}
              {...(running ? { loading: true } : {})}
              {...((!strategy || passwordProtected) && !running
                ? { disabled: true }
                : {})}
            >
              Run audit
            </s-button>
          </s-stack>
          {running ? (
            <s-paragraph>
              Auditing your storefront. This usually takes 20–60 seconds.
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      {report ? (
        <s-section>
          <s-stack direction="block" gap="large">
            <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
              Results
            </h3>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                flexWrap: "wrap",
                border: "1px solid #e1e3e5",
                borderRadius: 12,
                padding: 16,
                background: "#fff",
              }}
            >
              <ScoreRing score={report.overallScore} />
              <div>
                <div style={{ fontSize: "1.125rem", fontWeight: 700 }}>
                  Overall score: {scoreLabel(report.overallScore)}
                </div>
                <s-paragraph>
                  Average of the Lighthouse category scores for{" "}
                  {report.finalUrl} (
                  {report.strategy === "MOBILE" ? "mobile" : "desktop"}).
                </s-paragraph>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              {report.categories.map((category) => (
                <div
                  key={category.id}
                  style={{
                    border: "1px solid #e1e3e5",
                    borderRadius: 12,
                    padding: 16,
                    background: "#fff",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "1.75rem",
                      fontWeight: 700,
                      color: scoreColor(category.score),
                    }}
                  >
                    {category.score}
                  </div>
                  <div style={{ fontWeight: 600 }}>{category.title}</div>
                </div>
              ))}
            </div>
          </s-stack>
        </s-section>
      ) : null}

      {report ? (
        <s-section>
          <s-stack direction="block" gap="large">
            <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
              How to improve your store
            </h3>
            {report.feedback.length === 0 ? (
              <s-banner heading="Nothing to fix" tone="success">
                Lighthouse found no failing audits on your storefront. Great
                work!
              </s-banner>
            ) : (
              <s-stack direction="block" gap="base">
                {report.feedback.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      border: "1px solid #e1e3e5",
                      borderRadius: 12,
                      padding: 16,
                      background: "#fff",
                    }}
                  >
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="small">
                        <s-badge>{item.categoryTitle}</s-badge>
                        {item.score !== null ? (
                          <s-badge
                            tone={item.score >= 50 ? "warning" : "critical"}
                          >
                            {scoreLabel(item.score)}
                          </s-badge>
                        ) : null}
                      </s-stack>
                      <div style={{ fontWeight: 600 }}>
                        {item.title}
                        {item.displayValue ? ` — ${item.displayValue}` : ""}
                      </div>
                      <s-paragraph>{item.description}</s-paragraph>
                    </s-stack>
                  </div>
                ))}
              </s-stack>
            )}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
