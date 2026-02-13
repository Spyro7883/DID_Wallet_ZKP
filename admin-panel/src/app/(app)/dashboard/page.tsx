// src/app/(app)/dashboard/page.tsx
import DemoPage from "@/components/ui/DemoPage";

export default function Page() {
    return (
        <DemoPage
            title="Dashboard"
            subtitle="Overview of issuer/verifier activity"
            breadcrumbs={[{ label: "Dashboard" }]}
        />
    );
}
