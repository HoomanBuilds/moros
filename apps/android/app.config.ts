import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Moros",
  slug: "moros-pay",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "moros",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "fun.moros.pay",
    associatedDomains: ["applinks:pay.moros.fun"],
  },
  android: {
    package: "fun.moros.pay",
    adaptiveIcon: {
      backgroundColor: "#F5F3EE",
      foregroundImage: "./assets/icon.png",
    },
    edgeToEdgeEnabled: true,
    softwareKeyboardLayoutMode: "resize",
    predictiveBackGestureEnabled: true,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "pay.moros.fun",
            pathPrefix: "/pay",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission: "Allow Moros to scan private payment codes.",
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#F5F3EE",
        image: "./assets/icon.png",
        imageWidth: 112,
        resizeMode: "contain",
        dark: {
          backgroundColor: "#080808",
          image: "./assets/icon.png",
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    paymentDeployment: process.env.EXPO_PUBLIC_PAYMENT_DEPLOYMENT ?? "",
  },
};

export default config;
