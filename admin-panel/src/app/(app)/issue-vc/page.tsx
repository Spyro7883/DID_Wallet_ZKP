// src/app/(app)/issue-vc/page.tsx
import DemoPage from "@/components/ui/DemoPage";

export default function Page() {
    return (
        <DemoPage
            title="Issue VC"
            subtitle="Create and sign a verifiable credential for a subject"
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Issue VC" }]}
        />
    );
}
