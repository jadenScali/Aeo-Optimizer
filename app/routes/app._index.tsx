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
      <s-section heading="Store audit">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Run Google Lighthouse on your live storefront to score:
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>Performance and load speed</s-list-item>
            <s-list-item>Accessibility</s-list-item>
            <s-list-item>Best practices</s-list-item>
            <s-list-item>Search engine optimization (SEO)</s-list-item>
          </s-unordered-list>
          <s-paragraph>
            You get an overall score plus concrete feedback on what to
            improve.
          </s-paragraph>
          <s-button-group>
            <s-button variant="primary" href="/app/crawlability">
              Audit store
            </s-button>
          </s-button-group>
        </s-stack>
      </s-section>

      <s-section heading="Generate llms.txt">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Generate an llms.txt file for your storefront. This is an
            experimental standard and not widely adopted yet, but it may help
            AI systems better understand and reference your site content in
            the future.
          </s-paragraph>
          <s-paragraph color="subdued">
            Once published, it will be available at /llms.txt.
          </s-paragraph>
          <s-button-group>
            <s-button variant="primary" href="/app/generate">
              Generate llms.txt
            </s-button>
            <s-button href={llmsUrl} target="_blank">
              View llms.txt
            </s-button>
          </s-button-group>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
