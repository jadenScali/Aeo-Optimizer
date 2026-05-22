# Shopify App

Package manager: pnpm (never use npm or yarn)

When working with Shopify APIs:
- Call `learn_shopify_api` first for current context
- Use `introspect_graphql_schema` before writing any GraphQL
- Run `validate_graphql_codeblocks` on generated GraphQL
- Run `validate_component_codeblocks` on Polaris/component code