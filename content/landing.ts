/**
 * All landing copy, pricing, FAQ and nav links (owned by tc-copywriter).
 * Brand name and tagline come from `siteConfig` — never hardcode them here.
 *
 * Copy rules (context.md §4): no invented customers, testimonials, user counts,
 * revenue or performance stats. Third-party brands appear only as integrations.
 */
import { siteConfig } from "@/config/site";

import type { LandingContent } from "./types";

const name = siteConfig.name;

export const landing = {
  announcement: {
    id: "early-access-v1",
    message: `${name} is in early access.`,
    link: { label: "Join the waitlist", href: siteConfig.links.signUp },
    dismissLabel: "Dismiss announcement",
  },

  nav: {
    ariaLabel: "Main",
    links: [
      { label: "Product", href: "#product" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
    signIn: { label: "Sign in", href: siteConfig.links.signIn },
    getStarted: { label: "Get started", href: siteConfig.links.signUp },
    skipToContentLabel: "Skip to content",
    openMenuLabel: "Open menu",
    closeMenuLabel: "Close menu",
    themeToggleLabel: "Toggle color theme",
  },

  hero: {
    eyebrow: "TikTok → Shopify → TikTok Ads",
    title: ["From a TikTok post", "to a launch-ready campaign."],
    subline: `Paste a TikTok link and, in minutes, ${name} identifies the product, finds the supplier, drafts the Shopify page and prepares the ad campaign, with nothing launching until you approve.`,
    primaryCta: { label: "Get started", href: siteConfig.links.signUp },
    secondaryCta: { label: "See how it works →", href: "#how-it-works" },
    trustBullets: [
      { icon: "ShieldCheck", label: "Human approval before every launch" },
      { icon: "Store", label: "Multi-store, multi-account" },
      { icon: "CloudOff", label: "No videos stored on our servers" },
    ],
    pipeline: {
      ariaLabel: `Sample ${name} pipeline: a TikTok link becomes an identified product, a supplier match with margin, a Shopify draft page and a paused ad campaign waiting for approval.`,
      pauseLabel: "Pause animation",
      playLabel: "Play animation",
      states: [
        { id: "import", label: "Paste link", description: "Paste a TikTok link." },
        {
          id: "identify",
          label: "Identify",
          description: "AI identifies the product and its key features.",
        },
        {
          id: "source",
          label: "Source",
          description: "A supplier match with price and computed margin.",
        },
        {
          id: "page",
          label: "Draft page",
          description: "A Shopify draft page with variants.",
        },
        {
          id: "campaign",
          label: "Campaign",
          description: "A campaign created as Paused, ready for you to approve and launch.",
        },
      ],
    },
  },

  integrations: {
    label: "Works with",
    items: [
      { id: "shopify", name: "Shopify" },
      { id: "tiktok", name: "TikTok" },
      { id: "tiktok-ads", name: "TikTok Ads" },
      { id: "claude", name: "Claude" },
      { id: "chatgpt", name: "ChatGPT" },
      { id: "gemini", name: "Gemini" },
      { id: "perplexity", name: "Perplexity" },
    ],
    disclaimer:
      "Product names and logos belong to their owners. Their use does not imply partnership or endorsement.",
    pauseLabel: "Pause logo animation",
    playLabel: "Play logo animation",
  },

  why: {
    eyebrow: `Why ${name}`,
    title: ["Less setup,", "more tests that matter."],
    description:
      "Testing a product means jumping between TikTok, supplier sites, Shopify and Ads Manager. One workflow replaces the tab juggling.",
    flowAriaLabel: `Diagram: a TikTok post goes into ${name}, which prepares a Shopify draft page and a paused TikTok Ads campaign.`,
    pillars: [
      {
        icon: "Timer",
        title: "Save hours per product",
        description:
          "Research, sourcing, page building and campaign setup run in one flow. You review the result instead of building it by hand.",
      },
      {
        icon: "LayoutGrid",
        title: "One place for every store and ad account",
        description:
          "Group Shopify stores, TikTok profiles and ad accounts by brand. Switch brands without logging in and out.",
      },
      {
        icon: "Hand",
        title: "You stay in control",
        description:
          "Pages are created as drafts and campaigns as paused. Nothing goes live until you approve it.",
      },
    ],
  },

  howItWorks: {
    eyebrow: "How it works",
    title: ["Six steps.", "Four checkpoints that stay yours."],
    description:
      "The busywork is automated. Every decision that costs money or goes public waits for you.",
    approvalBadgeLabel: "Your approval",
    approvalLegend:
      "Steps marked “Your approval” pause until you confirm. Nothing moves past them on its own.",
    steps: [
      {
        id: "import",
        title: "Import",
        description:
          "Paste a TikTok link or a product URL. You can also search for TikTok videos that feature a product.",
        approval: null,
      },
      {
        id: "identify",
        title: "Identify",
        description:
          "AI detects the product and lists its key selling points. You confirm it is the right product before anything else happens.",
        approval: "Product confirmed",
      },
      {
        id: "source",
        title: "Source",
        description:
          "Matching listings are found online with images, prices and details. You pick the supplier and price, and the margin is calculated for you.",
        approval: "Supplier and price chosen",
      },
      {
        id: "build-page",
        title: "Build the page",
        description:
          "A product page is generated from your store’s own template, with variants, prices and photos. It is saved in Shopify as a draft.",
        approval: null,
      },
      {
        id: "prepare-videos",
        title: "Prepare videos",
        description:
          "Videos of the same product are collected and checked against TikTok ad rules. You approve the page and choose which videos to use.",
        approval: "Page and videos approved",
      },
      {
        id: "create-campaign",
        title: "Create the campaign",
        description:
          "The campaign, ad groups and ads are created in TikTok Ads Manager, all paused. They launch only when you approve.",
        approval: "Launch approved",
      },
    ],
  },

  features: {
    eyebrow: "Features",
    title: ["Every step of a product test,", "in one workflow."],
    items: [
      {
        id: "product-identification",
        eyebrow: "AI product identification",
        title: ["Know what’s in the video", "before you spend a cent."],
        description:
          "Drop in a TikTok link and AI names the product, pulls out its selling points and shows how confident it is. You confirm the match before moving on.",
        link: { label: "See the workflow", href: "#how-it-works" },
      },
      {
        id: "supplier-margin",
        eyebrow: "Supplier & margin",
        title: ["Compare suppliers.", "See the margin up front."],
        description:
          "Matching listings are lined up with prices, images and details. Set your selling price, cost, shipping and fees, and the margin updates as you go.",
        link: { label: "See the plans", href: "#pricing" },
      },
      {
        id: "shopify-page",
        eyebrow: "Shopify page",
        title: ["Your template.", "Your store. A draft to review."],
        description:
          "Product pages are built from your store’s existing template, with variants, price and compare-at price filled in. Every page is created as a draft, so nothing is published without you.",
        link: { label: "Which themes work", href: "#faq" },
      },
      {
        id: "video-compliance",
        eyebrow: "Video library & compliance",
        title: ["Find more videos.", "Catch issues before review."],
        description:
          "Videos of the same product are gathered and checked for format, length and risky claims against TikTok ad rules. Candidate videos are never stored on our servers.",
        link: { label: "How video data is handled", href: "#faq" },
      },
      {
        id: "ads-builder",
        eyebrow: "TikTok Ads builder",
        title: ["A full campaign,", "paused until you say go."],
        description:
          "The campaign, ad groups and ads are created in TikTok Ads Manager, all paused. A pre-launch checklist runs first, and only your approval launches it.",
        link: { label: "See the approval steps", href: "#how-it-works" },
      },
      {
        id: "tiktok-posting",
        eyebrow: "TikTok posting",
        title: ["Post approved videos", "to your connected profiles."],
        description:
          "Schedule selected videos to the TikTok profiles you connect, within TikTok’s publishing permissions. You choose what goes out and when.",
        link: { label: "About TikTok permissions", href: "#faq" },
      },
    ],
  },

  multiStore: {
    eyebrow: "Multi-store & teams",
    title: ["Every brand, store and account.", "One workspace."],
    description:
      "Connect Shopify stores from different Shopify accounts, plus TikTok profiles and ad accounts, and group them by brand.",
    cards: [
      {
        id: "brands",
        title: "Switch brands in one click",
        description:
          "Each brand keeps its own stores, profiles and ad accounts. Switching brands switches the whole context.",
      },
      {
        id: "connections",
        title: "See every connection’s health",
        description:
          "Stores, TikTok profiles and ad accounts are listed with their status, so you spot an expired connection before it blocks a launch.",
      },
      {
        id: "proxy",
        title: "Optional proxy per brand",
        description:
          "Assign a proxy to a brand or environment when you need one. Leave it off when you don’t.",
      },
      {
        id: "team",
        title: "Invite your team with roles",
        description:
          "Add teammates to the workspace and give each one a role. Control who can prepare work and who can approve it.",
      },
    ],
    statusLegend: { connected: "Connected", attention: "Needs attention", error: "Disconnected" },
  },

  security: {
    eyebrow: "Control & security",
    title: ["Built so nothing", "happens behind your back."],
    cards: [
      {
        id: "approval",
        icon: "ShieldCheck",
        title: "Nothing launches without approval",
        description:
          "Pages stay drafts and campaigns stay paused until you approve them. Four checkpoints, every time.",
      },
      {
        id: "no-video-storage",
        icon: "CloudOff",
        title: "No videos stored",
        description:
          "We keep links, IDs and metadata only. Approved videos live on your Shopify store and on TikTok, never on our servers.",
      },
      {
        id: "encrypted-tokens",
        icon: "KeyRound",
        title: "Encrypted account tokens",
        description: "Access tokens for Shopify and TikTok are encrypted at rest.",
      },
      {
        id: "isolated-workspaces",
        icon: "Boxes",
        title: "Isolated workspaces",
        description:
          "Every piece of data belongs to one workspace. One workspace can never read another’s data.",
      },
      {
        id: "roles-2fa",
        icon: "UserCog",
        title: "Roles & 2FA",
        description:
          "Give each teammate the access they need, and protect sign-in with two-factor authentication.",
      },
      {
        id: "activity-pace",
        icon: "Gauge",
        title: "Limited, adjustable activity pace",
        description:
          "Actions on connected accounts run at a measured pace by default. You can adjust it per brand.",
      },
    ],
  },

  pricing: {
    eyebrow: "Pricing",
    title: ["Simple plans.", "Pick the one that fits your stores."],
    description: "Every plan includes the full workflow and all four approval checkpoints.",
    currency: "USD",
    currencySymbol: "$",
    billing: {
      toggleLabel: "Billing period",
      monthlyLabel: "Monthly",
      yearlyLabel: "Yearly",
      yearlyBadge: "2 months free",
      perMonthSuffix: "/month",
      perMonthSrLabel: "per month",
      billedYearlyNote: "billed yearly",
    },
    // TODO: confirm pricing with client
    plans: [
      {
        id: "starter",
        name: "Starter",
        description: "For solo operators testing their first products.",
        price: { monthly: 29, yearly: 290 },
        limits: [
          { id: "stores", label: "Brands / stores", value: "1 brand, 1 store" },
          { id: "seats", label: "Team seats", value: "1" },
          { id: "products", label: "Products per month", value: "25" },
        ],
        features: [
          "AI product identification",
          "Supplier matching and margin calculator",
          "Shopify draft pages from your template",
          "Video compliance check",
          "Paused campaign builder",
          "4 approval checkpoints",
        ],
        cta: { label: "Start with Starter", href: siteConfig.links.signUp },
        highlighted: false,
      },
      {
        id: "growth",
        name: "Growth",
        description: "For operators running several stores with a small team.",
        price: { monthly: 79, yearly: 790 },
        limits: [
          { id: "stores", label: "Brands / stores", value: "3 brands, 5 stores" },
          { id: "seats", label: "Team seats", value: "5" },
          { id: "products", label: "Products per month", value: "150" },
        ],
        features: [
          "Everything in Starter",
          "Multiple stores, TikTok profiles and ad accounts",
          "TikTok posting to connected profiles",
          "Team roles and permissions",
          "Optional proxy per brand",
        ],
        cta: { label: "Start with Growth", href: siteConfig.links.signUp },
        highlighted: true,
        badge: "Most popular",
      },
      {
        id: "scale",
        name: "Scale",
        description: "For teams managing many brands and ad accounts.",
        price: { monthly: 199, yearly: 1990 },
        limits: [
          { id: "stores", label: "Brands / stores", value: "10 brands, 25 stores" },
          { id: "seats", label: "Team seats", value: "15" },
          { id: "products", label: "Products per month", value: "500" },
        ],
        features: [
          "Everything in Growth",
          "Adjustable activity pace per brand",
          "Two-factor authentication required for the whole team",
          "Priority support",
        ],
        cta: { label: "Start with Scale", href: siteConfig.links.signUp },
        highlighted: false,
      },
    ],
    enterprise: {
      title: "Enterprise / custom",
      description:
        "Need more brands, seats or products, or a custom setup? We’ll put together a plan for you.",
      cta: { label: "Talk to us", href: siteConfig.links.signUp },
    },
    footnote: "Prices in USD. Yearly billing is 10× the monthly price: 2 months free.",
  },

  faq: {
    eyebrow: "FAQ",
    title: ["Questions,", "answered."],
    items: [
      {
        id: "what-it-does",
        question: `What does ${name} do?`,
        answer: `${name} takes a TikTok post or a product link and prepares everything needed to test the product: it identifies the product, finds suppliers and computes your margin, drafts a Shopify product page from your template, checks videos against TikTok ad rules and builds a paused TikTok ad campaign.`,
      },
      {
        id: "auto-launch",
        question: "Does it launch ads automatically?",
        answer:
          "No. Campaigns, ad groups and ads are created paused, and product pages are created as drafts. Nothing launches or goes live without your explicit approval. There are 4 approval checkpoints in every run.",
      },
      {
        id: "shopify-themes",
        question: "Which Shopify themes work?",
        answer:
          "Themes built on Online Store 2.0 templates. The product page is generated from your store’s existing product template, so it matches the rest of your store.",
      },
      {
        id: "multiple-accounts",
        question: "Can I connect multiple stores and accounts?",
        answer:
          "Yes. One workspace can hold several Shopify stores, even from different Shopify accounts, plus TikTok profiles and TikTok ad accounts. You group them by brand and invite teammates with roles. Limits depend on your plan.",
      },
      {
        id: "video-storage",
        question: "Are videos stored on your servers?",
        answer:
          "No. We store only links, IDs and metadata. Videos you approve are hosted on your Shopify store as product media and on TikTok. Candidate videos are never stored.",
      },
      {
        id: "tiktok-permissions",
        question: "What permissions does it need on TikTok?",
        answer: `You connect your TikTok profiles and ad accounts through TikTok’s own authorization flow. ${name} only acts within the permissions you grant, and posts only within TikTok’s publishing permissions. You can disconnect an account at any time.`,
      },
      {
        id: "ai-models",
        question: "Which AI models do you use?",
        answer: `${name} uses Claude, ChatGPT, Gemini and Perplexity internally, picking the model that suits each task, such as product identification or online research. These are integrations only; their names do not imply partnership or endorsement.`,
      },
      {
        id: "data-security",
        question: "How is my data protected?",
        answer:
          "Account tokens are encrypted, every workspace is isolated from the others, and access is controlled with roles and two-factor authentication. Activity on connected accounts runs at a limited pace that you can adjust.",
      },
    ],
  },

  finalCta: {
    title: ["Your next winner is already trending.", "Get it to the cart."],
    description:
      "Go from a TikTok post to a paused, launch-ready campaign. You approve every step that matters.",
    primaryCta: { label: "Get started", href: siteConfig.links.signUp },
    secondaryCta: { label: "See how it works", href: "#how-it-works" },
  },

  footer: {
    // TODO: Resources, Company and Legal pages don't exist yet; replace "#" hrefs when they do.
    columns: [
      {
        title: "Product",
        links: [
          { label: "How it works", href: "#how-it-works" },
          { label: "Features", href: "#features" },
          { label: "Pricing", href: "#pricing" },
          { label: "FAQ", href: "#faq" },
        ],
      },
      {
        title: "Resources",
        links: [
          { label: "Guides", href: "#" },
          { label: "Changelog", href: "#" },
          { label: "Help center", href: "#" },
        ],
      },
      {
        title: "Company",
        links: [
          { label: "About", href: "#" },
          { label: "Contact", href: "#" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Privacy policy", href: "#" },
          { label: "Terms of service", href: "#" },
          { label: "Cookie policy", href: "#" },
        ],
      },
    ],
    newsletter: {
      title: "Product updates",
      description: "Occasional news on new features and early access. No spam.",
      inputLabel: "Email address",
      placeholder: "you@store.com",
      submitLabel: "Subscribe",
      // Phase 1 has no backend: be honest that nothing was saved.
      successMessage:
        "Thanks for your interest. Sign-up isn’t open yet, so your email wasn’t saved.",
    },
    socialsLabel: "Social links",
    legalNote: "All rights reserved.",
  },
} satisfies LandingContent;
