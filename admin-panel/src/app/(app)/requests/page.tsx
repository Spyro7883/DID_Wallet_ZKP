// src/app/(app)/requests/page.tsx
import DemoPage from "@/components/ui/DemoPage";

export default function Page() {
    return (
        <DemoPage
            title="Proof Requests"
            subtitle="Create VP/ZKP requests (policy + challenge + constraints)"
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Requests" }]}
        />
    );
}
