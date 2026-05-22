import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);

  if (!admin) {
    return new Response("Not found", { status: 404 });
  }

  const res = await admin.graphql(
    `#graphql
    query GetLlmsTxt {
      shop {
        metafield(namespace: "aeo_optimizer", key: "llms_txt") {
          value
        }
      }
    }`,
  );

  const { data } = await res.json();
  const value: string | undefined = data?.shop?.metafield?.value;

  if (!value) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
