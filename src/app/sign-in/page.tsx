"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { takeNext } from "@/lib/next-url";
import { AppBar, Banner, Screen } from "@/components/ui/kit";
import { AuthForm } from "@/components/auth-form";

/** Student sign-in: email first; a password for returning accounts, a code for new ones. */
export default function SignIn() {
  const { status, me, expired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Accounts without a password are held by PasswordGate until they set one.
    if (status === "signedIn" && me && me.passwordSet !== false) router.replace(!me.onboarded ? "/setup" : takeNext(me.role !== "student" ? "/admin" : "/home"));
  }, [status, me, router]);

  return (
    <Screen>
      <AppBar onLead={() => router.push("/welcome")} />
      <div className="flex flex-1 flex-col gap-6 px-[22px] pt-1 pb-6">
        {expired && (
          <Banner tone="info" icon="lock">
            <strong>Sign in again to keep going.</strong> It&apos;s been a while, so we signed you out for safety. Your offline results are safe on this phone and will sync after you sign in.
          </Banner>
        )}
        <AuthForm />
        <span className="mt-auto text-center text-xs leading-relaxed text-ink3">By continuing you agree to the Terms and Privacy Policy.</span>
      </div>
    </Screen>
  );
}
