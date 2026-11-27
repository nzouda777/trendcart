# Trendcart: Accounts to Create

This document lists the third-party accounts Trendcart needs before going live, and how each store connects to Trendcart. Please create each account **in your company's name, with your company's payment method**, so you own the data, the contracts and the billing.

## Before you start

- Use a shared company email address (for example `tech@yourcompany.com`), not a personal one.
- **Never send keys by plain email or chat.** Use a shared password manager (1Password, Bitwarden) or a one-time secret link.
- Whenever a service offers it, **invite us as a team member** instead of sharing your login.
- Set a **monthly spending limit** on every pay-as-you-go service.

## Summary

| Service | What Trendcart uses it for | Pricing | Required |
|---|---|---|---|
| **Vercel** | Hosting, scheduled jobs, database | Monthly subscription (Pro plan) | Yes |
| **Upstash** | Rate limiting and job locks | Free tier, then pay as you go | Recommended |
| **Google Gemini** | AI: watches the videos to identify the product, checks videos against TikTok ad rules | Pay as you go | Yes |
| **Anthropic** | AI: image search, product page copy | Pay as you go (prepaid credits) | Yes |
| **SerpApi** | Reverse image search and shopping results to find suppliers | Free tier, then monthly plan | Yes |
| **Firecrawl** | Reads supplier pages (photos, prices, details) | Free credits, then monthly plan | Yes |
| **ScrapeCreators** | Reads public videos and finds more videos of the same product | Pay as you go (credit packs) | Yes |
| **Stripe** | Collects your customers' subscription payments | No monthly fee, fee per transaction | Yes, to get paid |

Prices change often: check each provider's pricing page when you sign up.

---

## 1. Vercel

**Sign up:** [vercel.com/signup](https://vercel.com/signup)

1. Create an account and a **Team** in your company's name.
2. Upgrade the team to the **Pro** plan (needed for long-running jobs and scheduled tasks).
3. Invite us as a team member.

The database (Neon Postgres) is added from inside Vercel (**Storage > Neon**) and billed on your Vercel invoice, so there is no separate account to create.

**Send us:** a team invitation (no key needed).

## 2. Upstash

**Sign up:** [upstash.com](https://upstash.com)

1. Create an account, then a **Redis** database in the same region as your Vercel project.
2. Open the database's **REST API** tab.

**Send us:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## 3. Google Gemini

**Sign up:** [aistudio.google.com](https://aistudio.google.com)

1. Sign in with a company Google account and create an API key.
2. Turn on billing (paid tier) for the linked Google Cloud project. The free tier is too limited, and Google may use free-tier data to improve its products.
3. Set a budget and a spending alert in **Google Cloud > Billing**.

**Send us:** the API key (`GEMINI_API_KEY`).

## 4. Anthropic (Claude)

**Sign up:** [console.anthropic.com](https://console.anthropic.com)

1. Create an organization, add a payment method and buy credits.
2. Create an API key, ideally in a dedicated **Trendcart** workspace.
3. Set a monthly spending limit (**Settings > Limits**).

**Send us:** the API key (`ANTHROPIC_API_KEY`).

## 5. SerpApi

**Sign up:** [serpapi.com](https://serpapi.com)

1. Create an account and pick a plan that matches your expected number of product searches.
2. Copy the API key from **Your Account**.

**Send us:** the API key (`SERPAPI_KEY`).

## 6. Firecrawl

**Sign up:** [firecrawl.dev](https://firecrawl.dev)

1. Create an account.
2. Copy the API key from the dashboard.

**Send us:** the API key (`FIRECRAWL_API_KEY`).

## 7. ScrapeCreators

**Sign up:** [scrapecreators.com](https://scrapecreators.com)

1. Create an account and buy a credit pack.
2. Copy the API key from the dashboard.

**Send us:** the API key.

## 8. Stripe (collecting payments)

**Sign up:** [dashboard.stripe.com/register](https://dashboard.stripe.com/register)

1. Create the account and complete activation (company details and bank account), so payouts reach you.
2. Go to **Developers > API keys** and copy the **secret key** (test key first, live key at launch).
3. We will create the webhook together once the production URL is ready.

**Send us:** the secret key (`STRIPE_SECRET_KEY`), then the webhook signing secret at launch.

---

## Connecting a Shopify store

Shopify only lists apps that run inside the Shopify admin. Trendcart runs on its own site, so **each store connects through its own private Shopify app**, created once by the store owner (or a staff member with the *App developer* permission). It takes about 5 minutes and costs nothing. These are the steps to give to every Trendcart user who connects a store.

> Replace `https://usetrendcart.com` with the final Trendcart address if it is different.

### Step 1: Open the Dev Dashboard from the store

1. Log in to the store's Shopify admin.
2. Go to **Settings > Apps > Develop apps**. If Shopify shows **Build apps in Dev Dashboard**, click it.
3. In the Dev Dashboard, click **Create app**, then **Start from Dev Dashboard**.
4. Name the app `Trendcart` and click **Create**.

Create the app from the store like this (not from a separate Partner account): apps a merchant creates for their own store need no extra security setup. An app created in a Partner account and installed on another company's store needs an IP allowlist, which we would have to provide.

### Step 2: Configure and release a version

On the app's **Versions** page, click **Create a version** and fill in:

| Field | Value |
|---|---|
| App URL | `https://usetrendcart.com/app/connections` |
| Embed app in Shopify admin | Off (if the option is shown) |
| Redirect URL | `https://usetrendcart.com/api/shopify/callback` |
| Webhooks API version | The newest one offered |
| Scopes | `write_products`, `read_themes`, `write_files`, `write_publications` |

Then click **Release**.

### Step 3: Copy the app's credentials

1. Open the app's **Settings** page.
2. Copy the **Client ID** and the **Client secret**.
3. **Do not click Install** in the Dev Dashboard: Trendcart installs the app in the next step.

### Step 4: Connect the store in Trendcart

1. In Trendcart, open **Connections** and select the brand the store sells for.
2. Under **Connect a store**, enter the store's `your-store.myshopify.com` address (not the custom domain).
3. Paste the **Client ID** and the **Client secret**, then click **Connect Shopify**.
4. Shopify opens and asks to approve Trendcart's access. Click **Install**.
5. You come back to Trendcart with the store marked as connected.

The client secret is stored encrypted and never shown again. To reconnect later (for example after changing the secret), use **Reconnect with custom app credentials** on the store's row.

### If something goes wrong

- **Shopify shows "The redirect_uri is not whitelisted"**: the redirect URL in step 2 does not match exactly. Fix it, release a new version, then connect again.
- **Trendcart shows "Access was declined or a required permission is missing"**: a scope from step 2 is missing, or the access was declined. Add the scopes, release a new version, then connect again.
- **Trendcart shows "Shopify's signature could not be verified" or "The request was incomplete"**: check the store address, and copy the client secret again from the app's Settings page.

---

## What we handle on our side

- **Internal secrets** (session signing, encryption keys, scheduled job secret): we generate them and store them directly in Vercel.

## Checklist

- [ ] **Vercel**: team invitation sent
- [ ] **Upstash**: REST URL and REST token
- [ ] **Google Gemini**: API key, billing on, budget alert set
- [ ] **Anthropic**: API key, spending limit set
- [ ] **SerpApi**: API key
- [ ] **Firecrawl**: API key
- [ ] **ScrapeCreators**: API key
- [ ] **Stripe**: account activated, secret key
- [ ] **Shopify**: each store connected with its own app (see "Connecting a Shopify store")
