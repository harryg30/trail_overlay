import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Trail Overlay",
  description: "Trail Overlay Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="h-full overflow-y-auto bg-background py-12 px-4 pb-48 sm:px-6 sm:pb-32 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        
        <div className="prose prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-2xl font-semibold mb-3">1. Introduction</h2>
            <p className="text-muted-foreground">
              Trail Overlay ("we", "our", or "us") is committed to protecting your privacy. 
              This Privacy Policy explains our practices regarding data collection, use, and protection.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">2. Data We Collect</h2>
            <p className="text-muted-foreground mb-2">We may collect the following types of information:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                <strong>Web Activity:</strong> Pages visited, timestamps, and referring URLs (via analytics)
              </li>
              <li>
                <strong>Cookies:</strong> Session cookies and preference cookies for site functionality
              </li>
              <li>
                <strong>User Content:</strong> Trail data, ride uploads, and edits you create
              </li>
              <li>
                <strong>Location Data:</strong> GPS coordinates and map interactions (client-side only)
              </li>
              <li>
                <strong>Authentication:</strong> Email and authentication tokens (if you create an account)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">3. How We Use Your Data</h2>
            <p className="text-muted-foreground mb-2">We use the data we collect to:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Provide, maintain, and improve our services</li>
              <li>Analyze site performance and user behavior (anonymized analytics)</li>
              <li>Store and manage the trail and ride data you create</li>
              <li>Authenticate your account and manage your sessions</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">4. Cookies</h2>
            <p className="text-muted-foreground mb-2">
              We use cookies to enhance your experience. You can control cookie preferences through:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Our in-app cookie consent banner</li>
              <li>Your browser settings</li>
              <li>The "Cookie Policy" link in our footer</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              Declining cookies may impact site functionality.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">5. Third-Party Services</h2>
            <p className="text-muted-foreground mb-2">We use the following third-party services:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                <strong>Vercel Analytics:</strong> For website analytics and performance monitoring
              </li>
              <li>
                <strong>Strava API:</strong> To fetch public trail segment data
              </li>
              <li>
                <strong>OpenStreetMap:</strong> For map layers and data
              </li>
            </ul>
            <p className="text-muted-foreground mt-2">
              Please review their privacy policies for details on how they process data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">6. Data Protection</h2>
            <p className="text-muted-foreground">
              We implement industry-standard security measures to protect your data. However, no 
              method of transmission over the internet is 100% secure. We cannot guarantee absolute 
              security but commit to protecting your information to the best of our ability.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">7. Data Retention</h2>
            <p className="text-muted-foreground">
              We retain user data for as long as your account is active or as needed to provide 
              services. You may request deletion of your account and associated data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">8. Your Rights</h2>
            <p className="text-muted-foreground mb-2">Depending on your location, you may have rights to:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Opt-out of data collection</li>
              <li>Data portability</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">9. Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time. We will notify you of significant 
              changes by updating the date below or by other appropriate means.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">10. Contact Us</h2>
            <p className="text-muted-foreground">
              If you have questions about this Privacy Policy or our privacy practices, please contact 
              us through the Contact form on our site.
            </p>
          </section>

          <section className="pt-6 border-t border-border">
            <p className="text-sm text-muted-foreground">
              <strong>Last Updated:</strong> April 2026
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
