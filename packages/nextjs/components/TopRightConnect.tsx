"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { hardhat } from "viem/chains";
import { StepTrack } from "~~/components/recovery/StepTrack";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useRecoveryWizardStore } from "~~/services/store/recoveryWizard";

export function TopRightConnect() {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const pathname = usePathname();
  const step = useRecoveryWizardStore(s => s.step);

  const showTrack = useMemo(() => {
    // Only show the track for the recovery flow on the homepage.
    if (pathname !== "/") return false;
    return step !== "intro";
  }, [pathname, step]);

  return (
    <div className="sticky top-0 z-20">
      <div className="w-full flex justify-center px-5 py-3">
        <div className="w-full max-w-5xl">
          <div className="pt-1">{showTrack ? <StepTrack step={step} /> : null}</div>
        </div>
      </div>

      {/* Fixed wallet/connect UI on the far right (desktop) */}
      <div className="md:fixed md:right-4 md:top-3 z-30 hidden md:flex items-center gap-2">
        <RainbowKitCustomConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>

      {/* Non-fixed wallet/connect UI for small screens */}
      <div className="flex md:hidden justify-end px-5 pb-3">
        <div className="flex items-center gap-2">
          <RainbowKitCustomConnectButton />
          {isLocalNetwork && <FaucetButton />}
        </div>
      </div>
    </div>
  );
}
