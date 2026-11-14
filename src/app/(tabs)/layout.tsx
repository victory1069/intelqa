"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Gate } from "@/components/gate";
import { Screen, TabBar, TopNav } from "@/components/ui/kit";

/**
 * Home, Practise, Ranks and Me. Phones get the floating bottom tab bar; desktop gets a slim top bar
 * with a burger menu and a roomy centred column. Each page eases in when you switch tabs.
 */
export default function TabsLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <Gate>
      <div className="flex min-h-dvh flex-col">
        <TopNav />
        <div className="flex min-w-0 flex-1 justify-center">
          <Screen wide>
            <div key={path} className="page-in flex flex-1 flex-col">{children}</div>
            <TabBar />
          </Screen>
        </div>
      </div>
    </Gate>
  );
}
