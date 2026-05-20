"use client";

/**
 * CompetitionView — the live "Vibhu vs Drew" trading-challenge page.
 *
 * Standalone, public view (no wallet/login needed — these are public read
 * endpoints). Renders a header, then the two competitor cards stacked. Data is
 * live via `useChallengeData` (20s auto-refresh).
 *
 * OWNED BY: Competition feature (`src/competition/`).
 */

import Link from "next/link";
import { CompetitorCard } from "./CompetitorCard";
import { useChallengeData, type ChallengeData } from "./useChallengeData";

export function CompetitionView() {
  const { data, isLoading, isError, refetch } = useChallengeData();

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <Header />
      <main className="flex flex-col gap-4 p-3">
        {isLoading ? (
          <ChallengeSkeleton />
        ) : isError || !data ? (
          <ErrorCard onRetry={() => refetch()} />
        ) : (
          <ChallengeBody data={data} />
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Header() {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-3">
      <Link
        href="/trade/SOL"
        className="-ml-1 flex h-7 w-7 items-center justify-center rounded-md text-fg-muted active:bg-bg-muted"
        aria-label="Back to markets"
      >
        <span className="text-lg leading-none">‹</span>
      </Link>
      <div className="flex flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          Challenge
        </span>
        <h1 className="text-base font-semibold text-fg">
          Vibhu <span className="text-fg-subtle">vs</span> Drew
        </h1>
      </div>
    </header>
  );
}

function ChallengeBody({ data }: { data: ChallengeData }) {
  const { leader, gap, competitors } = data;
  const tied = gap < 0.005;

  return (
    <>
      {/* Competitor cards, stacked */}
      <div className="flex flex-col gap-3">
        {competitors.map((c) => (
          <CompetitorCard
            key={c.id}
            competitor={c}
            isLeader={!tied && c.id === leader.id}
          />
        ))}
      </div>

      <p className="px-1 pb-4 text-center text-[10px] leading-relaxed text-fg-subtle">
        Both traders started from an assumed $10,000 baseline on Phoenix perps.
        Returns are computed against that baseline. Net PnL is realized PnL
        minus fees from on-chain trade history.
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function ChallengeSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl bg-bg-elevated p-4">
          <div className="h-4 w-24 rounded bg-bg-muted" />
          <div className="h-9 w-40 rounded bg-bg-muted" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="h-8 rounded bg-bg-muted" />
            ))}
          </div>
          <div className="h-9 rounded bg-bg-muted" />
        </div>
      ))}
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-down/40 bg-down-bg px-6 py-10 text-center">
      <p className="text-sm font-medium text-fg">
        Could not load the challenge.
      </p>
      <p className="max-w-xs text-xs text-fg-muted">
        The Phoenix data feed did not respond. Check your connection and try
        again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-md border border-border px-4 py-2 text-xs font-semibold text-fg active:bg-bg-muted"
      >
        Retry
      </button>
    </div>
  );
}
