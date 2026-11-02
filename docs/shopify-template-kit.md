# Shopify template kit: the `product.trendcart` template

Trendcart creates every product as a draft and fills in three product metafields: highlights,
FAQ and guarantee. Your theme decides where they appear. The template kit is a small theme
section plus a product template that shows them. You install it **once per theme**, and every
product Trendcart creates then uses it.

Trendcart never edits your theme. You (or your developer) add the files below. This takes about
10 minutes on a new store.

Source files in this repository:

- `lib/integrations/shopify/template-kit/theme/sections/trendcart-product-details.liquid`
- `lib/integrations/shopify/template-kit/theme/templates/product.trendcart.json`

## What the template shows

| Metafield | Type | Shown as |
| --- | --- | --- |
| `custom.highlights` | List of single-line text | Bullet list ("Why you'll love it") |
| `custom.guarantee` | Multi-line text | Paragraph ("Our guarantee") |
| `custom.faq` | JSON `[{ "question": "...", "answer": "..." }]` | Questions you click to open ("Frequently asked questions") |

Trendcart creates these metafield definitions when you connect the store, so you do not need
to create them. A metafield that is empty shows nothing, so the section is safe on products
that Trendcart did not create. The section uses no JavaScript, and the FAQ works with the
keyboard.

Title, price, variants, photos and description are handled by your theme's normal product
section, as on any other product.

## Requirements

- An **Online Store 2.0** theme (JSON templates). Vintage themes with `.liquid` product
  templates are not supported.
- The kit must be on your **published (live) theme**. Trendcart only reads the live theme's
  templates.
- Permission to edit the theme code (store owner or a staff account with Themes access).

## Step 1: back up the theme

Go to **Online Store > Themes**. On the live theme, open the **...** menu and choose
**Duplicate**. You can go back to the copy at any time.

## Step 2: add the section

1. On the live theme, open **...** and choose **Edit code**.
2. Under **Sections**, click **Add a new section**, name it `trendcart-product-details`, and
   create it.
3. Replace the file's contents with `trendcart-product-details.liquid` from the kit, then click
   **Save**.

The section is called **Trendcart details** in the theme editor. It has settings to show or
hide each part, change the three headings, and set the top and bottom padding.

## Step 3: create the `product.trendcart` template

Pick the option that matches your theme.

### Option A: Dawn and Dawn-family themes (Dawn, Refresh, Sense, Craft and others)

1. Still in **Edit code**, under **Templates**, click **Add a new template**.
2. Choose **product**, type **JSON**, and name it `trendcart`. This creates
   `templates/product.trendcart.json`.
3. Replace its contents with the kit's `product.trendcart.json` (shown below), then click
   **Save**.

### Option B: any other Online Store 2.0 theme

Other themes name their sections differently, so build the template in the theme editor:

1. Open **Customize** on the live theme.
2. In the page selector at the top, choose **Products > Create template**. Name it
   `trendcart` and base it on your default product template.
3. Click **Add section** and choose **Trendcart details**. Place it under the product
   information and click **Save**.

This keeps your theme's own product layout and adds the Trendcart section under it.

### Example `templates/product.trendcart.json` (Dawn family)

It contains Dawn's `main-product` section with the usual blocks, then the Trendcart section,
then related products:

```json
{
  "sections": {
    "main": {
      "type": "main-product",
      "blocks": {
        "title": { "type": "title", "settings": {} },
        "price": { "type": "price", "settings": {} },
        "variant_picker": { "type": "variant_picker", "settings": { "picker_type": "button" } },
        "quantity_selector": { "type": "quantity_selector", "settings": {} },
        "buy_buttons": { "type": "buy_buttons", "settings": { "show_dynamic_checkout": true } },
        "description": { "type": "description", "settings": {} },
        "share": { "type": "share", "settings": { "share_label": "Share" } }
      },
      "block_order": [
        "title",
        "price",
        "variant_picker",
        "quantity_selector",
        "buy_buttons",
        "description",
        "share"
      ],
      "settings": {}
    },
    "trendcart_details": {
      "type": "trendcart-product-details",
      "settings": {
        "show_highlights": true,
        "highlights_heading": "Why you'll love it",
        "show_guarantee": true,
        "guarantee_heading": "Our guarantee",
        "show_faq": true,
        "faq_heading": "Frequently asked questions",
        "padding_top": 36,
        "padding_bottom": 36
      }
    },
    "related": {
      "type": "related-products",
      "settings": {}
    }
  },
  "order": ["main", "trendcart_details", "related"]
}
```

The section reads the metafields directly, so you do not need to connect anything by hand. In
Liquid it uses `product.metafields.custom.highlights.value`,
`product.metafields.custom.faq.value` and `product.metafields.custom.guarantee`.

**If you prefer to use your theme's own blocks.** Many themes let you connect a text block to a
metafield with **Connect dynamic source** in the theme editor. This works for
`custom.guarantee`, and for `custom.highlights` in themes that accept list metafields. It does
not work well for `custom.faq`, which is JSON: keep the Trendcart section for the FAQ. Settings
differ from theme to theme, so check the result in the preview.

## Step 4: tell Trendcart to use it

1. In Trendcart, open **Connections** and find the store.
2. In **Product page template**, type `trendcart` and click **Save template**. You need the
   Media buyer or Owner role.
3. Trendcart checks that the live theme has `templates/product.trendcart.json`. If it does
   not, you get `The store's theme has no "product.trendcart" template.` Check that you saved
   it on the **published** theme.

New drafts are then created with the `trendcart` template. Drafts that already exist get it
the next time Trendcart updates them (for example, after a copy edit at Gate 3). To check a
product, open it in the Shopify admin: **Theme template** (in the side panel) should say
`trendcart`.

## Reuse on a new store in about 10 minutes

1. Back up the live theme (Step 1).
2. Add the section file (Step 2).
3. Dawn family: add the template file (Step 3, Option A). Other themes: create the template in
   the editor (Option B).
4. Connect the store in Trendcart if you have not already. This creates the metafield
   definitions.
5. Set the template to `trendcart` (Step 4).
6. Open the Gate 3 **Preview the draft** link of a Trendcart product, and check that the
   highlights, guarantee and FAQ appear.

If you change themes later, repeat steps 1 to 3 on the new theme before you publish it.
Otherwise products keep the `trendcart` template name, and a theme without that template shows
them with its default product template.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Highlights, FAQ or guarantee do not appear | The product does not use the `trendcart` template, or the section was not added to the template | Check **Theme template** on the product. In the theme editor, open the `trendcart` template and check that **Trendcart details** is there and its parts are switched on |
| "The store's theme has no product.trendcart template" | The template is on an unpublished theme, or has another name | Add it to the live theme, named exactly `trendcart` |
| The section is missing from **Add section** | The section file was not saved, or the page is not a product template | Re-save `sections/trendcart-product-details.liquid`. The section only appears on product templates |
| Option A template shows an error in the editor | The theme is not in the Dawn family | Delete the JSON template and use Option B |
| FAQ is empty but the other parts show | That product has no FAQ yet | Edit the FAQ at Gate 3 and save |

## Later

A theme app extension (an app block you add without editing code) is an option for after v1.
It is not part of v1.
