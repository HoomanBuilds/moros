export type ThemeMode = "system" | "light" | "dark";

export type MorosTheme = {
  dark: boolean;
  background: string;
  surface: string;
  elevated: string;
  text: string;
  muted: string;
  subtle: string;
  border: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  danger: string;
  inverse: string;
  onInverse: string;
  scrim: string;
};

export const lightTheme: MorosTheme = {
  dark: false,
  background: "#F4F2ED",
  surface: "#FCFBF8",
  elevated: "#FFFFFF",
  text: "#0A0A0A",
  muted: "#68645E",
  subtle: "#9D9890",
  border: "#D7D2CA",
  accent: "#D978B7",
  accentSoft: "#F5DEEC",
  onAccent: "#170F14",
  success: "#167A55",
  danger: "#B9383D",
  inverse: "#0B0B0D",
  onInverse: "#F8F5EF",
  scrim: "rgba(0,0,0,0.52)",
};

export const darkTheme: MorosTheme = {
  dark: true,
  background: "#080809",
  surface: "#101013",
  elevated: "#17171B",
  text: "#F7F4EF",
  muted: "#AAA49C",
  subtle: "#706C67",
  border: "#2B2A2F",
  accent: "#ECA8D6",
  accentSoft: "#392432",
  onAccent: "#160D13",
  success: "#65D6AA",
  danger: "#FF8D91",
  inverse: "#F7F4EF",
  onInverse: "#080809",
  scrim: "rgba(0,0,0,0.68)",
};

export const fonts = {
  sans: "InstrumentSans_400Regular",
  medium: "InstrumentSans_500Medium",
  semibold: "InstrumentSans_600SemiBold",
  serif: "InstrumentSerif_400Regular",
  serifItalic: "InstrumentSerif_400Regular_Italic",
};
