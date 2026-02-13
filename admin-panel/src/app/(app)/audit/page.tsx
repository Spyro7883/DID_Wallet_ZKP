// src/app/(app)/audit/page.tsx
import DemoPage from "@/components/ui/DemoPage";

export default function Page() {
    return (
        <DemoPage
            title="Audit"
            subtitle="Overview of issuer/verifier activity"
            breadcrumbs={[{ label: "Audit" }]}
        />
    );
}
