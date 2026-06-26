"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { hardhat } from "viem/chains";
import { AgentSkillBulletin } from "~~/app/recover/_components/AgentSkillBulletin";
import { StepTrack } from "~~/components/recovery/StepTrack";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useRecoveryWizardStore } from "~~/services/store/recoveryWizard";

export function TopRightConnect() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const pathname = usePathname();
  const step = useRecoveryWizardStore(s => s.step);
  const logoSrc = mounted && resolvedTheme === "light" ? "/hwr-dark.svg" : "/hwr.svg";

  const showTrack = useMemo(() => {
    // Only show the track for the recovery flow on the homepage.
    if (pathname !== "/") return false;
    return step !== "intro";
  }, [pathname, step]);

  // On the homepage intro step, the track slot is empty — use it for a quiet
  // pointer to the AI-agent recovery skill instead.
  const showAgentBulletin = pathname === "/" && step === "intro";

  return (
    <div className="sticky top-0 z-20 relative">
      {/* Backdrop blur layer (blurs page content underneath while scrolling) */}
      <div className="absolute inset-0 pointer-events-none bg-base-200/60 backdrop-blur-md" />

      {/* Fixed logo on the far left (desktop) */}
      <div className="md:fixed md:left-4 md:top-3 z-30 hidden md:flex items-center">
        <Link href="/" className="flex items-center gap-2">
          <div className="relative w-9 h-9 rounded-xl bg-base-200 shadow-sm p-1">
            <Image alt="Hacked Wallet Recovery logo" fill src={logoSrc} />
          </div>
          <span className="font-bold text-base lg:text-lg leading-tight">Hacked Wallet Recovery</span>
        </Link>
      </div>

      {/* Fixed wallet/connect UI on the far right (desktop) */}
      <div className="md:fixed md:right-4 md:top-3 z-30 hidden md:flex items-center gap-2">
        <RainbowKitCustomConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>

      {/* Non-fixed wallet/connect UI for small screens */}
      <div className="relative z-10 flex md:hidden items-center justify-between px-5 pb-3 gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="relative w-8 h-8 rounded-xl bg-base-200 shadow-sm p-1">
            <Image alt="Hacked Wallet Recovery logo" fill src={logoSrc} />
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <RainbowKitCustomConnectButton />
          {isLocalNetwork && <FaucetButton />}
        </div>
      </div>

      {/* Progress track: below mobile header row, centered on desktop */}
      <div className="relative z-10 w-full flex justify-center px-5 py-3">
        <div className="w-full max-w-2xl">
          <div className="pt-1">
            {showTrack ? <StepTrack step={step} /> : showAgentBulletin ? <AgentSkillBulletin /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
