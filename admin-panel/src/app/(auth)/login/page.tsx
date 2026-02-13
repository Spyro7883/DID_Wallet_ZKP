"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Card, CardContent, TextField, Typography, Button } from "@mui/material";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const onSubmit = async () => {
        setLoading(true);
        try {
            const res = await api<{ token: string }>("/admin/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
            });
            setToken(res.token);
            router.push("/dashboard");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
            <Card sx={{ width: 420 }}>
                <CardContent sx={{ p: 4 }}>
                    <Typography variant="h5" fontWeight={700} mb={1}>
                        Admin Panel
                    </Typography>
                    <Typography color="text.secondary" mb={3}>
                        Institution issuer / verifier
                    </Typography>

                    <TextField
                        fullWidth
                        label="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        sx={{ mb: 2 }}
                    />
                    <TextField
                        fullWidth
                        label="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        sx={{ mb: 2 }}
                    />

                    <Button fullWidth variant="contained" onClick={onSubmit} disabled={loading}>
                        {loading ? "Signing in..." : "Sign in"}
                    </Button>
                </CardContent>
            </Card>
        </Box>
    );
}
