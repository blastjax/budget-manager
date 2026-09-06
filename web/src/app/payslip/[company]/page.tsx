import type { Metadata } from "next";
import PayslipClient from "../PayslipClient";

type Params = { company: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { company } = await params;
  const name = decodeURIComponent(company);
  return {
    title: `${name} Payslip`,
    description: "Upload and track payslip totals",
  };
}

export default async function CompanyPayslipPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { company } = await params;
  return <PayslipClient company={decodeURIComponent(company)} />;
}
