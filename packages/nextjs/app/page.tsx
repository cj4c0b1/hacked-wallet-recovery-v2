import { RecoverWizard } from "./recover/_components/RecoverWizard";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "Recover",
  description: "Hacked wallet recovery flow (local MVP)",
});

export default function Home() {
  return <RecoverWizard />;
}
