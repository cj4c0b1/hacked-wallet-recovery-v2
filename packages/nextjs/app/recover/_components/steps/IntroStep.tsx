"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function IntroStep(props: { onNext: () => void }) {
  const [revealCount, setRevealCount] = useState(0);
  const revealTimers = useRef<number[]>([]);

  const clearTimers = () => {
    revealTimers.current.forEach(id => window.clearTimeout(id));
    revealTimers.current = [];
  };

  const lines = useMemo(() => {
    return [
      "Sorry to hear that you have been hacked.",
      "This tool can help recover assets that are stuck in your wallet.",
    ];
  }, []);

  useEffect(() => {
    clearTimers();
    setRevealCount(0);

    // Fade in each line with a 500ms stagger, then show CTA.
    revealTimers.current = [
      window.setTimeout(() => setRevealCount(1), 500),
      window.setTimeout(() => setRevealCount(2), 1500),
      window.setTimeout(() => setRevealCount(3), 2500),
    ];

    return () => clearTimers();
  }, []);

  const isRevealing = revealCount < 3;

  const advance = useCallback(() => {
    // If still revealing, first press completes instantly.
    if (isRevealing) {
      clearTimers();
      setRevealCount(3);
      return;
    }

    props.onNext();
  }, [isRevealing, props]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance]);

  const showCta = revealCount >= 3;
  const ctaLabel = "Ready?";

  return (
    <div className="bg-base-100 rounded-3xl p-6 sm:p-10 md:p-14 border border-base-300 flex flex-col max-h-[80vh] min-h-[320px]">
      <div className="flex-1 flex items-center">
        <div className="max-w-3xl mx-auto w-full text-left">
          <h1
            className={[
              "text-3xl md:text-4xl font-bold m-0 leading-tight",
              "transition-opacity duration-500 ease-out",
              revealCount >= 1 ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            {lines[0]}
          </h1>

          <p
            className={[
              "mt-6 text-xl md:text-2xl leading-relaxed text-base-content/80",
              "transition-opacity duration-500 ease-out",
              revealCount >= 2 ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            {lines[1]}
          </p>
        </div>
      </div>

      <div className="pt-6 max-w-3xl mx-auto w-full flex justify-end">
        <div
          className={[
            "transition-all duration-300 ease-out",
            showCta ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none",
          ].join(" ")}
        >
          <button className="btn btn-primary rounded-full" onClick={advance}>
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
