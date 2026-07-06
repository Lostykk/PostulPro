import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Menu,
  X,
  ArrowRight,
  Sparkles,
  PenLine,
  BarChart3,
  Mail,
  Share2,
  Bot,
  Store,
  Check,
  ChevronDown,
  Rocket,
  Wand2,
  FileCheck2,
  Twitter,
  Instagram,
  Linkedin,
  Youtube,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { captureReferral } from "@/lib/referral";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  useEffect(() => {
    captureReferral();
  }, []);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <Pricing />
        <UseCases />
        <AffiliateTeaser />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}

/* ---------- Logo ---------- */
function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        aria-hidden
        className="relative grid h-8 w-8 place-items-center rounded-full bg-gradient-brand glow-brand"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="2" />
          <circle cx="5" cy="6" r="1.4" />
          <circle cx="19" cy="6" r="1.4" />
          <circle cx="5" cy="18" r="1.4" />
          <circle cx="19" cy="18" r="1.4" />
          <path d="M12 12L5 6M12 12l7-6M12 12l-7 6M12 12l7 6" />
        </svg>
      </div>
      <span className="font-display text-lg font-bold tracking-tight">PostulPro</span>
    </div>
  );
}

/* ---------- Header ---------- */
function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const nav = [
    { href: "#herramientas", label: "Herramientas" },
    { href: "#precios", label: "Precios" },
    { href: "#afiliados", label: "Afiliados" },
    { href: "#blog", label: "Blog" },
  ];

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/5 bg-background/70 backdrop-blur-xl"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Ir al inicio">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Navegación principal">
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-sm text-text-secondary transition-colors hover:text-foreground"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href="/auth/login"
            className="rounded-xl px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
          >
            Iniciar sesión
          </a>
          <a href="/auth/register" className="btn-primary-gradient inline-flex items-center gap-1 text-sm">
            Comenzar gratis <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-surface-2 md:hidden"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="md:hidden"
          >
            <div className="mx-4 mb-4 rounded-2xl border border-white/10 bg-surface-2 p-4">
              <div className="flex flex-col gap-1">
                {nav.map((n) => (
                  <a
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-3 hover:text-foreground"
                  >
                    {n.label}
                  </a>
                ))}
              </div>
              <div className="mt-3 grid gap-2">
                <a
                  href="/auth/login"
                  className="rounded-xl border border-white/10 px-4 py-2 text-center text-sm"
                >
                  Iniciar sesión
                </a>
                <a href="/auth/register" className="btn-primary-gradient text-center text-sm">
                  Comenzar gratis →
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ---------- Hero ---------- */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      <ParticleField />
      <div className="mesh-bg absolute inset-0 -z-10" aria-hidden />

      <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pt-28">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-2/70 px-4 py-1.5 text-xs font-medium text-text-secondary backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5 text-brand-2" />
            <span>Powered by Claude AI & GPT-4o</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-[64px]"
          >
            Genera ingresos reales con IA.{" "}
            <span className="text-gradient-brand">Sin tecnicismos.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary sm:text-xl"
          >
            La plataforma todo-en-uno que convierte tu conocimiento y la IA en productos digitales
            que venden solos.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <a
              href="/auth/register"
              className="btn-primary-gradient inline-flex items-center gap-2 text-base"
            >
              Comenzar gratis — 0 tarjeta <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#demo"
              className="rounded-xl border border-white/10 px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              Ver demo en vivo →
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-1.5 text-xs font-medium text-[#c4b5fd]"
          >
            <Rocket className="h-3.5 w-3.5" />
            Early Access — sé de los primeros en construir con PostulPro
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    type P = { x: number; y: number; vx: number; vy: number; r: number; c: string };
    const particles: P[] = [];

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const init = () => {
      particles.length = 0;
      const count = Math.min(60, Math.floor((width * height) / 22000));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          r: Math.random() * 1.6 + 0.4,
          c: Math.random() > 0.5 ? "rgba(124,58,237,0.7)" : "rgba(6,182,212,0.7)",
        });
      }
    };

    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        ctx.beginPath();
        ctx.fillStyle = p.c;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    init();
    tick();
    const onResize = () => {
      resize();
      init();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 opacity-70"
    />
  );
}

/* ---------- Social Proof ---------- */
function SocialProof() {
  const stack = ["Claude", "OpenAI", "Lemon Squeezy", "Supabase", "Vercel"];
  return (
    <section className="border-y border-white/5 bg-surface-1/50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-center text-xs uppercase tracking-[0.2em] text-text-muted">
          Construido sobre →
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-60">
          {stack.map((s) => (
            <span
              key={s}
              className="font-display text-xl font-semibold tracking-tight text-text-secondary"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Features ---------- */
const FEATURES = [
  {
    icon: PenLine,
    title: "Copywriter IA",
    desc: "Emails, posts, anuncios y guiones listos para publicar en segundos.",
  },
  {
    icon: BarChart3,
    title: "Business Plan IA",
    desc: "Planes de negocio completos, estructurados y exportables en un clic.",
  },
  {
    icon: Mail,
    title: "Email Marketing",
    desc: "Secuencias de ventas automatizadas que convierten mientras dormís.",
  },
  {
    icon: Share2,
    title: "Social Media Pack",
    desc: "Contenido para todas tus redes en simultáneo, con el tono de tu marca.",
  },
  {
    icon: Bot,
    title: "Consultor IA",
    desc: "Tu estratega de negocios disponible 24/7 para tomar mejores decisiones.",
  },
  {
    icon: Store,
    title: "Marketplace",
    desc: "Comprá y vendé templates, prompts y guías premium creadas por la comunidad.",
  },
] as const;

function Features() {
  return (
    <section id="herramientas" className="relative py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Herramientas"
          title="¿Qué puedes hacer con PostulPro?"
          subtitle="Un stack completo de herramientas de IA pensadas para creadores y negocios digitales."
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="glass-card group rounded-2xl p-6 transition-transform hover:-translate-y-1"
            >
              <div className="inline-grid h-11 w-11 place-items-center rounded-xl bg-gradient-brand text-white">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-display text-xl font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{f.desc}</p>
              <a
                href="#herramientas"
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-[#a78bfa] transition-colors group-hover:text-[#c4b5fd]"
              >
                Ver más <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */
function HowItWorks() {
  const steps = [
    {
      icon: PenLine,
      title: "Describe tu objetivo",
      desc: "Contá qué necesitás en lenguaje natural, sin prompts complicados.",
      demo: <TypingDemo />,
    },
    {
      icon: Wand2,
      title: "La IA trabaja para ti",
      desc: "Nuestros modelos combinan estrategia y creatividad en segundos.",
      demo: <WorkingDemo />,
    },
    {
      icon: FileCheck2,
      title: "Recibe resultados listos",
      desc: "Descargá, publicá o vendé. Todo exportable y editable.",
      demo: <DoneDemo />,
    },
  ];

  return (
    <section className="relative py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Cómo funciona" title="Así de simple" />

        <div className="relative mt-16">
          <div
            aria-hidden
            className="absolute left-6 right-6 top-6 hidden h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent md:block"
          />
          <div className="grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative"
              >
                <div className="relative z-10 grid h-12 w-12 place-items-center rounded-full bg-gradient-brand font-display font-bold text-white glow-brand">
                  {i + 1}
                </div>
                <div className="glass-card mt-5 rounded-2xl p-6">
                  <div className="mb-4 flex items-center gap-2 text-text-secondary">
                    <s.icon className="h-4 w-4 text-brand-2" />
                    <h3 className="font-display text-lg font-bold text-foreground">{s.title}</h3>
                  </div>
                  <p className="text-sm text-text-secondary">{s.desc}</p>
                  <div className="mt-5">{s.demo}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TypingDemo() {
  const full = "Quiero lanzar un curso de fotografía y necesito emails de venta...";
  const [text, setText] = useState("");
  useEffect(() => {
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % (full.length + 20);
      setText(full.slice(0, Math.min(i, full.length)));
    }, 80);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="rounded-lg border border-white/10 bg-surface-3/60 p-3 font-mono text-xs text-text-secondary">
      <span>{text}</span>
      <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-brand" />
    </div>
  );
}

function WorkingDemo() {
  return (
    <div className="space-y-2">
      {[70, 45, 90, 60].map((w, i) => (
        <motion.div
          key={i}
          initial={{ width: 0 }}
          whileInView={{ width: `${w}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: i * 0.2, ease: "easeOut" }}
          className="h-2 rounded-full bg-gradient-brand"
        />
      ))}
    </div>
  );
}

function DoneDemo() {
  const items = ["Email #1 · Bienvenida", "Email #2 · Storytelling", "Email #3 · Oferta"];
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li
          key={it}
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-surface-3/40 px-3 py-2 text-xs text-text-secondary"
        >
          <Check className="h-3.5 w-3.5 text-success" />
          {it}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Pricing ---------- */
type Plan = {
  name: string;
  monthly: number;
  yearly: number;
  popular?: boolean;
  cta: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    name: "Free",
    monthly: 0,
    yearly: 0,
    cta: "Empezar gratis",
    features: [
      "10 generaciones / mes",
      "3 herramientas básicas",
      "Sin acceso al marketplace",
      "Soporte de la comunidad",
    ],
  },
  {
    name: "Pro",
    monthly: 29,
    yearly: 23,
    popular: true,
    cta: "Comenzar Pro →",
    features: [
      "500 generaciones / mes",
      "8 herramientas premium",
      "Marketplace completo",
      "Export PDF / DOCX",
      "AI Consultor · 100 msgs/mes",
      "Comisión de afiliado 30% recurrente",
      "Soporte por email en 24h",
    ],
  },
  {
    name: "Business",
    monthly: 99,
    yearly: 79,
    cta: "Ir a Business →",
    features: [
      "Generaciones ilimitadas",
      "Todo lo de Pro",
      "AI Consultor ilimitado",
      "API personal",
      "Comisión de afiliado 40% recurrente",
      "White-label exports",
      "Soporte prioritario + onboarding",
    ],
  },
];

function Pricing() {
  const [annual, setAnnual] = useState(true);
  const [openCompare, setOpenCompare] = useState(false);

  return (
    <section id="precios" className="relative py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Precios"
          title="Planes que crecen con vos"
          subtitle="Empezá gratis. Escalá cuando lo necesites. Cancelá cuando quieras."
        />

        <div className="mt-8 flex items-center justify-center gap-3">
          <span className={`text-sm ${!annual ? "text-foreground" : "text-text-muted"}`}>
            Mensual
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            onClick={() => setAnnual((v) => !v)}
            className={`relative h-7 w-14 rounded-full border border-white/10 transition-colors ${
              annual ? "bg-gradient-brand" : "bg-surface-3"
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                annual ? "translate-x-7" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className={`text-sm ${annual ? "text-foreground" : "text-text-muted"}`}>
            Anual{" "}
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
              −20%
            </span>
          </span>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => {
            const price = annual ? p.yearly : p.monthly;
            return (
              <div
                key={p.name}
                className={`relative rounded-2xl p-6 ${
                  p.popular
                    ? "bg-gradient-to-b from-brand/20 to-transparent p-[1px] glow-brand"
                    : ""
                }`}
              >
                <div
                  className={`glass-card h-full rounded-2xl p-6 ${
                    p.popular ? "bg-surface-1" : ""
                  }`}
                >
                  {p.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-gradient-brand px-3 py-1 text-xs font-semibold text-white">
                        MÁS POPULAR
                      </span>
                    </div>
                  )}
                  <h3 className="font-display text-lg font-bold uppercase tracking-wide">
                    {p.name}
                  </h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="font-display text-5xl font-extrabold">
                      ${price}
                    </span>
                    <span className="text-sm text-text-secondary">
                      {price === 0 ? "" : "/mes"}
                    </span>
                  </div>
                  {annual && p.monthly > 0 && (
                    <p className="mt-1 text-xs text-text-muted">
                      Facturado anual · ahorrás ${(p.monthly - p.yearly) * 12}/año
                    </p>
                  )}

                  <ul className="mt-6 space-y-3">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-2" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8">
                    {p.popular ? (
                      <a
                        href="/auth/register"
                        className="btn-primary-gradient block w-full text-center text-sm"
                      >
                        {p.cta}
                      </a>
                    ) : (
                      <a
                        href="/auth/register"
                        className="btn-secondary-brand block w-full text-center text-sm"
                      >
                        {p.cta}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10">
          <button
            type="button"
            onClick={() => setOpenCompare((v) => !v)}
            className="mx-auto flex items-center gap-2 rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm text-text-secondary hover:text-foreground"
            aria-expanded={openCompare}
          >
            Comparar planes en detalle
            <ChevronDown
              className={`h-4 w-4 transition-transform ${openCompare ? "rotate-180" : ""}`}
            />
          </button>

          <AnimatePresence>
            {openCompare && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <CompareTable />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function CompareTable() {
  const rows: Array<[string, string, string, string]> = [
    ["Generaciones / mes", "10", "500", "Ilimitadas"],
    ["Herramientas IA", "3", "8", "8+ API"],
    ["Marketplace", "—", "✓", "✓"],
    ["Export PDF / DOCX", "—", "✓", "✓ White-label"],
    ["AI Consultor", "—", "100 msgs", "Ilimitado"],
    ["Comisión de afiliado", "—", "30%", "40%"],
    ["Soporte", "Comunidad", "Email 24h", "Prioritario"],
  ];
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-text-secondary">
          <tr>
            <th className="px-4 py-3 font-medium">Característica</th>
            <th className="px-4 py-3 font-medium">Free</th>
            <th className="px-4 py-3 font-medium">Pro</th>
            <th className="px-4 py-3 font-medium">Business</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-white/5 bg-surface-1/40">
              <td className="px-4 py-3 text-foreground">{r[0]}</td>
              <td className="px-4 py-3 text-text-secondary">{r[1]}</td>
              <td className="px-4 py-3 text-text-secondary">{r[2]}</td>
              <td className="px-4 py-3 text-text-secondary">{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Use cases carousel ---------- */
const USE_CASES = [
  {
    title: "Freelancer automatiza propuestas",
    desc: "Envía propuestas personalizadas en minutos y duplica su tasa de cierre.",
    tools: ["Copywriter IA", "Consultor IA"],
  },
  {
    title: "Coach lanza su infoproducto",
    desc: "Estructura curso, landing y emails sin equipo técnico.",
    tools: ["Business Plan IA", "Email Marketing"],
  },
  {
    title: "Agencia escala contenido",
    desc: "Genera contenido consistente para 10+ clientes en paralelo.",
    tools: ["Social Media Pack", "Copywriter IA"],
  },
  {
    title: "E-commerce optimiza fichas",
    desc: "Redacta descripciones que convierten y campañas de email.",
    tools: ["Copywriter IA", "Email Marketing"],
  },
  {
    title: "Creador vende templates",
    desc: "Publica sus prompts y guías en el marketplace y genera ingresos pasivos.",
    tools: ["Marketplace"],
  },
  {
    title: "Consultor 24/7",
    desc: "Prepara reuniones y estrategias con un asesor IA siempre disponible.",
    tools: ["Consultor IA", "Business Plan IA"],
  },
  {
    title: "Emprendedor valida ideas",
    desc: "Prueba modelos de negocio y proyecciones en horas, no semanas.",
    tools: ["Business Plan IA"],
  },
  {
    title: "Community manager en piloto automático",
    desc: "Un mes de contenido calendarizado en una sola sesión.",
    tools: ["Social Media Pack"],
  },
] as const;

function UseCases() {
  const [paused, setPaused] = useState(false);
  return (
    <section className="relative overflow-hidden py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Casos de uso"
          title="Pensado para todos los perfiles"
          subtitle="Escenarios reales para inspirarte. No son testimonios de clientes."
        />
      </div>

      <div
        className="relative mt-14"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent"
        />

        <div className="overflow-hidden">
          <div
            className="flex w-max gap-6 px-4 animate-marquee"
            style={{ animationPlayState: paused ? "paused" : "running" }}
          >
            {[...USE_CASES, ...USE_CASES].map((u, i) => (
              <article
                key={`${u.title}-${i}`}
                className="glass-card w-[320px] shrink-0 rounded-2xl p-6"
              >
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15 text-brand-2">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-bold">{u.title}</h3>
                <p className="mt-2 text-sm text-text-secondary">{u.desc}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {u.tools.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-white/10 bg-surface-3 px-2.5 py-0.5 text-xs text-text-secondary"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Affiliate teaser ---------- */
function AffiliateTeaser() {
  return (
    <section id="afiliados" className="relative py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand/25 via-brand/10 to-brand-2/15 p-8 sm:p-14">
          <div
            aria-hidden
            className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand/40 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-brand-2/40 blur-3xl"
          />

          <div className="relative grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs text-text-secondary backdrop-blur">
                Programa de afiliados
              </span>
              <h2 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">
                Gana el <span className="text-gradient-brand">30% recurrente</span> por cada
                referido{" "}
                <span className="text-text-secondary">(40% con plan Business)</span>
              </h2>
              <p className="mt-4 text-lg text-text-secondary">
                Cada persona que traigas te paga mes a mes. Sin techo de ingresos.
              </p>
              <a
                href="/auth/register"
                className="btn-primary-gradient mt-8 inline-flex items-center gap-2"
              >
                Unirte al programa <ArrowRight className="h-4 w-4" />
              </a>
            </div>

            <div className="glass-card rounded-2xl p-6">
              <span className="text-xs font-medium uppercase tracking-widest text-text-muted">
                Ejemplo ilustrativo
              </span>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-display text-5xl font-extrabold text-gradient-brand">
                  $87
                </span>
                <span className="text-text-secondary">/mes recurrentes</span>
              </div>
              <p className="mt-2 text-sm text-text-secondary">
                10 referidos en plan Pro anual × 30% de comisión.
              </p>
              <div className="mt-5 h-px w-full bg-white/5" />
              <ul className="mt-5 space-y-2 text-sm text-text-secondary">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" /> Cookies de 60 días
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" /> Pagos mensuales por Lemon Squeezy
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" /> Dashboard con métricas en vivo
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQS = [
  {
    q: "¿Necesito conocimientos técnicos para usar PostulPro?",
    a: "No. Todo funciona con lenguaje natural: describís lo que necesitás y la IA arma el resultado. No hace falta programar, ni saber de prompts.",
  },
  {
    q: "¿Cuánto dura el período gratis?",
    a: "El plan Free no expira: podés usarlo tanto como quieras dentro de los límites mensuales. No pedimos tarjeta de crédito para empezar.",
  },
  {
    q: "¿Puedo cancelar cuando quiera?",
    a: "Sí. Cancelás desde tu panel en un clic, sin llamadas ni formularios. Mantenés el acceso hasta el final del período pagado.",
  },
  {
    q: "¿Las generaciones no usadas se acumulan?",
    a: "Los créditos mensuales se reinician cada ciclo de facturación. Podés comprar créditos adicionales si necesitás más en un mes puntual.",
  },
  {
    q: "¿En qué idiomas funciona?",
    a: "Español, inglés, portugués, francés, italiano, alemán y más. La calidad es equivalente en todos los idiomas principales.",
  },
  {
    q: "¿Puedo usar el contenido comercialmente?",
    a: "Sí. Todo lo que generás con PostulPro es tuyo y podés usarlo en tus productos, clientes y campañas sin restricciones.",
  },
  {
    q: "¿Qué tan buena es la calidad de la IA?",
    a: "Combinamos Claude 3.5 y GPT-4o con prompts optimizados para cada caso. La calidad es de nivel profesional y siempre editable.",
  },
  {
    q: "¿Qué límites tiene el marketplace?",
    a: "Podés vender templates, prompts y guías. Nos quedamos con una comisión pequeña por transacción, el resto es tuyo. Sin exclusividad.",
  },
  {
    q: "¿Puedo comprar créditos adicionales?",
    a: "Sí. Desde el panel podés comprar packs extra que se suman a tu cuota mensual y no expiran mientras tengas el plan activo.",
  },
  {
    q: "¿Hay API para developers?",
    a: "El plan Business incluye acceso a la API personal para integrar PostulPro en tus propios productos o flujos automatizados.",
  },
];

function FAQ() {
  return (
    <section className="relative py-24 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Preguntas frecuentes"
          title="Todo lo que necesitas saber"
        />
        <Accordion type="single" collapsible className="mt-10 space-y-3">
          {FAQS.map((f, i) => (
            <AccordionItem
              key={f.q}
              value={`item-${i}`}
              className="rounded-2xl border border-white/10 bg-surface-1 px-5 data-[state=open]:border-brand/30"
            >
              <AccordionTrigger className="text-left font-display text-base font-semibold hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-text-secondary">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer() {
  const cols = [
    {
      title: "Producto",
      links: ["Herramientas", "Precios", "Marketplace", "Novedades"],
    },
    { title: "Empresa", links: ["Sobre nosotros", "Blog", "Afiliados", "Contacto"] },
    { title: "Legal", links: ["Términos", "Privacidad", "Cookies", "DMCA"] },
    { title: "Recursos", links: ["Ayuda", "API docs", "Comunidad", "Estado"] },
  ];

  return (
    <footer className="relative border-t border-white/5 bg-surface-1">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-text-secondary">
              Convertí tu conocimiento y la IA en productos digitales que venden solos.
            </p>
            <form
              className="mt-6 flex max-w-sm gap-2"
              onSubmit={(e) => e.preventDefault()}
              aria-label="Suscribirse al newsletter"
            >
              <input
                type="email"
                required
                placeholder="tu@email.com"
                className="w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm placeholder:text-text-muted focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <button type="submit" className="btn-primary-gradient text-sm">
                Suscribirme
              </button>
            </form>
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
                {c.title}
              </h4>
              <ul className="mt-4 space-y-2">
                {c.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-text-secondary transition-colors hover:text-foreground"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/5 pt-8 sm:flex-row">
          <p className="text-xs text-text-muted">
            © 2026 PostulPro — Hecho con IA en Argentina 🇦🇷
          </p>
          <div className="flex items-center gap-3">
            {[Twitter, Instagram, Linkedin, Youtube].map((Icon, i) => (
              <a
                key={i}
                href="#"
                aria-label="Red social"
                className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-surface-2 text-text-secondary transition-colors hover:text-foreground"
              >
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ---------- Section heading ---------- */
function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">
        {eyebrow}
      </span>
      <h2 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-base text-text-secondary sm:text-lg">{subtitle}</p>
      )}
    </div>
  );
}
