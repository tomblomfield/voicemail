import type { Metadata } from "next";
import CopyUrlButton from "./CopyUrlButton";

export const metadata: Metadata = {
  title: "Open in browser — Voicemail AI",
  description:
    "Please open this link in Safari or Chrome to sign in with Google.",
};

export default function OpenInBrowserPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold mb-4">
          Open in your browser
        </h1>

        <p className="text-gray-400 leading-relaxed mb-8">
          Google doesn&apos;t allow sign-in from in-app browsers (like the one
          inside Twitter, Instagram, or LinkedIn). Please open this page in{" "}
          <span className="text-white font-medium">Safari</span> or{" "}
          <span className="text-white font-medium">Chrome</span> to continue.
        </p>

        {/* Instructions */}
        <div className="text-left space-y-4 mb-10">
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-sm flex items-center justify-center shrink-0 border border-indigo-500/20">
              1
            </div>
            <p className="text-gray-300 text-sm leading-relaxed pt-1">
              Tap the <span className="text-white font-medium">menu</span> icon
              (usually <span className="font-mono text-white">&#8942;</span> or{" "}
              <span className="font-mono text-white">&#8230;</span>) in the
              top-right or bottom of your screen.
            </p>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-sm flex items-center justify-center shrink-0 border border-indigo-500/20">
              2
            </div>
            <p className="text-gray-300 text-sm leading-relaxed pt-1">
              Choose{" "}
              <span className="text-white font-medium">
                &ldquo;Open in Safari&rdquo;
              </span>{" "}
              or{" "}
              <span className="text-white font-medium">
                &ldquo;Open in browser&rdquo;
              </span>
              .
            </p>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-indigo-500/15 text-indigo-400 font-bold text-sm flex items-center justify-center shrink-0 border border-indigo-500/20">
              3
            </div>
            <p className="text-gray-300 text-sm leading-relaxed pt-1">
              Once the page reloads in your browser, tap{" "}
              <span className="text-white font-medium">
                &ldquo;Connect Gmail&rdquo;
              </span>{" "}
              to sign in.
            </p>
          </div>
        </div>

        <CopyUrlButton />

        <p className="text-gray-600 text-xs mt-6">
          This is a security requirement from Google, not a limitation of our
          app.
        </p>
      </div>
    </div>
  );
}
