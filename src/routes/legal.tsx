import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/legal")({
  component: Legal,
});

function Legal() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Volver a PostulPro
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Legal</h1>
        <p className="mt-3 text-sm text-text-secondary">
          Última actualización: julio de 2026. Si tenés dudas sobre estos términos, escribinos
          desde tu panel en Configuración.
        </p>

        <nav className="mt-8 flex flex-wrap gap-2 text-sm">
          <a
            href="#terminos"
            className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-text-secondary hover:text-foreground"
          >
            Términos de Servicio
          </a>
          <a
            href="#privacidad"
            className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-text-secondary hover:text-foreground"
          >
            Política de Privacidad
          </a>
          <a
            href="#cookies"
            className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-text-secondary hover:text-foreground"
          >
            Cookies
          </a>
        </nav>

        <section id="terminos" className="mt-14 space-y-4 scroll-mt-24">
          <h2 className="font-display text-2xl font-bold">Términos de Servicio</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Al crear una cuenta en PostulPro aceptás estos términos. PostulPro es una plataforma
            que ofrece herramientas de generación de contenido asistidas por IA, un marketplace de
            productos digitales creados por usuarios, y un programa de afiliados.
          </p>
          <h3 className="font-display text-lg font-semibold">Cuenta y uso aceptable</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            Sos responsable de la actividad de tu cuenta y de mantener tu contraseña segura. No
            está permitido usar PostulPro para generar contenido ilegal, difamatorio, fraudulento
            o que infrinja derechos de terceros, ni para intentar vulnerar la seguridad de la
            plataforma.
          </p>
          <h3 className="font-display text-lg font-semibold">Planes y facturación</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            Los pagos de suscripciones se procesan a través de Lemon Squeezy, nuestro Merchant of
            Record. Podés cancelar tu suscripción en cualquier momento desde tu panel; mantenés el
            acceso hasta el final del período ya pagado. Los créditos mensuales se reinician en
            cada ciclo de facturación y no son transferibles ni reembolsables salvo que la ley
            aplicable indique lo contrario.
          </p>
          <h3 className="font-display text-lg font-semibold">Propiedad del contenido generado</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            El contenido que generás con las herramientas de IA de PostulPro es tuyo. Podés
            usarlo comercialmente sin restricciones adicionales de nuestra parte, siempre que su
            uso respete la ley y los derechos de terceros.
          </p>
          <h3 className="font-display text-lg font-semibold">Marketplace</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            Los productos publicados en el marketplace son responsabilidad de quien los publica.
            PostulPro se reserva el derecho de retirar cualquier producto que incumpla estos
            términos. Los pagos del marketplace se encuentran en una etapa temprana de
            habilitación; los detalles de comisión se comunicarán antes de activarse.
          </p>
          <h3 className="font-display text-lg font-semibold">Limitación de responsabilidad</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            PostulPro se ofrece "tal cual". El contenido generado por IA puede contener errores o
            imprecisiones — revisalo antes de usarlo en decisiones importantes. No nos hacemos
            responsables por daños indirectos derivados del uso de la plataforma.
          </p>
          <h3 className="font-display text-lg font-semibold">Cambios a estos términos</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            Podemos actualizar estos términos ocasionalmente. Los cambios relevantes se
            notificarán por email o dentro del producto.
          </p>
        </section>

        <section id="privacidad" className="mt-14 space-y-4 scroll-mt-24">
          <h2 className="font-display text-2xl font-bold">Política de Privacidad</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Recolectamos los datos necesarios para operar tu cuenta: email, nombre, y los datos de
            uso del producto (generaciones, herramientas usadas, créditos). Estos datos se
            almacenan de forma segura en nuestra infraestructura sobre Supabase.
          </p>
          <h3 className="font-display text-lg font-semibold">Con quién compartimos datos</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            Los prompts que enviás a nuestras herramientas se procesan a través de los proveedores
            de IA que usamos (Anthropic y OpenAI) únicamente para generar tu resultado. Los pagos
            se procesan por Lemon Squeezy, que actúa como Merchant of Record y maneja tus datos de
            pago directamente — PostulPro nunca almacena números de tarjeta.
          </p>
          <h3 className="font-display text-lg font-semibold">Tus derechos</h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            Desde Configuración → Privacidad podés exportar una copia de tus datos en cualquier
            momento, o eliminar tu cuenta de forma permanente. Al eliminar tu cuenta, tus datos
            personales se borran de nuestros sistemas salvo lo que debamos conservar por
            obligaciones legales o contables.
          </p>
        </section>

        <section id="cookies" className="mt-14 space-y-4 scroll-mt-24">
          <h2 className="font-display text-2xl font-bold">Cookies</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Usamos cookies esenciales para mantener tu sesión iniciada y una cookie de atribución
            de referidos (60 días) para el programa de afiliados. No usamos cookies de publicidad
            de terceros.
          </p>
        </section>
      </main>
    </div>
  );
}
