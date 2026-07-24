export type DeploymentMetadata = {
  title: string;
  category: string;
  subject?: string;
  bannerDownloadUrl?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  resolutionSource?: string;
  backupResolutionSources?: string[];
  resolutionRules?: string;
  voidRules?: string;
};

export function strikeToRaw(strikeUsd: number): bigint {
  return BigInt(Math.round(strikeUsd * 1e4)) * 10_000_000_000n;
}
