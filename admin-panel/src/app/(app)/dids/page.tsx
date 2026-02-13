// src/app/(app)/dids/page.tsx
import DemoPage from "@/components/ui/DemoPage";

export default function Page() {
    return (
        <DemoPage
            title="Institution DIDs"
            subtitle="Create, list and export institution identifiers"
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "DIDs" }]}
        />
    );
}
