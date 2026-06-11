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
  const { admin } = await authenticate.admin(request);
  const storeUrl = await fetchStoreUrl(admin);
  const passwordProtected = await isPasswordProtected(storeUrl);
  return { storeUrl, passwordProtected };
};

function parseCustomUrl(input: string): URL | null {
  for (const candidate of [input, `https://${input}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const strategy: Strategy =
    formData.get("strategy") === "DESKTOP" ? "DESKTOP" : "MOBILE";
  const customUrlInput = formData.get("customUrl");

  try {
    let auditUrl: string;
    if (typeof customUrlInput === "string" && customUrlInput.trim()) {
      const parsed = parseCustomUrl(customUrlInput.trim());
      if (!parsed) {
        return {
          ok: false as const,
          error:
            "The link you entered is not a valid URL. Enter a full link such as https://your-store.com.",
        };
      }
      auditUrl = parsed.toString();
    } else {
      auditUrl = await fetchStoreUrl(admin);
      if (await isPasswordProtected(auditUrl)) {
        return {
          ok: false as const,
          error:
            "Your storefront is password-protected, so Lighthouse would only score the password page. Temporarily disable the password in Online Store → Preferences, then use Check again — or enter a link Lighthouse can reach yourself.",
        };
      }
    }
    const report = await runLighthouse(
      auditUrl,
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

const scoreTone = (score: number) =>
  score >= 90 ? ("success" as const) : score >= 50 ? ("warning" as const) : ("critical" as const);

const scoreLabel = (score: number) =>
  score >= 90 ? "Good" : score >= 50 ? "Needs improvement" : "Poor";

export default function Crawlability() {
  const { storeUrl, passwordProtected } = useLoaderData<typeof loader>();
  const [strategy, setStrategy] = useState<Strategy | "">("");
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const running = fetcher.state !== "idle";
  const checking = revalidator.state !== "idle";

  const usingCustomUrl =
    passwordProtected && showCustomUrl && customUrl.trim().length > 0;

  const handleRun = () => {
    if (!strategy) return;
    fetcher.submit(
      usingCustomUrl
        ? { strategy, customUrl: customUrl.trim() }
        : { strategy },
      { method: "POST" },
    );
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
                  so right now it would only score your password page not
                  your real store. To run a real audit, temporarily disable
                  the storefront password under Online Store → Preferences,
                  run the audit, then turn it back on — or enter a link
                  Lighthouse can reach yourself.
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  <s-button href="shopify:admin/online_store/preferences">
                    Open store preferences
                  </s-button>
                  <s-button
                    onClick={() => revalidator.revalidate()}
                    {...(checking ? { loading: true } : {})}
                  >
                    Check again
                  </s-button>
                  <s-button onClick={() => setShowCustomUrl(true)}>
                    Enter link manually
                  </s-button>
                </s-stack>
                {showCustomUrl ? (
                  <s-text-field
                    label="Link to audit"
                    name="customUrl"
                    placeholder="https://your-store.com"
                    details="Paste a publicly reachable link to your store, such as a preview link that bypasses the password. The audit will run against this link instead."
                    value={customUrl}
                    onChange={(
                      event: { target?: { value?: string } | null } | Event,
                    ) => {
                      const target = (
                        event as { target?: { value?: string } | null }
                      ).target;
                      setCustomUrl(target?.value ?? "");
                    }}
                  />
                ) : null}
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
              {...((!strategy || (passwordProtected && !usingCustomUrl)) &&
              !running
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
        <s-section heading="Results">
          <s-stack direction="block" gap="large">
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-heading>
                    Overall score: {report.overallScore}/100
                  </s-heading>
                  <s-badge tone={scoreTone(report.overallScore)}>
                    {scoreLabel(report.overallScore)}
                  </s-badge>
                </s-stack>
                <s-paragraph color="subdued">
                  Average of the Lighthouse category scores for{" "}
                  {report.finalUrl} (
                  {report.strategy === "MOBILE" ? "mobile" : "desktop"}).
                </s-paragraph>
              </s-stack>
            </s-box>
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))"
              gap="base"
            >
              {report.categories.map((category) => (
                <s-box
                  key={category.id}
                  padding="base"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="small" alignItems="center">
                    <s-heading>{category.score}</s-heading>
                    <s-text type="strong">{category.title}</s-text>
                    <s-badge tone={scoreTone(category.score)}>
                      {scoreLabel(category.score)}
                    </s-badge>
                  </s-stack>
                </s-box>
              ))}
            </s-grid>
          </s-stack>
        </s-section>
      ) : null}

      {report ? (
        <s-section heading="How to improve your store">
          <s-stack direction="block" gap="large">
            {report.feedback.length === 0 ? (
              <s-banner heading="Nothing to fix" tone="success">
                Lighthouse found no failing audits on your storefront. Great
                work!
              </s-banner>
            ) : (
              <s-stack direction="block" gap="base">
                {report.feedback.map((item) => (
                  <s-box
                    key={item.id}
                    padding="base"
                    border="base"
                    borderRadius="base"
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
                      <s-text type="strong">
                        {item.title}
                        {item.displayValue ? ` — ${item.displayValue}` : ""}
                      </s-text>
                      <s-paragraph>{item.description}</s-paragraph>
                    </s-stack>
                  </s-box>
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
