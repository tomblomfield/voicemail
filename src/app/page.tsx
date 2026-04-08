import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Voicemail AI — Hands-free email & calendar",
  description:
    "Triage your inbox by voice on your commute. Connect Gmail, tap Start, and your AI assistant reads and handles emails hands-free.",
};

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="8" x="2" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  );
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

const steps = [
  {
    number: "1",
    title: "Connect your Gmail",
    description: "Sign in with Google and grant email & calendar access. Takes 10 seconds.",
  },
  {
    number: "2",
    title: "Tap Start",
    description: "Your AI assistant begins reading your unread emails aloud, one by one.",
  },
  {
    number: "3",
    title: "Handle by voice",
    description: "Reply, skip, archive, block, or unsubscribe — just say the word.",
  },
];

const features = [
  {
    icon: MailIcon,
    title: "Email triage",
    description: "Your AI reads a summary of each email — sender, subject, key points — then asks what to do.",
  },
  {
    icon: CalendarIcon,
    title: "Calendar aware",
    description: "Ask about your schedule, check upcoming meetings, or create calendar invites by voice.",
  },
  {
    icon: ZapIcon,
    title: "Smart replies",
    description: "Tell the AI what to say. It drafts the reply and reads it back for confirmation before sending.",
  },
  {
    icon: FilterIcon,
    title: "Auto-filters",
    description: "Say \"auto-archive emails like this\" and the AI creates Gmail filters to keep your inbox clean.",
  },
  {
    icon: EyeOffIcon,
    title: "Unsubscribe",
    description: "Say \"unsubscribe\" and the AI finds and follows the unsubscribe link for you automatically.",
  },
  {
    icon: MicIcon,
    title: "Real-time voice",
    description: "Powered by OpenAI's Realtime API. Low-latency, natural conversation — no typing needed.",
  },
];

const privacyItems = [
  {
    icon: ShieldIcon,
    title: "No email storage",
    description: "We never store your emails on our servers. Data is fetched live from Gmail and processed in-memory during your session.",
  },
  {
    icon: ServerIcon,
    title: "Encrypted sessions",
    description: "Your Google OAuth tokens are encrypted with AES-256-GCM and stored only in a secure HTTP-only cookie on your device.",
  },
  {
    icon: EyeOffIcon,
    title: "Minimal permissions",
    description: "We request only the Gmail and Calendar scopes needed to triage email and manage your schedule. Nothing more.",
  },
  {
    icon: CodeIcon,
    title: "Open source",
    description: "The entire codebase is open source. Audit the code yourself — there's nothing hidden.",
    link: "https://github.com/tomblomfield/voicemail",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white selection:bg-indigo-500/30">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/30 via-gray-950 to-gray-950" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-indigo-500/[0.08] rounded-full blur-3xl" />

        <div className="relative max-w-3xl mx-auto px-6 pt-20 pb-24 text-center">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
            Your inbox
            <br />
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              hands-free
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-400 max-w-xl mx-auto mb-10 leading-relaxed">
            Voicemail AI triages your Gmail by voice. Reply, archive, unsubscribe,
            and manage your calendar — all without touching your phone.
          </p>

          <div className="flex justify-center">
            <Link
              href="/api/auth"
              className="inline-flex items-center gap-3 bg-white text-gray-950 font-semibold text-lg px-8 py-4 rounded-2xl hover:bg-gray-100 active:scale-[0.98] transition-all shadow-lg shadow-white/10"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Connect Gmail &amp; get started
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-14">
          How it works
        </h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="w-12 h-12 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-lg flex items-center justify-center mx-auto mb-4 border border-indigo-500/20">
                {step.number}
              </div>
              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-3xl mx-auto px-6">
        <div className="border-t border-gray-800/60" />
      </div>

      {/* Features */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">
          Everything you need, nothing you don&apos;t
        </h2>
        <p className="text-gray-400 text-center mb-14 max-w-lg mx-auto">
          Built for commuters who want to clear their inbox without looking at a screen.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="p-6 rounded-2xl border border-gray-800/60 bg-gray-900/40 hover:border-gray-700/60 transition-colors"
            >
              <feature.icon className="w-6 h-6 text-indigo-400 mb-4" />
              <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-3xl mx-auto px-6">
        <div className="border-t border-gray-800/60" />
      </div>

      {/* Privacy */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 text-emerald-300 text-sm font-medium mb-4 px-4 py-2 rounded-full border border-emerald-500/20 bg-emerald-500/10">
            <ShieldIcon className="w-4 h-4" />
            Your data stays yours
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Privacy-first by design
          </h2>
          <p className="text-gray-400 max-w-lg mx-auto">
            We know connecting your Gmail is a big ask. Here&apos;s exactly how we handle your data.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {privacyItems.map((item) => (
            <div
              key={item.title}
              className="p-6 rounded-2xl border border-gray-800/60 bg-gray-900/40"
            >
              <item.icon className="w-6 h-6 text-emerald-400 mb-4" />
              <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                {item.description}
              </p>
              {"link" in item && item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 underline underline-offset-4 transition-colors text-sm mt-1 inline-block"
                >
                  View on GitHub
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Ready to go hands-free?
        </h2>
        <p className="text-gray-400 mb-8 max-w-md mx-auto">
          Connect your Gmail and triage your inbox by voice in under 60 seconds.
        </p>
        <Link
          href="/api/auth"
          className="inline-flex items-center gap-3 bg-white text-gray-950 font-semibold text-lg px-8 py-4 rounded-2xl hover:bg-gray-100 active:scale-[0.98] transition-all shadow-lg shadow-white/10"
        >
          Get started — it&apos;s free
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800/60">
        <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div className="font-medium text-gray-400">Voicemail AI</div>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-gray-300 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-300 transition-colors">
              Terms
            </Link>
            <a
              href="https://github.com/tomblomfield/voicemail"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
