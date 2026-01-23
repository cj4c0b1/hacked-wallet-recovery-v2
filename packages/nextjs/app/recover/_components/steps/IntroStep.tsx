"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function IntroStep(props: { onNext: () => void }) {
  const [typed, setTyped] = useState("");
  const [isTyping, setIsTyping] = useState(true);

  const typeMsPerWord = 80;

  const text = useMemo(() => {
    return (
      "Sorry to hear that you have been hacked.\n\n" +
      "This tool can help recover assets that are stuck in your wallet."
    );
  }, []);

  const typingTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (typingTimer.current) window.clearInterval(typingTimer.current);
    typingTimer.current = null;
  };

  useEffect(() => {
    clearTimers();
    setIsTyping(true);
    setTyped("");

    const tokens = text.match(/\S+\s*/g) ?? [];
    let i = 0;
    typingTimer.current = window.setInterval(() => {
      i += 1;
      setTyped(tokens.slice(0, i).join(""));
      if (i >= tokens.length) {
        if (typingTimer.current) window.clearInterval(typingTimer.current);
        typingTimer.current = null;
        setIsTyping(false);
      }
    }, typeMsPerWord);

    return () => clearTimers();
  }, [text]);

  const advance = useCallback(() => {
    // If still typing, first press completes instantly.
    if (isTyping) {
      clearTimers();
      setTyped(text);
      setIsTyping(false);
      return;
    }

    props.onNext();
  }, [isTyping, props, text]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance]);

  const showCta = !isTyping;
  const ctaLabel = "Ready?";

  return (
    <div className="bg-base-100 rounded-3xl p-10 md:p-14 border border-base-300 flex flex-col max-h-[80vh] min-h-[320px]">
      <div className="flex-1 flex items-center">
        <div className="max-w-3xl mx-auto w-full text-left">
          <h1 className="text-3xl md:text-4xl font-bold m-0 leading-tight whitespace-pre-wrap">{typed}</h1>
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
