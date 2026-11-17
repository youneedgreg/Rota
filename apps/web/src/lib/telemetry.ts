// Error reports, off unless NEXT_PUBLIC_SENTRY_DSN is set. Nothing here sees
// money or keys; reports are scrubbed on the phone before they're sent (see
// scrub.ts), and the SDK is only downloaded when reporting is on.
import { scrubReport } from "./scrub";

export function startTelemetry(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  import("@sentry/browser")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        // Only uncaught errors, linked causes and de-duplication: no breadcrumbs
        // (they record clicks and URLs), no page URL or headers, no replay, no tracing.
        defaultIntegrations: false,
        integrations: [Sentry.globalHandlersIntegration(), Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
        maxBreadcrumbs: 0,
        beforeBreadcrumb: () => null,
        tracesSampleRate: 0,
        beforeSend: (event) => scrubReport(event),
        environment: process.env.NEXT_PUBLIC_BREEZ_NETWORK === "regtest" ? "regtest" : "mainnet",
      });
    })
    .catch(() => {
      // Reporting is optional: never let it break the app.
    });
}
