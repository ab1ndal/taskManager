import { Suspense } from "react";
import { LoginCard } from "./login-card";

export default function LoginPage() {
  return (
    <main className="p-6">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </main>
  );
}
