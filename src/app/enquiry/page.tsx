import type { Metadata } from "next";
import { PublicEnquiry } from "../../screens/PublicEnquiry";

// The public route (WEB-01). Deliberately outside the application shell: it renders no session, no
// navigation and no data, and it is the one page allowed to be framed by the company's own website
// (see the /enquiry override in next.config.ts).
export const metadata: Metadata = {
  title: "Request a vehicle — Richie Transport Services",
  description: "Ask Richie Transport Services for a vehicle. The office calls back to confirm.",
  robots: { index: true, follow: true },
};

export const dynamic = "force-dynamic";

export default async function EnquiryPage({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  const params = await searchParams;
  // `?embed=1` is what the website's iframe points at: the card loses its border, padding and
  // background so it sits inside the host page instead of looking like a second page in a box.
  return <PublicEnquiry embedded={params.embed === "1"} />;
}
