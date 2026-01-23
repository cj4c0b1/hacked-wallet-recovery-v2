"use client";

import React from "react";
import type { RecoveryWizardStep } from "~~/services/store/recoveryWizard";

const trackSteps = [
  { key: "pk", label: "Enter Wallet Info" },
  { key: "assets", label: "Select Assets" },
  { key: "pay", label: "Recover" },
] as const;

function trackIndexForWizardStep(step: RecoveryWizardStep): number {
  if (step === "intro") return 0;
  if (step === "pk") return 0;
  if (step === "assets") return 1;
  return 2; // pay/done
}

export function StepTrack(props: { step: RecoveryWizardStep }) {
  const activeIndex = trackIndexForWizardStep(props.step);
  const progressPct = (activeIndex / (trackSteps.length - 1)) * 100;
  const insetPct = 100 / (trackSteps.length * 2); // half a segment so the line ends at first/last circle centers

  return (
    <div className="w-full">
      <div className="relative w-full">
        {/* Continuous track line (ends at circle centers) */}
        <div className="absolute top-2 h-0.5 bg-base-300 z-0" style={{ left: `${insetPct}%`, right: `${insetPct}%` }}>
          <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="flex items-start w-full">
          {trackSteps.map(s => {
            const idx = trackSteps.findIndex(x => x.key === s.key);
            const completed = idx < activeIndex;
            const active = idx === activeIndex;
            const circleClass = completed || active ? "bg-primary border-primary" : "bg-base-100 border-base-300";
            const ringClass = active ? "ring-4 ring-primary/20" : "";
            const labelClass = completed || active ? "text-base-content" : "text-neutral";

            return (
              <div key={s.key} className="flex-1 flex flex-col items-center min-w-0">
                <div className={`w-4 h-4 rounded-full border ${circleClass} ${ringClass} relative z-10`} />
                <div className={`mt-2 text-[11px] md:text-sm font-semibold ${labelClass} text-center leading-tight`}>
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
