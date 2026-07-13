import { createFileRoute } from "@tanstack/react-router";

// Collects the browser's CSP violation reports sent because of the
// `report-uri` directive in src/server.ts's Content-Security-Policy-Report-Only
// header. Report-Only mode never blocks anything by itself -- without this
// endpoint, violations were only ever visible in each visitor's own devtools
// console and nobody could tell whether it was actually safe to switch to
// enforcing mode. Logs only the safe, structural fields (never headers,
// cookies, or full request bodies) via the same console.log-as-structured-
// JSON pattern used by the billing webhook and AI call logging.

type CspReportBody = {
  "csp-report"?: {
    "document-uri"?: string;
    "violated-directive"?: string;
    "blocked-uri"?: string;
    disposition?: string;
    "effective-directive"?: string;
  };
};

export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as CspReportBody;
          const report = body["csp-report"];
          if (report) {
            console.log(
              JSON.stringify({
                scope: "csp_report",
                documentUri: report["document-uri"],
                violatedDirective: report["violated-directive"] ?? report["effective-directive"],
                blockedUri: report["blocked-uri"],
                disposition: report.disposition,
              }),
            );
          }
        } catch {
          // Malformed report body -- never let a parsing failure surface an
          // error to the reporting browser.
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
