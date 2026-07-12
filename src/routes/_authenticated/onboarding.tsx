import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { DollarSign, TrendingUp, PenLine, Rocket, GraduationCap, Loader2, ArrowRight, ArrowLeft, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Configurá tu cuenta — PostulPro" }] }),
  component: OnboardingPage,
});

const GOALS = [
  { id: "passive_income", icon: DollarSign, label: "Ingresos pasivos", emoji: "💰" },
  { id: "grow_business", icon: TrendingUp, label: "Crecer mi negocio", emoji: "📈" },
  { id: "better_content", icon: PenLine, label: "Mejor contenido", emoji: "✍️" },
  { id: "launch_startup", icon: Rocket, label: "Lanzar mi startup", emoji: "🚀" },
  { id: "learn_ai", icon: GraduationCap, label: "Aprender IA", emoji: "🎓" },
] as const;

const COUNTRIES = [
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "CL", name: "Chile", flag: "🇨🇱" },
  { code: "PE", name: "Perú", flag: "🇵🇪" },
  { code: "UY", name: "Uruguay", flag: "🇺🇾" },
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "US", name: "Estados Unidos", flag: "🇺🇸" },
  { code: "BR", name: "Brasil", flag: "🇧🇷" },
  { code: "OTHER", name: "Otro", flag: "🌎" },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState<string | null>(null);
  const [target, setTarget] = useState(2000);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [country, setCountry] = useState("AR");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // If onboarding already completed, redirect to dashboard
  useEffect(() => {
    if (!user) return;
    supabase
      .from("users")
      .select("onboarding_completed, name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.onboarding_completed) navigate({ to: "/dashboard" });
        if (data?.name) setName(data.name);
      });
  }, [user, navigate]);

  async function complete() {
    if (!user) return;
    setSaving(true);
    // Server-side RPC: grants the +50 welcome bonus exactly once, guarded by
    // onboarding_bonus_claimed so this can't be replayed for infinite credits.
    // goal/target/company are persisted as light personalization context for
    // the AI Project Builder's planner — never surfaced as a promise of
    // results, and target is entirely optional to skip.
    const { error } = await supabase.rpc("complete_onboarding", {
      p_name: name,
      p_country: country,
      p_bio: bio,
      p_primary_goal: goal,
      p_revenue_goal_6m: target > 0 ? target : null,
      p_company_name: company || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setShowWelcome(true);
  }

  const canNext =
    (step === 1 && goal !== null) ||
    (step === 2 && target > 0) ||
    (step === 3 && name.trim().length >= 2);

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <ProgressBar step={step} total={3} />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="mt-10"
          >
            {step === 1 && (
              <Step title="¿Cuál es tu principal objetivo?" subtitle="Elegí una opción — podés cambiarla después.">
                <div className="grid sm:grid-cols-2 gap-3">
                  {GOALS.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setGoal(g.id)}
                      className={`text-left p-5 rounded-xl border transition-all ${
                        goal === g.id
                          ? "border-violet-500 bg-violet-500/10 shadow-[0_0_0_1px_rgba(139,92,246,0.5)]"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      <div className="text-3xl mb-2">{g.emoji}</div>
                      <div className="font-semibold">{g.label}</div>
                    </button>
                  ))}
                </div>
              </Step>
            )}

            {step === 2 && (
              <Step
                title="¿Cuánto querés generar en los próximos 6 meses?"
                subtitle="Nos ayuda a personalizar tus recomendaciones."
              >
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="font-display text-5xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                      ${target.toLocaleString()}
                      {target >= 10000 && "+"}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">USD en los próximos 6 meses</p>
                  </div>
                  <input
                    type="range"
                    min={500}
                    max={10000}
                    step={100}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                    className="w-full accent-violet-500"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>$500</span>
                    <span>$10,000+</span>
                  </div>
                  <label className="block text-sm">
                    <span className="font-medium">O ingresá un monto exacto</span>
                    <input
                      type="number"
                      min={100}
                      value={target}
                      onChange={(e) => setTarget(Number(e.target.value) || 0)}
                      className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                  </label>
                </div>
              </Step>
            )}

            {step === 3 && (
              <Step title="Contanos sobre vos" subtitle="Solo para personalizar tu experiencia.">
                <div className="space-y-4">
                  <Field label="Nombre completo *" value={name} onChange={setName} placeholder="María Pérez" />
                  <Field label="Empresa o proyecto (opcional)" value={company} onChange={setCompany} placeholder="Mi Startup" />
                  <label className="block text-sm">
                    <span className="font-medium">País</span>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code} className="bg-background">
                          {c.flag} {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Bio corta</span>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      maxLength={200}
                      rows={3}
                      placeholder="Freelancer, dueño de agencia, creador de contenido..."
                      className="mt-1.5 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                    <span className="text-xs text-muted-foreground">{bio.length}/200</span>
                  </label>
                </div>
              </Step>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowLeft className="w-4 h-4" /> Atrás
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-40"
            >
              Siguiente <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={complete}
              disabled={!canNext || saving}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition disabled:opacity-40"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Completar
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showWelcome && (
          <WelcomeModal
            onClose={() => {
              setShowWelcome(false);
              navigate({ to: "/dashboard" });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Paso {step} de {total}</span>
        <span>{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          initial={false}
          animate={{ width: `${(step / total) * 100}%` }}
          transition={{ duration: 0.3 }}
          className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
        />
      </div>
    </div>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-2xl sm:text-3xl font-bold">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full h-11 rounded-lg bg-white/5 border border-white/10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
      />
    </label>
  );
}

function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
    >
      <ConfettiBurst />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-md rounded-2xl bg-gradient-to-br from-[#1A0B2E] to-[#07070E] border border-violet-500/30 p-8 text-center shadow-2xl"
      >
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center mb-4 shadow-lg">
          <Gift className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-bold">¡Bienvenido a PostulPro!</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Como regalo de bienvenida, te sumamos <strong className="text-foreground">50 créditos extra</strong> 🎁
        </p>
        <button
          onClick={onClose}
          className="mt-6 w-full h-11 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold text-sm hover:opacity-95 transition"
        >
          Empezar a crear
        </button>
      </motion.div>
    </motion.div>
  );
}

function ConfettiBurst() {
  const pieces = Array.from({ length: 40 });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.3;
        const duration = 1.5 + Math.random() * 1.5;
        const colors = ["#8b5cf6", "#d946ef", "#3b82f6", "#22d3ee", "#f59e0b"];
        const color = colors[i % colors.length];
        return (
          <motion.span
            key={i}
            initial={{ y: -20, opacity: 1, rotate: 0 }}
            animate={{ y: "100vh", opacity: 0, rotate: 720 }}
            transition={{ duration, delay, ease: "easeOut" }}
            className="absolute top-0 w-2 h-3 rounded-sm"
            style={{ left: `${left}%`, background: color }}
          />
        );
      })}
    </div>
  );
}
