import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#6D5EF2" }, // ajustezi după Figma
    background: { default: "#F6F7FB", paper: "#FFFFFF" },
  },
  shape: { borderRadius: 16 },
  components: {
    MuiCard: { styleOverrides: { root: { borderRadius: 16 } } },
    MuiButton: {
      styleOverrides: { root: { borderRadius: 12, textTransform: "none" } },
    },
  },
});

export default theme;
