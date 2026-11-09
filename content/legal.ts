import { siteConfig } from "@/config/site";

/*
 * Privacy policy, terms of service and cookie policy. Plain data, rendered by
 * components/marketing/legal-page.tsx, which numbers the sections and adds a
 * final "Contact" section from siteConfig.legal. Written to match what the
 * code actually does (what is stored, which providers are called, which
 * cookies are set); update both together. The operator, address, contact
 * email and governing law come from siteConfig.legal and are never invented.
 */

export type LegalBlock = { type: "p"; text: string } | { type: "list"; items: string[] };

export type LegalSection = {
  /** Anchor id, e.g. /privacy#tiktok-data. */
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
const operator: string = siteConfig.legal.operator || name;
const governingLaw: string = siteConfig.legal.governingLaw;
/* Always the production domain, never the current deployment's host (localhost, previews). */
const siteUrl = siteConfig.canonicalUrl;
const url = (path: string) => `${siteUrl}${path}`;
const p = (text: string): LegalBlock => ({ type: "p", text });
const list = (...items: string[]): LegalBlock => ({ type: "list", items });

/* ------------------------------------------------------------------------ */
/* Terms of service                                                          */
/* ------------------------------------------------------------------------ */

export const termsOfService: LegalDocument = {
  title: "Terms of service",
  description: `The agreement that applies when you use ${name}.`,
  intro: `These Terms of Service ("Terms") are an agreement between you and ${operator} ("${name}", "we", "us"). By creating an account, accepting an invitation to a workspace, paying for a plan, or using ${name}, you agree to these Terms and to our Privacy Policy (${url(siteConfig.links.privacy)}). If you do not agree, do not use ${name}.`,
  sections: [
    {
      id: "eligibility",
      title: `Who can use ${name}`,
      blocks: [
        p(
          `You must be at least 18 and able to enter a binding contract. If you use ${name} for a business, you agree to these Terms for that business and confirm you are allowed to.`,
        ),
        p(
          "You are responsible for your account, for keeping your sign-in details safe, and for everything done through it. Tell us straight away if you think someone else has used it.",
        ),
        p(
          "Workspace owners decide who joins their workspace and which role each member has (owner, media buyer, creative or viewer), and are responsible for what their members do in it.",
        ),
      ],
    },
    {
      id: "service",
      title: `What ${name} does`,
      blocks: [
        p(
          `${name} is software that helps e-commerce teams test products. It can import a TikTok post or a product link, identify the product, find supplier listings and public TikTok videos about it, calculate a margin, build a draft product page in your Shopify store, check videos against TikTok's ad rules, post approved videos to your TikTok profiles, and set up TikTok ad campaigns in your own ad account.`,
        ),
        p(
          "Product pages are created as drafts and campaigns are created paused. Nothing is published, posted or launched, and nothing spends, until someone in your workspace approves it.",
        ),
        p(
          `${name} is a tool. You decide what to sell, what to publish, which videos to use, and whether and how much to spend on ads. We do not guarantee any sales, results, approvals or ad performance.`,
        ),
      ],
    },
    {
      id: "connected-accounts",
      title: "Your connected accounts",
      blocks: [
        p(
          `You can connect accounts you control, such as Shopify stores, TikTok profiles and TikTok ad accounts. By connecting one, you authorize ${name} to act in that account on your instructions (for example, to create a draft product, post a video you approved or create a paused campaign). You can disconnect any account at any time.`,
        ),
        p(
          "You are responsible for following the terms and policies of every service you connect, including the TikTok Terms of Service, TikTok Advertising Policies, TikTok Community Guidelines and the Shopify Terms of Service.",
        ),
        p(
          `${name} is not affiliated with, endorsed by, or sponsored by TikTok, Shopify or any other platform it connects to. Their names are used only to describe the integrations.`,
        ),
        p(
          `Ad spend is set and charged by TikTok directly to your ad account. ${name} never pays your ad spend and is not responsible for it.`,
        ),
      ],
    },
    {
      id: "content",
      title: "Videos, images and other content: your responsibility",
      blocks: [
        p(
          `${name} can find and show you content made by other people, such as public TikTok videos, images and product listings, so you can research a product. That content belongs to its creators and owners. ${name} does not own it and does not give you any right to use it. Showing it to you is not permission to use it.`,
        ),
        p(
          "Before you post, upload or run any content as an ad, you must have every right, license and permission that use needs: for example the creator's permission or a Spark Ads authorization code, rights to any music, and the consent of anyone who appears in it.",
        ),
        p(
          `You are solely responsible for any content you post, upload or advertise through or with the help of ${name}, and for your ads, your products, your prices, your store and any claims you make. You confirm that your use will not infringe anyone's copyright, trademark, privacy or publicity rights, or break any law (including advertising, consumer protection and product safety laws) or platform policy.`,
        ),
        p(
          `AI results (product identification, supplier matches, margins, compliance checks, product copy) can be wrong. Review them before you approve anything. A passed compliance check in ${name} does not guarantee that TikTok will approve an ad or a post.`,
        ),
        p(
          `You keep ownership of your content and data. You give us permission to store and process it only to provide ${name} to you.`,
        ),
      ],
    },
    {
      id: "acceptable-use",
      title: "What you must not do",
      blocks: [
        p(`Do not use ${name} to:`),
        list(
          "Infringe anyone's rights, or use content you do not have permission to use.",
          "Sell illegal, counterfeit, prohibited or unsafe products, or run misleading or unlawful ads.",
          "Harass or impersonate anyone.",
          "Break the rules of TikTok, Shopify or any connected service, create fake accounts or engagement, or use proxies or automation to get around their limits or detection systems.",
          "Access other workspaces' data, resell or share your account, copy, reverse engineer or scrape the service, get around usage limits, or interfere with how it works.",
        ),
        p("We may suspend or close accounts that do."),
      ],
    },
    {
      id: "fees",
      title: "Plans and payments",
      blocks: [
        p(
          `Plans and their limits are described on our pricing page (${url(siteConfig.links.home)}#pricing). Paid plans are billed in advance for the period you choose and renew automatically until you cancel. You can cancel at any time; the plan stays active until the end of the period you have paid for.`,
        ),
        p(
          "Usage included in a plan is for that period and does not carry over. Fees already paid are not refundable, except where the law requires otherwise. Prices do not include taxes unless we say so. We may change prices or plans with notice before your next billing period.",
        ),
      ],
    },
    {
      id: "copyright",
      title: "Copyright complaints",
      blocks: [
        p(
          `If you believe content handled through ${name} infringes your copyright, send us a notice using the contact details at the end of this page. Include your contact details, a description of the work, the link to the content concerned, and a statement that you believe in good faith the use is not authorized. We respond to valid notices and close the accounts of people who infringe repeatedly.`,
        ),
      ],
    },
    {
      id: "third-parties",
      title: "Services we rely on",
      blocks: [
        p(
          `${name} uses other companies' services to work, including hosting, databases, email, search, AI processing and the platforms you connect. Those services have their own terms and may change or stop. We are not responsible for them, and a change on their side, such as a change to TikTok's or Shopify's APIs or app permissions, may change what ${name} can do.`,
        ),
      ],
    },
    {
      id: "our-software",
      title: "Our software",
      blocks: [
        p(
          `${name}, its software, design and brand belong to us. We give you a personal, non-transferable right to use it under these Terms while your account is active. Feedback you send us may be used without any obligation to you.`,
        ),
      ],
    },
    {
      id: "warranties",
      title: "No warranties",
      blocks: [
        p(
          `${name} is provided "as is" and "as available". To the fullest extent the law allows, we make no warranties of any kind, including that it will be uninterrupted, error-free, or fit for a particular purpose, or that any product, page, video or ad will succeed or be approved.`,
        ),
      ],
    },
    {
      id: "liability",
      title: "Limits on our liability",
      blocks: [
        p(
          `To the fullest extent the law allows, ${name} and its owners, employees and contractors are not liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data, ad spend or goodwill, including losses from decisions made using AI results.`,
        ),
        p(
          `Our total liability for any claim about ${name} is limited to the amount you paid us in the 12 months before the claim arose. Nothing in these Terms limits liability that cannot be limited by law.`,
        ),
      ],
    },
    {
      id: "indemnity",
      title: "You protect us",
      blocks: [
        p(
          `You agree to defend, indemnify and hold harmless ${operator} and its owners, employees and contractors from any claims, damages, losses, fines and costs (including reasonable legal fees) that arise from: content you post, upload or advertise; your ads, products or store; your use of ${name}; or your breaking these Terms, any law, or anyone's rights.`,
        ),
      ],
    },
    {
      id: "termination",
      title: "Suspension and closing accounts",
      blocks: [
        p(
          `You can stop using ${name} and ask us to delete your account or workspace at any time. We may suspend or close your account if you break these Terms, if we are required to by law or a platform, or to protect ${name} or others. Our Privacy Policy explains what happens to your data.`,
        ),
        p(
          `The sections "Videos, images and other content", "No warranties", "Limits on our liability", "You protect us" and "Law and disputes" continue after your account closes.`,
        ),
      ],
    },
    {
      id: "changes",
      title: "Changes to these Terms",
      blocks: [
        p(
          `We may update these Terms. When we change them in substance, we will tell workspace owners by email or in ${name} before the changes take effect, and change the date at the top of this page. If you keep using ${name} after that, you accept the new version.`,
        ),
      ],
    },
    {
      id: "law",
      title: "Law and disputes",
      blocks: [
        p(
          governingLaw
            ? `These Terms are governed by the laws of ${governingLaw}, without regard to its conflict-of-law rules. Before going to court, please contact us so we can try to resolve the issue together.`
            : `These Terms are governed by the laws of the country where ${operator} is established, without regard to its conflict-of-law rules. Before going to court, please contact us so we can try to resolve the issue together.`,
        ),
        p(
          "This does not remove any mandatory protection you have under the law of the country where you live.",
        ),
      ],
    },
  ],
};

/* ------------------------------------------------------------------------ */
/* Privacy policy                                                            */
/* ------------------------------------------------------------------------ */

export const privacyPolicy: LegalDocument = {
  title: "Privacy policy",
  description: `What ${name} collects, how it is used, and the choices you have, including for data from TikTok and Shopify.`,
  intro: `This Privacy Policy explains what information ${operator} ("${name}", "we", "us") collects when you use ${name} at ${siteUrl}, how we use it, and the choices you have. We do not sell your personal information.`,
  sections: [
    {
      id: "data-we-collect",
      title: "What we collect",
      blocks: [
        list(
          "Account details: your name, email address and sign-in. Passwords are stored only as a hash and are never visible to us. If you turn on two-factor authentication, its settings.",
          "Workspace details: your workspace, its members and their roles, your brands and their settings (country, language, budgets, margins, pricing rules).",
          "Connected accounts: the details needed to act on your instructions, such as your Shopify store address and access token, your TikTok ad account IDs and names, and your TikTok profile's open ID, display name and avatar. Access tokens and proxy credentials are stored encrypted.",
          `What you put into ${name}: the TikTok links and product links you import, and what ${name} creates for you (AI analyses, supplier listings, prices and margins, draft product pages, links and IDs of approved videos, campaign settings and their hourly statistics).`,
          "Activity records: approvals, publications, launches, budget changes and connection changes, kept as your workspace's audit trail.",
          "Usage and device data: your IP address and browser on each session, and technical logs and error reports used to keep the service running.",
        ),
      ],
    },
    {
      id: "cookies",
      title: "Cookies and browser storage",
      blocks: [
        p(
          `${name} keeps a few small items in your browser. Some are needed to keep you signed in and to connect your accounts safely; the others remember choices you made, such as your theme. We do not use advertising or analytics cookies, and we do not let other companies track you on ${name}.`,
        ),
        p(
          `The full list, with what each item does and how long it lasts, is in our Cookie Policy (${url(siteConfig.links.cookies)}).`,
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
      id: "use",
      title: "How we use it",
      blocks: [
        list(
          `To provide ${name}: run the steps you ask for (import, analysis, sourcing, page building, publishing and campaigns), including in the accounts you connect.`,
          "To keep accounts secure, enforce workspace roles and prevent misuse.",
          "To send service emails, such as email verification and workspace invitations, and to answer support requests.",
          `To fix and improve ${name}.`,
          "To meet legal obligations.",
        ),
        p(
          "We process data to perform our contract with you and, for security, abuse prevention and improving the service, on our legitimate interest in running it safely. We do not send marketing emails without your consent, and you can unsubscribe from them at any time.",
        ),
      ],
    },
    {
      id: "tiktok-data",
      title: "How we use TikTok data",
      blocks: [
        p(
          `${name} uses TikTok's official APIs, in line with the TikTok Developer Terms of Service. We use data from TikTok only to provide the features you ask for, on the accounts you connected yourself.`,
        ),
        p("TikTok profiles (Login Kit and Content Posting API), by permission:"),
        list(
          "user.info.basic: your open ID, display name and avatar, to show which profile is connected.",
          "video.publish: to read the posting options TikTok offers for your profile and post the videos you approve. Nothing is posted without your action, and posts stay private until TikTok allows public posting for our app.",
          "video.upload: to send an approved video to your TikTok inbox as a draft that you finish in the TikTok app.",
        ),
        p("TikTok ad accounts (TikTok API for Business):"),
        list(
          "Reading the ad accounts you authorize (ID, name, currency, time zone) to show them in your workspace.",
          "Uploading your approved videos to your ad account and creating campaigns, ad groups and ads in a paused state. A campaign is launched only after a person on your team approves it.",
          "Reading the statistics of the campaigns we created (spend, impressions, clicks, conversions, revenue) every hour, to show their results.",
        ),
        p(
          "We do not sell TikTok data, use it to build advertising profiles, use it to train AI models, or share it with anyone other than the service providers listed below, only as needed to run the service. We never read or post on a TikTok account you did not connect.",
        ),
        p(
          "When you disconnect a TikTok profile or ad account from the Connections page, its tokens are deleted right away. You can also revoke our access at any time from your TikTok app settings (Security, Manage app permissions) or from TikTok for Business.",
        ),
      ],
    },
    {
      id: "shopify-data",
      title: "How we use Shopify data",
      blocks: [
        p(
          `${name} connects to the Shopify stores you install it on, with the permissions shown during installation. We use that access to read your store's product templates, create draft products with their variants, prices and media, and delete media you remove.`,
        ),
        p(
          `${name} does not read or store your store's customer or order data. We answer Shopify's privacy requests (customer data requests, customer redaction and shop redaction), and when you uninstall the app, its access token is deleted.`,
        ),
      ],
    },
    {
      id: "providers",
      title: "Who we share it with",
      blocks: [
        p(
          "Service providers that run the service for us, under contract and only for that purpose:",
        ),
        list(
          "Hosting and infrastructure: Vercel (application hosting), Neon (database), Upstash (rate limiting).",
          "Email: Resend (account emails).",
          "AI processing: Google (Gemini), Anthropic (Claude), OpenAI and Perplexity, to identify products, check videos against ad rules and write product copy. We send them only what a task needs, through their business APIs, and do not allow them to train their models on it where they offer that choice.",
          "Product research: SerpApi, Firecrawl and a TikTok data provider, to find listings and related public TikTok videos.",
        ),
        p(
          `The platforms you connect (TikTok and Shopify), when you ask ${name} to act in them, under their own privacy policies.`,
        ),
        p(
          "Others only if the law requires it, to protect rights and safety, or as part of a sale or merger of our business.",
        ),
      ],
    },
    {
      id: "retention",
      title: "How long we keep it",
      blocks: [
        p(
          "We keep your data while your workspace is active and as long as needed to provide the service, then for as long as the law requires (for example tax records). Data already sent to your own Shopify store or TikTok accounts stays there under your control.",
        ),
        p("How to delete your data:"),
        list(
          "Disconnect a TikTok profile, TikTok ad account or Shopify store from the Connections page: its tokens are deleted immediately.",
          "Reject or remove a video in the app: if it was uploaded to your Shopify store, it is deleted from there too.",
          "Ask us to delete your account or workspace using the contact details below. We delete it within 30 days, except records we must keep by law, and confirm by email.",
        ),
      ],
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        p(
          "Access tokens and other credentials are encrypted at rest with AES-256-GCM. Every workspace's data is kept separate, each action checks the user's role, and connections use HTTPS. No system is completely secure, so we cannot promise absolute security.",
        ),
      ],
    },
    {
      id: "rights",
      title: "Your choices and rights",
      blocks: [
        p(
          `You can see and update your account details in ${name}, disconnect accounts at any time, and ask us for a copy of your data, to correct it, or to delete it. Depending on where you live (for example the European Union, the United Kingdom or California), you may also object to or restrict its processing, take it elsewhere, and complain to your data protection authority. We will honor these rights. To make a request, contact us using the details below.`,
        ),
      ],
    },
    {
      id: "children",
      title: "Children",
      blocks: [
        p(
          `${name} is a business tool and is not for anyone under 18. We do not knowingly collect information from children.`,
        ),
      ],
    },
    {
      id: "transfers",
      title: "Where your information is processed",
      blocks: [
        p(
          "Our providers may process your information in the United States, the European Union and other countries. Where required, transfers are covered by appropriate safeguards such as standard contractual clauses.",
        ),
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        p(
          `We may update this policy and will change the date at the top when we do. If the changes are significant, we will tell workspace owners in ${name} or by email before they take effect.`,
        ),
      ],
    },
  ],
};

/* ------------------------------------------------------------------------ */
/* Cookie policy                                                             */
/* ------------------------------------------------------------------------ */

export const cookiePolicy: LegalDocument = {
  title: "Cookie policy",
  description: `The cookies and browser storage ${name} uses, why, and how to control them.`,
  intro: `This Cookie Policy explains which small items ${operator} ("${name}", "we", "us") keeps in your browser when you use ${siteUrl}, why, and how you can control them. It is part of our Privacy Policy (${url(siteConfig.links.privacy)}).`,
  sections: [
    {
      id: "what",
      title: "What cookies and browser storage are",
      blocks: [
        p(
          "Cookies are small text files a website saves in your browser. Local storage is a similar space in your browser that a website can use to remember settings. Both stay on your device.",
        ),
      ],
    },
    {
      id: "needed",
      title: "Needed to make the service work",
      blocks: [
        p(
          `These are set only when you sign in or connect an account. Without them, ${name} cannot keep you signed in or connect your accounts safely.`,
        ),
        list(
          "Sign-in (better-auth.session_token, and short-lived companion cookies during sign-in and two-factor verification): keeps you signed in between pages and visits. Lasts up to 7 days and is renewed while you use the app; removed when you sign out.",
          "Account connection (tc_oauth_shopify, tc_oauth_tiktok_ads, tc_oauth_tiktok_login): protects the connection of a Shopify store or TikTok account against forgery. Lasts 10 minutes and is deleted as soon as the connection finishes.",
        ),
      ],
    },
    {
      id: "preferences",
      title: "Remembering your choices",
      blocks: [
        list(
          "Active brand (cookie tc_active_brand): remembers which brand you last selected in the app, so you land on it next time. Lasts 1 year.",
          "Theme (local storage key theme): remembers whether you chose the light or dark theme. Kept until you clear it.",
          "Announcement (local storage keys starting with tc:announcement-dismissed:): remembers that you closed the announcement bar on our website. Kept until you clear it.",
        ),
        p("These items hold only the choice itself, nothing else about you."),
      ],
    },
    {
      id: "not-used",
      title: "What we do not use",
      blocks: [
        p(
          `We do not use advertising, analytics or social media cookies, and we do not let other companies track you on ${name}. Because we only use items that are needed for the service or that remember a choice you made, we do not show a cookie banner.`,
        ),
        p(
          "When you connect a Shopify store or a TikTok account, you are sent to Shopify's or TikTok's own website, which sets its own cookies. Their cookie and privacy policies cover those.",
        ),
      ],
    },
    {
      id: "control",
      title: "How to control them",
      blocks: [
        p(
          "You can see, clear or block cookies and local storage in your browser settings at any time. If you block the sign-in cookie, you will not be able to stay signed in, and if you block the connection cookies, you will not be able to connect Shopify or TikTok accounts.",
        ),
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        p(
          "If we add a new cookie or storage item, we will update this page and the date at the top before we use it. If we ever want to use one that is not needed for the service, we will ask for your consent first.",
        ),
      ],
    },
  ],
};
