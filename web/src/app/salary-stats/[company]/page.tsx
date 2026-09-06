import type { Metadata } from "next";
import SalaryStatsClient from "../SalaryStatsClient";

type Params = { company: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { company } = await params;
  const name = decodeURIComponent(company);
  return {
    title: `${name} Salary Stats`,
    description: "Charts for payslip components over time",
  };
}

export default async function CompanySalaryStatsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { company } = await params;
  return <SalaryStatsClient company={decodeURIComponent(company)} />;
}
