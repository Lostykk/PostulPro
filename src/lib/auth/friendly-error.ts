// Supabase Auth returns raw, English, sometimes internals-revealing error
// strings (e.g. "AuthApiError: Invalid login credentials"). The public auth
// screens must show clear Spanish copy instead (redesign brief §12) — this
// maps known messages and falls back to a safe generic string rather than
// ever surfacing an unrecognized raw message to the user.
const KNOWN_MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "Email o contraseña incorrectos."],
  [/email not confirmed/i, "Confirmá tu email antes de iniciar sesión — revisá tu bandeja de entrada."],
  [/user already registered/i, "Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña."],
  [/password should be at least/i, "La contraseña es demasiado corta."],
  [/rate limit/i, "Hiciste demasiados intentos. Esperá un minuto y volvé a intentar."],
  [/network/i, "No pudimos conectar. Revisá tu conexión e intentá de nuevo."],
  [/token has expired|invalid.*token/i, "El enlace venció o ya fue usado. Solicitá uno nuevo."],
];

export function friendlyAuthError(message: string | undefined | null): string {
  const msg = message ?? "";
  for (const [pattern, friendly] of KNOWN_MESSAGES) {
    if (pattern.test(msg)) return friendly;
  }
  return "No pudimos completar la acción. Intentá de nuevo en unos segundos.";
}
