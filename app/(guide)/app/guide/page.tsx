import {
  ArrowLeftIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  FilmIcon,
  GaugeIcon,
  LayoutTemplateIcon,
  MegaphoneIcon,
  ScanSearchIcon,
  SendIcon,
  ShieldCheckIcon,
  TruckIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import {
  Callout,
  CardGrid,
  GateTrack,
  GuideSection,
  GuideTable,
  ImportIllustration,
  Prose,
  Steps,
  SubHeading,
  Ui,
  type GuideTocItem,
} from "@/components/guide/guide-parts";
import {
  AdsBuilderMockup,
  BrandSwitcherMockup,
  ConnectionsMockup,
  FlowDiagram,
  ProductAnalysisMockup,
  ProxySettingMockup,
  ShopifyPageMockup,
  SupplierMarginMockup,
  TeamMockup,
  TiktokPostingMockup,
  VideoComplianceMockup,
} from "@/components/mockups";
import { siteConfig } from "@/config/site";
import { AUTH_PATHS } from "@/lib/auth/paths";

/*
 * In-app user guide, opened in a new tab from the account menu. Standalone
 * page (no app shell) under /app, so the proxy keeps it behind sign-in.
 * Static: no session read, so it prerenders.
 */

export const metadata: Metadata = {
  title: `User guide · ${siteConfig.name}`,
  description: `How to use ${siteConfig.name}, step by step: from a TikTok video to a paused TikTok campaign.`,
  robots: { index: false, follow: false },
};

const TOC: GuideTocItem[] = [
  { id: "overview", label: "How it works", group: "Start here" },
  { id: "getting-started", label: "Account and workspace", group: "Start here" },
  { id: "roles", label: "Roles", group: "Start here" },
  { id: "brands", label: "Brands and settings", group: "Set up" },
  { id: "connections", label: "Connections", group: "Set up" },
  { id: "proxy", label: "Proxy (optional)", group: "Set up" },
  { id: "campaign-settings", label: "Campaign settings", group: "Set up" },
  { id: "import", label: "Import a product", group: "Run a product" },
  { id: "gate-1", label: "Gate 1: confirm the product", group: "Run a product" },
  { id: "gate-2", label: "Gate 2: supplier and price", group: "Run a product" },
  { id: "gate-3-page", label: "Gate 3: product page", group: "Run a product" },
  { id: "gate-3-videos", label: "Gate 3: videos", group: "Run a product" },
  { id: "posting", label: "Post to TikTok (optional)", group: "Run a product" },
  { id: "gate-4", label: "Gate 4: launch the campaign", group: "Run a product" },
  { id: "duplicates", label: "Duplicate a campaign", group: "Run a product" },
  { id: "team", label: "Team", group: "Workspace" },
  { id: "usage", label: "Usage and limits", group: "Workspace" },
  { id: "billing", label: "Plans and billing", group: "Workspace" },
  { id: "statuses", label: "Product statuses", group: "Reference" },
  { id: "troubleshooting", label: "Troubleshooting", group: "Reference" },
];

function Toc() {
  const groups = [...new Set(TOC.map((t) => t.group))];
  return (
    <nav aria-label="Guide contents" className="grid gap-5 text-sm">
      {groups.map((group) => (
        <div key={group}>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {group}
          </p>
          <ul className="grid gap-0.5">
            {TOC.filter((t) => t.group === group).map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className="block rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#guide-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-foreground"
      >
        Skip to the guide
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="hidden text-sm text-muted-foreground sm:inline">User guide</span>
          </div>
          <Link
            href={AUTH_PATHS.home}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            Back to the app
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-10 pr-2">
            <Toc />
          </div>
        </aside>

        <main id="guide-content" className="min-w-0 py-10">
          {/* Hero */}
          <div className="border-b border-border pb-12">
            <p className="text-sm font-semibold text-brand-text">{siteConfig.tagline}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
              The {siteConfig.name} user guide
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Everything you need to go from a TikTok video (or a product link) to a Shopify product
              page, checked videos and a TikTok campaign that is ready to launch. A person on your
              team approves every important step: nothing is published or launched on its own.
            </p>
            <details className="mt-6 rounded-xl border border-border bg-surface p-4 lg:hidden">
              <summary className="cursor-pointer text-sm font-medium">Contents</summary>
              <div className="mt-4">
                <Toc />
              </div>
            </details>
          </div>

          <div className="divide-y divide-border">
            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="overview"
              eyebrow="Start here"
              title="How Trendcart works"
              intro={
                <>
                  <p>
                    You give Trendcart a link. It identifies the product, finds suppliers, works out
                    your margin, writes a Shopify page, collects videos and checks them against
                    TikTok ad rules, then prepares a TikTok campaign. Everything is created as a{" "}
                    <strong>draft</strong> or <strong>paused</strong>.
                  </p>
                  <p>
                    The work stops at four <strong>approval gates</strong>. Each one waits for a
                    person with the right role, and every decision is recorded with their name and
                    the time.
                  </p>
                </>
              }
              illustration={
                <FlowDiagram ariaLabel="From a TikTok link to a paused TikTok campaign, through Shopify." />
              }
            >
              <GateTrack />
              <CardGrid
                items={[
                  {
                    icon: <ScanSearchIcon />,
                    title: "AI product identification",
                    body: "Watches the TikTok video or reads the product page to name the product.",
                    href: "#gate-1",
                  },
                  {
                    icon: <TruckIcon />,
                    title: "Suppliers and margin",
                    body: "Online listings with photos, prices and shipping, and a live margin calculator.",
                    href: "#gate-2",
                  },
                  {
                    icon: <LayoutTemplateIcon />,
                    title: "Shopify product page",
                    body: "Built from your store's template with variants, prices and media, as a draft.",
                    href: "#gate-3-page",
                  },
                  {
                    icon: <FilmIcon />,
                    title: "Video compliance",
                    body: "Other TikTok videos of the product, each checked against TikTok ad rules.",
                    href: "#gate-3-videos",
                  },
                  {
                    icon: <SendIcon />,
                    title: "TikTok posting",
                    body: "Optionally post approved videos to your connected TikTok profiles.",
                    href: "#posting",
                  },
                  {
                    icon: <MegaphoneIcon />,
                    title: "Paused campaigns",
                    body: "Campaign, ad groups and ads created paused in TikTok Ads Manager, with results by hour.",
                    href: "#gate-4",
                  },
                ]}
              />
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="getting-started"
              eyebrow="Start here"
              title="Create your account and workspace"
              intro={
                <p>
                  A <strong>workspace</strong> is your company&apos;s space in Trendcart: its
                  brands, stores, products and team. The person who creates it becomes its{" "}
                  <strong>Owner</strong>.
                </p>
              }
            >
              <Steps
                items={[
                  {
                    title: "Sign up",
                    body: (
                      <p>
                        Enter your name, work email and a password of at least 10 characters, then
                        click <Ui>Create account</Ui>.
                      </p>
                    ),
                  },
                  {
                    title: "Verify your email",
                    body: (
                      <p>
                        Open the link we send you. Your account is active once you click it. No
                        email? Check your spam folder, then sign in again to get a new link.
                      </p>
                    ),
                  },
                  {
                    title: "Create your workspace",
                    body: <p>Give it your company name. You can create more workspaces later.</p>,
                  },
                  {
                    title: "Add your first brand",
                    body: (
                      <p>
                        Name, country, language and currency. See{" "}
                        <a className="text-brand-text underline" href="#brands">
                          Brands and settings
                        </a>
                        .
                      </p>
                    ),
                  },
                  {
                    title: "Connect your accounts",
                    body: (
                      <p>
                        At least one Shopify store and one TikTok Ads account. See{" "}
                        <a className="text-brand-text underline" href="#connections">
                          Connections
                        </a>
                        .
                      </p>
                    ),
                  },
                ]}
              />
              <Callout kind="tip" title="Protect your account">
                Turn on two-step sign-in with an authenticator app: open your account menu at the
                bottom of the sidebar, then <Ui>Security and two-factor</Ui>.
              </Callout>
              <Callout>
                Belong to several workspaces? Switch between them, or create a new one, from the
                workspace menu at the top of the sidebar.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="roles"
              eyebrow="Start here"
              title="Roles: who can do what"
              intro={
                <p>
                  Each member has one role per workspace. Higher roles can do everything the lower
                  ones can. Buttons you cannot use are hidden or disabled, with the reason shown.
                </p>
              }
            >
              <GuideTable
                caption="Roles and permissions"
                head={["Role", "What they can do"]}
                rows={[
                  [
                    "Owner",
                    "Everything: members and roles, create or delete brands, disconnect accounts, plus all Media buyer actions.",
                  ],
                  [
                    "Media buyer",
                    "Runs products end to end: every gate, choosing the TikTok Ads account, launching, pausing and budgets. Edits brands, connects accounts, sets the proxy, sees Usage.",
                  ],
                  [
                    "Creative",
                    "Imports links, confirms products (Gate 1), chooses suppliers and prices (Gate 2), edits and approves pages and individual videos (Gate 3), posts to TikTok, retries failed steps.",
                  ],
                  ["Viewer", "Read-only access to products, campaigns and results."],
                ]}
              />
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="brands"
              number={1}
              eyebrow="Set up"
              title="Brands and settings"
              intro={
                <>
                  <p>
                    A <strong>brand</strong> groups its own Shopify stores, TikTok ad accounts and
                    TikTok profiles. Most companies use one brand per store or per market. Pick the
                    active brand in the sidebar: connections and imports use it.
                  </p>
                  <p>
                    Open <Ui>Brands</Ui> to add a brand or change its settings.
                  </p>
                </>
              }
              illustration={<BrandSwitcherMockup />}
            >
              <GuideTable
                caption="Brand settings"
                head={["Setting", "What it does"]}
                rows={[
                  ["Brand name", "How the brand appears in Trendcart."],
                  ["Main country", "Default targeting of new campaigns."],
                  ["Language", "Language of the product pages and ad texts."],
                  ["Currency", "Should match your Shopify store's currency."],
                  [
                    "Default test budget (daily)",
                    "Prefilled on new campaigns. Every change is recorded in the audit log.",
                  ],
                  ["Minimum margin", "Suppliers below this margin are flagged at Gate 2."],
                  [
                    "Pricing rule",
                    "Selling price = landed cost × multiplier, with an optional ending (for example .99) and compare-at multiplier.",
                  ],
                ]}
              />
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="connections"
              number={2}
              eyebrow="Set up"
              title="Connect Shopify and TikTok"
              intro={
                <p>
                  Open <Ui>Connections</Ui> to link the accounts of the active brand. Each
                  connection shows its health with a colour.
                </p>
              }
              illustration={<ConnectionsMockup />}
            >
              <GuideTable
                caption="Connection status colours"
                head={["Colour", "Meaning", "What to do"]}
                rows={[
                  ["Green: Healthy", "Connected and working.", "Nothing."],
                  [
                    "Orange: Needs attention",
                    "Setup not finished, or access about to expire.",
                    "Finish the setup, or reconnect soon.",
                  ],
                  [
                    "Red: Not working",
                    "Disconnected, expired or revoked.",
                    <>
                      Click <Ui>Reconnect</Ui>.
                    </>,
                  ],
                ]}
              />
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="grid content-start gap-2">
                  <SubHeading>Shopify store</SubHeading>
                  <Prose>
                    <p>
                      Enter the store&apos;s <strong>your-store.myshopify.com</strong> address (not
                      your custom domain), click <Ui>Connect Shopify</Ui> and approve Trendcart in
                      Shopify.
                    </p>
                    <p>
                      Prefer your own app? Open{" "}
                      <strong>Use a custom app from the store&apos;s admin instead</strong> and
                      paste its client ID and secret. The secret is stored encrypted and never shown
                      again.
                    </p>
                    <p>
                      <strong>Product page template</strong>: the name of a product template in your
                      live theme (for example <code>trendcart</code> for{" "}
                      <code>product.trendcart.json</code>). Leave it empty to use the default
                      template.
                    </p>
                  </Prose>
                </div>
                <div className="grid content-start gap-2">
                  <SubHeading>TikTok Ads account</SubHeading>
                  <Prose>
                    <p>
                      Click <Ui>Connect TikTok Ads</Ui> and sign in with TikTok For Business. The
                      advertiser accounts you authorize appear in the list. Campaigns are always
                      created there <strong>paused</strong>.
                    </p>
                    <p>Required to prepare and launch campaigns.</p>
                  </Prose>
                </div>
                <div className="grid content-start gap-2">
                  <SubHeading>TikTok profile (optional)</SubHeading>
                  <Prose>
                    <p>
                      Click <Ui>Connect a profile</Ui> and sign in with the TikTok account the brand
                      posts from. Only needed to post videos organically. Campaigns do not need it.
                    </p>
                  </Prose>
                </div>
              </div>
              <Callout>
                Disconnecting never deletes what you already created on Shopify or TikTok. Trendcart
                simply stops using that account.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="proxy"
              number={3}
              eyebrow="Set up"
              title="Proxy (optional, per brand)"
              intro={
                <>
                  <p>
                    Under <Ui>Connections</Ui>, then <Ui>Proxy</Ui>, you can route the brand&apos;s
                    TikTok data, page reading and video downloads through your own proxy. Enter a
                    URL like <code>http://user:pass@host:port</code> (http, https or socks5).
                  </p>
                  <p>
                    It is stored encrypted, and only its scheme and host are ever shown. Turn it on
                    or off, test it, or remove it at any time.
                  </p>
                </>
              }
              illustration={<ProxySettingMockup />}
            />

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="campaign-settings"
              eyebrow="Set up"
              title="Save your campaign settings"
              intro={
                <>
                  <p>
                    TikTok&apos;s defaults often widen delivery and spend more than you planned.
                    Save exactly the settings you want once, per brand, and reuse them. Open{" "}
                    <Ui>Brands</Ui>, pick a brand, then <Ui>Campaign settings</Ui>. Only a Media
                    buyer or the Owner can change them.
                  </p>
                  <p>There are two lists, each with as many named settings as you need:</p>
                </>
              }
            >
              <CardGrid
                items={[
                  {
                    icon: <MegaphoneIcon />,
                    title: "Brand new campaign setups",
                    body: "For the first test campaign of a new product, for example “Brand new campaign setup 1” and “…setup 2”. Chosen when you approve the videos at Gate 3.",
                  },
                  {
                    icon: <CheckCircle2Icon />,
                    title: "Campaign duplicate settings",
                    body: "For copies of a launched campaign, for example “Campaign duplicate settings 1” to scale a winner. Chosen when you duplicate a campaign.",
                  },
                  {
                    icon: <ShieldCheckIcon />,
                    title: "One default per list",
                    body: "The default is preselected. The first setting you save becomes the default; click Make default to change it.",
                  },
                ]}
              />
              <GuideTable
                caption="What a campaign setting holds"
                head={["Group", "Settings"]}
                rows={[
                  [
                    "Budget and bidding",
                    "Daily or total budget (empty = brand default, or the source budget for duplicates), budget per ad group (ABO) or per campaign (CBO), lowest cost or cost cap, standard or accelerated pacing, dayparting.",
                  ],
                  [
                    "Targeting",
                    "Countries (empty = brand country), ages, gender, languages, devices (iOS, Android).",
                  ],
                  [
                    "Placements and extras",
                    "Always TikTok only (never Pangle or the Global App Bundle). Search results placement, comments, video downloads and sharing on or off.",
                  ],
                  [
                    "Objective and structure",
                    "Traffic or website conversions (pixel ID and event), one ad group with every video or one ad group per video.",
                  ],
                ]}
              />
              <Callout>
                Budgets are entered in the brand currency and converted with the exchange rate
                recorded at Gate 3. A setting can never push a campaign above 10× the brand default
                test budget per day.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="import"
              number={4}
              eyebrow="Run a product"
              title="Import a product"
              intro={
                <p>
                  Everything starts from a link. Open <Ui>Import</Ui> and paste one of these:
                </p>
              }
              illustration={<ImportIllustration />}
            >
              <Steps
                items={[
                  {
                    title: "Paste a link",
                    body: (
                      <>
                        <p>
                          A <strong>TikTok video</strong> (
                          <code>https://www.tiktok.com/@creator/video/…</code>): the AI watches the
                          video to identify the product.
                        </p>
                        <p>
                          Or a <strong>product link</strong> from a store or marketplace: the AI
                          reads the page. The type switches on its own when you paste.
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "Pick the brand",
                    body: <p>Only shown when you have several brands.</p>,
                  },
                  {
                    title: "Click Import",
                    body: (
                      <p>
                        The analysis usually takes under a minute. You can leave the page: the
                        product keeps processing and appears in <Ui>Products</Ui>.
                      </p>
                    ),
                  },
                ]}
              />
              <Callout>
                Importing a link the brand already has takes you to the existing product. There is
                an hourly import limit per workspace.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="gate-1"
              number={5}
              eyebrow="Gate 1"
              title="Confirm the product"
              intro={
                <>
                  <p>
                    When the status is <Ui>Confirm product</Ui>, open the product. You see the{" "}
                    <strong>AI analysis</strong> (name, category, description, features, selling
                    points, keywords and a confidence score), the <strong>source</strong>, the four
                    gates and the <strong>activity</strong> of each step with its AI cost.
                  </p>
                  <p>Below 70% confidence, check carefully before confirming.</p>
                </>
              }
              illustration={<ProductAnalysisMockup />}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Callout kind="tip" title="Right product">
                  Click <Ui>Confirm product</Ui>. You can correct the name and add a note. The
                  product moves to <Ui>Finding suppliers</Ui>.
                </Callout>
                <Callout kind="note" title="Wrong product">
                  Click <Ui>Reject</Ui> and say what is wrong. The product is analyzed again, using
                  your note as feedback, and comes back to <Ui>Confirm product</Ui>.
                </Callout>
              </div>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="gate-2"
              number={6}
              eyebrow="Gate 2"
              title="Choose a supplier and a price"
              intro={
                <>
                  <p>
                    Trendcart searches online for listings of the same product (a minute or two).
                    When the status shows <Ui>Choose supplier</Ui>, compare the cards: title,
                    photos, price, shipping, delivery time and source, with a link to the original
                    page. Closest matches come first.
                  </p>
                  <p>
                    Pick one and Trendcart suggests a selling price from the brand&apos;s pricing
                    rule, raised if needed to reach your minimum margin.
                  </p>
                </>
              }
              illustration={<SupplierMarginMockup />}
            >
              <GuideTable
                caption="Price fields at Gate 2"
                head={["Field", "Use it to"]}
                rows={[
                  ["Selling price", "Override the suggestion. Leave empty to keep it."],
                  [
                    "Compare-at price",
                    "Set the strike-through price, or tick No compare-at price.",
                  ],
                  ["Other costs per order", "Add packaging, inserts or fulfilment."],
                  [
                    "Exchange rate",
                    "Asked when the listing uses another currency than your brand.",
                  ],
                  [
                    "Target Shopify store",
                    "Choose which store receives the page (several stores only).",
                  ],
                ]}
              />
              <Prose>
                <p>
                  The <strong>margin preview</strong> updates as you type: landed cost, payment
                  fees, gross margin, and what you can spend on ads per order (break-even CPA, max
                  CPA at your target margin, break-even ROAS).
                </p>
                <p>
                  Click <Ui>Choose this supplier</Ui> and confirm. Below the brand minimum you must
                  first tick <strong>Go on with a margin below the brand minimum</strong>. Trendcart
                  then writes the page and creates it as a <strong>draft</strong> on the store. If
                  nothing fits, click <Ui>None of these</Ui> to search again.
                </p>
              </Prose>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="gate-3-page"
              number={7}
              eyebrow="Gate 3, part 1"
              title="Review and publish the product page"
              intro={
                <>
                  <p>
                    When the status shows <Ui>Approve content</Ui>, the page is a draft on your
                    store: shoppers cannot see it yet. Review the title, prices, highlights,
                    description, guarantee, FAQ, SEO listing and the short ad texts.
                  </p>
                  <p>
                    Use <Ui>Preview the draft</Ui> to see it in your theme, or{" "}
                    <Ui>Open in Shopify admin</Ui>. The copy is written by AI: check claims, sizes
                    and shipping promises.
                  </p>
                </>
              }
              illustration={<ShopifyPageMockup />}
            >
              <GuideTable
                caption="Page actions"
                head={["Action", "What happens"]}
                rows={[
                  [
                    "Edit copy",
                    "Change any text and Save changes. The Shopify draft is updated at once.",
                  ],
                  ["Regenerate", "Discard this copy (with your edits) and write a new one."],
                  ["Reject", "Say what should change; a new version follows your note."],
                  [
                    "Approve and publish",
                    "The product becomes Active on your Online Store. Your approval is recorded.",
                  ],
                ]}
              />
              <Callout kind="warning" title="Claims the copy cannot make">
                To keep your store and your ads within TikTok&apos;s rules, Trendcart refuses
                ratings and review counts, customer or sales numbers, endorsements, &quot;went
                viral&quot;, superlatives (&quot;#1&quot;, &quot;best seller&quot;), health or
                certification claims, absolute guarantees, false urgency, prices or discounts in the
                text, and links or emails. The message names the field and the reason: remove the
                claim and save again.
              </Callout>
              <Callout title="“The page changed since you loaded it”">
                Your approval is tied to the version on your screen. If someone edited it meanwhile,
                click <Ui>Reload</Ui>, review the latest version, then approve.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="gate-3-videos"
              number={8}
              eyebrow="Gate 3, part 2"
              title="Choose and approve the videos"
              intro={
                <>
                  <p>
                    Trendcart looks for other TikTok videos of the same product (
                    <Ui>Looking for videos of this product…</Ui>) and checks each one against TikTok
                    ad rules. You can also <Ui>Add video</Ui> by pasting a TikTok link. Only links
                    and details are stored, never the video files.
                  </p>
                  <p>
                    Each video shows where it comes from (<Ui>Imported link</Ui>,{" "}
                    <Ui>Found by search</Ui> or <Ui>Added by your team</Ui>) and its ad-rules
                    report.
                  </p>
                </>
              }
              illustration={<VideoComplianceMockup />}
            >
              <GuideTable
                caption="Ad-rules results"
                head={["Result", "Meaning"]}
                rows={[
                  ["Meets ad rules", "Safe to use."],
                  ["Check warnings", "Usable, but read the warnings first."],
                  ["Breaks ad rules", "Cannot be approved."],
                  [
                    "Technical",
                    <>
                      The check could not run. Click <Ui>Check again</Ui>.
                    </>,
                  ],
                ]}
              />
              <Steps
                items={[
                  {
                    title: "Approve each video you want (Creative or higher)",
                    body: (
                      <p>
                        Click <Ui>Approve</Ui> on a video. It is uploaded once to the Shopify
                        product as product media (<Ui>Uploading to Shopify…</Ui>). If you see
                        &quot;Shopify is still processing this video&quot;, wait a minute and
                        approve it again: it resumes the same upload, never a duplicate.
                      </p>
                    ),
                  },
                  {
                    title: "Reject the others",
                    body: (
                      <p>
                        <Ui>Reject video</Ui> removes it from the Shopify product and keeps it out
                        of the campaign.
                      </p>
                    ),
                  },
                  {
                    title: "Approve the videos part (Media buyer or Owner)",
                    body: (
                      <p>
                        Click <Ui>Approve videos</Ui>, choose the{" "}
                        <strong>TikTok Ads account</strong> and the <strong>campaign setup</strong>{" "}
                        (the brand&apos;s default is preselected, see{" "}
                        <a className="text-brand-text underline" href="#campaign-settings">
                          Campaign settings
                        </a>
                        ), add an exchange rate if the account&apos;s currency differs from the
                        brand, then confirm.
                      </p>
                    ),
                  },
                ]}
              />
              <Callout>
                Once both the page and the videos are approved, Trendcart prepares the campaign on
                TikTok Ads, <strong>paused</strong>. Nothing spends until someone approves the
                launch at Gate 4.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="posting"
              number={9}
              eyebrow="Optional"
              title="Post a video to TikTok"
              intro={
                <>
                  <p>
                    With a TikTok profile connected, click <Ui>Post to TikTok</Ui> on an approved
                    video. Choose the profile, <strong>who can see this post</strong> (everyone,
                    friends, followers or only you), and whether to{" "}
                    <strong>disclose commercial content</strong>. Accept TikTok&apos;s Music Usage
                    Confirmation and, for branded content, its Branded Content Policy.
                  </p>
                  <p>
                    Use <Ui>Refresh post status</Ui> to follow TikTok&apos;s processing.
                  </p>
                </>
              }
              illustration={<TiktokPostingMockup />}
            >
              <Callout kind="warning">
                Until TikTok approves Trendcart&apos;s posting audit, posts are private (visible
                only to the account owner). This is TikTok&apos;s rule, not a setting.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="gate-4"
              number={10}
              eyebrow="Gate 4"
              title="Review and launch the campaign"
              intro={
                <>
                  <p>
                    When the status shows <Ui>Ready to launch</Ui>, the campaign, its ad groups and
                    ads exist in TikTok Ads Manager, all <strong>paused</strong>. Review the ad
                    account, objective, countries, budget, structure and landing page (your Shopify
                    product).
                  </p>
                  <p>
                    Only a <strong>Media buyer</strong> or the <strong>Owner</strong> can launch.
                  </p>
                </>
              }
              illustration={<AdsBuilderMockup />}
            >
              <GuideTable
                caption="Campaign controls"
                head={["Control", "What happens"]}
                rows={[
                  [
                    "Approve and launch",
                    "Turns the campaign on and spending starts. Your approval is recorded.",
                  ],
                  [
                    "Pause campaign",
                    "Every ad group and ad is disabled on TikTok and spending stops.",
                  ],
                  ["Resume", "Turns it back on and spending starts again."],
                  ["Change the budget", "Saved on TikTok and recorded in the audit log."],
                  ["Retry launch", "Shown if TikTok refused the launch: fix the cause and retry."],
                ]}
              />
              <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
                <BarChart3Icon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-brand-text"
                />
                <p className="leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">Results.</strong> After launch, the product
                  page shows <Ui>Hourly results, newest first</Ui>: spend, impressions, clicks,
                  conversions and revenue, synced from TikTok automatically.
                </p>
              </div>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="duplicates"
              number={11}
              eyebrow="Scale"
              title="Duplicate a campaign"
              intro={
                <p>
                  Once a campaign is launched, the <Ui>Duplicates</Ui> panel on the product page
                  copies it with one of your <strong>campaign duplicate settings</strong>: same
                  videos, ad texts and landing page, new budget, targeting and structure.
                </p>
              }
            >
              <Steps
                items={[
                  {
                    title: "Choose the duplicate settings",
                    body: (
                      <p>
                        Pick one in <Ui>Duplicate with</Ui>. The brand default is preselected.
                      </p>
                    ),
                  },
                  {
                    title: "Click Duplicate campaign",
                    body: (
                      <p>
                        Trendcart creates the copy on TikTok Ads, <strong>paused</strong>, named{" "}
                        <code>… · copy 1</code>, <code>… · copy 2</code>, and so on.
                      </p>
                    ),
                  },
                  {
                    title: "Launch it when you are ready (Media buyer or Owner)",
                    body: (
                      <p>
                        Click <Ui>Launch</Ui> on the copy and confirm. Your approval is recorded.
                        Pause it or change its budget at any time from the same row.
                      </p>
                    ),
                  },
                ]}
              />
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="team"
              eyebrow="Workspace"
              title="Invite your team"
              intro={
                <p>
                  Open <Ui>Team</Ui> to see members and roles. The Owner invites people by email
                  (the link is valid for 7 days), sees pending invitations, changes roles and
                  removes members. Invited people sign up or sign in from the link to join.
                </p>
              }
              illustration={<TeamMockup />}
            />

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="usage"
              eyebrow="Workspace"
              title="Usage and limits"
              intro={
                <p>
                  <Ui>Usage</Ui> (Media buyer and Owner) shows the AI cost and the number of paid
                  API calls per calendar month (UTC), with a 12-month history.
                </p>
              }
            >
              <CardGrid
                items={[
                  {
                    icon: <GaugeIcon />,
                    title: "Monthly AI budget",
                    body: "When it is reached, new analyses, supplier searches and page rewrites stop until next month.",
                  },
                  {
                    icon: <ShieldCheckIcon />,
                    title: "Rebuild limits",
                    body: "None of these, Reject and Regenerate: 10 per product and 60 per workspace per hour.",
                  },
                  {
                    icon: <CheckCircle2Icon />,
                    title: "Never limited",
                    body: "Edits and approvals. When a limit is hit, the button shows Try again later.",
                  },
                ]}
              />
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection
              id="billing"
              eyebrow="Workspace"
              title="Plans and billing"
              intro={
                <p>
                  Open <Ui>Billing</Ui> to see your plan, its limits and when it renews. Only the
                  workspace <strong>Owner</strong> can choose, change or cancel a plan.
                </p>
              }
            >
              <Steps
                items={[
                  {
                    title: "Choose a plan or start a free trial",
                    body: (
                      <p>
                        Pick monthly or yearly, then <Ui>Subscribe</Ui>. You pay on Stripe&apos;s
                        secure page: Trendcart never sees your card. A free trial, when offered,
                        starts at once and can be used once per workspace.
                      </p>
                    ),
                  },
                  {
                    title: "Manage billing",
                    body: (
                      <p>
                        <Ui>Manage billing</Ui> opens Stripe&apos;s portal: change card, plan or
                        billing period, download invoices, or cancel.
                      </p>
                    ),
                  },
                ]}
              />
              <Callout>
                Each plan sets limits (brands, Shopify stores, team seats, products per month, AI
                budget). When one is reached, the action explains which limit and suggests an
                upgrade. Without an active plan, the app pages ask the Owner to choose one.
              </Callout>
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection id="statuses" eyebrow="Reference" title="Product statuses">
              <GuideTable
                caption="Product statuses"
                head={["Status", "Meaning", "Who acts"]}
                rows={[
                  ["Imported / Analyzing", "The AI is identifying the product.", "Nobody, wait."],
                  ["Confirm product", "Gate 1 is waiting.", "Creative or higher"],
                  ["Finding suppliers", "Searching listings online.", "Nobody, wait."],
                  ["Choose supplier", "Gate 2 is waiting.", "Creative or higher"],
                  [
                    "Building page and videos",
                    "Writing the page, finding and checking videos.",
                    "Nobody, wait.",
                  ],
                  [
                    "Approve content",
                    "Gate 3 is waiting (page and videos).",
                    "Creative; Media buyer for the videos part",
                  ],
                  [
                    "Preparing campaign",
                    "Creating the paused campaign on TikTok.",
                    "Nobody, wait.",
                  ],
                  ["Ready to launch", "Gate 4 is waiting.", "Media buyer or Owner"],
                  ["Launched", "The campaign is live.", "Media buyer or Owner (pause, budget)"],
                  ["Failed", "A step failed. The error is shown.", "Retry step"],
                ]}
              />
            </GuideSection>

            {/* ------------------------------------------------------------ */}
            <GuideSection id="troubleshooting" eyebrow="Reference" title="Troubleshooting">
              <GuideTable
                caption="Common problems"
                head={["You see", "What to do"]}
                rows={[
                  [
                    "A step shows Failed",
                    <>
                      Read the error, fix the cause if needed, then click <Ui>Retry step</Ui>.
                    </>,
                  ],
                  [
                    "“Shopify is still processing this video”",
                    "Wait a minute and approve the video again. It resumes, no duplicate.",
                  ],
                  [
                    "“This video is already uploading to Shopify”",
                    "Someone (or another tab) is uploading it. Wait a moment.",
                  ],
                  [
                    "A connection is red",
                    <>
                      Open <Ui>Connections</Ui> and click <Ui>Reconnect</Ui>.
                    </>,
                  ],
                  [
                    "“Try again later”",
                    "A rebuild limit or the monthly AI budget was reached. Wait, or ask the Owner.",
                  ],
                  [
                    "“The page changed since you loaded it”",
                    <>
                      Click <Ui>Reload</Ui>, review, then approve again.
                    </>,
                  ],
                  [
                    "A button is missing",
                    "Your role cannot do this action. Ask a member with a higher role.",
                  ],
                  [
                    "No verification email",
                    "Check spam, then sign in again to receive a new link.",
                  ],
                ]}
              />
              <Callout kind="tip" title="Your safety net">
                Pages are drafts until you publish them, campaigns are paused until you launch them,
                and every approval, publish, launch, budget and connection change is recorded in the
                audit log.
              </Callout>
            </GuideSection>
          </div>

          <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground">
            <span>
              {siteConfig.name}, {siteConfig.tagline}
            </span>
            <Link href={AUTH_PATHS.home} className="font-medium text-brand-text hover:underline">
              Back to the app
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
