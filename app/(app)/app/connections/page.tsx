import { Building2Icon, MegaphoneIcon, StoreIcon, UserRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { HealthBadge } from "@/components/app/badges";
import { CallbackBanners } from "@/components/app/connections/callback-banner";
import { DisconnectButton } from "@/components/app/connections/disconnect-button";
import { ProxyPanel } from "@/components/app/connections/proxy-panel";
import {
  ShopifyCustomConnectForm,
  ShopifyPublicConnectForm,
} from "@/components/app/connections/shopify-connect";
import { TemplateForm } from "@/components/app/connections/template-form";
import { formatDateTime } from "@/components/app/format";
import { ListSkeleton, PageSkeleton, Section } from "@/components/app/surface";
import { Button } from "@/components/ui/button";
import { can, type Role } from "@/lib/auth/permissions";
import { listConnections } from "@/lib/services";
import type { BrandDTO, ConnectionHealth } from "@/lib/services/types";

import { getPageContext } from "../_lib/page-context";
import {
  clearProxyAction,
  disconnectAction,
  listTemplatesAction,
  setProxyAction,
  setTemplateAction,
  toggleProxyAction,
} from "./actions";

export const metadata: Metadata = { title: "Connections" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Session reads stay behind Suspense so the route keeps a static shell.
export default function ConnectionsPage(props: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ConnectionsContent {...props} />
    </Suspense>
  );
}

async function ConnectionsContent({ searchParams }: { searchParams: SearchParams }) {
  const [params, { role, activeBrand, brands }] = await Promise.all([
    searchParams,
    getPageContext(),
  ]);

  if (!activeBrand) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Connections" />
        <CallbackBanners params={params} />
        <EmptyState
          icon={Building2Icon}
          title="Add a brand first"
          description="Stores, TikTok accounts and proxies are connected per brand."
          action={
            can(role, "brand:create") ? (
              <Button asChild size="lg">
                <Link href="/app/onboarding">Add a brand</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Connections"
        description={
          <>
            Stores and TikTok accounts for{" "}
            <span className="text-foreground">{activeBrand.name}</span>
            {brands.length > 1 ? ". Switch brand in the sidebar." : "."}
          </>
        }
      />
      <CallbackBanners params={params} />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <BrandConnections brand={activeBrand} role={role} />
      </Suspense>
      <Section
        id="proxy"
        title="Proxy"
        description="Optional. Routes this brand's TikTok data and scraping requests through your proxy."
      >
        <ProxyPanel
          key={`${activeBrand.id}:${activeBrand.proxy.updatedAt ?? "none"}`}
          proxy={activeBrand.proxy}
          canEdit={can(role, "connection:update")}
          onSet={setProxyAction.bind(null, activeBrand.id)}
          onToggle={toggleProxyAction.bind(null, activeBrand.id)}
          onClear={clearProxyAction.bind(null, activeBrand.id)}
        />
      </Section>
    </div>
  );
}

function Row({
  icon,
  title,
  meta,
  health,
  healthReason,
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  health: ConnectionHealth;
  healthReason: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="grid gap-4 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{title}</p>
            <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <HealthBadge health={health} />
              <span className="text-xs text-muted-foreground">{healthReason}</span>
            </div>
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-1 sm:justify-end">{actions}</div>
        ) : null}
      </div>
      {children}
    </li>
  );
}

function ConnectLink({
  href,
  children,
  variant = "outline",
}: {
  href: string;
  children: ReactNode;
  variant?: "outline" | "default";
}) {
  // Full navigation: the API route redirects to the provider.
  return (
    <Button asChild variant={variant} size="sm">
      <a href={href}>{children}</a>
    </Button>
  );
}

async function BrandConnections({ brand, role }: { brand: BrandDTO; role: Role }) {
  const { ctx } = await getPageContext();
  const data = await listConnections(ctx, brand.id);
  const canCreate = can(role, "connection:create");
  const canUpdate = can(role, "connection:update");
  const canDelete = can(role, "connection:delete");
  const q = `brandId=${encodeURIComponent(brand.id)}`;

  return (
    <>
      <Section
        id="shopify"
        title="Shopify store"
        description="Product pages are created as drafts on this store, using its theme template."
      >
        <div className="grid gap-4">
          {data.shopify.length > 0 ? (
            <ul className="grid gap-3" aria-label="Shopify stores">
              {data.shopify.map((c) => (
                <Row
                  key={c.id}
                  icon={<StoreIcon aria-hidden="true" className="size-4" />}
                  title={c.shopDomain}
                  meta={
                    <>
                      {c.appMode === "custom" ? "Custom app" : "Public app"} · Updated{" "}
                      {formatDateTime(c.updatedAt)}
                    </>
                  }
                  health={c.health}
                  healthReason={c.healthReason}
                  actions={
                    <>
                      {canCreate && c.appMode === "public" ? (
                        <ConnectLink
                          href={`/api/shopify/install?${q}&shop=${encodeURIComponent(c.shopDomain)}`}
                        >
                          Reconnect
                        </ConnectLink>
                      ) : null}
                      {canDelete && c.status !== "disconnected" ? (
                        <DisconnectButton
                          label={c.shopDomain}
                          consequence="Draft pages already on the store stay there; Trendcart can no longer create or update pages."
                          onDisconnect={disconnectAction.bind(null, "shopify", c.id)}
                        />
                      ) : null}
                    </>
                  }
                >
                  {c.status !== "disconnected" ? (
                    <TemplateForm
                      connectionId={c.id}
                      current={c.templateSuffix}
                      canEdit={canUpdate}
                      onLoad={listTemplatesAction.bind(null, c.id)}
                      onSave={setTemplateAction.bind(null, c.id)}
                    />
                  ) : null}
                  {canCreate && c.appMode === "custom" ? (
                    <details className="rounded-lg border border-border">
                      <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Reconnect with custom app credentials
                      </summary>
                      <div className="px-3 pb-3">
                        <ShopifyCustomConnectForm
                          brandId={brand.id}
                          shop={c.shopDomain}
                          idPrefix={`reconnect-${c.id}`}
                          submitLabel="Reconnect"
                        />
                      </div>
                    </details>
                  ) : null}
                </Row>
              ))}
            </ul>
          ) : (
            <EmptyState
              as="h3"
              icon={StoreIcon}
              title="No store connected"
              description="Connect the Shopify store this brand sells on."
              className="py-8"
            />
          )}
          {canCreate ? (
            <div className="grid gap-3 rounded-xl border border-border p-4">
              <h3 className="text-sm font-medium">
                {data.shopify.length > 0 ? "Connect another store" : "Connect a store"}
              </h3>
              <ShopifyPublicConnectForm brandId={brand.id} />
              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Use a custom app from the store&apos;s admin instead
                </summary>
                <div className="px-3 pb-3">
                  <ShopifyCustomConnectForm brandId={brand.id} />
                </div>
              </details>
            </div>
          ) : (
            <ReadOnlyNote />
          )}
        </div>
      </Section>

      <Section
        id="tiktok-ads"
        title="TikTok ad accounts"
        description="Campaigns are created paused in these advertiser accounts."
        actions={
          canCreate ? (
            <ConnectLink href={`/api/tiktok/ads/connect?${q}`} variant="default">
              {data.tiktokAds.length > 0 ? "Add or reconnect" : "Connect TikTok Ads"}
            </ConnectLink>
          ) : undefined
        }
      >
        {data.tiktokAds.length > 0 ? (
          <ul className="grid gap-3" aria-label="TikTok ad accounts">
            {data.tiktokAds.map((c) => (
              <Row
                key={c.id}
                icon={<MegaphoneIcon aria-hidden="true" className="size-4" />}
                title={c.name}
                meta={
                  <>
                    <span className="font-mono">Advertiser {c.advertiserId}</span>
                    {" · "}
                    {c.currency ? (
                      <span>Billed in {c.currency}</span>
                    ) : (
                      <span className="text-warning">
                        Currency unknown: reconnect before using it for a campaign
                      </span>
                    )}
                  </>
                }
                health={c.health}
                healthReason={c.healthReason}
                actions={
                  <>
                    {canCreate && (c.health !== "green" || !c.currency) ? (
                      <ConnectLink href={`/api/tiktok/ads/connect?${q}`}>Reconnect</ConnectLink>
                    ) : null}
                    {canDelete && c.status !== "disconnected" ? (
                      <DisconnectButton
                        label={c.name}
                        consequence="Existing campaigns keep running in TikTok Ads Manager; Trendcart can no longer create, launch or read stats for them."
                        onDisconnect={disconnectAction.bind(null, "tiktok_ads", c.id)}
                      />
                    ) : null}
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            as="h3"
            icon={MegaphoneIcon}
            title="No ad account connected"
            description="Connect TikTok For Business to pick the advertiser accounts for this brand."
            className="py-8"
          />
        )}
        {!canCreate ? <ReadOnlyNote className="mt-4" /> : null}
      </Section>

      <Section
        id="tiktok-profiles"
        title="TikTok profiles"
        description="Approved videos can be posted to these profiles. Posts stay private until TikTok's app audit is passed."
        actions={
          canCreate ? (
            <ConnectLink href={`/api/tiktok/login/connect?${q}`} variant="default">
              {data.tiktokProfiles.length > 0 ? "Add a profile" : "Connect a profile"}
            </ConnectLink>
          ) : undefined
        }
      >
        {data.tiktokProfiles.length > 0 ? (
          <ul className="grid gap-3" aria-label="TikTok profiles">
            {data.tiktokProfiles.map((c) => (
              <Row
                key={c.id}
                icon={<UserRoundIcon aria-hidden="true" className="size-4" />}
                title={c.displayName}
                meta={
                  <>
                    {c.postingMode === "direct" ? "Direct posting" : "Sends to TikTok inbox"}
                    {c.expiresAt ? <> · Token until {formatDateTime(c.expiresAt)}</> : null}
                  </>
                }
                health={c.health}
                healthReason={c.healthReason}
                actions={
                  <>
                    {canCreate && c.health !== "green" ? (
                      <ConnectLink href={`/api/tiktok/login/connect?${q}`}>Reconnect</ConnectLink>
                    ) : null}
                    {canDelete && c.status !== "disconnected" ? (
                      <DisconnectButton
                        label={c.displayName}
                        consequence="Videos already posted stay on TikTok; Trendcart can no longer post to this profile."
                        onDisconnect={disconnectAction.bind(null, "tiktok_profile", c.id)}
                      />
                    ) : null}
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            as="h3"
            icon={UserRoundIcon}
            title="No profile connected"
            description="Sign in with TikTok to post approved videos to a brand profile."
            className="py-8"
          />
        )}
        {!canCreate ? <ReadOnlyNote className="mt-4" /> : null}
      </Section>
    </>
  );
}

function ReadOnlyNote({ className }: { className?: string }) {
  return (
    <p className={["text-sm text-muted-foreground", className].filter(Boolean).join(" ")}>
      Connecting accounts needs the Media buyer role or higher.
    </p>
  );
}
