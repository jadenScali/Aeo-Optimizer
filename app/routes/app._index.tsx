import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();

  const llmsUrl = `https://${shop}/a/llms-txt`;

  return (
    <s-page heading="AEO Optimizer">
      <s-section>
        <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
          Store audit
        </h3>
        <s-paragraph>
          Run Google Lighthouse on your live storefront to score:
          <br />
          <br />
          <ul style={{ margin: 0, paddingLeft: "1.5em" }}>
            <li>Performance and load speed</li>
            <li>Accessibility</li>
            <li>Best practices</li>
            <li>Search engine optimization (SEO)</li>
          </ul>
          <br />
          You get an overall score plus concrete feedback on what to improve.
        </s-paragraph>
        <div
          style={{
            border: "1px solid #e1e3e5",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
          }}
        >
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" href="/app/crawlability?autorun=1">
              Run tests
            </s-button>
            <s-button href="/app/crawlability">Open store audit</s-button>
          </s-stack>
        </div>
      </s-section>

      <s-section>
        <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
          Generate llms.txt
        </h3>
        <s-paragraph>
          Generate an <s-text>llms.txt</s-text> file for your storefront.
          <br />
          <br />
          This is an experimental standard and not widely adopted yet, but it
          may help AI systems better understand and reference your site content
          in the future.
          <br />
          <br />
          Once published, it will be available at <s-text>/llms.txt</s-text>.
        </s-paragraph>
        <div
          style={{
            border: "1px solid #e1e3e5",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
          }}
        >
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" href="/app/generate">
              Generate llms.txt
            </s-button>
            <s-button href={llmsUrl} target="_blank">
              View llms.txt
            </s-button>
          </s-stack>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
