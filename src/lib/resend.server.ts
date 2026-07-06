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

const FROM = "PostulPro <notificaciones@postulpro.com>";

const shell = (title: string, body: string) => `
<div style="background:#07070E;padding:32px 16px;font-family:Inter,system-ui,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#0E0E1B;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7C3AED,#06B6D4);padding:20px 24px;">
      <span style="color:#fff;font-weight:700;font-size:18px;">PostulPro</span>
    </div>
    <div style="padding:24px;color:#F8FAFC;">
      <h1 style="font-size:18px;margin:0 0 12px;">${title}</h1>
      <div style="font-size:14px;line-height:1.6;color:#94A3B8;">${body}</div>
    </div>
  </div>
</div>`;

// idempotencyKey: pass a stable id (e.g. a billing webhook event id) so a retried
// webhook delivery can't send the same email twice — Resend deduplicates
// requests sharing an Idempotency-Key within its retention window.
async function sendEmail(to: string, subject: string, html: string, idempotencyKey?: string) {
  const resend = getResend();
  await resend.emails.send(
    { from: FROM, to, subject, html },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
}

export function sendWelcomeEmail(to: string, name: string, idempotencyKey?: string) {
  return sendEmail(
    to,
    "¡Bienvenido a PostulPro! 🎉",
    shell("¡Bienvenido, " + name + "!", "Ya tenés 10 créditos gratis para empezar a generar contenido con IA. Entrá a tu dashboard cuando quieras."),
    idempotencyKey,
  );
}

export function sendProConfirmationEmail(to: string, plan: "pro" | "business", idempotencyKey?: string) {
  return sendEmail(
    to,
    `Tu plan ${plan.toUpperCase()} está activo`,
    shell("¡Listo!", `Tu suscripción ${plan.toUpperCase()} ya está activa. Disfrutá de tus nuevos créditos y herramientas.`),
    idempotencyKey,
  );
}

export function sendLowCreditsEmail(to: string, remainingPercent: number, idempotencyKey?: string) {
  return sendEmail(
    to,
    "Te quedan pocos créditos",
    shell("¡Atención!", `Ya usaste el ${100 - remainingPercent}% de tus créditos este período. Podés conseguir más desde tu configuración.`),
    idempotencyKey,
  );
}

export function sendPaymentFailedEmail(to: string, idempotencyKey?: string) {
  return sendEmail(
    to,
    "No pudimos procesar tu pago",
    shell("Pago fallido", "Tu último intento de cobro no se pudo procesar. Actualizá tu método de pago desde el portal de facturación para no perder acceso."),
    idempotencyKey,
  );
}

export function sendNewCommissionEmail(to: string, amount: number, idempotencyKey?: string) {
  return sendEmail(
    to,
    "Nueva comisión de afiliado 💰",
    shell("¡Ganaste una comisión!", `Sumaste $${amount.toFixed(2)} en comisión por un nuevo referido. Mirá el detalle en tu panel de afiliados.`),
    idempotencyKey,
  );
}

export function sendWeeklySummaryEmail(
  to: string,
  stats: { generations: number; creditsUsed: number },
  idempotencyKey?: string,
) {
  return sendEmail(
    to,
    "Tu resumen semanal en PostulPro",
    shell(
      "Tu semana en números",
      `Generaste ${stats.generations} piezas de contenido y usaste ${stats.creditsUsed} créditos la semana pasada. ¡Seguí así!`,
    ),
    idempotencyKey,
  );
}
