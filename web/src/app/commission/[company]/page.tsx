import type { Metadata } from "next";
import CommissionClient from "../CommissionClient";

type Params = { company: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { company } = await params;
  const name = decodeURIComponent(company);
  return {
    title: `${name} Commission`,
    description: "Commission history and forecast",
  };
}

export default async function CompanyCommissionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { company } = await params;
  return <CommissionClient company={decodeURIComponent(company)} />;
}
