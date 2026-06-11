import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>AEO Optimizer</h1>
        <p className={styles.text}>
          Make your Shopify store fast, discoverable, and ready for AI search.
        </p>
        <p className={styles.text}>
          Install AEO Optimizer from the Shopify App Store to get started.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Store audit</strong>. Run Google Lighthouse on your live
            storefront and get scores for performance, accessibility, best
            practices, and SEO.
          </li>
          <li>
            <strong>Actionable feedback</strong>. See the highest-impact issues
            holding your store back, with concrete guidance on how to fix
            them.
          </li>
          <li>
            <strong>llms.txt generator</strong>. Publish an llms.txt file so AI
            systems can better understand and reference your store.
          </li>
        </ul>
      </div>
    </div>
  );
}
