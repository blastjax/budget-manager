import type { Metadata } from "next";
import LottoClient from "./LottoClient";

export const metadata: Metadata = {
  title: "Lotto",
  description: "Track lotto results by date and check your attempts against them",
};

export default function LottoPage() {
  return <LottoClient />;
}
