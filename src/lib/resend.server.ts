import { Resend } from "resend";

// Server-only. Never import from a route/component that ships to the client.
// RESEND_API_KEY is not configured in this environment — sendEmail() throws
// a clear error rather than silently no-op'ing, so callers can catch it and
// keep going (a failed email must never break a webhook or a user action).

let _resend: Resend | undefined;

function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not configured");
  _resend = new Resend(key);
  return _resend;
}

// Must stay on the Resend-verified domain (auth.postulpro.com) — the
// previous "postulpro.com" sender was never a verified domain in Resend, so
// every send from it would have been rejected. Callers never get to choose
// the sender — it's fixed here, not a parameter.
const FROM = "PostulPro <notificaciones@auth.postulpro.com>";

const SEND_TIMEOUT_MS = 10_000;

const shell = (title: string, body: string, ctaHref?: string, ctaLabel?: string) => `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
</head>
<body style="margin:0;background:#07070E;">
<div style="background:#07070E;padding:32px 16px;font-family:Inter,system-ui,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#0E0E1B;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7C3AED,#06B6D4);padding:20px 24px;">
      <span style="color:#fff;font-weight:700;font-size:18px;">PostulPro</span>
    </div>
    <div style="padding:24px;color:#F8FAFC;">
      <h1 style="font-size:18px;margin:0 0 12px;">${title}</h1>
      <div style="font-size:14px;line-height:1.6;color:#94A3B8;">${body}</div>
      ${
        ctaHref
          ? `<a href="${ctaHref}" style="display:inline-block;margin-top:20px;padding:12px 24px;border-radius:8px;background:linear-gradient(135deg,#7C3AED,#06B6D4);color:#fff;text-decoration:none;font-size:14px;font-weight:600;">${ctaLabel ?? "Ir a PostulPro"}</a>`
          : ""
      }
    </div>
  </div>
</div>
</body>
</html>`;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Resend request timed out")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// idempotencyKey: pass a stable id (e.g. a billing webhook event id, or a
// notifications ledger key) so a retried request can't send the same email
// twice — Resend deduplicates requests sharing an Idempotency-Key within its
// retention window. No built-in retry loop here by design: a single attempt
// per call, callers decide whether/how to retry.
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  idempotencyKey?: string,
) {
  const resend = getResend();
  const { error } = await withTimeout(
    resend.emails.send(
      { from: FROM, to, subject, html, text },
      idempotencyKey ? { idempotencyKey } : undefined,
    ),
    SEND_TIMEOUT_MS,
  );
  if (error) {
    // Resend's own error objects never carry the API key, but strip down to
    // name/message defensively so nothing unexpected (headers, request
    // internals) ever reaches a log line.
    throw new Error(`Resend error: ${error.name ?? "unknown"}: ${error.message ?? "send failed"}`);
  }
}

export function sendWelcomeEmail(
  to: string,
  name: string,
  appOrigin: string,
  idempotencyKey?: string,
) {
  const safeName = name.trim() || "ahí";
  return sendEmail(
    to,
    "¡Bienvenido a PostulPro! 🎉",
    shell(
      `¡Bienvenido, ${safeName}!`,
      "Ya tenés créditos gratis para empezar a generar contenido con IA. Describí una idea y PostulPro arma el plan y los entregables por vos.",
      `${appOrigin}/dashboard`,
      "Ir a mi dashboard",
    ),
    `Bienvenido a PostulPro, ${safeName}.\n\nYa tenés créditos gratis para empezar a generar contenido con IA.\n\nEntrá a tu dashboard: ${appOrigin}/dashboard`,
    idempotencyKey,
  );
}

export function sendProConfirmationEmail(
  to: string,
  plan: "pro" | "business",
  idempotencyKey?: string,
) {
  return sendEmail(
    to,
    `Tu plan ${plan.toUpperCase()} está activo`,
    shell(
      "¡Listo!",
      `Tu suscripción ${plan.toUpperCase()} ya está activa. Disfrutá de tus nuevos créditos y herramientas.`,
    ),
    `Tu suscripción ${plan.toUpperCase()} ya está activa. Disfrutá de tus nuevos créditos y herramientas.`,
    idempotencyKey,
  );
}

export function sendLowCreditsEmail(
  to: string,
  remainingPercent: number,
  appOrigin: string,
  idempotencyKey?: string,
) {
  return sendEmail(
    to,
    "Te quedan pocos créditos",
    shell(
      "¡Atención!",
      `Ya usaste el ${100 - remainingPercent}% de tus créditos este período. Podés conseguir más desde tu configuración.`,
      `${appOrigin}/settings`,
      "Ver mis créditos",
    ),
    `Ya usaste el ${100 - remainingPercent}% de tus créditos este período. Podés conseguir más desde tu configuración: ${appOrigin}/settings`,
    idempotencyKey,
  );
}

export function sendPaymentFailedEmail(to: string, idempotencyKey?: string) {
  return sendEmail(
    to,
    "No pudimos procesar tu pago",
    shell(
      "Pago fallido",
      "Tu último intento de cobro no se pudo procesar. Actualizá tu método de pago desde el portal de facturación para no perder acceso.",
    ),
    "Tu último intento de cobro no se pudo procesar. Actualizá tu método de pago desde el portal de facturación para no perder acceso.",
    idempotencyKey,
  );
}

export function sendNewCommissionEmail(to: string, amount: number, idempotencyKey?: string) {
  return sendEmail(
    to,
    "Nueva comisión de afiliado 💰",
    shell(
      "¡Ganaste una comisión!",
      `Sumaste $${amount.toFixed(2)} en comisión por un nuevo referido. Mirá el detalle en tu panel de afiliados.`,
    ),
    `Sumaste $${amount.toFixed(2)} en comisión por un nuevo referido. Mirá el detalle en tu panel de afiliados.`,
    idempotencyKey,
  );
}

// stats only carries figures this codebase can actually compute accurately
// today: a real count of generations and a real sum of tokens_used, both
// scoped to the requesting user's own rows. There's no per-generation
// credit-cost ledger to derive a trustworthy "credits used this week" from,
// so this deliberately doesn't show one rather than approximate it.
export function sendWeeklySummaryEmail(
  to: string,
  stats: { generations: number; tokensUsed: number },
  appOrigin: string,
  idempotencyKey?: string,
) {
  return sendEmail(
    to,
    "Tu resumen semanal en PostulPro",
    shell(
      "Tu semana en números",
      `Generaste ${stats.generations} piezas de contenido la semana pasada${stats.tokensUsed > 0 ? ` (${stats.tokensUsed.toLocaleString("es-AR")} tokens procesados)` : ""}. ¡Seguí así!`,
      `${appOrigin}/dashboard`,
      "Ver mi dashboard",
    ),
    `Generaste ${stats.generations} piezas de contenido la semana pasada. ¡Seguí así!\n\n${appOrigin}/dashboard`,
    idempotencyKey,
  );
}
