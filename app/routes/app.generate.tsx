import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type Options = {
  includeCollections: boolean;
  includeProducts: boolean;
  includePages: boolean;
  linkRobots: boolean;
  linkSitemap: boolean;
};

type Stage = "options" | "preview" | "published";

const DEFAULT_OPTIONS: Options = {
  includeCollections: true,
  includeProducts: true,
  includePages: true,
  linkRobots: true,
  linkSitemap: true,
};

type Shop = { name: string; myshopifyDomain: string };
type Collection = { handle: string; title: string };
type Money = { amount: string; currencyCode: string };
type Product = {
  handle: string;
  title: string;
  description: string | null;
  tags: string[];
  publishedAt: string | null;
  updatedAt: string;
  variants: { nodes: Array<{ sku: string | null }> };
  priceRangeV2: { minVariantPrice: Money } | null;
};
type Page = { handle: string; title: string; body: string | null };

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (text: string, max = 150) =>
  text.length <= max ? text : text.slice(0, max) + "...";

const ymd = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

function buildLlmsTxt(
  shop: Shop,
  collections: Collection[],
  products: Product[],
  pages: Page[],
  options: Options
): string {
  const base = `https://${shop.myshopifyDomain}`;
  const out: string[] = [`# [${shop.name}](${base})`, ""];

  if (options.includeCollections && collections.length) {
    out.push("## Collections");
    for (const c of collections) {
      out.push(`- [${c.title}](${base}/collections/${c.handle})`);
    }
    out.push("");
  }

  if (options.includeProducts && products.length) {
    out.push("## Products");
    for (const p of products) {
      const meta: string[] = [];
      const description = p.description?.replace(/\s+/g, " ").trim();
      if (description) meta.push(truncate(description));
      const sku = p.variants?.nodes?.[0]?.sku?.trim();
      if (sku) meta.push(`sku ${sku}`);
      const price = p.priceRangeV2?.minVariantPrice;
      if (price) meta.push(`price ${price.amount} ${price.currencyCode}`);
      if (p.tags?.length) meta.push(`tags ${p.tags.join(", ")}`);
      const published = ymd(p.publishedAt);
      if (published) meta.push(`published ${published}`);
      const updated = ymd(p.updatedAt);
      if (updated) meta.push(`updated ${updated}`);
      const suffix = meta.length ? `: ${meta.join(" | ")}` : "";
      out.push(`- [${p.title}](${base}/products/${p.handle})${suffix}`);
    }
    out.push("");
  }

  if (options.includePages && pages.length) {
    out.push("## Pages");
    for (const pg of pages) {
      const text = pg.body ? truncate(stripHtml(pg.body)) : "";
      const suffix = text ? `: ${text}` : "";
      out.push(`- [${pg.title}](${base}/pages/${pg.handle})${suffix}`);
    }
    out.push("");
  }

  if (options.linkRobots || options.linkSitemap) {
    out.push("## Rules");
    if (options.linkRobots) out.push(`- [robots.txt](${base}/robots.txt)`);
    if (options.linkSitemap) out.push(`- [sitemap.xml](${base}/sitemap.xml)`);
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "generate") {
    const options: Options = {
      includeCollections: formData.get("includeCollections") === "true",
      includeProducts: formData.get("includeProducts") === "true",
      includePages: formData.get("includePages") === "true",
      linkRobots: formData.get("linkRobots") === "true",
      linkSitemap: formData.get("linkSitemap") === "true",
    };

    // Keep this fast for MVP: avoid large stores making the action feel stuck.
    const FIRST = 50;

    let data: {
      shop: Shop;
      collections?: { nodes: Collection[] };
      products?: { nodes: Product[] };
    };

    try {
      const res = await admin.graphql(
        `#graphql
        query StoreContent(
          $includeCollections: Boolean!
          $includeProducts: Boolean!
          $first: Int!
        ) {
          shop { name myshopifyDomain }
          collections(first: $first) @include(if: $includeCollections) {
            nodes { handle title }
          }
          products(first: $first, query: "status:active") @include(if: $includeProducts) {
            nodes {
              handle
              title
              description
              tags
              publishedAt
              updatedAt
              variants(first: 1) { nodes { sku } }
              priceRangeV2 { minVariantPrice { amount currencyCode } }
            }
          }
        }`,
        {
          variables: {
            includeCollections: options.includeCollections,
            includeProducts: options.includeProducts,
            first: FIRST,
          },
        },
      );

      const json = (await res.json()) as {
        data: typeof data;
        errors?: { message: string }[];
      };
      if (json.errors?.length) {
        return {
          ok: false as const,
          intent: "generate" as const,
          errors: json.errors.map((e) => e.message),
        };
      }
      data = json.data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false as const,
        intent: "generate" as const,
        errors: [msg],
      };
    }

    let pageNodes: Page[] = [];
    let pagesWarning: string | undefined;
    if (options.includePages) {
      try {
        const pRes = await admin.graphql(
          `#graphql
          query StorePages {
            pages(first: 50) {
              nodes { handle title body }
            }
          }`,
          {},
        );
        const pJson = (await pRes.json()) as {
          data?: { pages?: { nodes: Page[] } };
          errors?: { message: string }[];
        };
        if (pJson.errors?.length) {
          pagesWarning = `Pages were skipped: ${pJson.errors.map((e) => e.message).join("; ")}. Grant read_online_store_pages or read_content and reinstall the app.`;
        } else {
          pageNodes = pJson.data?.pages?.nodes ?? [];
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pagesWarning = `Pages were skipped (${msg}). Grant read_online_store_pages or read_content and reinstall the app.`;
      }
    }

    const content = buildLlmsTxt(
      data.shop,
      data.collections?.nodes ?? [],
      data.products?.nodes ?? [],
      pageNodes,
      options
    );
    return {
      ok: true as const,
      intent: "generate" as const,
      content,
      ...(pagesWarning ? { pagesWarning } : {}),
    };
  }

  const content = String(formData.get("content") ?? "");

  const shopRes = await admin.graphql(`#graphql
    query { shop { id } }
  `);
  const { data: shopData } = await shopRes.json();

  const metafieldRes = await admin.graphql(
    `#graphql
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            namespace: "aeo_optimizer",
            key: "llms_txt",
            type: "multi_line_text_field",
            value: content,
            ownerId: shopData.shop.id,
          },
        ],
      },
    },
  );

  // Optional: create a redirect /llms.txt -> /a/llms-txt. This requires
  // write_online_store_navigation; if missing, publishing should still succeed.
  let redirectWarning: string | undefined;
  let redirectRes:
    | Response
    | undefined;
  try {
    redirectRes = await admin.graphql(
      `#graphql
      mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
        urlRedirectCreate(urlRedirect: $urlRedirect) {
          urlRedirect { id }
          userErrors { field message }
        }
      }`,
      { variables: { urlRedirect: { path: "/llms.txt", target: "/a/llms-txt" } } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    redirectWarning = msg.includes("write_online_store_navigation")
      ? "Redirect not created (missing write_online_store_navigation). Publish still succeeded."
      : `Redirect not created (${msg}). Publish still succeeded.`;
  }

  const { data: metafieldData } = await metafieldRes.json();
  const metafieldErrors = metafieldData?.metafieldsSet?.userErrors ?? [];
  if (metafieldErrors.length > 0) {
    return {
      ok: false as const,
      intent: "publish" as const,
      errors: metafieldErrors,
    };
  }

  if (redirectRes) {
    const { data: redirectData } = await redirectRes.json();
    const redirectErrors = (redirectData?.urlRedirectCreate?.userErrors ?? []).filter(
      (e: { message: string }) => !e.message.toLowerCase().includes("already"),
    );
    if (redirectErrors.length > 0) {
      redirectWarning = redirectErrors.map((e: { message: string }) => e.message).join("; ");
    }
  }

  return {
    ok: true as const,
    intent: "publish" as const,
    ...(redirectWarning ? { redirectWarning } : {}),
  };
};

export default function Generate() {
  const { shop } = useLoaderData<typeof loader>();
  const llmsUrl = `https://${shop}/a/llms-txt`;

  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [stage, setStage] = useState<Stage>("options");
  const [preview, setPreview] = useState("");

  const fetcher = useFetcher<typeof action>();
  const submittingIntent =
    fetcher.state !== "idle"
      ? (fetcher.formData?.get("intent") as "generate" | "publish" | null)
      : null;
  const generating = submittingIntent === "generate";
  const publishing = submittingIntent === "publish";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.intent === "generate") {
      if (!fetcher.data.ok) return;
      if (fetcher.data.content) {
        setPreview(fetcher.data.content);
        setStage("preview");
      }
    } else if (fetcher.data.intent === "publish" && fetcher.data.ok) {
      setStage("published");
    }
  }, [fetcher.state, fetcher.data]);

  type CheckedChangeEvent = { target?: { checked?: boolean } | null } | Event;

  const toggle = (key: keyof Options) => (event: CheckedChangeEvent) => {
    const target = (event as { target?: { checked?: boolean } | null }).target;
    const checked: boolean = !!target?.checked;
    setOptions((prev) => ({ ...prev, [key]: checked }));
  };

  const handleGenerate = () => {
    fetcher.submit(
      {
        intent: "generate",
        includeCollections: String(options.includeCollections),
        includeProducts: String(options.includeProducts),
        includePages: String(options.includePages),
        linkRobots: String(options.linkRobots),
        linkSitemap: String(options.linkSitemap),
      },
      { method: "POST" }
    );
  };

  const handlePublish = () => {
    fetcher.submit({ intent: "publish", content: preview }, { method: "POST" });
  };

  const handleBackToOptions = () => setStage("options");
  const handleEditAgain = () => setStage("preview");

  return (
    <s-page heading="Generate llms.txt">
      {stage === "options" && (
        <s-section>
          <s-stack direction="block" gap="large-200">
            <s-stack direction="block" gap="base">
              <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
                What to include
              </h3>
              <s-paragraph>
                Choose the storefront content you want to expose in your{" "}
                <s-text>llms.txt</s-text>.
              </s-paragraph>
            </s-stack>
            <s-stack direction="block" gap="base">
              <s-checkbox
                name="includeCollections"
                label="Include collections"
                details="Adds links to your storefront collections."
                checked={options.includeCollections}
                onChange={toggle("includeCollections")}
              />
              <s-checkbox
                name="includeProducts"
                label="Include products"
                details="Adds links to your active products."
                checked={options.includeProducts}
                onChange={toggle("includeProducts")}
              />
              <s-checkbox
                name="includePages"
                label="Include pages"
                details="Adds links to your storefront pages (about, FAQs, etc.)."
                checked={options.includePages}
                onChange={toggle("includePages")}
              />
            </s-stack>

            <s-divider />

            <s-stack direction="block" gap="large">
              <s-stack direction="block" gap="small">
                <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
                  SEO references
                </h3>
                <s-paragraph>
                  Link to robots.txt and{" "}
                  sitemap.xml.
                </s-paragraph>
              </s-stack>
              <s-stack direction="block" gap="base">
                <s-switch
                  name="linkRobots"
                  label="Link to robots.txt (recommended)"
                  details="Only enable if your storefront already serves a robots.txt."
                  checked={options.linkRobots}
                  onChange={toggle("linkRobots")}
                />
                <s-switch
                  name="linkSitemap"
                  label="Link to sitemap.xml (recommended)"
                  details="Only enable if your storefront already serves a sitemap.xml."
                  checked={options.linkSitemap}
                  onChange={toggle("linkSitemap")}
                />
              </s-stack>
            </s-stack>

            {fetcher.data?.intent === "generate" &&
            fetcher.data.ok === false &&
            "errors" in fetcher.data &&
            fetcher.data.errors?.length ? (
              <s-banner heading="Generate failed" tone="critical">
                {fetcher.data.errors.join(" ")}
              </s-banner>
            ) : null}
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={handleGenerate}
                {...(generating ? { loading: true } : {})}
              >
                Generate
              </s-button>
              <s-button href="/app">Cancel</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {stage === "preview" && (
        <s-section>
          <s-stack direction="block" gap="large">
            {fetcher.data?.ok &&
            fetcher.data.intent === "generate" &&
            "pagesWarning" in fetcher.data &&
            fetcher.data.pagesWarning ? (
              <s-banner heading="Pages not included" tone="warning">
                {fetcher.data.pagesWarning}
              </s-banner>
            ) : null}
            <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
              llms.txt
            </h3>
            <s-paragraph>
              Review and edit the generated <s-text>llms.txt</s-text> below.
              When you publish, it becomes available at <s-text>/llms.txt</s-text>,
              but AI platforms may currently ignore it.
            </s-paragraph>

          <s-text-area
            name="content"
            rows={20}
            value={preview}
            onChange={(event: { target?: { value?: string } | null } | Event) => {
              const target = (event as { target?: { value?: string } | null }).target;
              setPreview(target?.value ?? "");
            }}
          />

            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={handlePublish}
                {...(publishing ? { loading: true } : {})}
              >
                Publish
              </s-button>
              <s-button onClick={handleBackToOptions}>Back to options</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {stage === "published" && (
        <s-section heading="Published">
          <s-stack direction="block" gap="large">
            <s-banner heading="llms.txt published" tone="success">
              Your <s-text>llms.txt</s-text> is now live on your storefront.
            </s-banner>
            {fetcher.data?.ok &&
            fetcher.data.intent === "publish" &&
            "redirectWarning" in fetcher.data &&
            fetcher.data.redirectWarning ? (
              <s-banner heading="Redirect not created" tone="warning">
                {fetcher.data.redirectWarning}
              </s-banner>
            ) : null}

            <s-stack direction="inline" gap="base">
              <s-button variant="primary" href={llmsUrl} target="_blank">
                View live llms.txt
              </s-button>
              <s-button onClick={handleEditAgain}>Edit again</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
