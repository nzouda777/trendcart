# Trendcart user guide (Milestones 1 and 2)

Trendcart takes a TikTok video or a product link and prepares everything you need to sell and
advertise that product: the AI analysis, suppliers and margin, a draft Shopify page, checked
videos, and a paused TikTok campaign. A person on your team approves each important step. Nothing
is published or launched on its own.

This guide covers what works today: from a link to a published Shopify page. Parts marked
**Coming in M3** are planned but not available yet.

## 1. Create your account and workspace

1. Go to **Sign up**, enter your name, work email and a password (at least 10 characters).
2. Open the verification link we email you. Your account is active once you click it.
3. Create your **workspace**. A workspace is your company's space in Trendcart: its brands,
   stores, products and team. You become its **Owner**.
4. Add your first **brand** (next section).

Optional: turn on two-step sign-in with an authenticator app from your user menu,
**Security and two-factor**.

If you belong to several workspaces, switch between them (or create another) from the
**Workspace** menu at the top of the sidebar.

## 2. Roles

Each person in a workspace has one role. Higher roles can do everything the lower ones can.

| Role        | What they can do                                                                       |
| ----------- | -------------------------------------------------------------------------------------- |
| Owner       | Full access, including members, billing, connections and deleting the workspace.      |
| Media buyer | Runs products end to end: every approval gate, campaigns, launches and budgets.       |
| Creative    | Imports products, picks suppliers, approves pages and videos, posts to TikTok.        |
| Viewer      | Read-only access to products, campaigns and stats.                                    |

Today this means:

- **Owner only**: create or delete brands, disconnect a store or TikTok account, invite people
  and change roles.
- **Media buyer and Owner**: edit brand settings, connect stores and TikTok accounts, set the
  proxy and the product page template, see Usage.
- **Creative and above**: import links, confirm products (Gate 1), choose suppliers and prices
  (Gate 2), edit, reject or approve and publish the product page (Gate 3), retry a failed step.
- **Viewer**: sees everything above but cannot change it. Buttons you cannot use are hidden.

## 3. Brands and settings

A **brand** groups one or more Shopify stores, TikTok ad accounts and TikTok profiles. Most
companies have one brand per store or per market. Open **Brands** to add one or change its
settings:

- **Brand name**, **Main country** (default campaign targeting), **Language** (used for pages
  and ad copy), **Currency** (should match your Shopify store).
- **Default test budget (daily)**: prefilled on new campaigns. Every change is recorded in the
  audit log.
- **Minimum margin**: suppliers below it will be flagged.
- **Pricing rule**: selling price = landed cost x multiplier, an optional price ending (for
  example .99) and an optional compare-at (strike-through) multiplier.

When you have several brands, choose the active one in the sidebar. Connections and imports
use the active brand.

## 4. Connections

Open **Connections** to link the accounts of the active brand. Each connection shows a colour:

| Colour | Label           | Meaning                                                                    |
| ------ | --------------- | -------------------------------------------------------------------------- |
| Green  | Healthy         | Connected and working.                                                     |
| Orange | Needs attention | Setup not finished, or the access is about to expire and will be renewed. |
| Red    | Not working     | Disconnected, or access expired or was revoked. Click **Reconnect**.       |

**Shopify store.** Enter the store's `your-store.myshopify.com` address (not your custom
domain) and click **Connect Shopify**. Shopify asks you to approve Trendcart, then sends you
back. Alternatively, open **Use a custom app from the store's admin instead** and paste the
client ID and secret of an app you created in that store; the secret is stored encrypted and
never shown again.

You can also set a **Product page template**: the name of a product template in your live
theme (for example `trendcart` for `product.trendcart.json`). Leave it empty to use the default
template. When you save, Trendcart checks that the template exists in the theme. To show the
highlights, FAQ and guarantee that Trendcart writes, install our template once per theme:
see [shopify-template-kit.md](shopify-template-kit.md).

**TikTok ad accounts.** Click **Connect TikTok Ads** and sign in with TikTok For Business.
The advertiser accounts you authorize appear in the list. Campaigns will be created paused in
these accounts (**Coming in M3**).

**TikTok profiles.** Click **Connect a profile** and sign in with the TikTok account the brand
posts from. Until TikTok approves Trendcart's posting audit, posts are private (visible only to
the account owner). Posting itself is **Coming in M3**.

Disconnecting does not delete anything you already created on Shopify or TikTok; Trendcart
simply stops using that account.

## 5. Proxy (optional, per brand)

Under **Connections, Proxy**, you can route the brand's TikTok data and page-reading requests
through your own proxy. Enter a URL like `http://user:pass@host:port` (http, https or socks5).
Trendcart stores it encrypted and only ever shows the scheme and host. You can turn it on or
off, or remove it.

## 6. Import a product

1. Open **Import**.
2. Paste a link:
   - a **TikTok video** link (`https://www.tiktok.com/@creator/video/...`): the AI watches the
     video to identify the product;
   - or a **product link** from a store or marketplace: the AI reads the page.

   The type switches automatically when you paste.
3. Pick the brand if you have several, then click **Import**.

The analysis usually takes under a minute. You can leave the page; the product keeps
processing. If you import a link that this brand already has, you are taken to the existing
product. There is an hourly import limit per workspace; if you reach it, wait and try again.

## 7. Products and Gate 1

**Products** lists every import with its status. Filter by brand, or by **Needs action**,
**In progress**, **Failed** and **Launched**.

Open a product to see:

- **Preparation**: the four approval gates and where the product is.
- **AI analysis**: the identified product, category, description, features, selling points,
  keywords and a confidence score. Below 70% confidence, check carefully before confirming.
- **Source**: the video or page it came from.
- **Activity**: each step, its result, and the AI cost for this product.

**Gate 1: is this the right product?** When the status is **Confirm product**, check the
analysis and click **Confirm product**. You can correct the product name and add a note. Your
approval is recorded with your name and time. Confirming moves the product to
**Finding suppliers**.

If the AI picked the wrong product, click **Reject** and say what is wrong (optional). The
rejection is recorded, and the product is analyzed again from scratch, using your note and the
rejected name as feedback. It comes back to **Confirm product** with the new analysis.

If a step fails, the page shows the error and a **Retry step** button.

### The four approvals

1. **Product confirmation** (Gate 1): available.
2. **Supplier and price** (Gate 2): available.
3. **Page and videos** (Gate 3): the page part is available. The videos part is
   **Coming in M3**.
4. **Launch** (Gate 4): **Coming in M3**. The campaign is created paused and only goes live
   after a Media buyer or Owner approves it.

## 8. Gate 2: choose a supplier and a price

After Gate 1, Trendcart searches online for listings of the same product. This usually takes a
minute or two. When the status shows **Choose supplier**, open the product.

**Supplier cards.** Each listing shows its title, photos, price, shipping, delivery time and
where it comes from (for example AliExpress), with a link to the original page. The closest
matches come first. Open the link and check that it really is the same product.

**Price and margin.** Pick a listing, and Trendcart suggests a selling price from the brand's
pricing rule. If that price would leave less than the brand's minimum margin, it is raised to
the lowest price that reaches it. You can change:

- **Selling price**: leave it empty to use the suggested price.
- **Compare-at price** (the strike-through price), or tick **No compare-at price**.
- **Other costs per order**: packaging, inserts, fulfilment.
- **Exchange rate**: asked for when the listing uses another currency than your brand.

The margin preview updates as you type. It shows the landed cost (product, shipping, other
costs), payment fees, gross margin, and how much you can spend on ads per order: break-even
CPA, max CPA at your target margin, and break-even ROAS.

**Target Shopify store.** If the brand has several stores, choose the one that will receive
the page. Stores that need to be reconnected cannot be chosen. A store shown in orange (access
about to expire) can still be used, but reconnect it soon.

**Confirm.** Click **Choose this supplier**, add a note if you like, and confirm. If the margin
is below the brand minimum, you must first tick **Go on with a margin below the brand
minimum**. Your choice is recorded with your name. Trendcart then writes the page and creates
it as a **draft** on the store. Nothing is published yet.

**None of these.** If no listing fits, click **None of these** and say what is wrong
(optional). Trendcart removes these listings and searches again. Listings you rejected are not
offered again. If nothing is found at all, click **Search again**.

## 9. Gate 3: review the product page

When the status shows **Approve content**, the page is ready for you to review. It is a
**draft** on your Shopify store: shoppers cannot see it yet.

**What you see.** A preview of the title, price and compare-at price, highlights, description,
guarantee and FAQ. You also see the search listing (SEO) and the short ad texts that will be
used for TikTok ads later. Use **Preview the draft** to see it in your theme, or **Open in
Shopify admin**. The copy is written by AI, so check claims, sizes and shipping promises.

**Your options:**

- **Edit copy**: change any text and click **Save changes**. The Shopify draft is updated at
  once.
- **Regenerate**: discard this copy (including your edits) and write a new one. The page stays
  on the same draft.
- **Reject**: say what should change (for example "shorter title, no shipping promise"), and
  Trendcart writes a new version that follows your note.
- **Approve and publish**: publishes the product on your store (see below).

### What you cannot write in the copy

To protect your store and keep your future ads within TikTok's rules, Trendcart refuses copy
that makes claims it cannot back up. If you save text like this, you get a message that names
the field and the reason. Remove the claim and save again. There is no override.

| Not allowed | Examples | Why |
| --- | --- | --- |
| Reviews and ratings | "Rated 4.9 out of 5", "4.9★", "500 reviews", "5-star" | Ratings must come from real reviews, not page text |
| Customer or sales counts | "10,000 happy customers", "thousands of shoppers", "1 million sold" | Unverifiable numbers count as fake social proof |
| Endorsements | "Trusted by", "Recommended by experts", "Dermatologist recommended" | Endorsements need proof |
| Popularity | "Went viral", "As seen on TikTok", "Everyone is talking about it" | Unverifiable |
| Superlatives | "#1", "Best seller", "Top rated", "Award-winning" | Unverifiable |
| Health and certifications | "Clinically proven", "FDA approved", "Cures", "Weight loss" | Restricted by ad and consumer rules |
| Absolute guarantees | "100% effective", "Risk-free", "Money-back guarantee", "Lifetime warranty" | Only promise what your store really offers |
| False urgency | "Only 3 left", "Selling fast", "Last chance" | Misleading |
| Prices and discounts | "$19.99", "50% off", "Save 20%", "Half price" | The price lives in Shopify's price fields, so it stays correct when it changes |
| Links and emails | "www.example.com", "support@example.com" | Contact details belong in your theme |

The same rules apply to the AI copy. When the AI breaks them, Trendcart asks it to write the
copy again before showing it to you. If the copy is still not safe, the step fails and you can
click **Retry step**. Option names coming from supplier listings (sizes, colours) are checked too.

### "The page changed since you loaded it"

Your approval is tied to the exact version of the page on your screen. If someone else edited
or regenerated it after you opened it, **Approve and publish** stops and offers **Reload**.
Reload, review the latest version, then approve it. This way nobody publishes a page they have
not seen.

If someone else saved changes while you were editing, your save is refused with "updated by
someone else". Copy your changes, refresh, and apply them again.

### Approve and publish

Click **Approve and publish**, add a note if you like, and confirm. The product becomes
**Active** on your store's Online Store channel, so anyone can see it and buy it. Your approval
is recorded with your name.

- While Trendcart publishes, the page shows **Publishing to Shopify…** and every page action
  is paused. The screen updates on its own, usually within seconds.
- If Shopify refuses or fails, Trendcart puts the product back to **draft**, cancels the
  approval and reopens the review. Fix the cause (for example, reconnect the store) and approve
  again.
- Once published, Trendcart does not unpublish the page for you. To take it down, set it back
  to draft in the Shopify admin.

After the page approval, the product stays at Gate 3 until the videos part arrives (**M3**).

### Limits on rebuilds

Each new supplier search or page rewrite costs money (search and AI services). **None of
these**, **Reject** and **Regenerate** are limited to **10 per product** and **60 per
workspace** per hour. When a limit is reached, the button shows **Try again later**. Wait a
little and try again. Edits and approvals are not limited.

## 10. Team

Open **Team** to see members and the role descriptions. Owners can invite people by email
(the link is valid for 7 days), see pending invitations, change roles and remove members.
Invited people sign up or sign in from the link to join.

## 11. Usage

**Usage** (Media buyer and Owner) shows the AI cost and the number of paid API calls for the
workspace, per calendar month (UTC), with a 12-month history. Supplier searches and page
writing count too. Each workspace has a monthly AI budget. When it is reached, new analyses,
supplier searches and page rewrites stop until the next month. Ask your Trendcart
administrator to change it.

## Coming next

- **M3**: finding more TikTok videos of the product, ad-rule checks, video approval (the
  videos part of Gate 3), posting to TikTok profiles, paused TikTok campaigns, launch approval
  (Gate 4) and hourly results.
