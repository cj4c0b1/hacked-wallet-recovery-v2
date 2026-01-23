import { create } from "zustand";

export type RecoveryWizardStep = "intro" | "pk" | "assets" | "pay" | "done";

type RecoveryWizardState = {
  step: RecoveryWizardStep;
  setStep: (step: RecoveryWizardStep) => void;
  reset: () => void;
};

export const useRecoveryWizardStore = create<RecoveryWizardState>(set => ({
  step: "intro",
  setStep: (step: RecoveryWizardStep) => set(() => ({ step })),
  reset: () => set(() => ({ step: "intro" })),
}));
