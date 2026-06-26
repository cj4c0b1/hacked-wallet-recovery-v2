"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import * as viemChains from "viem/chains";
import externalContracts from "~~/contracts/externalContracts";
import { sortNetworksForDropdown } from "~~/utils/scaffold-eth/networks";

type ChainIconItem = {
  chainId: number;
  name: string;
  iconSrc: string;
};

function supportedChainsForIntro(): ChainIconItem[] {
  const ids = Object.keys(externalContracts)
    .map(Number)
    .filter((x): x is number => Number.isFinite(x) && x > 0);

  const viemChainsById = (() => {
    const m = new Map<number, viemChains.Chain>();
    for (const v of Object.values(viemChains)) {
      if (v && typeof v === "object" && "id" in v) m.set((v as viemChains.Chain).id, v as viemChains.Chain);
    }
    return m;
  })();

  const items = ids.map(chainId => {
    const chain = viemChainsById.get(chainId);
    const name = chain?.name ?? `Chain ${chainId}`;
    return { chainId, name, iconSrc: `/chains/${chainId}.svg` };
  });

  return sortNetworksForDropdown(items.map(x => ({ id: x.chainId, name: x.name, x }))).map(v => v.x);
}

function ChainIconsRow(props: { items: ChainIconItem[]; className?: string }) {
  const { items, className } = props;
  const [activeChainId, setActiveChainId] = useState<number | null>(null);

  const itemCount = items.length;
  const rows = 3;
  const cols = Math.ceil(Math.max(itemCount, 1) / rows);
  const cells: Array<ChainIconItem | null> = Array.from({ length: rows * cols }, (_, idx) => items[idx] ?? null);

  const gridStyle = useMemo(() => {
    return {
      gridTemplateColumns: `repeat(${cols}, var(--chain-col-w))`,
    } as CSSProperties;
  }, [cols]);

  if (itemCount === 0) return null;

  return (
    <div className={["mt-8", className].filter(Boolean).join(" ")}>
      {/* Keep label aligned with the grid's left edge */}
      <div className="mt-2 w-full">
        <div className="w-fit mx-auto px-1 [--chain-col-w:40px] sm:[--chain-col-w:44px]">
          <div className="text-sm text-base-content/60 text-left">Supported chains</div>

          <div
            className="mt-1 grid gap-x-1 gap-y-0.5 place-items-center"
            // Fixed column width keeps icons tightly packed (no full-width spreading).
            style={gridStyle}
          >
            {cells.map((item, i) => {
              if (!item) {
                // Pad to keep rows the same length.
                return <div key={`pad-${i}`} className="w-10 sm:w-11" aria-hidden="true" />;
              }

              const isActive = activeChainId === item.chainId;

              return (
                <div
                  key={item.chainId}
                  className="group relative z-0 hover:z-20 focus-within:z-20 flex flex-col items-center w-10 sm:w-11"
                >
                  <button
                    type="button"
                    className="h-10 w-10 sm:h-11 sm:w-11 rounded-full border border-base-300 bg-base-200/40 flex items-center justify-center overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    title={item.name}
                    aria-label={item.name}
                    onClick={() => setActiveChainId(prev => (prev === item.chainId ? null : item.chainId))}
                    onBlur={() => setActiveChainId(null)}
                  >
                    <Image
                      src={item.iconSrc}
                      alt={item.name}
                      width={24}
                      height={24}
                      className="h-6 w-6 sm:h-[26px] sm:w-[26px] rounded-full transition-transform duration-150 ease-out group-hover:scale-125 group-focus-within:scale-125"
                      onError={e => {
                        // If an icon is missing, hide the image but keep the badge.
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </button>

                  {/* Intentionally no reserved height: label can overlap the row below */}
                  <div className="w-full relative">
                    <div className="absolute left-1/2 -translate-x-1/2 top-0.5">
                      <div
                        className={[
                          "pointer-events-none whitespace-nowrap text-[11px] leading-4 text-base-content/80",
                          "opacity-0 translate-y-0.5 transition-all duration-150 ease-out",
                          "group-hover:opacity-100 group-hover:translate-y-0",
                          "group-focus-within:opacity-100 group-focus-within:translate-y-0",
                          isActive ? "opacity-100 translate-y-0" : "",
                        ].join(" ")}
                      >
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-base-100/95 border border-base-300 shadow-sm backdrop-blur">
                          {item.name}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function IntroStep(props: { onNext: () => void }) {
  const [mounted, setMounted] = useState(false);

  const lines = useMemo(() => {
    return [
      "We're sad to hear that you have been hacked.",
      "This tool can help recover assets that are stuck in your wallet.",
    ];
  }, []);

  const supportedChains = useMemo(() => supportedChainsForIntro(), []);

  useEffect(() => {
    // Subtle single fade-in on mount (no delayed/staggered reveal).
    const raf = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const advance = useCallback(() => {
    props.onNext();
  }, [props]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance]);

  const ctaLabel = "Ready?";

  return (
    <div className="w-full">
      <div
        className={[
          "bg-base-100 rounded-3xl p-6 sm:p-10 md:p-14 border border-base-300 flex flex-col max-h-[80vh] min-h-[320px]",
          "transition-opacity duration-300 ease-out",
          mounted ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        <div className="flex-1 flex items-center">
          <div className="max-w-3xl mx-auto w-full text-left">
            <h1 className="text-3xl md:text-4xl font-bold m-0 leading-tight">{lines[0]}</h1>

            <p className="mt-6 text-xl md:text-2xl leading-relaxed text-base-content/80">{lines[1]}</p>
          </div>
        </div>

        <div className="pt-6 max-w-3xl mx-auto w-full flex justify-end">
          <div
            className={[
              "transition-all duration-200 ease-out",
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none",
            ].join(" ")}
          >
            <button className="btn btn-primary rounded-full" onClick={advance}>
              {ctaLabel}
            </button>
          </div>
        </div>
      </div>

      {/* Outside the intro card, per UX request */}
      <div
        className={[
          "max-w-3xl mx-auto w-full",
          "transition-opacity duration-300 ease-out",
          mounted ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        <ChainIconsRow items={supportedChains} className="mt-5" />
      </div>
    </div>
  );
}
