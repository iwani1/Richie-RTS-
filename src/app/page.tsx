"use client";

import App from "../App";

// The application shell is a client component: it holds the session view and dispatches commands
// to the API. Data is never read from or written to browser storage in this build.
export default function Page() {
  return <App />;
}
