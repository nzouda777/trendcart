import {
  siClaude,
  siGooglegemini,
  siPerplexity,
  siShopify,
  siTiktok,
  type SimpleIcon,
} from "simple-icons";

import { Section } from "@/components/marketing/shared";
import { landing } from "@/content/landing";
import type { IntegrationId } from "@/content/types";

import { IntegrationsMarqueeTrack } from "./integrations-marquee-track";

/** Monochrome simple-icons; ids without an icon (ChatGPT: no OpenAI icon) render as text only. */
const integrationIcons: Partial<Record<IntegrationId, SimpleIcon>> = {
  shopify: siShopify,
  tiktok: siTiktok,
  "tiktok-ads": siTiktok,
  claude: siClaude,
  gemini: siGooglegemini,
  perplexity: siPerplexity,
};

function IntegrationLogo({ icon }: { icon: SimpleIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="size-5 shrink-0"
    >
      <path d={icon.path} />
    </svg>
  );
}

/** "Works with" strip. Brand names are integrations only — no endorsement implied. */
export function IntegrationsMarquee() {
  const { integrations } = landing;

  const list = (
    <ul className="flex items-center gap-x-10 pr-10 sm:gap-x-14 sm:pr-14">
      {integrations.items.map((item) => {
        const icon = integrationIcons[item.id];
        return (
          <li
            key={item.id}
            className="flex shrink-0 items-center gap-2.5 text-base font-medium whitespace-nowrap text-muted-foreground"
          >
            {icon ? <IntegrationLogo icon={icon} /> : null}
            <span>{item.name}</span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Section
      aria-labelledby="integrations-title"
      flush
      className="border-y bg-surface/40 py-8 md:py-10"
    >
      <div className="flex flex-col items-center gap-5 md:flex-row md:gap-8">
        <h2
          id="integrations-title"
          className="shrink-0 font-mono text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase"
        >
          {integrations.label}
        </h2>
        <IntegrationsMarqueeTrack
          className="w-full md:flex-1"
          list={list}
          pauseLabel={integrations.pauseLabel}
          playLabel={integrations.playLabel}
        />
      </div>
      {integrations.disclaimer ? (
        <p className="mt-5 text-center text-xs text-muted-foreground md:text-left">
          {integrations.disclaimer}
        </p>
      ) : null}
    </Section>
  );
}
