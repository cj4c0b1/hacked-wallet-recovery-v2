"use client";

import React from "react";

/**
 * Underlined text with a hover tooltip (DaisyUI).
 * Keeps copy clean while allowing users to opt into details.
 */
export function UnderlinedTooltip(props: { text: string; tip: string; className?: string }) {
  return (
    <span className={`tooltip tooltip-bottom ${props.className ?? ""}`} data-tip={props.tip}>
      <span className="underline decoration-dotted decoration-accent underline-offset-4 cursor-help">{props.text}</span>
    </span>
  );
}
