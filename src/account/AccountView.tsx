"use client";

/**
 * AccountView — the "Account" bottom-nav view of the trade screen.
 *
 * CONTRACT
 *  Props: none (reads the active trader from context).
 *  Behaviour (PLAN.md §7): account equity, balances, and a perps overview
 *  (balance, unrealized PNL, margin ratio, maintenance margin, account
 *  leverage). A clear "connect wallet" empty state when no wallet is
 *  connected. Renders CollateralActions.
 *  Rise SDK: `client.api.traders().getTraderState()` for the rich snapshot;
 *  live refresh via the WS `traderState` stream (see useTraderState).
 *  Wallet: `useWallet()` for the connected `authority`.
 *
 * OWNED BY: Account agent (`src/account/`).
 */

import { useRouter } from "next/navigation";
import { useWallet } from "@/wallet/WalletProvider";
import { shortenAddress } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CollateralActions } from "./CollateralActions";
import { useTraderState } from "./useTraderState";
import type { AccountOverview } from "./lib";

export function AccountView() {
  const { wallet } = useWallet();
  const authority =
    wallet?.isConnected && wallet.authority ? wallet.authority : undefined;

  const { overview, isLoading, isError, error, refetch } =
    useTraderState(authority);

  // --- Empty state: no wallet connected. ----------------------------------
  if (!authority) {
    return (
      <div className="flex flex-col gap-4 p-3">
        <ConnectWalletEmptyState />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="flex flex-col gap-2">
        <SectionHeading
          title="Equity & Balances"
          trailing={
            <span className="font-mono text-[11px] text-fg-subtle">
              {shortenAddress(authority)}
            </span>
          }
        />

        {isLoading ? (
          <AccountSkeleton />
        ) : isError ? (
          <ErrorCard
            message={error?.message ?? "Could not load account state."}
            onRetry={refetch}
          />
        ) : !overview ? (
          <NoTraderCard />
        ) : (
          <AccountSummary overview={overview} />
        )}
      </section>

      <CollateralActions onChanged={refetch} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Summary
 * ----------------------------------------------------------------------- */

function AccountSummary({ overview }: { overview: AccountOverview }) {
  const upnlColor =
    overview.unrealizedPnlSign > 0
      ? "text-up"
      : overview.unrealizedPnlSign < 0
        ? "text-down"
        : "text-fg";

  return (
    <div className="flex flex-col gap-4">
      {/* Hero: account equity. */}
      <div className="rounded-lg bg-bg-elevated p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            Account Equity
          </span>
          <HealthBadge riskState={overview.riskState} />
        </div>
        <div className="mt-1.5 font-mono text-3xl font-semibold tabular-nums text-fg">
          ${overview.portfolioValue}
        </div>
        <div className="mt-1 text-xs text-fg-subtle">
          Unrealized PNL{" "}
          <span className={cn("font-mono font-medium tabular-nums", upnlColor)}>
            ${overview.unrealizedPnl}
          </span>
        </div>
      </div>

      {/* Perps overview grid. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <StatCell label="Balance" value={`$${overview.collateralBalance}`} />
        <StatCell
          label="Effective Collateral"
          value={`$${overview.effectiveCollateral}`}
        />
        <StatCell
          label="Unrealized PNL"
          value={`$${overview.unrealizedPnl}`}
          valueClassName={upnlColor}
        />
        <StatCell label="Margin Ratio" value={overview.marginRatio} />
        <StatCell
          label="Maintenance Margin"
          value={`$${overview.maintenanceMargin}`}
        />
        <StatCell label="Account Leverage" value={overview.accountLeverage} />
        <StatCell
          label="Initial Margin"
          value={`$${overview.initialMargin}`}
        />
        <StatCell
          label="Open Positions"
          value={String(overview.openPositions)}
        />
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums text-fg",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function HealthBadge({ riskState }: { riskState: string }) {
  const healthy = riskState === "healthy";
  const zero = riskState === "zeroCollateralNoPositions";
  const label = healthy
    ? "Healthy"
    : zero
      ? "No Positions"
      : riskState === "unhealthy"
        ? "At Risk"
        : riskState === "underwater"
          ? "Underwater"
          : riskState;

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        healthy && "bg-up-bg text-up",
        zero && "bg-bg-muted text-fg-muted",
        !healthy && !zero && "bg-down-bg text-down",
      )}
    >
      {label}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * States
 * ----------------------------------------------------------------------- */

function ConnectWalletEmptyState() {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg bg-bg-elevated px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-fg">No wallet connected</h3>
      <p className="max-w-xs text-sm leading-snug text-fg-muted">
        Connect a wallet to view your account equity, balances, and perps
        overview, and to deposit or withdraw collateral.
      </p>
      <button
        type="button"
        onClick={() => router.push("/login")}
        className="mt-1 rounded-md bg-accent px-6 py-3 text-sm font-semibold text-accent-fg active:opacity-80"
      >
        Connect wallet
      </button>
    </div>
  );
}

function NoTraderCard() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg bg-bg-elevated px-6 py-10 text-center">
      <h3 className="text-sm font-semibold text-fg">No trader account yet</h3>
      <p className="max-w-xs text-xs leading-snug text-fg-muted">
        This wallet has no Phoenix perps account. Deposit collateral to get
        started.
      </p>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-down/40 bg-down-bg px-6 py-8 text-center">
      <p className="text-sm font-medium text-fg">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-fg active:bg-bg-muted"
      >
        Retry
      </button>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="h-[104px] rounded-lg bg-bg-elevated" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 rounded bg-bg-elevated" />
        ))}
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  trailing,
}: {
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {title}
      </h2>
      {trailing}
    </div>
  );
}
