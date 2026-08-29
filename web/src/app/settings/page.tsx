import type { Metadata } from "next";
import SettingsClient from "./SettingsClient";

export const metadata: Metadata = {
  title: "Settings",
  description: "Payslip defaults, chart colors, and users",
};

export default function SettingsPage() {
  return <SettingsClient />;
}
