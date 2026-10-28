import type { Metadata } from "next";
import { OverviewScreen } from "@/components/tms/OverviewScreen";

export const metadata: Metadata = {
  title: "Operations overview — Richie TMS",
  description: "Runs, vehicles and money on one board. Interface review build; sample data.",
};

// Cut per request rather than frozen at build: the payload's activity times are relative to the
// moment it is assembled, and a page that has said "9m ago" for a week is telling a small lie.
// Nothing is cached, and nothing is read from the database.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <OverviewScreen />;
}
