"use client";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { rememberInvite } from "@/lib/invite";
import { Splash } from "@/components/gate";

/** Friend invite link: remember the code, then carry on to sign-in or home. */
function Join() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  useEffect(() => {
    if (code) rememberInvite(code);
    router.replace("/");
  }, [code, router]);
  return <Splash />;
}

export default function Page() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}
