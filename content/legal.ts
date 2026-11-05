import { siteConfig } from "@/config/site";

/*
 * Privacy policy and terms of service. Plain data, rendered by
 * components/marketing/legal-page.tsx. Written to match what the code
 * actually does (what is stored, which providers are called); update both
 * together. The operator, address, contact email and governing law come from
 * siteConfig.legal and are left out while empty.
 */

export type LegalBlock = { type: "p"; text: string } | { type: "list"; items: string[] };

export type LegalSection = {
  /** Anchor id, e.g. /privacy#cookies. */
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  title: string;
  description: string;
  intro: string;
  sections: LegalSection[];
};

const name = siteConfig.name;
const p = (text: string): LegalBlock => ({ type: "p", text });
const list = (...items: string[]): LegalBlock => ({ type: "list", items });

export const privacyPolicy: LegalDocument = {
  title: "Privacy policy",
  description: `How ${name} collects, uses and protects data, including data from TikTok and Shopify.`,
  intro: `${name} is a tool for e-commerce teams. It turns a TikTok post or a product link into a product page on the team's Shopify store and a paused TikTok ad campaign. This policy explains what data we handle to do that, why, and the choices you have.`,
  sections: [
    {
      id: "data-we-collect",
      title: "Data we collect",
      blocks: [
        p(
          "Account data: your name, email address, password (stored as a hash) and, if you turn it on, two-factor authentication settings.",
        ),
        p(
          "Workspace data: your workspace, its members and their roles, your brands and their settings (country, language, budgets, margins, pricing rules).",
        ),
        p("Connected accounts, only when you connect them yourself:"),
        list(
          "TikTok ad accounts (TikTok for Business): advertiser ID, name, currency, time zone and an access token.",
          "TikTok profiles (Login Kit): your TikTok open ID, display name, avatar, and access and refresh tokens. We request only the user.info.basic, video.publish and video.upload permissions.",
          "Shopify stores: shop domain, granted scopes and an access token.",
        ),
        p(
          "Product and campaign data: the TikTok links and product links you import, AI analysis results, supplier listings, prices and margins, links and IDs of approved videos, the campaigns we create for you and their hourly statistics (spend, impressions, clicks, conversions, revenue).",
        ),
        p(
          "Activity records: approvals, publications, launches, budget changes and connection changes are logged for your workspace's audit trail.",
        ),
      ],
    },
    {
      id: "videos",
      title: "Videos",
      blocks: [
        p(
          `${name} does not store video files. For candidate videos we keep only the TikTok link, author, thumbnail link and public metadata. A video is analyzed by streaming it to the AI provider, and only the result is kept.`,
        ),
        p(
          "When you approve a video, it is uploaded to your own Shopify store as product media and, if you choose, to your TikTok ad account or posted to your connected TikTok profile. When you reject or remove it, we delete it from your Shopify store.",
        ),
      ],
    },
    {
      id: "tiktok-data",
      title: "How we use TikTok data",
      blocks: [
        p(
          "We use data from TikTok only to provide the features you ask for, on the accounts you connected:",
        ),
        list(
          "Showing which profile or ad account is connected.",
          "Posting the videos you approve to your TikTok profile. Nothing is posted without your action, and posts stay private until TikTok allows public posting for our app.",
          "Uploading your approved videos to your ad account, creating campaigns, ad groups and ads in a paused state, launching them only after a person on your team approves, and reading their statistics.",
        ),
        p(
          "We do not sell TikTok data, use it for advertising profiles, or share it with anyone other than the service providers listed below. You can disconnect a TikTok account at any time from the Connections page, and revoke our access from your TikTok or TikTok for Business settings.",
        ),
      ],
    },
    {
      id: "use",
      title: "Why we use your data",
      blocks: [
        list(
          "To run the service you signed up for: import, analysis, sourcing, page building, publishing and campaigns.",
          "To keep accounts secure, prevent abuse and enforce workspace roles.",
          "To send service emails: email verification and workspace invitations.",
          "To meet legal obligations.",
        ),
        p(
          "We process data to perform our contract with you and, for security and abuse prevention, on our legitimate interest in keeping the service safe.",
        ),
      ],
    },
    {
      id: "providers",
      title: "Service providers",
      blocks: [
        p("We share data with these providers only as needed to run the service:"),
        list(
          "Hosting and infrastructure: Vercel (application hosting), Neon (database), Upstash (rate limiting).",
          "Email: Resend (account emails).",
          "AI processing: Google (Gemini), Anthropic (Claude), OpenAI and Perplexity, to identify products, check videos against ad rules and write product copy.",
          "Product research: SerpApi, Firecrawl and a TikTok data provider, to find listings and related public TikTok videos.",
          "Platforms you connect: TikTok and Shopify, under their own privacy policies.",
        ),
        p(
          "Some of these providers process data outside your country. Where required, they are bound by appropriate safeguards such as standard contractual clauses.",
        ),
      ],
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        p(
          "Access tokens and other credentials are encrypted at rest with AES-256-GCM. Every workspace's data is kept separate, and each action checks the user's role. Connections use HTTPS.",
        ),
      ],
    },
    {
      id: "retention",
      title: "Retention and deletion",
      blocks: [
        p(
          "We keep your data while your workspace is active. Disconnecting an account deletes its tokens from our side. When you ask us to delete your account or workspace, we delete its data within 30 days, except records we must keep by law.",
        ),
        p(
          "Data already sent to your own Shopify store or TikTok accounts stays there under your control.",
        ),
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      blocks: [
        p(
          `${name} uses only the cookies it needs to work: a session cookie to keep you signed in, and short-lived cookies that protect sign-in and account connections. Your light or dark theme choice is saved in your browser's local storage. We do not use advertising or tracking cookies.`,
        ),
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      blocks: [
        p(
          "Depending on where you live, you can ask to access, correct, export or delete your personal data, object to or restrict its processing, and complain to your data protection authority. To make a request, contact us using the details below.",
        ),
      ],
    },
    {
      id: "children",
      title: "Children",
      blocks: [p(`${name} is a business tool and is not meant for anyone under 18.`)],
    },
    {
      id: "changes",
      title: "Changes",
      blocks: [
        p(
          "We will update this page when our practices change and change the date at the top. For significant changes, we will notify workspace owners by email.",
        ),
      ],
    },
  ],
};

export const termsOfService: LegalDocument = {
  title: "Terms of service",
  description: `The terms that apply when you use ${name}.`,
  intro: `These terms apply when you create an account on ${name} or use it. By using ${name}, you agree to them on behalf of yourself and the business you represent.`,
  sections: [
    {
      id: "service",
      title: "The service",
      blocks: [
        p(
          `${name} helps you import TikTok posts and product links, identify products, compare supplier listings, build draft product pages on your Shopify store, check videos against TikTok ad rules, post videos to your TikTok profiles and create TikTok ad campaigns.`,
        ),
        p(
          "Campaigns are always created paused. Pages, videos and campaigns go live only after someone in your workspace approves them.",
        ),
      ],
    },
    {
      id: "accounts",
      title: "Accounts and workspaces",
      blocks: [
        list(
          "You must be at least 18 and able to act for your business.",
          "Keep your sign-in details safe. You are responsible for activity in your workspace.",
          "Workspace owners decide who joins and which role each member has.",
        ),
      ],
    },
    {
      id: "connected-accounts",
      title: "Your connected accounts",
      blocks: [
        p(
          "You connect your own TikTok, TikTok for Business and Shopify accounts and can disconnect them at any time. Your use of those platforms remains subject to their own terms, including the TikTok Terms of Service, TikTok Advertising Policies and the Shopify Terms of Service.",
        ),
        p(
          "You are responsible for your ad spend. Budgets and charges are set and billed by TikTok on your ad account, not by us.",
        ),
      ],
    },
    {
      id: "content",
      title: "Your content and responsibility",
      blocks: [
        list(
          "You keep all rights to your content and data. You allow us to process it only to provide the service.",
          "You confirm you have the rights to the videos, images and text you publish or advertise, including permission from their creators where needed.",
          "You are responsible for your products, prices, product pages and ads, and for following advertising, consumer protection and product safety laws.",
          "AI results (product identification, margins, compliance checks, copy) can be wrong. Review them before you approve. A passed compliance check does not guarantee that TikTok will approve an ad.",
        ),
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        p("Do not use the service to:"),
        list(
          "Break the law or the rules of TikTok, Shopify or any other connected platform.",
          "Advertise prohibited or counterfeit products, or infringe anyone's rights.",
          "Access other workspaces' data, overload the service, or work around its limits and security.",
        ),
        p("We may suspend access that breaks these rules or puts the service or others at risk."),
      ],
    },
    {
      id: "fees",
      title: "Fees",
      blocks: [
        p(
          "Paid plans, if any, are described on our pricing page and billed as stated there. Usage limits may apply to AI processing.",
        ),
      ],
    },
    {
      id: "availability",
      title: "Availability and changes",
      blocks: [
        p(
          "We work to keep the service available but do not guarantee it is uninterrupted. Features that rely on TikTok or Shopify depend on their APIs and approvals, which may change. We may change the service and these terms; we will notify workspace owners of significant changes.",
        ),
      ],
    },
    {
      id: "liability",
      title: "Disclaimer and liability",
      blocks: [
        p(
          `The service is provided "as is". To the extent permitted by law, ${name} is not liable for indirect losses, lost profits, ad spend, or decisions made using AI results, and our total liability is limited to the amounts you paid us in the 12 months before the claim. Nothing in these terms limits liability that cannot be limited by law.`,
        ),
      ],
    },
    {
      id: "termination",
      title: "Ending your use",
      blocks: [
        p(
          "You can stop using the service and ask us to delete your workspace at any time. We may end or suspend accounts that break these terms. Our privacy policy explains what happens to your data.",
        ),
      ],
    },
  ],
};
