import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Voicemail AI",
  description: "How Voicemail AI handles your data.",
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-950 text-white selection:bg-indigo-500/30">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-gray-500 hover:text-gray-300 transition-colors text-sm mb-8 inline-block"
        >
          &larr; Back to home
        </Link>

        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-gray-500 mb-12">Last updated: April 8, 2026</p>

        <div className="prose prose-invert prose-gray max-w-none space-y-8 text-gray-300 leading-relaxed [&_h2]:text-white [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-white [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-8 [&_h3]:mb-3 [&_strong]:text-white [&_a]:text-indigo-400 [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-indigo-300 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2">
          <p>
            Voicemail AI (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the website{" "}
            <a href="https://voicemail.audio">voicemail.audio</a> and the Voicemail AI
            application (the &quot;Service&quot;). This Privacy Policy explains how we collect,
            use, and protect your information when you use our Service.
          </p>

          <h2>1. What Voicemail AI does</h2>
          <p>
            Voicemail AI is a hands-free email and calendar assistant. You connect your
            Google account, and our AI reads your emails aloud, lets you reply by voice,
            archive messages, create Gmail filters, unsubscribe from mailing lists, and
            manage your calendar — all without touching your phone.
          </p>

          <h2>2. Information we access</h2>
          <p>
            When you connect your Google account, we request access to the following
            Google API scopes:
          </p>

          <h3>Gmail</h3>
          <ul>
            <li>
              <strong>Read your emails</strong> (gmail.readonly) — to fetch and summarize
              your unread messages so the AI can read them to you.
            </li>
            <li>
              <strong>Modify your emails</strong> (gmail.modify) — to mark messages as
              read, archive them, and apply labels when you ask.
            </li>
            <li>
              <strong>Send emails on your behalf</strong> (gmail.send) — to send replies
              and new emails that you compose by voice.
            </li>
            <li>
              <strong>Manage basic Gmail settings</strong> (gmail.settings.basic) — to
              create, update, and delete Gmail filters when you say things like
              &quot;auto-archive emails like this.&quot;
            </li>
          </ul>

          <h3>Google Calendar</h3>
          <ul>
            <li>
              <strong>Read your calendar</strong> (calendar.readonly) — to check your
              upcoming events and answer schedule questions.
            </li>
            <li>
              <strong>Create and edit events</strong> (calendar.events) — to create,
              update, or cancel calendar events by voice.
            </li>
          </ul>

          <h2>3. How we use your data</h2>
          <p>Your Google data is used exclusively to power the features described above. Specifically:</p>
          <ul>
            <li>
              <strong>Real-time processing only.</strong> Emails and calendar data are
              fetched live from Google&apos;s servers during your active session. We process
              them in memory to generate voice summaries and carry out your instructions.
              We do not store your emails, calendar events, or their contents on our
              servers.
            </li>
            <li>
              <strong>AI processing.</strong> Your email content is sent to OpenAI&apos;s
              Realtime API during your session so the AI can summarize messages and draft
              replies. This data is transmitted securely and used only to serve your
              immediate request. We do not use your data to train any AI or machine
              learning models.
            </li>
            <li>
              <strong>Actions you explicitly request.</strong> We only send emails, modify
              messages, create filters, or change calendar events when you specifically
              ask us to. The AI confirms actions with you before executing them.
            </li>
          </ul>

          <h2>4. What we store</h2>
          <ul>
            <li>
              <strong>OAuth tokens.</strong> When you sign in with Google, we receive an
              access token and refresh token. These are encrypted with AES-256-GCM and
              stored in a secure, HTTP-only cookie on your device. They are never stored
              on our servers in plaintext.
            </li>
            <li>
              <strong>No email content.</strong> We never write your emails, attachments,
              contacts, or calendar event details to our database or any persistent
              storage.
            </li>
            <li>
              <strong>Basic account information.</strong> We may store your email address
              for account identification and support purposes.
            </li>
          </ul>

          <h2>5. What we do not do with your data</h2>
          <ul>
            <li>We do not sell, rent, or trade your personal data to any third party.</li>
            <li>We do not use your Google data for advertising or ad targeting.</li>
            <li>We do not use your Google data to train generalized or foundational AI models.</li>
            <li>
              We do not allow humans to read your email content unless you explicitly
              request support assistance and provide consent.
            </li>
            <li>
              We do not transfer your Google data to third parties except as needed to
              provide the Service (i.e., OpenAI for AI processing), and those transfers
              comply with Google&apos;s policies.
            </li>
          </ul>

          <h2>6. Google API Services User Data Policy</h2>
          <div className="p-5 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
            <p>
              Voicemail AI&apos;s use and transfer to any other app of information received
              from Google APIs will adhere to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </div>

          <h2>7. Third-party services</h2>
          <p>We use the following third-party services to operate Voicemail AI:</p>
          <ul>
            <li>
              <strong>Google APIs</strong> (Gmail API, Google Calendar API) — to access
              your email and calendar data with your authorization.
            </li>
            <li>
              <strong>OpenAI</strong> (Realtime API) — to power voice interaction, email
              summarization, and reply drafting. Email content is sent to OpenAI only
              during active sessions and only to serve your requests.
            </li>
            <li>
              <strong>Railway</strong> — cloud hosting for the application. No user email
              content is persisted on Railway&apos;s infrastructure.
            </li>
          </ul>

          <h2>8. Data security</h2>
          <p>We take the following measures to protect your data:</p>
          <ul>
            <li>OAuth tokens are encrypted with AES-256-GCM before storage.</li>
            <li>All data in transit is encrypted via HTTPS/TLS.</li>
            <li>Tokens are stored in secure, HTTP-only cookies inaccessible to client-side JavaScript.</li>
            <li>
              The application is{" "}
              <a
                href="https://github.com/tomblomfield/voicemail"
                target="_blank"
                rel="noopener noreferrer"
              >
                open source
              </a>{" "}
              so anyone can audit the code.
            </li>
          </ul>

          <h2>9. Data retention and deletion</h2>
          <ul>
            <li>
              <strong>Session data</strong> is ephemeral and discarded when your session
              ends.
            </li>
            <li>
              <strong>OAuth tokens</strong> are stored in your browser cookie and expire
              or are deleted when you clear your cookies or revoke access.
            </li>
            <li>
              You can revoke Voicemail AI&apos;s access at any time from your{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Account permissions page
              </a>
              . Once revoked, we can no longer access any of your Google data.
            </li>
            <li>
              To request deletion of any data associated with your account, contact us at
              the email address below.
            </li>
          </ul>

          <h2>10. Children&apos;s privacy</h2>
          <p>
            Voicemail AI is not intended for use by anyone under the age of 13. We do
            not knowingly collect personal information from children under 13. If you
            believe a child has provided us with personal information, please contact us
            and we will delete it.
          </p>

          <h2>11. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of
            significant changes by posting the new policy on this page and updating the
            &quot;Last updated&quot; date. Your continued use of the Service after changes
            constitutes acceptance of the updated policy.
          </p>

          <h2>12. Contact us</h2>
          <p>
            If you have questions about this Privacy Policy or how we handle your data,
            please contact us at:
          </p>
          <p>
            <a href="mailto:privacy@voicemail.audio">privacy@voicemail.audio</a>
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
