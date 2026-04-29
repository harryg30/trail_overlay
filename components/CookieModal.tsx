"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const COOKIE_CONSENT_KEY = "trail-overlay-cookie-consent";

interface CookieModalProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export default function CookieModal({ forceOpen, onClose }: CookieModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMounted(true);
      if (forceOpen) {
        setIsVisible(true);
        return;
      }

      const hasConsent = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (!hasConsent) {
        setIsVisible(true);
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [forceOpen]);

  useEffect(() => {
    if (!mounted) return;
    document.body.classList.toggle("cookie-consent-visible", isVisible);
    return () => {
      document.body.classList.remove("cookie-consent-visible");
    };
  }, [isVisible, mounted]);

  function handleAccept() {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    handleClose();
  }

  function handleDecline() {
    localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
    handleClose();
  }

  function handleClose() {
    setIsVisible(false);
    onClose?.();
  }

  if (!mounted || !isVisible) return null;

  return (
    <footer className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur-sm z-[999]">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex-1 pr-4">
            <h3 className="font-semibold text-sm mb-1">Cookie Consent</h3>
            <p className="text-sm text-muted-foreground">
              We use cookies to enhance your experience and analyze site usage. By
              continuing to use this site, you consent to our use of cookies.{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-electric underline-offset-2 hover:underline"
              >
                Learn more
              </a>
            </p>
          </div>
          <div className="flex gap-2 items-center shrink-0 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDecline}
              className="flex-1 sm:flex-none"
            >
              Decline
            </Button>
            <Button
              size="sm"
              onClick={handleAccept}
              className="flex-1 sm:flex-none"
            >
              Accept
            </Button>
            <button
              onClick={handleClose}
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss cookie consent"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
