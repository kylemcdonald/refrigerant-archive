import type { Metadata } from "next";
import { ColdShotViewer } from "./ColdShotViewer";

export const metadata: Metadata = {
  title: "Refrigerant Archive — Six Photo-fitted 3D Cans",
  description:
    "Six vintage refrigerant cans with fitted multi-view GPT labels, plus an interactive rigid-body can-rain simulation.",
};

export default function Home() {
  return <ColdShotViewer />;
}
