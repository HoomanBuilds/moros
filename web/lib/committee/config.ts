import { NETWORK } from "@/lib/network";

if (!NETWORK.privateServiceUrl) {
  throw new Error(
    `NEXT_PUBLIC_${NETWORK.id.toUpperCase()}_PRIVATE_SERVICE_URL is required`,
  );
}

export const COMMITTEE_URL = NETWORK.privateServiceUrl;
