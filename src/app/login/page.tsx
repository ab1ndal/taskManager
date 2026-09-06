import { Suspense } from "react";
import { LoginCard } from "./login-card";

export default function LoginPage() {
  return (
    // Signed out there is no nav, and `.safe-top` lives on the nav — so nothing else on this page
    // accounts for the notch and the card sits under the status bar on a standalone launch.
    <main className="safe-top p-6">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </main>
  );
}
