# Trendcart Shopify template kit

Source files for the product page template Trendcart's generated products use. Trendcart
never edits themes (v1): the merchant installs these files once per theme. The docs-writer
turns this into the merchant guide.

## What it shows

Trendcart fills three product metafields (definitions are created on install):

| Metafield           | Type                          | Rendered as             |
| ------------------- | ----------------------------- | ----------------------- |
| `custom.highlights` | `list.single_line_text_field` | Bullet list             |
| `custom.guarantee`  | `multi_line_text_field`       | Paragraph               |
| `custom.faq`        | `json` `[{question, answer}]` | Accordion (`<details>`) |

Empty metafields render nothing, so the section is harmless on other products.

## Files

- `theme/sections/trendcart-product-details.liquid`: the section. Works on any Online Store
  2.0 theme (no theme-specific snippets, no JavaScript).
- `theme/templates/product.trendcart.json`: a ready template for **Dawn-family themes**
  (Dawn, Refresh, Sense, Craft, ...): Dawn's `main-product` section, then the Trendcart
  section, then `related-products`. Other themes use different section names: use option B.

## Install (merchant)

Back up the theme first (Online Store > Themes > ... > Duplicate).

**Option A: Dawn-family theme (code editor)**

1. Online Store > Themes > ... > Edit code.
2. Sections > Add a new section > `trendcart-product-details`, paste the `.liquid` file.
3. Templates > Add a new template > product, JSON, name `trendcart`; paste the `.json` file.

**Option B: any OS 2.0 theme (theme editor)**

1. Do step 2 of option A (add the section file).
2. Theme editor > Products > Create template, name `trendcart`, based on the default product
   template.
3. Add section > "Trendcart details", place it under the product information, Save.

Then in Trendcart: **Connections > the store > Template**, pick `trendcart`. New draft
products get `templateSuffix: "trendcart"`. Step-by-step merchant guide:
[docs/shopify-template-kit.md](../../../../docs/shopify-template-kit.md).

## How Trendcart picks the template

- `listShopifyTemplates` (`lib/services/connections.ts`) lists the `templates/product*.json`
  files of the store's published (MAIN) theme as suffixes (`null` = default `product.json`)
  and reports `hasTrendcartTemplate`. Liquid templates (`product.*.liquid`) are not listed.
- The connections page offers these suffixes as a select and recommends `trendcart` when it
  is present. If the call fails, it falls back to a free-text suffix field.
- `setShopifyTemplate` re-reads the active theme and refuses a suffix that is not in it
  (`null`, the default template, is always accepted).

## Notes

- The template only affects products whose template is `trendcart`.
- The kit must be installed on the **published** theme; Trendcart reads the templates of the
  live theme only.
- Option for later: ship the section as a theme app extension (app block), installable
  without editing code. Not in v1.
