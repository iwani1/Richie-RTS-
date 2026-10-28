import type { Metadata } from "next";
import { DesignGallery } from "@/components/tms/DesignGallery";

export const metadata: Metadata = {
  title: "Design system — Richie TMS",
  description: "Every shared interface component, in every state. Sample data.",
};

// Cut per request rather than frozen at build: the payload's activity times are relative to the
// moment it is assembled, and a page that has said "9m ago" for a week is telling a small lie.
// Nothing is cached, and nothing is read from the database.
export const dynamic = "force-dynamic";

export default function DesignPage() {
  return <DesignGallery />;
}
