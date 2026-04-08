import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Voicemail AI",
  description: "Terms of Service for Voicemail AI.",
};

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-950 text-white selection:bg-indigo-500/30">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-gray-500 hover:text-gray-300 transition-colors text-sm mb-8 inline-block"
        >
          &larr; Back to home
        </Link>

        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-gray-500 mb-12">Last updated: April 8, 2026</p>

        <div className="prose prose-invert prose-gray max-w-none space-y-8 text-gray-300 leading-relaxed [&_h2]:text-white [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-white [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-8 [&_h3]:mb-3 [&_strong]:text-white [&_a]:text-indigo-400 [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-indigo-300 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2">
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your use of Voicemail AI
            (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), accessible at{" "}
            <a href="https://voicemail.audio">voicemail.audio</a> (the
            &quot;Service&quot;). By using the Service, you agree to these Terms. If you
            do not agree, please do not use the Service.
          </p>

          <h2>1. Description of the Service</h2>
          <p>
            Voicemail AI is a voice-powered email and calendar assistant. It connects to
            your Google account (Gmail and Google Calendar) and uses AI to read your
            emails aloud, draft replies, manage your inbox, and handle your calendar —
            all by voice.
          </p>

          <h2>2. Eligibility</h2>
          <p>
            You must be at least 13 years old to use the Service. By using Voicemail AI,
            you represent that you meet this requirement and have the legal capacity to
            enter into these Terms.
          </p>

          <h2>3. Your Google account</h2>
          <p>
            To use Voicemail AI, you must connect a Google account and grant the
            requested permissions (OAuth scopes). You are responsible for:
          </p>
          <ul>
            <li>Maintaining the security of your Google account credentials.</li>
            <li>
              All activity that occurs through the Service using your connected account.
            </li>
            <li>
              Ensuring you have the right to grant us access to the Google account you
              connect (e.g., it is your personal account or you have authorization from
              the account owner).
            </li>
          </ul>
          <p>
            You can revoke Voicemail AI&apos;s access at any time from your{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Account permissions page
            </a>
            .
          </p>

          <h2>4. Acceptable use</h2>
          <p>You agree not to use the Service to:</p>
          <ul>
            <li>Violate any applicable laws or regulations.</li>
            <li>Send spam, phishing emails, or any unsolicited bulk messages.</li>
            <li>Harass, threaten, or harm others.</li>
            <li>
              Attempt to gain unauthorized access to our systems or other users&apos;
              accounts.
            </li>
            <li>
              Interfere with or disrupt the Service or its underlying infrastructure.
            </li>
            <li>
              Use the Service for any purpose that violates Google&apos;s Terms of
              Service or Acceptable Use Policy.
            </li>
          </ul>

          <h2>5. AI-generated content</h2>
          <p>
            Voicemail AI uses artificial intelligence (powered by OpenAI) to summarize
            emails, draft replies, and suggest actions. You acknowledge that:
          </p>
          <ul>
            <li>
              <strong>AI output may contain errors.</strong> Summaries may miss nuance,
              and drafted replies may not perfectly capture your intent. Always review
              AI-generated content before sending.
            </li>
            <li>
              <strong>You are responsible for what gets sent.</strong> The Service asks
              for your confirmation before sending emails or modifying your account. Once
              you confirm an action, you are responsible for it.
            </li>
            <li>
              <strong>We are not liable for AI errors.</strong> While we strive for
              accuracy, we do not guarantee that AI summaries or drafts will be complete,
              correct, or appropriate.
            </li>
          </ul>

          <h2>6. Actions on your account</h2>
          <p>
            Voicemail AI can perform actions on your Gmail and Calendar accounts at your
            direction, including:
          </p>
          <ul>
            <li>Sending emails and replies.</li>
            <li>Archiving, labeling, or marking messages as read.</li>
            <li>Creating, modifying, or deleting Gmail filters.</li>
            <li>Unsubscribing from mailing lists.</li>
            <li>Creating, updating, or deleting calendar events.</li>
          </ul>
          <p>
            These actions are performed only when you explicitly request them. The AI
            will describe the action and ask for confirmation before executing. However,
            some actions (such as sending an email or deleting a calendar event) may be
            irreversible. Use the Service with care.
          </p>

          <h2>7. Privacy</h2>
          <p>
            Your privacy is important to us. Please review our{" "}
            <Link href="/privacy">Privacy Policy</Link> to understand how we collect,
            use, and protect your information. By using the Service, you agree to the
            practices described in the Privacy Policy.
          </p>

          <h2>8. Intellectual property</h2>
          <p>
            The Voicemail AI application is open source under the{" "}
            <a
              href="https://opensource.org/licenses/MIT"
              target="_blank"
              rel="noopener noreferrer"
            >
              MIT License
            </a>
            . The source code is available at{" "}
            <a
              href="https://github.com/tomblomfield/voicemail"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/tomblomfield/voicemail
            </a>
            . The Voicemail AI name and logo are our trademarks and may not be used
            without permission.
          </p>

          <h2>9. Service availability</h2>
          <p>
            We aim to keep Voicemail AI available and reliable, but we do not guarantee
            uninterrupted access. The Service may be temporarily unavailable due to
            maintenance, updates, or circumstances beyond our control. We reserve the
            right to modify, suspend, or discontinue the Service at any time without
            prior notice.
          </p>

          <h2>10. Disclaimer of warranties</h2>
          <p>
            The Service is provided <strong>&quot;as is&quot;</strong> and{" "}
            <strong>&quot;as available&quot;</strong> without warranties of any kind,
            whether express or implied, including but not limited to warranties of
            merchantability, fitness for a particular purpose, and non-infringement.
          </p>

          <h2>11. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Voicemail AI and its operators shall
            not be liable for any indirect, incidental, special, consequential, or
            punitive damages, or any loss of profits, data, or goodwill, arising out of
            or related to your use of the Service. This includes, without limitation,
            damages arising from:
          </p>
          <ul>
            <li>Emails sent or actions taken through the Service.</li>
            <li>Errors or inaccuracies in AI-generated content.</li>
            <li>Unauthorized access to your account.</li>
            <li>Service interruptions or data loss.</li>
          </ul>

          <h2>12. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Voicemail AI and its operators from
            any claims, damages, losses, or expenses (including reasonable legal fees)
            arising from your use of the Service or violation of these Terms.
          </p>

          <h2>13. Termination</h2>
          <p>
            We may suspend or terminate your access to the Service at our discretion if
            we believe you have violated these Terms. You may stop using the Service at
            any time by revoking Google account access and clearing your browser cookies.
          </p>

          <h2>14. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. We will post the revised Terms
            on this page and update the &quot;Last updated&quot; date. Your continued use
            of the Service after changes constitutes acceptance of the updated Terms.
          </p>

          <h2>15. Governing law</h2>
          <p>
            These Terms are governed by and construed in accordance with the laws of
            the State of Delaware, United States, without regard to its conflict of law
            provisions. Any disputes arising from these Terms or your use of the Service
            shall be subject to the exclusive jurisdiction of the state and federal
            courts located in the State of Delaware.
          </p>

          <h2>16. Contact us</h2>
          <p>
            If you have questions about these Terms, please contact us at:
          </p>
          <p>
            <a href="mailto:support@voicemail.audio">support@voicemail.audio</a>
          </p>
        </div>
      </div>

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
