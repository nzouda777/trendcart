import { CalendarClock, Check } from "lucide-react";
import { siTiktok } from "simple-icons";

import { cn } from "@/lib/utils";

import { demoProfiles, demoVideos } from "./data";
import { MockupFrame } from "./mockup-frame";
import { FakeButton, PanelLabel, VideoPoster } from "./primitives";
import { StatusBadge } from "./status";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Day indexes with a scheduled post (matches demoProfiles slots). */
const scheduledDays = new Set([1, 2]);

export type TiktokPostingMockupProps = { className?: string };

/** Post scheduler: one approved video queued to connected TikTok profiles. */
export function TiktokPostingMockup({ className }: TiktokPostingMockupProps) {
  const video = demoVideos[0];
  return (
    <MockupFrame
      className={className}
      title="Publish"
      label="TikTok post scheduler: an approved video queued for two connected TikTok profiles on Tuesday and Wednesday, with a third profile left as a draft."
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <PanelLabel className="flex items-center gap-1.5">
            <CalendarClock className="size-3" /> Schedule post
          </PanelLabel>
          <StatusBadge tone="success">Video approved</StatusBadge>
        </div>

        <div className="flex gap-3 rounded-lg border border-border bg-surface-2/50 p-2.5">
          <VideoPoster
            photo={video.poster}
            duration={video.duration}
            sizes="64px"
            className="aspect-[9/14] w-14 shrink-0 sm:w-16"
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Caption</p>
            <p className="line-clamp-2 text-xs">
              Movie night on the ceiling. Glow Mini Projector, now in Demo Store. #homedecor
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">{video.id} · 9:16</p>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((d, i) => (
            <div
              key={d}
              className={cn(
                "rounded-md border py-1 text-center text-[10px]",
                scheduledDays.has(i)
                  ? "border-brand-border bg-brand-soft font-medium text-brand-text"
                  : "border-border text-muted-foreground",
              )}
            >
              {d}
              <span
                className={cn(
                  "mx-auto mt-1 block size-1 rounded-full",
                  scheduledDays.has(i) ? "bg-brand" : "bg-transparent",
                )}
              />
            </div>
          ))}
        </div>

        <ul className="space-y-1.5">
          {demoProfiles.map((p) => {
            const on = p.status === "Scheduled";
            return (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[11px] sm:text-xs"
              >
                <span
                  className={cn(
                    "grid size-3.5 shrink-0 place-items-center rounded-[4px] border",
                    on ? "border-brand bg-brand text-brand-foreground" : "border-border-strong",
                  )}
                >
                  {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-3.5 shrink-0 fill-current"
                >
                  <path d={siTiktok.path} />
                </svg>
                <span className="min-w-0 flex-1 truncate">{p.handle}</span>
                <span className="font-mono text-muted-foreground">{p.slot}</span>
                <StatusBadge tone={on ? "success" : "neutral"} className="hidden sm:inline-flex">
                  {p.status}
                </StatusBadge>
              </li>
            );
          })}
        </ul>

        <div className="flex justify-end gap-2">
          <FakeButton>Save draft</FakeButton>
          <FakeButton variant="primary">Schedule 2 posts</FakeButton>
        </div>
      </div>
    </MockupFrame>
  );
}
