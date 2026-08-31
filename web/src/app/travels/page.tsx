import type { Metadata } from "next";
import TravelsClient from "./TravelsClient";

export const metadata: Metadata = {
  title: "Travels",
  description: "Trips filed by year and month, with flights, itinerary, and accommodations",
};

export default function TravelsPage() {
  return <TravelsClient />;
}
