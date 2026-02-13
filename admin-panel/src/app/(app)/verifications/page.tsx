// src/app/(app)/verifications/page.tsx
import DemoPage from "@/components/ui/DemoPage";

export default function Page() {
    return (
        <DemoPage
            title="Verifications"
            subtitle="Inbox of received presentations/proofs and verification results"
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Verifications" }]}
        />
    );
}
