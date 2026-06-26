"use client";

import { CheckCircleIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { useCopyToClipboard } from "~~/hooks/scaffold-eth/useCopyToClipboard";

const SKILL_REPO_URL = "https://github.com/BuidlGuidl/hacked-wallet-recovery-skill";
const SKILL_REPO_LABEL = "github.com/BuidlGuidl/hacked-wallet-recovery-skill";

/**
 * Quiet header pointer to the AI-agent recovery skill. Rendered in the header's
 * centered slot on the intro step only, so it never competes with the wizard.
 */
export function AgentSkillBulletin() {
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();

  return (
    <div className="flex w-full max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center text-xs sm:text-sm text-base-content/70">
      <span>Prefer to recover with your AI agent? Give it this skill:</span>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1">
        <a
          href={SKILL_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="link min-w-0 break-all font-mono text-[0.7rem] sm:text-xs"
        >
          {SKILL_REPO_LABEL}
        </a>
        {isCopiedToClipboard ? (
          <CheckCircleIcon className="h-4 w-4 shrink-0 text-base-content" aria-label="Copied" />
        ) : (
          <button
            type="button"
            aria-label="Copy skill repository link"
            onClick={() => copyToClipboard(SKILL_REPO_URL)}
            className="shrink-0 cursor-pointer"
          >
            <DocumentDuplicateIcon className="h-4 w-4" />
          </button>
        )}
      </span>
    </div>
  );
}
