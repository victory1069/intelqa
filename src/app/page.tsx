"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Splash } from "@/components/gate";

/** Entry point: route by sign-in state. */
export default function Index() {
  const { status, me } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "signedOut") router.replace("/welcome");
    else if (status === "signedIn") router.replace(me && !me.onboarded ? "/setup" : "/home");
  }, [status, me, router]);
  return <Splash />;
}
