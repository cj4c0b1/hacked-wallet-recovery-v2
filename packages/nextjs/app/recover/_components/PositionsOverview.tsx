"use client";

import externalContracts from "~~/contracts/externalContracts";
import type { ZerionPositionsView, ZerionPositionsViewGroup, ZerionPositionsViewRow } from "~~/utils/recovery/zerion";

const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

const SUPPORTED_CHAIN_IDS = new Set(
  Object.keys(externalContracts)
    .map(Number)
    .filter((x): x is number => Number.isFinite(x)),
);

function fmtUsd(n: number) {
  return usd.format(n);
}

function fmtPct(n: number) {
  return `${n.toFixed(n >= 1 ? 1 : 2)}%`;
}

function fmtQuantity(row: ZerionPositionsViewRow) {
  const sym = row.tokenSymbol ? ` ${row.tokenSymbol}` : "";
  if (!row.quantityNumeric) return row.quantityText ?? "—";

  // quantityNumeric is a string like "220000.000000000000000000"
  const [intPartRaw, fracPartRaw] = row.quantityNumeric.split(".");
  const intPart = intPartRaw || "0";
  const fracPart = fracPartRaw || "";

  if (!fracPart) return `${intPart}${sym}`;

  const firstNonZero = fracPart.search(/[1-9]/);
  // Default to 6 decimals for readability, but if the first non-zero digit is far out,
  // show enough decimals so it doesn't look like zero.
  const desiredFracDigits =
    firstNonZero === -1 ? 0 : Math.min(fracPart.length, firstNonZero > 5 ? firstNonZero + 3 : 6);

  const fracShown = fracPart.slice(0, desiredFracDigits).replace(/0+$/g, "");
  return `${intPart}${fracShown ? `.${fracShown}` : ""}${sym}`.trim();
}

function chainLabel(chain: string) {
  if (!chain) return "Unknown";
  return chain.charAt(0).toUpperCase() + chain.slice(1);
}

function rowLabel(row: ZerionPositionsViewRow) {
  if (row.kind === "deposit") return "Deposited";
  if (row.kind === "loan") return "Debt";
  if (row.kind === "reward") return "Reward";
  if (row.kind === "wallet") return "Asset";
  return "Position";
}

function valueClass(row: ZerionPositionsViewRow) {
  return row.kind === "loan" ? "text-error" : "text-base-content";
}

function tokenKeyForRow(row: ZerionPositionsViewRow): string | null {
  if (!row.chainId) return null;
  if (row.standard === "native") return `native:${row.chainId}`;
  if (!row.contract) return null;
  return `erc20:${row.chainId}:${row.contract.toLowerCase()}`;
}

function GroupCard(props: {
  group: ZerionPositionsViewGroup;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
  showHeader?: boolean;
}) {
  const g = props.group;
  const showManage = Boolean(g.url);
  const selectable = Boolean(props.selectable && props.onToggleKey && props.selectedKeys);
  const showHeader = props.showHeader ?? true;

  const selectableKeys = g.rows.map(tokenKeyForRow).filter((x): x is string => Boolean(x));
  const selectedCount = selectable ? selectableKeys.filter(k => props.selectedKeys!.has(k)).length : 0;
  const totalSelectable = selectable ? selectableKeys.length : 0;

  return (
    <div className="rounded-3xl border border-base-300 bg-base-100">
      {showHeader ? (
        <div className="p-5 md:p-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-base-200 border border-base-300 overflow-hidden flex items-center justify-center shrink-0">
              {g.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.iconUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-4 h-4 rounded bg-base-300" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-semibold truncate">{g.title}</div>
                <div className="text-xs text-neutral bg-base-200 border border-base-300 rounded-full px-2 py-0.5 shrink-0">
                  {fmtPct(g.percentOfPortfolio)}
                </div>
              </div>
              <div className="text-sm text-neutral">
                {g.totalValueUsd < 0 ? "-" : ""}
                {fmtUsd(Math.abs(g.totalValueUsd))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {selectable ? (
              <div className="text-xs text-neutral bg-base-200 border border-base-300 rounded-full px-2 py-0.5">
                {selectedCount}/{totalSelectable} selected
              </div>
            ) : null}
            {showManage ? (
              <a className="btn btn-ghost btn-sm rounded-full" href={g.url} target="_blank" rel="noreferrer">
                Manage positions <span aria-hidden>↗</span>
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={showHeader ? "px-5 md:px-6 pb-5 md:pb-6" : "p-5 md:p-6"}>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr className="text-xs text-neutral">
                {selectable ? <th className="w-10" /> : null}
                <th>Asset</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map(row => (
                <tr
                  key={row.id}
                  className={
                    selectable
                      ? row.chainId && !SUPPORTED_CHAIN_IDS.has(row.chainId)
                        ? "opacity-60"
                        : "hover:bg-base-200 cursor-pointer"
                      : undefined
                  }
                  onClick={() => {
                    if (!selectable) return;
                    if (row.chainId && !SUPPORTED_CHAIN_IDS.has(row.chainId)) return;
                    const key = tokenKeyForRow(row);
                    if (!key) return;
                    props.onToggleKey?.(key);
                  }}
                >
                  {selectable ? (
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={Boolean(props.selectedKeys?.has(tokenKeyForRow(row) ?? ""))}
                        disabled={!tokenKeyForRow(row) || Boolean(row.chainId && !SUPPORTED_CHAIN_IDS.has(row.chainId))}
                        onChange={() => {
                          if (row.chainId && !SUPPORTED_CHAIN_IDS.has(row.chainId)) return;
                          const key = tokenKeyForRow(row);
                          if (!key) return;
                          props.onToggleKey?.(key);
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    </td>
                  ) : null}
                  <td>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-2xl bg-base-200 border border-base-300 overflow-hidden flex items-center justify-center shrink-0">
                        {row.tokenIconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.tokenIconUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-4 h-4 rounded bg-base-300" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          {row.tokenName}
                          {row.tokenSymbol ? (
                            <span className="ml-2 text-xs text-neutral">{row.tokenSymbol}</span>
                          ) : null}
                          {row.isVerified === false ? (
                            <span className="ml-2 text-[10px] text-warning bg-base-200 border border-base-300 rounded-full px-2 py-0.5 align-middle">
                              Unverified
                            </span>
                          ) : null}
                          {row.chainId && !SUPPORTED_CHAIN_IDS.has(row.chainId) ? (
                            <span className="ml-2 text-[10px] text-warning bg-base-200 border border-base-300 rounded-full px-2 py-0.5 align-middle">
                              Unsupported network
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-neutral">
                          {chainLabel(row.chain)} ·{" "}
                          <span className={row.kind === "loan" ? "text-error" : ""}>{rowLabel(row)}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-mono text-xs">{fmtQuantity(row)}</td>
                  <td className={`text-right font-semibold ${valueClass(row)}`}>{fmtUsd(row.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function PositionsOverview(props: {
  positionsView: ZerionPositionsView;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
  showUnverified?: boolean;
  showGroupHeader?: boolean;
}) {
  const groups = props.positionsView.groups ?? [];
  if (!groups.length) return null;

  const filteredGroups = props.showUnverified
    ? groups
    : groups
        .map(g => ({
          ...g,
          rows: (g.rows ?? []).filter(r => r.isVerified !== false),
        }))
        .filter(g => (g.rows ?? []).length);

  return (
    <div className="space-y-4">
      {filteredGroups.map(g => (
        <GroupCard
          key={g.id}
          group={g}
          selectable={props.selectable}
          selectedKeys={props.selectedKeys}
          onToggleKey={props.onToggleKey}
          showHeader={props.showGroupHeader ?? true}
        />
      ))}
    </div>
  );
}
